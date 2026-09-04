/**
 * Minimal HTTP helper for the end-to-end suites.
 *
 * Uses the platform `fetch` against a real listening server — no supertest,
 * no in-process shortcuts — so guards, middleware, cookies and headers behave
 * exactly as they do for a browser or the mobile app.
 */
export interface HttpResult<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
  /** `set-cookie` values, split per cookie. */
  cookies: string[];
}

export interface HttpOptions {
  method?: string;
  token?: string | null;
  origin?: string | null;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
}

export async function httpRequest<T = unknown>(
  baseUrl: string,
  path: string,
  options: HttpOptions = {},
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.origin) {
    headers.Origin = options.origin;
  }
  if (options.cookies && Object.keys(options.cookies).length > 0) {
    headers.Cookie = Object.entries(options.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
  });

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    status: response.status,
    headers: response.headers,
    body: body as T,
    cookies: response.headers.getSetCookie?.() ?? [],
  };
}

/** Extracts a cookie value from a `set-cookie` list. */
export function readCookie(cookies: string[], name: string): string | null {
  for (const cookie of cookies) {
    const match = cookie.match(new RegExp(`^${name}=([^;]*)`));
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

/** Error code carried by the project's standard error envelope. */
export function errorCode(body: unknown): string | undefined {
  return (body as { error?: { code?: string } })?.error?.code;
}

/** Message carried by the project's standard error envelope. */
export function errorMessage(body: unknown): string | undefined {
  return (body as { error?: { message?: string } })?.error?.message;
}
