import { UserRole } from '@school-bus-tracking/shared-types';
import { ApiClientError } from '@school-bus-tracking/api-client';
import {
  MobileSession,
  parseAccessTokenExpiry,
  type LoginOutcome,
} from '../src/auth/mobile-session';
import type { KeyValueStorage, SessionKey } from '../src/storage/secure-store';

/**
 * Auth lifecycle for the mobile session (Task 23 §B): the flows that used to
 * have no coverage at all are exercised here against a fake api-client and a
 * fake storage — the exact seams the session is built on.
 */

function makeStorage(): KeyValueStorage & { values: Map<SessionKey, string> } {
  const values = new Map<SessionKey, string>();
  return {
    values,
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      if (value === null) {
        values.delete(key);
      } else {
        values.set(key, value);
      }
    },
  };
}

function jwt(expSecondsFromNow: number): string {
  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return [
    encode({ alg: 'HS256' }),
    encode({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
    'sig',
  ].join('.');
}

const verifiedUser = {
  id: 'user-1',
  email: 'driver@school.test',
  role: UserRole.DRIVER,
  first_name: 'Dana',
  last_name: 'Driver',
} as never;

type Accessors = {
  getAccessToken?: () => string | null;
  setAccessToken?: (token: string | null) => void;
  getRefreshToken?: () => Promise<string | null> | string | null;
  setRefreshToken?: (token: string | null) => void;
  onUnauthorized?: () => void;
};

function makeSession(
  options: {
    loginError?: unknown;
    /** Queue consumed by api.refresh(); entries are envelopes or thrown errors. */
    refreshResponses?: Array<{ data: unknown } | { error: unknown }>;
  } = {},
) {
  const storage = makeStorage();
  const accessorsRef: { current: Accessors } = { current: {} };
  const refreshQueue = [...(options.refreshResponses ?? [])];

  // Mirrors the real client's behaviour: an auth envelope is applied to the
  // token accessors the session provided.
  const applyTokens = (data: Record<string, unknown> | undefined) => {
    if (!data) {
      return;
    }
    if (typeof data.access_token === 'string') {
      accessorsRef.current.setAccessToken?.(data.access_token);
    }
    if (typeof data.refresh_token === 'string') {
      accessorsRef.current.setRefreshToken?.(data.refresh_token);
    }
  };

  const api = {
    handlers: {} as Accessors,
    login: jest.fn(async () => {
      if (options.loginError) {
        throw options.loginError;
      }
      const data = { access_token: jwt(3600), refresh_token: 'refresh-1', user: verifiedUser };
      applyTokens(data);
      return { data };
    }),
    refresh: jest.fn(async () => {
      const next = refreshQueue.shift();
      if (next && 'error' in next) {
        throw next.error;
      }
      const data = (next as { data?: Record<string, unknown> } | undefined)?.data ?? {
        access_token: jwt(3600),
        refresh_token: 'refresh-rotated',
        user: verifiedUser,
      };
      applyTokens(data);
      return { data };
    }),
    logout: jest.fn(async () => ({ data: { success: true } })),
  };

  const signedOut: Array<'logout' | 'expired' | 'invalid-session'> = [];
  const session = new MobileSession({
    storage,
    createClient: (accessors) => {
      accessorsRef.current = accessors;
      api.handlers = accessors;
      return api as never as import('@school-bus-tracking/api-client').ApiClient;
    },
    onSignedOut: (reason) => signedOut.push(reason),
  });
  return { session, storage, api, signedOut };
}

function httpError(status: number, message: string): ApiClientError {
  return new ApiClientError(message, status);
}

describe('MobileSession.login (Task 23 §B)', () => {
  it('stores the tokens and exposes the server-verified user', async () => {
    const { session, storage, api } = makeSession();
    const outcome: LoginOutcome = await session.login({
      school_id: 'SCH-1',
      email: 'driver@school.test',
      password: 'hunter2!',
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.user?.role).toBe(UserRole.DRIVER);
    expect(session.getSnapshot()).toMatchObject({ status: 'authenticated' });
    expect(storage.get('user')).toContain('"id":"user-1"');
    expect(storage.get('refresh_token')).toBe('refresh-1');
    expect(storage.get('access_token')).toContain('.');
    expect(api.handlers.getAccessToken).toBeDefined();
    expect(api.handlers.getAccessToken?.()).toContain('.');
    expect(api.login).toHaveBeenCalledTimes(1);
  });

  it('sends only the sign-in selectors — never a role, actor or tenant claim', async () => {
    const { session, api } = makeSession();
    await session.login({ school_id: 'SCH-1', email: 'a@b.c', password: 'x' });
    const body = (api.login as unknown as jest.Mock).mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(body).sort()).toEqual(['email', 'password', 'school_id']);
    // school_id here is the *typed* school code selector, not a session
    // claim; the tenant in the JWT is what the server trusts.
    expect(body.school_id).toBe('SCH-1');
    expect(body).not.toHaveProperty('role');
    expect(body).not.toHaveProperty('parent_id');
    expect(body).not.toHaveProperty('user_id');
  });

  it('surfaces the 401 message for invalid credentials and starts nothing', async () => {
    const { session, storage } = makeSession({
      loginError: httpError(401, 'Invalid email, password or school code.'),
    });
    const outcome = await session.login({ school_id: 'S', email: 'a@b.c', password: 'bad' });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('Invalid');
    expect(storage.get('refresh_token')).toBeNull();
    expect(session.getSnapshot().status).not.toBe('authenticated');
  });

  it('explains an inactive school (403)', async () => {
    const { session } = makeSession({ loginError: httpError(403, 'This school is inactive.') });
    const outcome = await session.login({ school_id: 'S', email: 'a@b.c', password: 'x' });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('inactive');
  });

  it('tells the user nothing was recorded when offline (no half-login)', async () => {
    const { session, storage } = makeSession({
      loginError: httpError(0, 'Network request failed'),
    });
    const outcome = await session.login({ school_id: 'S', email: 'a@b.c', password: 'x' });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/offline/i);
    expect(session.getSnapshot().networkError).toBe(true);
    expect(storage.get('user')).toBeNull();
  });
});

describe('MobileSession refresh rotation + expiry (Task 23 §B)', () => {
  it('rotates both tokens through the api-client accessors', async () => {
    const { session, storage, api } = makeSession({
      refreshResponses: [
        { data: { access_token: jwt(3600), refresh_token: 'refresh-rotated', user: verifiedUser } },
      ],
    });
    await session.login({ school_id: 'S', email: 'a@b.c', password: 'x' });
    expect(storage.get('refresh_token')).toBe('refresh-1');

    // Force the access token into the past, then ensureFresh must refresh.
    api.handlers.setAccessToken?.(jwt(-10));
    await session.ensureFresh();
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(storage.get('refresh_token')).toBe('refresh-rotated');
    expect(session.getSnapshot().status).toBe('authenticated');
  });

  it('clears the session when a needed refresh fails (expired)', async () => {
    const { session, storage, api, signedOut } = makeSession({
      refreshResponses: [{ error: httpError(401, 'refresh expired') }],
    });
    await session.login({ school_id: 'S', email: 'a@b.c', password: 'x' });
    api.handlers.setAccessToken?.(jwt(-10));
    await session.ensureFresh();
    expect(session.getSnapshot().status).toBe('anonymous');
    expect(storage.get('refresh_token')).toBeNull();
    expect(storage.get('user')).toBeNull();
    expect(storage.get('access_token')).toBeNull();
    expect(signedOut).toEqual(['expired']);
  });

  it('logs out server-side best-effort and always clears local keys', async () => {
    const { session, storage, api, signedOut } = makeSession();
    await session.login({ school_id: 'S', email: 'a@b.c', password: 'x' });
    api.logout.mockRejectedValueOnce(httpError(500, 'boom'));
    await session.logout();
    expect(api.logout).toHaveBeenCalled();
    expect(storage.get('refresh_token')).toBeNull();
    expect(storage.get('user')).toBeNull();
    expect(storage.get('expires_at')).toBeNull();
    expect(signedOut).toEqual(['logout']);
    expect(session.getSnapshot().status).toBe('anonymous');
  });

  it('keeps tokens when bootstrap cannot reach the API (offline ≠ logged out)', async () => {
    const restart = makeSession({
      refreshResponses: [{ error: httpError(0, 'Network request failed') }],
    });
    restart.storage.values.set('refresh_token', 'stored');
    await restart.session.bootstrap();
    expect(restart.storage.get('refresh_token')).toBe('stored');
    expect(restart.session.getSnapshot().networkError).toBe(true);
    expect(restart.signedOut).toEqual([]);
  });

  it('drops a repairable-but-dead session on bootstrap (invalid-session)', async () => {
    const restart = makeSession({
      refreshResponses: [{ error: httpError(401, 'refresh revoked') }],
    });
    restart.storage.values.set('refresh_token', 'stale');
    await restart.session.bootstrap();
    expect(restart.storage.get('refresh_token')).toBeNull();
    expect(restart.signedOut).toEqual(['invalid-session']);
  });
});

describe('parseAccessTokenExpiry', () => {
  it('reads the exp claim from a JWT payload', () => {
    const exp = parseAccessTokenExpiry(jwt(600));
    expect(exp).not.toBeNull();
    expect(Math.abs((exp as number) - (Date.now() + 600_000))).toBeLessThan(5_000);
  });

  it('returns null for garbage instead of throwing (fallback TTL applies upstream)', () => {
    expect(parseAccessTokenExpiry('not-a-jwt')).toBeNull();
    expect(parseAccessTokenExpiry('a.%%%b.c')).toBeNull();
  });
});
