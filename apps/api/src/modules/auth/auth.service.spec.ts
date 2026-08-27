import { beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { hashPassword } from '../../auth';
import { User } from '../../database/models';
import { AuthService } from './auth.service';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.constants';
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

/** In-memory stand-in for the tenant-scoped `(school_id, email)` lookup. */
function makeUsersRepository(user: StubUser | null, capture: { where?: unknown } = {}) {
  return {
    unscoped: () => ({
      findOne: (options: { where: Record<string, unknown> }) => {
        capture.where = options.where;
        return Promise.resolve(user);
      },
    }),
  } as unknown as typeof User;
}

function makeJwtService(): JwtService {
  return new JwtService({
    secret: JWT_SECRET,
    signOptions: { expiresIn: JWT_EXPIRES_IN },
  });
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

async function expectInvalidCredentials(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof UnauthorizedException, 'expected an UnauthorizedException');
    assert.equal(error.getStatus(), 401);
    assert.equal(error.message, INVALID_CREDENTIALS_MESSAGE);
    return true;
  });
}

describe('AuthService.login', () => {
  let user: StubUser;

  beforeEach(async () => {
    user = await makeActiveUser();
  });

  it('returns a signed access token and public user data for valid credentials', async () => {
    const service = new AuthService(makeUsersRepository(user), makeJwtService());

    const result = await service.login(makeLoginDto());

    assert.equal(typeof result.access_token, 'string');
    assert.ok(result.access_token.split('.').length === 3, 'expected a JWT (3 segments)');
    assert.equal(result.token_type, 'Bearer');
    assert.deepEqual(result.user, {
      id: USER_ID,
      school_id: SCHOOL_ID,
      role: UserRole.DRIVER,
      first_name: 'Dana',
      last_name: 'Driver',
      email: 'driver@school.org',
    });
  });

  it('issues a JWT carrying exactly sub, school_id and role claims', async () => {
    const jwtService = makeJwtService();
    const service = new AuthService(makeUsersRepository(user), jwtService);

    const { access_token: accessToken } = await service.login(makeLoginDto());
    const claims = await jwtService.verifyAsync<JwtAccessTokenPayload & Record<string, unknown>>(
      accessToken,
      { secret: JWT_SECRET },
    );

    assert.equal(claims.sub, USER_ID);
    assert.equal(claims.school_id, SCHOOL_ID);
    assert.equal(claims.role, UserRole.DRIVER);
    // Only the three domain claims plus the standard iat/exp timestamps.
    assert.deepEqual(Object.keys(claims).sort(), ['exp', 'iat', 'role', 'school_id', 'sub']);
  });

  it('rejects a token signed with a different secret', async () => {
    const service = new AuthService(makeUsersRepository(user), makeJwtService());
    const { access_token: accessToken } = await service.login(makeLoginDto());

    const verifier = new JwtService({ secret: 'a-different-secret' });
    await assert.rejects(verifier.verifyAsync(accessToken));
  });

  it('reports the configured expiry via expires_in and the exp claim', async () => {
    const jwtService = makeJwtService();
    const service = new AuthService(makeUsersRepository(user), jwtService);

    const result = await service.login(makeLoginDto());
    const claims = jwtService.decode<{ exp: number; iat: number }>(result.access_token);

    assert.equal(result.expires_in, 15 * 60);
    assert.equal(claims.exp - claims.iat, 15 * 60);
  });

  it('normalizes the email before the tenant-scoped lookup', async () => {
    const capture: { where?: unknown } = {};
    const service = new AuthService(makeUsersRepository(user, capture), makeJwtService());

    await service.login(makeLoginDto({ email: '  Driver@School.ORG  ' }));

    assert.deepEqual(capture.where, { school_id: SCHOOL_ID, email: 'driver@school.org' });
  });

  it('returns generic 401 when no user matches school_id + email', async () => {
    const service = new AuthService(makeUsersRepository(null), makeJwtService());
    await expectInvalidCredentials(service.login(makeLoginDto()));
  });

  it('returns generic 401 for a wrong password', async () => {
    const service = new AuthService(makeUsersRepository(user), makeJwtService());
    await expectInvalidCredentials(service.login(makeLoginDto({ password: 'wrong-password' })));
  });

  it('returns generic 401 for a deactivated user even with the right password', async () => {
    const inactive = await makeActiveUser({ is_active: false });
    const service = new AuthService(makeUsersRepository(inactive), makeJwtService());
    await expectInvalidCredentials(service.login(makeLoginDto()));
  });

  it('returns generic 401 for a user without stored credentials', async () => {
    const noCredentials = await makeActiveUser({ password_hash: null });
    const service = new AuthService(makeUsersRepository(noCredentials), makeJwtService());
    await expectInvalidCredentials(service.login(makeLoginDto()));
  });

  it('never exposes password or password_hash anywhere in the response', async () => {
    const service = new AuthService(makeUsersRepository(user), makeJwtService());
    const result = await service.login(makeLoginDto());

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('password'), 'response must not contain a password field');
    assert.ok(
      !serialized.includes(user.password_hash as string),
      'response must not contain the stored hash',
    );
  });
});
