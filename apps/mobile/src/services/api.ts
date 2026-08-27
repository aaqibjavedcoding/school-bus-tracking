import { createApiClient, ApiClient } from '@school-bus-tracking/api-client';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export const apiClient: ApiClient = createApiClient({
  baseUrl: API_BASE_URL,
});
