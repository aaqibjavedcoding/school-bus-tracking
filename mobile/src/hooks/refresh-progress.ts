/**
 * Pure progress tracking for loader hooks (`useLoad`, `usePagedResource`).
 *
 * Two deliberately independent signals:
 *
 *  - `loading` — the *blocking* signal: initial load and every
 *    dependency-driven reload.
 *  - `refreshing` — the *user pull* signal: pull-to-refresh only.
 *
 * Each signal has its own operation counter, so a signal is cleared exactly
 * when the operation that raised it finishes — no matter what other
 * operations have started in the meantime.
 *
 * The previous implementation shared one request id across both signals: a
 * dependency-driven `reload()` that started while a pull was in flight
 * invalidated the pull's completion, so `refreshing` was never cleared and
 * the blue pull indicator stayed pinned at the top of the screen as a
 * permanent "refreshing" status element. Data writes are still guarded by a
 * shared sequence (a stale response must never overwrite a newer one) —
 * only the progress flags are per-signal.
 */

export interface LoaderProgressTracker {
  /** Starts a blocking load (initial load or dependency-driven reload). */
  startLoad(): number;
  /**
   * A load finished. `true` — clear `loading` (this was the newest load);
   * `false` — a newer load superseded it, leave the flag; `null` — the
   * component unmounted, update nothing.
   */
  endLoad(id: number): boolean | null;
  /** Starts a user pull (pull-to-refresh). */
  startRefresh(): number;
  /**
   * A pull finished. `true` — clear `refreshing` (this was the newest pull;
   * intervening *loads* never block this); `false` — a newer pull superseded
   * it; `null` — unmounted.
   */
  endRefresh(id: number): boolean | null;
  /**
   * Shared data-write guard: `true` when the operation with this id is the
   * newest operation of any kind, so its response may be committed.
   */
  canWriteData(id: number): boolean;
  /** Marks the component mounted (idempotent; called from the mount effect). */
  mount(): void;
  /** Marks the component unmounted; all further updates are dropped. */
  unmount(): void;
}

export function createLoaderProgressTracker(): LoaderProgressTracker {
  let mounted = false;
  /** Shared sequence: newest operation of any kind wins the data write. */
  let dataSeq = 0;
  /**
   * Per-signal "newest" pointers, expressed in the shared data sequence so
   * each `end*` call can compare against the id its `start*` returned. The
   * load pointer never moves when a pull starts (and vice versa) — that
   * independence is the whole point of the split.
   */
  let latestLoadId = 0;
  let latestRefreshId = 0;

  return {
    startLoad(): number {
      dataSeq += 1;
      latestLoadId = dataSeq;
      return dataSeq;
    },
    endLoad(id: number): boolean | null {
      if (!mounted) {
        return null;
      }
      return id === latestLoadId;
    },
    startRefresh(): number {
      dataSeq += 1;
      latestRefreshId = dataSeq;
      return dataSeq;
    },
    endRefresh(id: number): boolean | null {
      if (!mounted) {
        return null;
      }
      return id === latestRefreshId;
    },
    canWriteData(id: number): boolean {
      return mounted && id === dataSeq;
    },
    mount(): void {
      mounted = true;
    },
    unmount(): void {
      mounted = false;
    },
  };
}
