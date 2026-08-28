import { createApiClient, ApiClient } from '@school-bus-tracking/api-client';
import { getAccessToken, setAccessToken, notifyUnauthorized } from './session';

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
});
