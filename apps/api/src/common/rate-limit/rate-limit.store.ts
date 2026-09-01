/**
 * Rate-limit storage abstraction.
 *
 * The guard never talks to a concrete backend: it calls {@link RateLimitStore}
 * and gets back the post-increment state of a fixed window. That boundary is
 * what makes a distributed (Redis) implementation a drop-in addition later —
 * no guard, decorator or controller changes required.
 *
 * **Production note.** `MemoryRateLimitStore` counts per *process*. With N API
 * instances behind a load balancer the effective limit is N × configured
 * limit. That is documented in `docs/security.md` as a production dependency;
 * a Redis-backed store is intentionally out of scope for this phase, and
 * selecting `RATE_LIMIT_STORE=redis` fails fast rather than pretending to be
 * distributed.
 */
export interface RateLimitHit {
  /** Number of requests recorded in the current window, including this one. */
  count: number;
  /** Epoch ms at which the current window resets. */
  resetAt: number;
}

export interface RateLimitStore {
  /** Records one request against `key` and returns the resulting window state. */
  hit(key: string, windowMs: number, now?: number): Promise<RateLimitHit>;
  /** Drops a key (used to forgive successful logins). */
  reset(key: string): Promise<void>;
}

interface WindowState {
  count: number;
  resetAt: number;
}

/**
 * Process-local fixed-window counter.
 *
 * Expired windows are evicted lazily on access plus, when the map grows past
 * `maxKeys`, by a sweep — so a hostile client cannot grow the map without
 * bound.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, WindowState>();

  constructor(private readonly maxKeys = 50_000) {}

  async hit(key: string, windowMs: number, now: number = Date.now()): Promise<RateLimitHit> {
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      const created: WindowState = { count: 1, resetAt: now + windowMs };
      this.windows.set(key, created);
      this.maybeSweep(now);
      return { count: created.count, resetAt: created.resetAt };
    }
    existing.count += 1;
    return { count: existing.count, resetAt: existing.resetAt };
  }

  async reset(key: string): Promise<void> {
    this.windows.delete(key);
  }

  /** Current window state without recording a hit (used by tests/diagnostics). */
  peek(key: string, now: number = Date.now()): RateLimitHit | null {
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      return null;
    }
    return { count: existing.count, resetAt: existing.resetAt };
  }

  get size(): number {
    return this.windows.size;
  }

  private maybeSweep(now: number): void {
    if (this.windows.size <= this.maxKeys) {
      return;
    }
    for (const [key, state] of this.windows) {
      if (state.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}
