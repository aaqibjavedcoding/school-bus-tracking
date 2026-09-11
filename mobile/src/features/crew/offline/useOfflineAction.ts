import { useCallback, useEffect, useState } from 'react';
import { ApiClientError } from '@school-bus-tracking/api-client';
import { cleanupSuccessful, enqueue, markOutcome } from './attendance-queue.ts';
import {
  getSyncState,
  refreshCounts,
  subscribeSyncState,
  syncNow,
  type SyncState,
} from './attendance-sync.ts';
import type { NewQueuedAction } from './queue-core.ts';

/** Live sync state of the crew offline queue. */
export function useSyncState(): SyncState {
  const [state, setState] = useState<SyncState>(() => getSyncState());
  useEffect(() => subscribeSyncState(setState), []);
  return state;
}

/** How an offline-capable crew action ended. */
export type OfflineActionResult =
  /** The API applied it right away. */
  | { mode: 'online' }
  /** No network (or the request never reached the server): safely queued. */
  | { mode: 'queued' };

/**
 * True for a failure where it is *unknown* whether the server applied the
 * request: fetch failed (status 0) or an upstream 5xx / 502-504 / 429. Those
 * are the only cases worth queueing — a 4xx answer means the server decided,
 * and queueing would just replay the same rejection.
 */
export function shouldQueueAfterError(error: unknown): boolean {
  if (error instanceof ApiClientError) {
    return error.status === 0 || error.status === 429 || error.status >= 500;
  }
  // Non-API errors (TypeError: Network request failed, aborted fetch…) are
  // network-level: nothing reached the server.
  return error instanceof Error;
}

/**
 * Runs `online()` first; when the request cannot reach the server the action
 * is queued for replay instead of being lost.
 *
 * **Idempotency contract:** `online()` must send the same idempotency key the
 * queued item will replay with — pass the key from `action` through
 * `withIdempotencyKey(...)`. That way "request reached the server but the
 * response was lost" replays as a dedupe hit, never as a second mutation.
 *
 * `execute` never throws for network failures; API rejections (4xx) still
 * throw so the caller can show the server's message.
 */
export function useOfflineAction() {
  const state = useSyncState();

  const execute = useCallback(
    async (
      action: NewQueuedAction,
      online: (idempotencyKey: string) => Promise<unknown>,
    ): Promise<OfflineActionResult> => {
      // Reserve the queue slot first so the key used online is the key that
      // will be replayed. The item is removed again on immediate success.
      const item = await enqueue(action);
      if (!state.isOnline) {
        void syncNow();
        return { mode: 'queued' };
      }
      try {
        await online(item.idempotencyKey);
      } catch (error) {
        if (shouldQueueAfterError(error)) {
          // Leave the reserved item pending; the manager retries with backoff.
          void syncNow();
          return { mode: 'queued' };
        }
        // Server rejected it: drop the reservation and surface the error.
        await markOutcome(item.id, { action: 'success' });
        await cleanupSuccessful();
        void refreshCounts();
        throw error;
      }
      await markOutcome(item.id, { action: 'success' });
      await cleanupSuccessful();
      void refreshCounts();
      return { mode: 'online' };
    },
    [state.isOnline],
  );

  return { execute, sync: state };
}
