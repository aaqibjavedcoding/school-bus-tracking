import './env';
import { TEST_PASSWORD } from './fixtures';
import { httpRequest, readCookie } from './http';

/**
 * Session helper for the end-to-end suites.
 *
 * Sessions are obtained the way a real client obtains them — by posting real
 * credentials to `POST /auth/login` — so every assertion downstream exercises
 * the genuine token issued by the application.
 */
export interface TestSession {
  accessToken: string;
  refreshCookie: string | null;
  csrfCookie: string | null;
  cookies: string[];
  userId: string;
}

export interface LoginOptions {
  origin?: string | null;
  password?: string;
}

export async function login(
  baseUrl: string,
  schoolCode: string | null,
  email: string | null,
  options: LoginOptions = {},
): Promise<TestSession> {
  const result = await httpRequest<{
    success: boolean;
    data: { access_token: string; user: { id: string } };
  }>(baseUrl, '/auth/login', {
    method: 'POST',
    origin: options.origin ?? null,
    body: {
      school_id: schoolCode,
      email,
      password: options.password ?? TEST_PASSWORD,
    },
  });

  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`login failed (${result.status}): ${JSON.stringify(result.body)}`);
  }

  return {
    accessToken: result.body.data.access_token,
    refreshCookie: readCookie(result.cookies, 'refresh_token'),
    csrfCookie: readCookie(result.cookies, 'csrf_token'),
    cookies: result.cookies,
    userId: result.body.data.user.id,
  };
}
