import { beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { hashPassword, hashToken } from '../../auth';
import { RefreshToken, School, User } from '../../database/models';
import { AuthService } from './auth.service';
import {
  EXPIRED_REFRESH_TOKEN_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_REFRESH_TOKEN_MESSAGE,
  LOGOUT_SUCCESS_MESSAGE,
  REVOKED_REFRESH_TOKEN_MESSAGE,
} from './auth.constants';
import { LoginDto } from './dto/login.dto';

const JWT_SECRET = 'test-only-secret';
const JWT_EXPIRES_IN = '15m';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PASSWORD = 'correct-horse-battery';

interface StubUser {
  id: string;
  school_id: string;
  role: UserRole;
  first_name: string;
  last_name: string;
  email: string | null;
  password_hash: string | null;
  is_active: boolean;
}

interface StubRefreshToken {
  id: string;
  school_id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_token_id: string | null;
  save: () => Promise<void>;
}

/** In-memory stand-in for the tenant-scoped user lookup. */
function makeUsersRepository(
  user: StubUser | null,
  capture: { where?: unknown; findOneCalls?: number } = {},
) {
  return {
    unscoped: () => ({
      findOne: (options: { where: Record<string, unknown> }) => {
        capture.where = options.where;
        capture.findOneCalls = (capture.findOneCalls ?? 0) + 1;
        return Promise.resolve(user);
      },
    }),
  } as unknown as typeof User;
}

/** In-memory stand-in for the `School` model used to resolve a tenant code. */
function makeSchoolsRepository(schoolIdByCode: Record<string, string>) {
  return {
    findOne: (options: { where: { code: string } }) => {
      const id = schoolIdByCode[(options.where.code ?? '').toLowerCase()];
      return Promise.resolve(id ? { id } : null);
    },
  } as unknown as typeof School;
}

/** In-memory stand-in for the refresh tokens repository. */
function makeRefreshTokensRepository(
  initialTokens: StubRefreshToken[] = [],
  capture: { created?: StubRefreshToken[]; where?: unknown } = {},
) {
  const tokens = [...initialTokens];
  capture.created = [];

  return {
    tokens,
    repo: {
      unscoped: () => ({
        findOne: (options: { where: Record<string, unknown> }) => {
          capture.where = options.where;
          const match = tokens.find((t) => {
            if (options.where.token_hash && t.token_hash !== options.where.token_hash) {
              return false;
            }
            return true;
          });
          return Promise.resolve(match ?? null);
        },
      }),
      create: (payload: Partial<StubRefreshToken>) => {
        const id = `token-${tokens.length + 1}`;
        const record: StubRefreshToken = {
          id,
          school_id: payload.school_id ?? SCHOOL_ID,
          user_id: payload.user_id ?? USER_ID,
          token_hash: payload.token_hash ?? '',
          expires_at: payload.expires_at ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          revoked_at: payload.revoked_at ?? null,
          replaced_by_token_id: payload.replaced_by_token_id ?? null,
          save: async () => {},
        };
        tokens.push(record);
        capture.created?.push(record);
        return Promise.resolve(record);
      },
    } as unknown as typeof RefreshToken,
  };
}

function makeJwtService(): JwtService {
  return new JwtService({
    secret: JWT_SECRET,
    signOptions: { expiresIn: JWT_EXPIRES_IN },
  });
}

function makeConfigService(overrides: Record<string, unknown> = {}): ConfigService {
  const store: Record<string, unknown> = {
    'jwt.secret': JWT_SECRET,
    'jwt.expiresIn': JWT_EXPIRES_IN,
    'jwt.refreshExpiresIn': '7d',
    'jwt.refreshCookieName': 'refresh_token',
    'app.nodeEnv': 'test',
    'app.apiPrefix': 'api/v1',
    ...overrides,
  };
  return {
    get: (key: string, defaultValue?: unknown) => store[key] ?? defaultValue,
  } as unknown as ConfigService;
}

function makeLoginDto(overrides: Partial<LoginDto> = {}): LoginDto {
  const dto = new LoginDto();
  dto.school_id = SCHOOL_ID;
  dto.email = 'driver@school.org';
  dto.password = PASSWORD;
  return Object.assign(dto, overrides);
}

async function makeActiveUser(overrides: Partial<StubUser> = {}): Promise<StubUser> {
  return {
    id: USER_ID,
    school_id: SCHOOL_ID,
    role: UserRole.DRIVER,
    first_name: 'Dana',
    last_name: 'Driver',
    email: 'driver@school.org',
    password_hash: await hashPassword(PASSWORD),
    is_active: true,
    ...overrides,
  };
}

async function expectUnauthorized(
  promise: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof UnauthorizedException, 'expected an UnauthorizedException');
    assert.equal(error.getStatus(), 401);
    assert.equal(error.message, expectedMessage);
    return true;
  });
}

describe('AuthService.login', () => {
  let user: StubUser;

  beforeEach(async () => {
    user = await makeActiveUser();
  });

  it('returns a signed access token and public user data for valid credentials', async () => {
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    const result = await service.login(makeLoginDto());

    assert.equal(typeof result.response.access_token, 'string');
    assert.ok(result.response.access_token.split('.').length === 3, 'expected a JWT (3 segments)');
    assert.equal(result.response.token_type, 'Bearer');
    assert.deepEqual(result.response.user, {
      id: USER_ID,
      school_id: SCHOOL_ID,
      role: UserRole.DRIVER,
      first_name: 'Dana',
      last_name: 'Driver',
      email: 'driver@school.org',
    });
  });

  it('creates and persists a hashed refresh token associated with user and school', async () => {
    const capture: { created?: StubRefreshToken[] } = {};
    const { repo: refreshRepo } = makeRefreshTokensRepository([], capture);
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    const result = await service.login(makeLoginDto());

    assert.equal(typeof result.refreshToken, 'string');
    assert.equal(result.refreshToken.length, 64);
    assert.equal(capture.created?.length, 1);

    const createdRecord = capture.created![0];
    assert.equal(createdRecord.school_id, SCHOOL_ID);
    assert.equal(createdRecord.user_id, USER_ID);
    assert.equal(createdRecord.token_hash, hashToken(result.refreshToken));
    assert.equal(createdRecord.revoked_at, null);
    assert.equal(createdRecord.replaced_by_token_id, null);
    assert.ok(createdRecord.expires_at.getTime() > Date.now());
  });

  it('issues a JWT carrying exactly sub, school_id and role claims', async () => {
    const jwtService = makeJwtService();
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      jwtService,
      makeConfigService(),
    );

    const { response } = await service.login(makeLoginDto());
    const claims = await jwtService.verifyAsync<JwtAccessTokenPayload & Record<string, unknown>>(
      response.access_token,
      { secret: JWT_SECRET },
    );

    assert.equal(claims.sub, USER_ID);
    assert.equal(claims.school_id, SCHOOL_ID);
    assert.equal(claims.role, UserRole.DRIVER);
    // Only the three domain claims plus standard iat/exp timestamps
    assert.deepEqual(Object.keys(claims).sort(), ['exp', 'iat', 'role', 'school_id', 'sub']);
  });

  it('rejects a token signed with a different secret', async () => {
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );
    const { response } = await service.login(makeLoginDto());

    const verifier = new JwtService({ secret: 'a-different-secret' });
    await assert.rejects(verifier.verifyAsync(response.access_token));
  });

  it('reports the configured expiry via expires_in and the exp claim', async () => {
    const jwtService = makeJwtService();
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      jwtService,
      makeConfigService(),
    );

    const { response } = await service.login(makeLoginDto());
    const claims = jwtService.decode<{ exp: number; iat: number }>(response.access_token);

    assert.equal(response.expires_in, 15 * 60);
    assert.equal(claims.exp - claims.iat, 15 * 60);
  });

  it('normalizes the email before the tenant-scoped lookup', async () => {
    const capture: { where?: unknown } = {};
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(user, capture),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    await service.login(makeLoginDto({ email: '  Driver@School.ORG  ' }));

    assert.deepEqual(capture.where, { school_id: SCHOOL_ID, email: 'driver@school.org' });
  });

  it('resolves a school tenant code to its UUID before the user lookup', async () => {
    const capture: { where?: unknown } = {};
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(user, capture),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
      undefined,
      makeSchoolsRepository({ 'lincoln-high': SCHOOL_ID }),
    );

    const { response } = await service.login(makeLoginDto({ school_id: 'lincoln-high' }));

    // The tenant code was resolved to the school UUID before the lookup,
    // and the JWT still carries the resolved tenant id.
    assert.deepEqual(capture.where, { school_id: SCHOOL_ID, email: 'driver@school.org' });
    assert.equal(response.user.school_id, SCHOOL_ID);
  });

  it('returns generic 401 when the supplied school code is unknown', async () => {
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(null),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
      undefined,
      makeSchoolsRepository({}),
    );
    await expectUnauthorized(
      service.login(makeLoginDto({ school_id: 'no-such-school' })),
      INVALID_CREDENTIALS_MESSAGE,
    );
  });

  it('returns generic 401 when no user matches school_id + email', async () => {
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(null),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );
    await expectUnauthorized(service.login(makeLoginDto()), INVALID_CREDENTIALS_MESSAGE);
  });

  it('returns generic 401 for a wrong password', async () => {
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );
    await expectUnauthorized(
      service.login(makeLoginDto({ password: 'wrong-password' })),
      INVALID_CREDENTIALS_MESSAGE,
    );
  });

  it('returns generic 401 for a deactivated user even with the right password', async () => {
    const inactive = await makeActiveUser({ is_active: false });
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(inactive),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );
    await expectUnauthorized(service.login(makeLoginDto()), INVALID_CREDENTIALS_MESSAGE);
  });

  it('returns generic 401 for a user without stored credentials', async () => {
    const noCredentials = await makeActiveUser({ password_hash: null });
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(noCredentials),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );
    await expectUnauthorized(service.login(makeLoginDto()), INVALID_CREDENTIALS_MESSAGE);
  });

  it('never exposes password, password_hash, or refresh token in the response JSON', async () => {
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );
    const { response, refreshToken } = await service.login(makeLoginDto());

    const serialized = JSON.stringify(response);
    assert.ok(!serialized.includes('password'), 'response must not contain a password field');
    assert.ok(
      !serialized.includes(user.password_hash as string),
      'response must not contain the stored hash',
    );
    assert.ok(
      !serialized.includes(refreshToken),
      'response JSON must not expose the raw refresh token',
    );
  });
});

describe('AuthService.refresh & token rotation', () => {
  let user: StubUser;
  const rawToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const tokenHash = hashToken(rawToken);

  beforeEach(async () => {
    user = await makeActiveUser();
  });

  it('successfully refreshes token, issues new access token, and rotates refresh token', async () => {
    let oldTokenSaved = false;
    const existingToken: StubRefreshToken = {
      id: 'token-old-uuid',
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revoked_at: null,
      replaced_by_token_id: null,
      save: async () => {
        oldTokenSaved = true;
      },
    };

    const { repo: refreshRepo } = makeRefreshTokensRepository([existingToken]);
    const jwtService = makeJwtService();
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      jwtService,
      makeConfigService(),
    );

    const result = await service.refresh(rawToken);

    // 1. Issues a new access token
    assert.equal(typeof result.response.access_token, 'string');
    assert.equal(result.response.token_type, 'Bearer');
    assert.deepEqual(result.response.user, {
      id: USER_ID,
      school_id: SCHOOL_ID,
      role: UserRole.DRIVER,
      first_name: 'Dana',
      last_name: 'Driver',
      email: 'driver@school.org',
    });

    const claims = await jwtService.verifyAsync<JwtAccessTokenPayload>(
      result.response.access_token,
      { secret: JWT_SECRET },
    );
    assert.equal(claims.sub, USER_ID);
    assert.equal(claims.school_id, SCHOOL_ID);
    assert.equal(claims.role, UserRole.DRIVER);

    // 2. Refresh token rotation: old token is revoked and linked to replacement
    assert.ok(existingToken.revoked_at instanceof Date, 'old token must be revoked');
    assert.ok(existingToken.replaced_by_token_id !== null, 'replaced_by_token_id must be set');
    assert.ok(oldTokenSaved, 'old token save must be called');

    // 3. New refresh token is issued and returned separately
    assert.equal(typeof result.refreshToken, 'string');
    assert.notEqual(result.refreshToken, rawToken, 'must issue a brand new refresh token');
    assert.equal(result.refreshToken.length, 64);

    // 4. Response JSON does not contain refresh token
    const serialized = JSON.stringify(result.response);
    assert.ok(!serialized.includes(result.refreshToken));
    assert.ok(!serialized.includes(rawToken));
  });

  it('rejects an undefined or empty refresh token', async () => {
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    await expectUnauthorized(service.refresh(undefined), INVALID_REFRESH_TOKEN_MESSAGE);
    await expectUnauthorized(service.refresh(''), INVALID_REFRESH_TOKEN_MESSAGE);
    await expectUnauthorized(service.refresh('   '), INVALID_REFRESH_TOKEN_MESSAGE);
  });

  it('rejects a nonexistent refresh token', async () => {
    const { repo: refreshRepo } = makeRefreshTokensRepository([]);
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    await expectUnauthorized(service.refresh('nonexistent-token'), INVALID_REFRESH_TOKEN_MESSAGE);
  });

  it('rejects an already-revoked refresh token', async () => {
    const revokedToken: StubRefreshToken = {
      id: 'token-revoked-uuid',
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revoked_at: new Date(Date.now() - 1000),
      replaced_by_token_id: 'token-next-uuid',
      save: async () => {},
    };

    const { repo: refreshRepo } = makeRefreshTokensRepository([revokedToken]);
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    await expectUnauthorized(service.refresh(rawToken), REVOKED_REFRESH_TOKEN_MESSAGE);
  });

  it('rejects an expired refresh token', async () => {
    const expiredToken: StubRefreshToken = {
      id: 'token-expired-uuid',
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() - 1000), // in the past
      revoked_at: null,
      replaced_by_token_id: null,
      save: async () => {},
    };

    const { repo: refreshRepo } = makeRefreshTokensRepository([expiredToken]);
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    await expectUnauthorized(service.refresh(rawToken), EXPIRED_REFRESH_TOKEN_MESSAGE);
  });

  it('rejects refresh when associated user is deactivated', async () => {
    const inactiveUser = await makeActiveUser({ is_active: false });
    const existingToken: StubRefreshToken = {
      id: 'token-uuid',
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revoked_at: null,
      replaced_by_token_id: null,
      save: async () => {},
    };

    const { repo: refreshRepo } = makeRefreshTokensRepository([existingToken]);
    const service = new AuthService(
      makeUsersRepository(inactiveUser),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    await expectUnauthorized(service.refresh(rawToken), INVALID_CREDENTIALS_MESSAGE);
  });

  it('rejects refresh when associated user no longer exists', async () => {
    const existingToken: StubRefreshToken = {
      id: 'token-uuid',
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revoked_at: null,
      replaced_by_token_id: null,
      save: async () => {},
    };

    const { repo: refreshRepo } = makeRefreshTokensRepository([existingToken]);
    const service = new AuthService(
      makeUsersRepository(null),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    await expectUnauthorized(service.refresh(rawToken), INVALID_CREDENTIALS_MESSAGE);
  });
});

describe('AuthService.logout', () => {
  let user: StubUser;
  const rawToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const tokenHash = hashToken(rawToken);

  beforeEach(async () => {
    user = await makeActiveUser();
  });

  it('revokes an active refresh token in the database', async () => {
    let saved = false;
    const tokenRecord: StubRefreshToken = {
      id: 'token-uuid',
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revoked_at: null,
      replaced_by_token_id: null,
      save: async () => {
        saved = true;
      },
    };

    const { repo: refreshRepo } = makeRefreshTokensRepository([tokenRecord]);
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    const result = await service.logout(rawToken);

    assert.equal(result.message, LOGOUT_SUCCESS_MESSAGE);
    assert.ok(tokenRecord.revoked_at instanceof Date, 'revoked_at must be set');
    assert.ok(saved, 'token save must be called');
  });

  it('is idempotent when no token is provided', async () => {
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    const result = await service.logout(undefined);
    assert.equal(result.message, LOGOUT_SUCCESS_MESSAGE);
  });

  it('is idempotent when token is not found or already revoked', async () => {
    const revokedToken: StubRefreshToken = {
      id: 'token-uuid',
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revoked_at: new Date(Date.now() - 1000),
      replaced_by_token_id: null,
      save: async () => {
        assert.fail('should not save an already revoked token');
      },
    };

    const { repo: refreshRepo } = makeRefreshTokensRepository([revokedToken]);
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    const result = await service.logout(rawToken);
    assert.equal(result.message, LOGOUT_SUCCESS_MESSAGE);
  });
});

describe('AuthService cookie options', () => {
  it('configures httpOnly, secure, path, and maxAge properly', () => {
    const service = new AuthService(
      makeUsersRepository(null),
      makeRefreshTokensRepository().repo,
      makeJwtService(),
      makeConfigService({
        'app.nodeEnv': 'production',
        'app.apiPrefix': 'api/v1',
        'jwt.refreshExpiresIn': '7d',
        'jwt.refreshCookieName': 'custom_refresh_token',
      }),
    );

    assert.equal(service.getRefreshCookieName(), 'custom_refresh_token');

    const options = service.getRefreshCookieOptions();
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, 'none');
    assert.equal(options.path, '/api/v1/auth');
    assert.equal(options.maxAge, 7 * 24 * 60 * 60 * 1000);

    const clearOptions = service.getClearCookieOptions();
    assert.equal(clearOptions.httpOnly, true);
    assert.equal(clearOptions.secure, true);
    assert.equal(clearOptions.sameSite, 'none');
    assert.equal(clearOptions.path, '/api/v1/auth');
  });
});

/**
 * Task 19 — platform SUPER_ADMIN login and inactive-school enforcement.
 */
describe('AuthService platform & lifecycle', () => {
  it('logs a SUPER_ADMIN in with no school_id and issues a null-school token', async () => {
    const admin: StubUser = {
      id: USER_ID,
      school_id: null as unknown as string,
      role: UserRole.SUPER_ADMIN,
      first_name: 'Parker',
      last_name: 'Platform',
      email: 'superadmin@platform.test',
      password_hash: await hashPassword(PASSWORD),
      is_active: true,
    };
    const capture: { where?: unknown } = {};
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(admin, capture),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    const dto = makeLoginDto({ school_id: undefined, email: 'superadmin@platform.test' });
    const { response } = await service.login(dto);

    // The lookup targeted the platform account (null school + role).
    assert.deepEqual(capture.where, {
      email: 'superadmin@platform.test',
      role: UserRole.SUPER_ADMIN,
      school_id: null,
    });
    assert.equal(response.user.role, UserRole.SUPER_ADMIN);
    assert.equal(response.user.school_id, null);
    const decoded = makeJwtService().decode<{ school_id: string | null; role: UserRole }>(
      response.access_token,
    );
    assert.equal(decoded?.role, UserRole.SUPER_ADMIN);
    assert.equal(decoded?.school_id, null);
  });

  it('refuses platform login when a school_id is supplied for a SUPER_ADMIN account', async () => {
    const admin: StubUser = {
      id: USER_ID,
      school_id: null as unknown as string,
      role: UserRole.SUPER_ADMIN,
      first_name: 'Parker',
      last_name: 'Platform',
      email: 'superadmin@platform.test',
      password_hash: await hashPassword(PASSWORD),
      is_active: true,
    };
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const service = new AuthService(
      makeUsersRepository(admin),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
    );

    // School id present -> tenant lookup path -> platform row not found there.
    await expectUnauthorized(
      service.login(makeLoginDto({ school_id: SCHOOL_ID, email: 'superadmin@platform.test' })),
      INVALID_CREDENTIALS_MESSAGE,
    );
  });

  it('blocks a school user login with 403 when the school is inactive', async () => {
    const user = await makeActiveUser();
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const schoolAccess = {
      isSchoolAccessible: async (schoolId: string | null | undefined) => schoolId === null,
    };
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
      schoolAccess as never,
    );

    await assert.rejects(
      service.login(makeLoginDto()),
      (error: { getStatus?: () => number; message?: string }) => {
        assert.equal(error.getStatus?.(), 403);
        assert.equal(error.message, 'School is inactive');
        return true;
      },
    );
  });

  it('still allows the school login when the tenant is active', async () => {
    const user = await makeActiveUser();
    const { repo: refreshRepo } = makeRefreshTokensRepository();
    const schoolAccess = {
      isSchoolAccessible: async () => true,
    };
    const service = new AuthService(
      makeUsersRepository(user),
      refreshRepo,
      makeJwtService(),
      makeConfigService(),
      schoolAccess as never,
    );

    const { response } = await service.login(makeLoginDto());
    assert.equal(response.user.role, UserRole.DRIVER);
  });

  it('blocks refresh for an inactive school and succeeds for the platform admin', async () => {
    const rawToken = 'raw-refresh-token';
    const storedToken: StubRefreshToken = {
      id: 'token-1',
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() + 7 * 86_400_000),
      revoked_at: null,
      replaced_by_token_id: null,
      save: async () => {},
    };
    const driver = await makeActiveUser();

    const inactiveService = new AuthService(
      makeUsersRepository(driver),
      makeRefreshTokensRepository([storedToken]).repo,
      makeJwtService(),
      makeConfigService(),
      { isSchoolAccessible: async () => false } as never,
    );
    await assert.rejects(
      inactiveService.refresh(rawToken),
      (error: { getStatus?: () => number }) => error.getStatus?.() === 403,
    );

    // Platform refresh token (null school) always passes the lifecycle check.
    const platformToken: StubRefreshToken = {
      ...storedToken,
      school_id: null as unknown as string,
    };
    const admin: StubUser = {
      ...driver,
      school_id: null as unknown as string,
      role: UserRole.SUPER_ADMIN,
    };
    const platformService = new AuthService(
      makeUsersRepository(admin),
      makeRefreshTokensRepository([platformToken]).repo,
      makeJwtService(),
      makeConfigService(),
      { isSchoolAccessible: async () => false } as never,
    );
    const result = await platformService.refresh(rawToken);
    assert.equal(result.response.user.role, UserRole.SUPER_ADMIN);
  });
});
