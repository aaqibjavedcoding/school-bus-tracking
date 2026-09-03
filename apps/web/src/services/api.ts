import { createApiClient, ApiClient } from '@school-bus-tracking/api-client';
import { getAccessToken, setAccessToken, notifyUnauthorized } from './session';
import { readManagedSchoolId } from '../features/managed/managed-school-store';

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
