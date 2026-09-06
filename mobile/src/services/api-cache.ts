/**
 * Tiny in-memory response cache for the mobile API client — the mobile port
 * of the web app's `src/lib/api-cache.ts`, same TTL and invalidation rules.
 *
 * Every screen visit used to re-fetch its list APIs even when the user had
 * just seen the same screen. This layer sits in front of the shared
 * `ApiClient`'s GETs and:
 *
 * - serves a fresh (< {@link FRESH_TTL_MS}) response without touching the
 *   network;
 * - serves a stale-but-recent (< {@link STALE_TTL_MS}) response instantly
 *   while revalidating in the background (stale-while-revalidate — a screen
 *   re-visit renders immediately, the data catches up on the next load);
 * - deduplicates concurrent identical GETs;
 * - drops **all** entries when any mutating request (POST/PATCH/PUT/DELETE)
 *   completes — a create/update/delete can affect any list, so invalidating
 *   everything is the only answer that can never serve stale rows.
 *
 * The cache is deliberately bounded ({@link MAX_ENTRIES}) and process-local:
 * it lives in app memory, dies with the app, and never persists user data.
 */

/** How long a cached response is served without revalidation. */
export const FRESH_TTL_MS = 30_000;

/** How long a stale response may still be served while it revalidates. */
export const STALE_TTL_MS = 120_000;

/** Upper bound on cached responses (oldest entries evicted first). */
export const MAX_ENTRIES = 200;

interface CacheEntry {
  value: unknown;
  storedAt: number;
}

/** The mobile app never switches tenant context, so the scope is constant —
 * kept in the key format anyway so both platforms share one shape. */
const CACHE_SCOPE = 'app';

/** Same key format as the web cache: `METHOD scope endpoint`. */
export function cacheKey(method: string, endpoint: string, scope: string = CACHE_SCOPE): string {
  return `${method} ${scope} ${endpoint}`;
}

/**
 * GET paths whose responses may be cached.
 *
 * Deliberately an allowlist of list-shaped, read-heavy endpoints: live
 * surfaces (tracking, sockets, SOS) and detail endpoints keep their exact
 * per-call behaviour. Query strings are part of the cache key, so `?page=2`
 * and `?search=x` never collide.
 */
const CACHEABLE_PATH_PATTERNS: RegExp[] = [
  /^\/students$/,
  /^\/buses$/,
  /^\/routes$/,
  /^\/stops$/,
  /^\/trips$/,
  /^\/parents$/,
  /^\/drivers$/,
  /^\/conductors$/,
  /^\/route-assignments$/,
  /^\/assignments$/,
  /^\/reports(?:\/[a-z0-9_]+)?$/,
  /^\/dashboard\/stats$/,
];

/** True when a GET to this endpoint may be answered from the cache. */
export function isCacheableGet(endpoint: string): boolean {
  const path = endpoint.split('?')[0] ?? endpoint;
  return CACHEABLE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

export interface CacheLookup<T = unknown> {
  /** Cached value, when one may be served right now. */
  value: T | null;
  /** True when the served value is stale and a revalidation was requested. */
  isStale: boolean;
}

export class ApiCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private hits = 0;
  private misses = 0;

  /** Snapshot for diagnostics/tests. */
  stats(): { entries: number; inflight: number; hits: number; misses: number } {
    return {
      entries: this.entries.size,
      inflight: this.inflight.size,
      hits: this.hits,
      misses: this.misses,
    };
  }

  /**
   * Reads an entry and classifies its freshness. `null` ⇒ must fetch.
   *
   * Fresh entries count as hits. Stale-but-servable entries also count as
   * hits (they are the stale-while-revalidate fast path).
   */
  peek<T = unknown>(key: string, now: number = Date.now()): CacheLookup<T> {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return { value: null, isStale: false };
    }
    const age = now - entry.storedAt;
    if (age >= STALE_TTL_MS) {
      // Too old even for stale-while-revalidate — drop it and refetch.
      this.entries.delete(key);
      this.misses += 1;
      return { value: null, isStale: false };
    }
    // Refresh recency so a hot entry is not evicted by {@link MAX_ENTRIES}.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return { value: entry.value as T, isStale: age >= FRESH_TTL_MS };
  }

  /** Stores a response (oldest entry evicted when the cache overflows). */
  set(key: string, value: unknown, now: number = Date.now()): void {
    this.entries.set(key, { value, storedAt: now });
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * Deduplicates concurrent fetches for one key: concurrent callers share a
   * single network round trip instead of stampeding the API.
   */
  inflightFor<T>(key: string): Promise<T> | null {
    return (this.inflight.get(key) as Promise<T> | undefined) ?? null;
  }

  trackInflight<T>(key: string, promise: Promise<T>): Promise<T> {
    this.inflight.set(
      key,
      promise.finally(() => {
        this.inflight.delete(key);
      }),
    );
    return promise;
  }

  /** Drops every entry. Called after any successful mutation. */
  clear(): void {
    this.entries.clear();
  }
}

/** Process-wide cache for the current app session. */
export const apiCache = new ApiCache();
