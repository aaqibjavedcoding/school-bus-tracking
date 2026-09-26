import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { UserRole } from '@school-bus-tracking/shared-types';
import { BadRequestException } from '../../framework';
import { comparePassword, hashPassword, hashToken } from '../../auth';
import type { PasswordResetToken, User } from '../../database/models';
import type { EmailNotificationProvider } from '../notifications/providers';
import type { AuthService } from './auth.service';
import {
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  INVALID_PASSWORD_RESET_TOKEN_MESSAGE,
  PASSWORD_RESET_SUCCESS_MESSAGE,
} from './auth.constants';
import { PasswordResetService } from './password-reset.service';

/**
 * The self-service reset flow, with the database, the clock and the mail
 * relay replaced by in-memory doubles.
 *
 * Three claims are load-bearing and each gets a section:
 *
 * 1. **`/forgot-password` answers identically for every outcome** — matching
 *    admin, wrong role, unknown email, unknown school, deactivated account,
 *    deactivated school, and an SMTP outage. The assertions compare the
 *    serialized response, so a future field that differs by case fails here.
 * 2. **a link is single-use, expiring, and superseded by the next one**.
 * 3. **a completed reset revokes every existing session** — the reason the
 *    flow exists at all.
 *
 * `now` is injected through the service's `protected now()` seam, so the
 * timeline below is deterministic.
 */

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SCHOOL_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SCHOOL_CODE = 'triumph-academy';
const T0 = Date.parse('2026-03-01T09:00:00.000Z');
const MINUTE = 60_000;

interface StubUser {
  id: string;
  school_id: string | null;
  role: UserRole;
  first_name: string;
  last_name: string;
  email: string | null;
  password_hash: string | null;
  is_active: boolean;
  update: (values: Record<string, unknown>) => Promise<void>;
}

interface StubToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  requested_ip: string | null;
  update: (values: Record<string, unknown>) => Promise<void>;
}

function makeUser(overrides: Partial<StubUser> = {}): StubUser {
  const user: StubUser = {
    id: USER_ID,
    school_id: SCHOOL_ID,
    role: UserRole.SCHOOL_ADMIN,
    first_name: 'Ada',
    last_name: 'Byron',
    email: 'ada@triumph.edu',
    password_hash: 'old-hash',
    is_active: true,
    update: async (values) => {
      Object.assign(user, values);
    },
    ...overrides,
  };
  // Re-bind after the spread so an override object still mutates this row.
  user.update = async (values) => {
    Object.assign(user, values);
  };
  return user;
}

/** In-memory `password_reset_tokens` table with the four calls the service makes. */
function makeTokenStore(rows: StubToken[] = []) {
  let sequence = rows.length;
  const store = {
    rows,
    destroyed: [] as StubToken[],
    created: [] as StubToken[],
    repository: {
      unscoped: () => ({
        findOne: async (options: { where: { token_hash?: string } }) =>
          store.rows.find((row) => row.token_hash === options.where.token_hash) ?? null,
      }),
      update: async (
        values: Record<string, unknown>,
        options: { where: { user_id?: string; used_at?: unknown } },
      ) => {
        let affected = 0;
        for (const row of store.rows) {
          if (options.where.user_id && row.user_id !== options.where.user_id) {
            continue;
          }
          if (options.where.used_at === null && row.used_at !== null) {
            continue;
          }
          Object.assign(row, values);
          affected += 1;
        }
        return [affected];
      },
      destroy: async (options: { where: { expires_at?: Record<symbol, Date> } }) => {
        const clause = options.where.expires_at ?? {};
        const cutoff = Object.getOwnPropertySymbols(clause)
          .map((symbol) => (clause as Record<symbol, Date>)[symbol])
          .find((value) => value instanceof Date);
        if (!cutoff) {
          return 0;
        }
        const survivors = store.rows.filter((row) => row.expires_at.getTime() >= cutoff.getTime());
        store.destroyed.push(...store.rows.filter((row) => !survivors.includes(row)));
        const removed = store.rows.length - survivors.length;
        store.rows.splice(0, store.rows.length, ...survivors);
        return removed;
      },
      create: async (values: Record<string, unknown>) => {
        sequence += 1;
        const row: StubToken = {
          id: `token-${sequence}`,
          user_id: values.user_id as string,
          token_hash: values.token_hash as string,
          expires_at: values.expires_at as Date,
          used_at: null,
          requested_ip: (values.requested_ip as string | null) ?? null,
          update: async (patch) => {
            Object.assign(row, patch);
          },
        };
        store.rows.push(row);
        store.created.push(row);
        return row;
      },
    },
  };
  return store;
}

function makeUsersRepository(users: StubUser[]) {
  return {
    unscoped: () => ({
      findOne: async (options: { where: { id?: string; school_id?: string; email?: string } }) => {
        const { id, school_id, email } = options.where;
        return (
          users.find((user) => {
            if (id !== undefined) {
              return user.id === id;
            }
            return user.school_id === school_id && user.email === email;
          }) ?? null
        );
      },
    }),
  } as unknown as typeof User;
}

interface AuthDouble {
  service: AuthService;
  revokedFor: string[];
  revokedSessions: number;
}

function makeAuth(
  options: {
    tenants?: Record<string, string>;
    schoolAccessible?: boolean;
    revokedSessions?: number;
  } = {},
): AuthDouble {
  const tenants = options.tenants ?? { [SCHOOL_CODE]: SCHOOL_ID, [SCHOOL_ID]: SCHOOL_ID };
  const double: AuthDouble = {
    revokedFor: [],
    revokedSessions: options.revokedSessions ?? 0,
    service: {
      resolveTenantId: async (identifier: string) => tenants[identifier] ?? null,
      assertSchoolAccessible: async () => {
        if (options.schoolAccessible === false) {
          throw new BadRequestException('School is not accessible');
        }
      },
      revokeAllUserSessions: async (userId: string) => {
        double.revokedFor.push(userId);
        return double.revokedSessions;
      },
    } as unknown as AuthService,
  };
  return double;
}

interface EmailDouble {
  provider: EmailNotificationProvider;
  sent: Array<{ to: string; subject: string; body: string; html?: string }>;
}

function makeEmail(options: { failing?: boolean; throwing?: boolean } = {}): EmailDouble {
  const double: EmailDouble = {
    sent: [],
    provider: {
      name: 'test-email',
      isConfigured: () => true,
      send: async (payload: { to: string; subject: string; body: string; html?: string }) => {
        if (options.throwing) {
          throw new Error('relay unreachable');
        }
        double.sent.push(payload);
        return options.failing
          ? { success: false, provider: 'test-email', error: 'mailbox full', retryable: true }
          : { success: true, provider: 'test-email', messageId: 'msg-1', retryable: false };
      },
    } as unknown as EmailNotificationProvider,
  };
  return double;
}

/** The service with its clock pinned, so expiry is arithmetic rather than waiting. */
class TestPasswordResetService extends PasswordResetService {
  public clock = T0;
  protected override now(): number {
    return this.clock;
  }
}

interface Harness {
  service: TestPasswordResetService;
  tokens: ReturnType<typeof makeTokenStore>;
  auth: AuthDouble;
  email: EmailDouble;
  users: StubUser[];
}

function harness(
  options: {
    users?: StubUser[];
    tokens?: StubToken[];
    tenants?: Record<string, string>;
    schoolAccessible?: boolean;
    revokedSessions?: number;
    emailFailing?: boolean;
    emailThrowing?: boolean;
  } = {},
): Harness {
  const users = options.users ?? [makeUser()];
  const tokens = makeTokenStore(options.tokens ?? []);
  const auth = makeAuth({
    tenants: options.tenants,
    schoolAccessible: options.schoolAccessible,
    revokedSessions: options.revokedSessions,
  });
  const email = makeEmail({ failing: options.emailFailing, throwing: options.emailThrowing });
  const service = new TestPasswordResetService(
    makeUsersRepository(users),
    tokens.repository as unknown as typeof PasswordResetToken,
    auth.service,
    email.provider,
  );
  return { service, tokens, auth, email, users };
}

/** The reset link the fake relay received, as the user would click it. */
function sentResetUrl(email: EmailDouble): string {
  const match = /https?:\/\/\S*\/reset-password\?token=([A-Za-z0-9]+)/.exec(
    email.sent[email.sent.length - 1]?.body ?? '',
  );
  assert.ok(match, 'expected a reset URL in the email body');
  return match[0];
}

/** The raw token out of the emailed link. */
function sentRawToken(email: EmailDouble): string {
  return new URL(sentResetUrl(email)).searchParams.get('token') as string;
}

describe('forgot-password: one answer for every outcome', () => {
  /**
   * Every case a hostile caller can construct, and the fact that none of them
   * is distinguishable from the response. The serialized comparison is on
   * purpose: adding any field that varies by case breaks this test.
   */
  const cases: Array<{ name: string; build: () => Harness; body?: { school_id: string; email: string } }> = [
    {
      name: 'a matching, active SCHOOL_ADMIN',
      build: () => harness(),
    },
    {
      name: 'an email that belongs to nobody',
      build: () => harness(),
      body: { school_id: SCHOOL_CODE, email: 'nobody@triumph.edu' },
    },
    {
      name: 'a DRIVER (crew accounts have no password to reset)',
      build: () => harness({ users: [makeUser({ role: UserRole.DRIVER })] }),
    },
    {
      name: 'a CONDUCTOR',
      build: () => harness({ users: [makeUser({ role: UserRole.CONDUCTOR })] }),
    },
    {
      name: 'a PARENT (out of scope for now)',
      build: () => harness({ users: [makeUser({ role: UserRole.PARENT })] }),
    },
    {
      name: 'the platform SUPER_ADMIN',
      build: () => harness({ users: [makeUser({ role: UserRole.SUPER_ADMIN })] }),
    },
    {
      name: 'a deactivated SCHOOL_ADMIN',
      build: () => harness({ users: [makeUser({ is_active: false })] }),
    },
    {
      name: 'a SCHOOL_ADMIN of a deactivated school',
      build: () => harness({ schoolAccessible: false }),
    },
    {
      name: 'a school code that does not exist',
      build: () => harness(),
      body: { school_id: 'no-such-school', email: 'ada@triumph.edu' },
    },
    {
      name: 'the right email at the wrong school',
      build: () => harness({ users: [makeUser({ school_id: OTHER_SCHOOL_ID })] }),
    },
    {
      name: 'a relay that reports failure',
      build: () => harness({ emailFailing: true }),
    },
    {
      name: 'a relay that throws',
      build: () => harness({ emailThrowing: true }),
    },
  ];

  for (const testCase of cases) {
    it(`answers the same for ${testCase.name}`, async () => {
      const { service } = testCase.build();
      const response = await service.requestReset(
        testCase.body ?? { school_id: SCHOOL_CODE, email: 'ada@triumph.edu' },
      );

      assert.deepEqual(response, { message: FORGOT_PASSWORD_GENERIC_MESSAGE });
      assert.equal(
        JSON.stringify(response),
        JSON.stringify({ message: FORGOT_PASSWORD_GENERIC_MESSAGE }),
        'the response must be byte-identical for every outcome',
      );
    });
  }

  it('never throws, whatever the repository does', async () => {
    const { service, tokens } = harness();
    tokens.repository.create = async () => {
      throw new Error('database is on fire');
    };
    // A 500 is a different response, and a different response is an answer.
    const response = await service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });
    assert.deepEqual(response, { message: FORGOT_PASSWORD_GENERIC_MESSAGE });
  });

  it('mints and mails for the matching admin only', async () => {
    const match = harness();
    await match.service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });
    assert.equal(match.tokens.created.length, 1);
    assert.equal(match.email.sent.length, 1);
    assert.equal(match.email.sent[0].to, 'ada@triumph.edu');

    for (const build of [
      () => harness({ users: [makeUser({ role: UserRole.DRIVER })] }),
      () => harness({ users: [makeUser({ is_active: false })] }),
      () => harness({ schoolAccessible: false }),
    ]) {
      const miss = build();
      await miss.service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });
      assert.equal(miss.tokens.created.length, 0, 'no token for a non-resettable account');
      assert.equal(miss.email.sent.length, 0, 'no mail for a non-resettable account');
    }
  });

  it('matches the email case-insensitively, as login does', async () => {
    const { service, email } = harness();
    await service.requestReset({ school_id: SCHOOL_CODE, email: '  ADA@Triumph.edu ' });
    assert.equal(email.sent.length, 1);
  });

  it('accepts the school UUID as well as the code', async () => {
    const { service, email } = harness();
    await service.requestReset({ school_id: SCHOOL_ID, email: 'ada@triumph.edu' });
    assert.equal(email.sent.length, 1);
  });
});

describe('forgot-password: what is stored and what is sent', () => {
  it('stores only the digest, never the raw token', async () => {
    const { service, tokens, email } = harness();
    await service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });

    const raw = sentRawToken(email);
    const row = tokens.created[0];
    assert.equal(row.token_hash, hashToken(raw));
    assert.notEqual(row.token_hash, raw);
    assert.equal(JSON.stringify(row).includes(raw), false, 'the raw token is never persisted');
  });

  it('records the requesting IP for audit but keeps it out of the email', async () => {
    const { service, tokens, email } = harness();
    await service.requestReset(
      { school_id: SCHOOL_CODE, email: 'ada@triumph.edu' },
      { ip: '203.0.113.7' },
    );
    assert.equal(tokens.created[0].requested_ip, '203.0.113.7');
    assert.equal(email.sent[0].body.includes('203.0.113.7'), false);
  });

  it('tolerates a missing IP', async () => {
    const { service, tokens } = harness();
    await service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });
    assert.equal(tokens.created[0].requested_ip, null);
  });

  it('sets expiry from the clamped TTL', async () => {
    const { service, tokens } = harness();
    await service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });
    assert.equal(tokens.created[0].expires_at.getTime(), T0 + 45 * MINUTE);
  });

  it('sends both a plain-text and an HTML body carrying the same link', async () => {
    const { service, email } = harness();
    await service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });
    const sent = email.sent[0];
    assert.ok(sent.html, 'an HTML alternative is sent');
    assert.ok(sent.html.includes(sentResetUrl(email)));
    assert.match(sent.body, /45 minutes/);
    assert.match(sent.body, /did ?n.t request/i);
  });
});

describe('forgot-password: one live link per account', () => {
  it('supersedes the previous unused link when a new one is issued', async () => {
    const { service, tokens, email } = harness();

    await service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });
    const firstToken = sentRawToken(email);

    service.clock = T0 + 5 * MINUTE;
    await service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });
    const secondToken = sentRawToken(email);

    assert.notEqual(firstToken, secondToken);
    const live = tokens.rows.filter((row) => row.used_at === null);
    assert.equal(live.length, 1, 'exactly one live link survives');
    assert.equal(live[0].token_hash, hashToken(secondToken));
  });

  it('refuses a superseded link at redemption time', async () => {
    const { service, email } = harness();
    await service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });
    const firstToken = sentRawToken(email);

    service.clock = T0 + MINUTE;
    await service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });

    await assert.rejects(
      () => service.resetPassword({ token: firstToken, password: 'new-password-123' }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message === INVALID_PASSWORD_RESET_TOKEN_MESSAGE,
    );
  });

  it('purges rows that have been dead longer than the retention window', async () => {
    const ancient: StubToken = {
      id: 'ancient',
      user_id: USER_ID,
      token_hash: 'stale-hash',
      expires_at: new Date(T0 - 48 * 60 * MINUTE),
      used_at: new Date(T0 - 48 * 60 * MINUTE),
      requested_ip: null,
      update: async () => {},
    };
    const { service, tokens } = harness({ tokens: [ancient] });

    await service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });
    assert.equal(
      tokens.rows.some((row) => row.id === 'ancient'),
      false,
      'the sweep is why this table needs no retention worker entry',
    );
  });
});

describe('reset-password', () => {
  let ctx: Harness;
  let rawToken: string;

  beforeEach(async () => {
    ctx = harness({ revokedSessions: 3 });
    await ctx.service.requestReset({ school_id: SCHOOL_CODE, email: 'ada@triumph.edu' });
    rawToken = sentRawToken(ctx.email);
  });

  it('sets the new password hash and reports the account for the audit row', async () => {
    const result = await ctx.service.resetPassword({ token: rawToken, password: 'new-password-123' });

    assert.equal(result.message, PASSWORD_RESET_SUCCESS_MESSAGE);
    assert.equal(result.user_id, USER_ID);
    assert.equal(result.school_id, SCHOOL_ID);

    const stored = ctx.users[0].password_hash as string;
    assert.notEqual(stored, 'old-hash');
    assert.notEqual(stored, 'new-password-123', 'the password is hashed, never stored in the clear');
    assert.equal(await comparePassword('new-password-123', stored), true);
  });

  it('revokes every existing session — the point of the whole flow', async () => {
    const result = await ctx.service.resetPassword({ token: rawToken, password: 'new-password-123' });
    assert.deepEqual(ctx.auth.revokedFor, [USER_ID]);
    assert.equal(result.revoked_sessions, 3);
  });

  it('spends the token, so the same link cannot be replayed', async () => {
    await ctx.service.resetPassword({ token: rawToken, password: 'new-password-123' });
    assert.ok(ctx.tokens.rows[0].used_at instanceof Date);

    await assert.rejects(
      () => ctx.service.resetPassword({ token: rawToken, password: 'another-password-9' }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message === INVALID_PASSWORD_RESET_TOKEN_MESSAGE,
    );
  });

  it('refuses an expired link', async () => {
    ctx.service.clock = T0 + 46 * MINUTE;
    await assert.rejects(
      () => ctx.service.resetPassword({ token: rawToken, password: 'new-password-123' }),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.equal(ctx.users[0].password_hash, 'old-hash', 'the password is untouched');
    assert.deepEqual(ctx.auth.revokedFor, [], 'no sessions are disturbed by a failed reset');
  });

  it('refuses an unknown token with the same message as an expired one', async () => {
    const unknown = await ctx.service
      .resetPassword({ token: 'a'.repeat(64), password: 'new-password-123' })
      .catch((error: Error) => error.message);
    ctx.service.clock = T0 + 46 * MINUTE;
    const expired = await ctx.service
      .resetPassword({ token: rawToken, password: 'new-password-123' })
      .catch((error: Error) => error.message);

    // "Expired" vs "never existed" would narrow an attacker's search.
    assert.equal(unknown, INVALID_PASSWORD_RESET_TOKEN_MESSAGE);
    assert.equal(expired, INVALID_PASSWORD_RESET_TOKEN_MESSAGE);
  });

  it('tolerates a token pasted with surrounding whitespace', async () => {
    const result = await ctx.service.resetPassword({
      token: `  ${rawToken}\n`,
      password: 'new-password-123',
    });
    assert.equal(result.user_id, USER_ID);
  });

  it('burns the link when the account stopped being resettable after the email was sent', async () => {
    ctx.users[0].is_active = false;
    await assert.rejects(
      () => ctx.service.resetPassword({ token: rawToken, password: 'new-password-123' }),
      (error: unknown) => error instanceof BadRequestException,
    );
    // Burned, so a retry after a re-activation cannot use the same link.
    assert.ok(ctx.tokens.rows[0].used_at instanceof Date);
    assert.equal(ctx.users[0].password_hash, 'old-hash');
  });

  it('refuses a link whose account changed role', async () => {
    ctx.users[0].role = UserRole.PARENT;
    await assert.rejects(
      () => ctx.service.resetPassword({ token: rawToken, password: 'new-password-123' }),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.equal(ctx.users[0].password_hash, 'old-hash');
  });

  it('does not reuse the previous hash even for the same password text', async () => {
    // bcrypt salts per call: two resets to the same string produce different
    // hashes, so a stolen hash cannot be recognised across accounts.
    const first = await hashPassword('new-password-123');
    await ctx.service.resetPassword({ token: rawToken, password: 'new-password-123' });
    assert.notEqual(ctx.users[0].password_hash, first);
    assert.equal(await comparePassword('new-password-123', ctx.users[0].password_hash as string), true);
  });
});
