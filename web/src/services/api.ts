import { createApiClient, ApiClient } from '@school-bus-tracking/api-client';
import type { ApiResponse } from '@school-bus-tracking/shared-types';
import { getAccessToken, setAccessToken, notifyUnauthorized } from './session';
import { readManagedSchoolId } from '../features/managed/managed-school-store';
import { apiCache, cacheKey, isCacheableGet } from '../lib/api-cache';

/**
 * Browser calls go to a same-origin `/api/v1` prefix. Next.js rewrites that
 * path to the Nest API so the user's browser never talks to localhost and
 * never needs a CORS exception for a second origin.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export const apiClient: ApiClient = createApiClient({
  baseUrl: API_BASE_URL,
  getAccessToken,
  setAccessToken,
  onUnauthorized: notifyUnauthorized,
  // Super Admin assisted management ("Manage Data"): while the context is
  // active, tenant resource calls are remapped onto the guarded
  // /admin/schools/:id/manage/* surface. The store is plain state — no import
  // cycle — and returns null for everyone else, keeping school users untouched.
  resolveManagedSchoolId: readManagedSchoolId,
});

/** Signature of the client's GET convenience method. */
type GetFn = <T>(endpoint: string, options?: RequestInit) => Promise<ApiResponse<T>>;
/** Signature of the client's body-carrying mutating convenience methods. */
type MutateFn = <T>(
  endpoint: string,
  body?: unknown,
  options?: RequestInit,
) => Promise<ApiResponse<T>>;
/** Signature of the client's DELETE convenience method. */
type DeleteFn = <T>(endpoint: string, options?: RequestInit) => Promise<ApiResponse<T>>;

/**
 * Cache scope of the current session.
 *
 * The same client method can hit two different endpoints depending on the
 * assisted-management context (`/students` vs
 * `/admin/schools/:id/manage/students`), so the active managed-school id is
 * part of every cache key. Flipping the context therefore can never serve a
 * response from the wrong school — and switching back reuses the earlier
 * school's still-warm cache.
 */
function cacheScope(): string {
  return readManagedSchoolId() ?? '-';
}

/**
 * Installs the 30s in-memory response cache (see `lib/api-cache`) on a
 * client instance.
 *
 * The instance's `get` is wrapped so **every** GET — including the ones the
 * `listX` helpers issue internally through `this.get` — is cache-keyed by
 * method + scope + endpoint + query. Mutating verbs invalidate the whole
 * cache on completion: a create/update/delete can affect any list, so
 * blanket invalidation is the only rule that can never serve stale rows
 * (worst case is one extra refetch).
 */
export function applyResponseCache(client: ApiClient): ApiClient {
  const originalGet: GetFn = client.get.bind(client);

  client.get = async <T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> => {
    // Only bare GETs (every list helper) are cached; anything with request
    // options keeps its exact per-call behaviour.
    if (options || !isCacheableGet(endpoint)) {
      return originalGet<T>(endpoint, options);
    }
    const key = cacheKey('GET', endpoint, cacheScope());
    const cached = apiCache.peek<ApiResponse<T>>(key);
    if (cached.value !== null) {
      const cachedValue: ApiResponse<T> = cached.value;
      if (cached.isStale) {
        // Stale-while-revalidate: answer from the cache now, refresh in the
        // background so the next visit is fresh. Shared with concurrent
        // callers through the inflight map.
        if (!apiCache.inflightFor<ApiResponse<T>>(key)) {
          apiCache.trackInflight<ApiResponse<T>>(
            key,
            originalGet<T>(endpoint).then((response) => {
              apiCache.set(key, response);
              return response;
            }),
          );
        }
      }
      return cachedValue;
    }
    const shared = apiCache.inflightFor<ApiResponse<T>>(key);
    if (shared) {
      return shared;
    }
    const promise = originalGet<T>(endpoint).then((response) => {
      apiCache.set(key, response);
      return response;
    });
    return apiCache.trackInflight<ApiResponse<T>>(key, promise);
  };

  const originalPost: MutateFn = client.post.bind(client);
  const originalPatch: MutateFn = client.patch.bind(client);
  const originalPut: MutateFn = client.put.bind(client);
  const originalDelete: DeleteFn = client.delete.bind(client);

  const invalidateAfter = async <T>(
    run: () => Promise<ApiResponse<T>>,
  ): Promise<ApiResponse<T>> => {
    try {
      return await run();
    } finally {
      // Even a failed mutation clears the cache: an extra refetch is cheap,
      // a stale row after a retried write is not.
      apiCache.clear();
    }
  };

  client.post = (async <T>(
    endpoint: string,
    body?: unknown,
    options?: RequestInit,
  ): Promise<ApiResponse<T>> =>
    invalidateAfter(() => originalPost<T>(endpoint, body, options))) as MutateFn;

  client.patch = (async <T>(
    endpoint: string,
    body?: unknown,
    options?: RequestInit,
  ): Promise<ApiResponse<T>> =>
    invalidateAfter(() => originalPatch<T>(endpoint, body, options))) as MutateFn;

  client.put = (async <T>(
    endpoint: string,
    body?: unknown,
    options?: RequestInit,
  ): Promise<ApiResponse<T>> =>
    invalidateAfter(() => originalPut<T>(endpoint, body, options))) as MutateFn;

  client.delete = (async <T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> =>
    invalidateAfter(() => originalDelete<T>(endpoint, options))) as DeleteFn;

  return client;
}

applyResponseCache(apiClient);
