import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { ForbiddenException, HttpException, UnauthorizedException } from '../../framework';
import type { ConfigService } from '../../framework';
import { UserRole } from '@school-bus-tracking/shared-types';
import type { LoginResponse } from '@school-bus-tracking/shared-types';
import {
  CREW_PIN_COMBINATIONS,
  crewPinLoginSchema,
  crewPinSetSchema,
  encodeCrewPairingPayload,
  parseCrewPairingPayload,
} from '@school-bus-tracking/validation';
import { comparePassword, hashPassword, hashToken } from '../../auth';
import type { CrewPairingToken, User } from '../../database/models';
import type { AuthService, AuthSessionResult } from './auth.service';
import {
  CREW_PAIRING_INVALID_CODE,
  CREW_PIN_INVALID_CODE,
  CREW_PIN_LOCKED_CODE,
  CREW_PIN_LOCKED_MESSAGE,
  INVALID_CREW_CREDENTIALS_MESSAGE,
  INVALID_PAIRING_CODE_MESSAGE,
  PIN_TIMING_EQUALIZATION_HASH,
} from './auth.constants';
import { CrewPinAttemptStore } from './crew-pin-attempts';
import {
  CrewAuthService,
  crewNotFoundMessage,
  crewPinState,
  isCrewRole,
} from './crew-auth.service';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SCHOOL_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PIN = '4821';
const WRONG_PIN = '0000';

/**
 * Test-only PIN digest at bcrypt cost **4**, not the production cost 12.
 *
 * `comparePassword()` reads the work factor out of the stored hash, so a cost-4
 * digest exercises exactly the same code path as a real one — it is simply
 * ~300ms cheaper per comparison, and this spec performs a few dozen of them.
 * The one place a real cost-12 digest matters (that
 * `PIN_TIMING_EQUALIZATION_HASH` is a *genuine* bcrypt output, not a
 * look-alike string that `bcrypt.compare` would reject instantly) is asserted
 * against the shipped constant itself.
 */
const PIN_HASH = bcrypt.hashSync(PIN, 4);

const MINUTE = 60_000;

// ── Stubs ──────────────────────────────────────────────────────────────────

interface StubUserRow {
  id: string;
  school_id: string | null;
  role: UserRole;
  first_name: string;
  last_name: string;
  email: string | null;
  pin_hash: string | null;
  pin_updated_at: Date | null;
  is_active: boolean;
  save: () => Promise<void>;
  /** How many times this row was persisted — asserted instead of a module counter. */
  saveCalls: number;
}

function makeUser(overrides: Partial<StubUserRow> = {}): StubUserRow {
  const row = {
    id: USER_ID,
    school_id: SCHOOL_ID,
    role: UserRole.DRIVER,
    first_name: 'Dana',
    last_name: 'Driver',
    email: 'driver@school.org',
    pin_hash: PIN_HASH,
    pin_updated_at: new Date('2026-09-10T08:00:00.000Z'),
    is_active: true,
    saveCalls: 0,
    ...overrides,
  } as StubUserRow;
  row.save = async () => {
    row.saveCalls += 1;
  };
  return row;
}

interface UsersCapture {
  where?: Record<string, unknown>;
  findOneCalls: number;
  unscopedCalls: number;
  attributes?: unknown;
}

/** In-memory stand-in for the tenant-scoped `User` lookup. */
function makeUsersRepository(rows: Array<StubUserRow | null>, capture: UsersCapture) {
  const present = rows.filter((row): row is StubUserRow => row !== null);
  const findOne = (options: { where: Record<string, unknown>; attributes?: unknown }) => {
    capture.where = options.where;
    capture.attributes = options.attributes;
    capture.findOneCalls += 1;
    const match = present.find((row) =>
      Object.entries(options.where).every(([key, value]) => row[key as keyof StubUserRow] === value),
    );
    return Promise.resolve(match ?? null);
  };
  return {
    findOne: (options: { where: Record<string, unknown>; attributes?: unknown }) =>
      findOne(options),
    unscoped: () => {
      capture.unscopedCalls += 1;
      return { findOne };
    },
  } as unknown as typeof User;
}

interface StubPairingRow {
  id: string;
  school_id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
}

interface PairingCapture {
  updateWhere?: Record<string, unknown>;
  updateValues?: Record<string, unknown>;
  updateCalls: number;
  /** Rows matching an `update`, i.e. how many the atomic redeem would consume. */
  updateAffected: number;
  /** Lookups performed — asserted to prove a refusal happened before any query. */
  findOneCalls: number;
  destroyed: Array<Record<string, unknown>>;
  created: Array<Record<string, unknown>>;
  findOneWhere?: Record<string, unknown>;
}

function makePairingRepository(rows: StubPairingRow[], capture: PairingCapture) {
  return {
    update: (values: Record<string, unknown>, options: { where: Record<string, unknown> }) => {
      capture.updateCalls += 1;
      capture.updateValues = values;
      capture.updateWhere = options.where;
      return Promise.resolve([capture.updateAffected]);
    },
    findOne: (options: { where: Record<string, unknown> }) => {
      capture.findOneCalls += 1;
      capture.findOneWhere = options.where;
      const match = rows.find((row) =>
        Object.entries(options.where).every(
          ([key, value]) => row[key as keyof StubPairingRow] === value,
        ),
      );
      return Promise.resolve(match ?? null);
    },
    create: (payload: Record<string, unknown>) => {
      capture.created.push(payload);
      return Promise.resolve({ id: `pairing-${capture.created.length}`, ...payload });
    },
    destroy: (options: { where: Record<string, unknown> }) => {
      capture.destroyed.push(options.where);
      return Promise.resolve(0);
    },
  } as unknown as typeof CrewPairingToken;
}

interface AuthStubCapture {
  issuedFor: Array<StubUserRow>;
  tenantChecks: Array<StubUserRow>;
  resolved: string[];
}

function makeAuthStub(
  users: Array<StubUserRow | null>,
  capture: AuthStubCapture,
  options: { tenantIdByCode?: Record<string, string>; schoolAccessible?: boolean } = {},
): AuthService {
  const tenantIdByCode = options.tenantIdByCode ?? {};
  const schoolAccessible = options.schoolAccessible ?? true;
  return {
    resolveTenantId: async (identifier: string) => {
      capture.resolved.push(identifier);
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuid.test(identifier)) return identifier;
      return tenantIdByCode[identifier.toLowerCase()] ?? null;
    },
    assertSchoolAccessible: async (user: StubUserRow) => {
      capture.tenantChecks.push(user);
      if (!schoolAccessible) {
        throw new ForbiddenException('School is inactive');
      }
    },
    issueSession: async (user: StubUserRow): Promise<AuthSessionResult<LoginResponse>> => {
      capture.issuedFor.push(user);
      return {
        response: {
          access_token: 'mock-access-token',
          token_type: 'Bearer',
          expires_in: 900,
          user: {
            id: user.id,
            school_id: user.school_id,
            role: user.role,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
          },
        },
        refreshToken: 'mock-refresh-token',
      };
    },
    toAuthenticatedUser: (user: StubUserRow) => ({
      id: user.id,
      school_id: user.school_id,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
    }),
  } as unknown as AuthService;
}

interface Harness {
  service: CrewAuthService;
  attempts: CrewPinAttemptStore;
  users: UsersCapture;
  pairings: PairingCapture;
  auth: AuthStubCapture;
  setNow: (now: number) => void;
  /**
   * The harness clock. Every `attempts.peek()` in this file must pass it: the
   * store's default is the real `Date.now()`, which is years away from the
   * fixed test epoch, so a peek without it silently reports an empty state and
   * a lockout looks like it never happened.
   */
  now: () => number;
}

/**
 * Builds a service wired to in-memory doubles with a **manual clock**.
 *
 * The clock is injected because the brute-force policy is expressed in minutes:
 * a lockout timeline has to be walked deterministically, and a spec that slept
 * for fifteen real minutes would never be run.
 */
function makeHarness(
  options: {
    userRows?: Array<StubUserRow | null>;
    pairingRows?: StubPairingRow[];
    updateAffected?: number;
    config?: Record<string, unknown>;
    now?: number;
    tenantIdByCode?: Record<string, string>;
    schoolAccessible?: boolean;
  } = {},
): Harness {
  let now = options.now ?? 1_700_000_000_000;
  const users: UsersCapture = { findOneCalls: 0, unscopedCalls: 0 };
  const pairings: PairingCapture = {
    updateCalls: 0,
    findOneCalls: 0,
    updateAffected: options.updateAffected ?? 1,
    destroyed: [],
    created: [],
  };
  const auth: AuthStubCapture = { issuedFor: [], tenantChecks: [], resolved: [] };
  const attempts = new CrewPinAttemptStore();
  const values = options.config ?? {};
  const configService = {
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  } as unknown as ConfigService;

  const userRows = options.userRows ?? [makeUser()];
  const service = new CrewAuthService(
    makeUsersRepository(userRows, users),
    makePairingRepository(options.pairingRows ?? [], pairings),
    makeAuthStub(userRows, auth, {
      tenantIdByCode: options.tenantIdByCode,
      schoolAccessible: options.schoolAccessible,
    }),
    configService,
    attempts,
    () => now,
  );

  return {
    service,
    attempts,
    users,
    pairings,
    auth,
    setNow: (value: number) => (now = value),
    now: () => now,
  };
}

const pinBody = (overrides: Record<string, unknown> = {}) => ({
  method: 'pin' as const,
  school_id: SCHOOL_ID,
  user_id: USER_ID,
  pin: PIN,
  ...overrides,
});

/** Reads the error envelope fields the way a client would. */
function envelopeOf(error: unknown): { status: number; code?: string; message: unknown; details?: Record<string, unknown> } {
  const response = (error as HttpException).getResponse() as Record<string, unknown>;
  return {
    status: (error as HttpException).getStatus(),
    code: response['error'] as string | undefined,
    message: response['message'],
    details: response['details'] as Record<string, unknown> | undefined,
  };
}

// ── PIN branch ─────────────────────────────────────────────────────────────

describe('CrewAuthService — PIN login', () => {
  it('issues an ordinary session for a correct PIN on an active driver', async () => {
    const harness = makeHarness();
    const result = await harness.service.login(pinBody());
    assert.equal(result.response.access_token, 'mock-access-token');
    assert.equal(result.response.user.role, UserRole.DRIVER);
    assert.equal(harness.auth.issuedFor.length, 1, 'the session must be minted exactly once');
    assert.equal(harness.auth.issuedFor[0].id, USER_ID);
  });

  it('accepts a conductor as well as a driver', async () => {
    const harness = makeHarness({
      userRows: [makeUser({ role: UserRole.CONDUCTOR, last_name: 'Conductor' })],
    });
    const result = await harness.service.login(pinBody());
    assert.equal(result.response.user.role, UserRole.CONDUCTOR);
  });

  it('resolves a tenant code the same way the web login form does', async () => {
    const harness = makeHarness({ tenantIdByCode: { 'lincoln-high': SCHOOL_ID } });
    const result = await harness.service.login(pinBody({ school_id: 'lincoln-high' }));
    assert.equal(result.response.access_token, 'mock-access-token');
    assert.deepEqual(harness.auth.resolved, ['lincoln-high']);
  });

  it('looks the user up scoped to the resolved tenant', async () => {
    const harness = makeHarness();
    await harness.service.login(pinBody());
    assert.deepEqual(harness.users.where, { school_id: SCHOOL_ID, id: USER_ID });
    // `unscoped()` is required: the default scope hides `pin_hash`.
    assert.equal(harness.users.unscopedCalls, 1);
  });

  it('clears the attempt counter on success', async () => {
    const harness = makeHarness();
    await harness.service.login(pinBody({ pin: WRONG_PIN })).catch(() => undefined);
    const key = CrewPinAttemptStore.keyFor(SCHOOL_ID, USER_ID);
    assert.equal(harness.attempts.peek(key, harness.now()).failures, 1);

    await harness.service.login(pinBody());
    assert.equal(harness.attempts.peek(key, harness.now()).failures, 0);
  });

  it('rejects a wrong PIN with the generic credential failure', async () => {
    const harness = makeHarness();
    await assert.rejects(
      () => harness.service.login(pinBody({ pin: WRONG_PIN })),
      (error: unknown) => {
        assert.ok(error instanceof UnauthorizedException);
        const envelope = envelopeOf(error);
        assert.equal(envelope.status, 401);
        assert.equal(envelope.code, CREW_PIN_INVALID_CODE);
        assert.equal(envelope.message, INVALID_CREW_CREDENTIALS_MESSAGE);
        assert.equal(envelope.details?.['remaining_attempts'], 4);
        return true;
      },
    );
    assert.equal(harness.auth.issuedFor.length, 0);
  });

  /**
   * The enumeration-resistance property, asserted as an equivalence rather than
   * as a list of individual cases: a client that cannot tell these apart cannot
   * turn a list of UUIDs into a list of drivers.
   */
  it('answers identically for a wrong PIN, an unknown user, a non-crew role, an inactive account and a missing PIN', async () => {
    const scenarios: Array<{ name: string; harness: Harness; body: Record<string, unknown> }> = [
      { name: 'wrong PIN', harness: makeHarness(), body: pinBody({ pin: WRONG_PIN }) },
      { name: 'unknown user', harness: makeHarness({ userRows: [null] }), body: pinBody() },
      {
        name: 'not a crew role',
        harness: makeHarness({ userRows: [makeUser({ role: UserRole.PARENT })] }),
        body: pinBody(),
      },
      {
        name: 'inactive account',
        harness: makeHarness({ userRows: [makeUser({ is_active: false })] }),
        body: pinBody(),
      },
      {
        name: 'no PIN set',
        harness: makeHarness({ userRows: [makeUser({ pin_hash: null, pin_updated_at: null })] }),
        body: pinBody(),
      },
      {
        name: 'user in another tenant',
        harness: makeHarness({ userRows: [makeUser({ school_id: OTHER_SCHOOL_ID })] }),
        body: pinBody(),
      },
      {
        name: 'unknown tenant code',
        harness: makeHarness({ tenantIdByCode: {} }),
        body: pinBody({ school_id: 'no-such-school' }),
      },
    ];

    const signatures: string[] = [];
    for (const scenario of scenarios) {
      let signature = '';
      try {
        await scenario.harness.service.login(scenario.body as never);
        signature = 'LOGGED IN';
      } catch (error) {
        const envelope = envelopeOf(error);
        signature = JSON.stringify({
          status: envelope.status,
          code: envelope.code,
          message: envelope.message,
          remaining: envelope.details?.['remaining_attempts'],
        });
      }
      assert.notEqual(signature, 'LOGGED IN', `${scenario.name} must not authenticate`);
      signatures.push(signature);
    }

    assert.equal(
      new Set(signatures).size,
      1,
      `every failure must be indistinguishable from the outside:\n${scenarios
        .map((scenario, index) => `  ${scenario.name}: ${signatures[index]}`)
        .join('\n')}`,
    );
    assert.ok(
      signatures[0]!.includes(INVALID_CREW_CREDENTIALS_MESSAGE),
      `the generic message must be the one on the wire: ${signatures[0]}`,
    );
  });

  it('counts a failure against an unknown user too, so the countdown is not an oracle', async () => {
    const harness = makeHarness({ userRows: [null] });
    const seen: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await harness.service.login(pinBody());
      } catch (error) {
        seen.push(Number(envelopeOf(error).details?.['remaining_attempts']));
      }
    }
    // Identical to the countdown a real driver with a wrong PIN would see.
    assert.deepEqual(seen, [4, 3, 2, 1]);
  });

  it('performs no user lookup for an unknown tenant code', async () => {
    const harness = makeHarness({ tenantIdByCode: {} });
    await assert.rejects(() =>
      harness.service.login(pinBody({ school_id: 'no-such-school' })),
    );
    assert.equal(harness.users.findOneCalls, 0, 'a bogus tenant code must not reach the users table');
  });

  it('checks the tenant lifecycle only after the PIN is verified', async () => {
    const wrongPin = makeHarness({ schoolAccessible: false });
    await assert.rejects(
      () => wrongPin.service.login(pinBody({ pin: WRONG_PIN })),
      UnauthorizedException,
    );
    assert.equal(
      wrongPin.auth.tenantChecks.length,
      0,
      'a failed PIN must not reveal anything about the tenant lifecycle',
    );

    const rightPin = makeHarness({ schoolAccessible: false });
    await assert.rejects(() => rightPin.service.login(pinBody()), ForbiddenException);
    assert.equal(rightPin.auth.tenantChecks.length, 1);
  });
});

describe('CrewAuthService — PIN brute force', () => {
  it('locks the account on the fifth failure and reports a retry window', async () => {
    const harness = makeHarness();
    const remaining: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await harness.service.login(pinBody({ pin: WRONG_PIN }));
      } catch (error) {
        assert.equal(envelopeOf(error).status, 401);
        remaining.push(Number(envelopeOf(error).details?.['remaining_attempts']));
      }
    }
    assert.deepEqual(remaining, [4, 3, 2, 1]);

    await assert.rejects(
      () => harness.service.login(pinBody({ pin: WRONG_PIN })),
      (error: unknown) => {
        const envelope = envelopeOf(error);
        assert.equal(envelope.status, 429);
        assert.equal(envelope.code, CREW_PIN_LOCKED_CODE);
        assert.equal(envelope.message, CREW_PIN_LOCKED_MESSAGE);
        assert.equal(envelope.details?.['retry_after_seconds'], 900);
        assert.equal(envelope.details?.['remaining_attempts'], 0);
        return true;
      },
    );
  });

  it('refuses a locked account without touching the database at all', async () => {
    const harness = makeHarness();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.service.login(pinBody({ pin: WRONG_PIN })).catch(() => undefined);
    }
    const lookupsBefore = harness.users.findOneCalls;

    // Even the *correct* PIN is refused while locked — the throttle is checked
    // before any credential work, which is what makes a locked account cheap and
    // keeps the locked response free of any signal about the account.
    await assert.rejects(() => harness.service.login(pinBody()), (error: unknown) => {
      assert.equal(envelopeOf(error).status, 429);
      return true;
    });
    assert.equal(harness.users.findOneCalls, lookupsBefore, 'no lookup while locked');
    assert.equal(harness.auth.issuedFor.length, 0);
  });

  it('lifts the lockout once the window has passed, with a full allowance', async () => {
    const harness = makeHarness();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.service.login(pinBody({ pin: WRONG_PIN })).catch(() => undefined);
    }
    harness.setNow(1_700_000_000_000 + 15 * MINUTE + 1);

    const result = await harness.service.login(pinBody());
    assert.equal(result.response.access_token, 'mock-access-token', 'the driver gets back in');
  });

  it('does not extend the lockout when an attacker keeps hammering', async () => {
    const harness = makeHarness();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.service.login(pinBody({ pin: WRONG_PIN })).catch(() => undefined);
    }
    harness.setNow(1_700_000_000_000 + 14 * MINUTE);
    await harness.service.login(pinBody()).catch(() => undefined);
    harness.setNow(1_700_000_000_000 + 15 * MINUTE + 1);
    // Had the hammering extended the lock, this would still be a 429.
    const result = await harness.service.login(pinBody());
    assert.equal(result.response.access_token, 'mock-access-token');
  });

  it('honours a configured policy from crewAuth.*', async () => {
    const harness = makeHarness({
      config: {
        'crewAuth.pin.maxAttempts': 2,
        'crewAuth.pin.windowMs': MINUTE,
        'crewAuth.pin.lockoutMs': 2 * MINUTE,
      },
    });
    await harness.service.login(pinBody({ pin: WRONG_PIN })).catch(() => undefined);
    await assert.rejects(
      () => harness.service.login(pinBody({ pin: WRONG_PIN })),
      (error: unknown) => {
        assert.equal(envelopeOf(error).status, 429);
        assert.equal(envelopeOf(error).details?.['retry_after_seconds'], 120);
        return true;
      },
    );
    // …and it lifts on the configured clock, not the default one.
    harness.setNow(1_700_000_000_000 + MINUTE + 1);
    await assert.rejects(() => harness.service.login(pinBody()), (error: unknown) => {
      assert.equal(envelopeOf(error).status, 429);
      return true;
    });
    harness.setNow(1_700_000_000_000 + 2 * MINUTE + 1);
    assert.equal((await harness.service.login(pinBody())).response.access_token, 'mock-access-token');
  });

  it('keys the lockout per (school, user) so one driver cannot lock another', async () => {
    const harness = makeHarness({ userRows: [makeUser()] });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.service.login(pinBody({ pin: WRONG_PIN })).catch(() => undefined);
    }
    // A different crew account in the same school still has a full allowance.
    const other = '44444444-4444-4444-8444-444444444444';
    await assert.rejects(
      () => harness.service.login(pinBody({ user_id: other, pin: WRONG_PIN })),
      (error: unknown) => {
        assert.equal(envelopeOf(error).status, 401, 'a 429 here would mean the buckets are shared');
        assert.equal(envelopeOf(error).details?.['remaining_attempts'], 4);
        return true;
      },
    );
  });

  it('reports the shipped policy arithmetic rather than a quoted figure', () => {
    const harness = makeHarness();
    const policy = harness.service.describeBruteForcePolicy();
    assert.equal(policy.combinations, CREW_PIN_COMBINATIONS);
    assert.equal(policy.pinLength, 4);
    assert.equal(policy.maxAttempts, 5);
    assert.equal(policy.windowMs, 15 * MINUTE);
    assert.equal(policy.lockoutMs, 15 * MINUTE);
    assert.equal(policy.guessesPerDay, 480);
    assert.equal(policy.pairingTtlMs, 5 * MINUTE);
    // The claim made in the docs, computed here: ~20.8 days to exhaust 10,000
    // values against one account at 480 guesses/day.
    assert.ok(policy.exhaustionDays > 20 && policy.exhaustionDays < 21);
    // Stated, not hidden: the counters are process-local.
    assert.equal(policy.counterScope, 'process-local');
  });
});

describe('PIN_TIMING_EQUALIZATION_HASH', () => {
  it('is a genuine cost-12 bcrypt digest, not a look-alike string', async () => {
    // A malformed digest would make `bcrypt.compare` return false immediately,
    // without doing the work — which would turn the timing equalization into a
    // comment rather than a control. This is the one place a real cost-12
    // comparison is worth the ~300ms.
    assert.match(PIN_TIMING_EQUALIZATION_HASH, /^\$2[aby]\$12\$.{53}$/);
    assert.equal(PIN_TIMING_EQUALIZATION_HASH.length, 60);
    assert.equal(await comparePassword('0000', PIN_TIMING_EQUALIZATION_HASH), false);
    assert.equal(await comparePassword('9999', PIN_TIMING_EQUALIZATION_HASH), false);
  });
});

// ── QR branch ──────────────────────────────────────────────────────────────

describe('CrewAuthService — QR pairing login', () => {
  const TOKEN = 'a'.repeat(64);

  function pairingHarness(overrides: { updateAffected?: number; userRow?: StubUserRow | null } = {}) {
    const row: StubPairingRow = {
      id: 'pairing-1',
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      token_hash: hashToken(TOKEN),
      expires_at: new Date(1_700_000_000_000 + 5 * MINUTE),
      consumed_at: null,
    };
    return makeHarness({
      pairingRows: [row],
      updateAffected: overrides.updateAffected ?? 1,
      userRows: [overrides.userRow === undefined ? makeUser() : overrides.userRow],
    });
  }

  it('issues an ordinary session for a live, unconsumed code', async () => {
    const harness = pairingHarness();
    const result = await harness.service.login({ method: 'qr', pairing_token: TOKEN });
    assert.equal(result.response.access_token, 'mock-access-token');
    assert.equal(result.response.user.id, USER_ID);
    assert.equal(harness.auth.issuedFor.length, 1);
  });

  it('consumes the code in one atomic statement that also enforces single use and expiry', async () => {
    const harness = pairingHarness();
    await harness.service.login({ method: 'qr', pairing_token: TOKEN });

    assert.equal(harness.pairings.updateCalls, 1);
    assert.ok(harness.pairings.updateValues?.['consumed_at'] instanceof Date);
    const where = harness.pairings.updateWhere!;
    assert.equal(where['token_hash'], hashToken(TOKEN));
    // `consumed_at IS NULL` and `expires_at > now` live in the WHERE of the
    // UPDATE, not in application order — that is what makes a code unspendable
    // twice even when two scans arrive simultaneously, and unspendable after
    // expiry even if the service forgot to look at a clock.
    assert.equal(where['consumed_at'], null);
    assert.deepEqual((where['expires_at'] as Record<symbol, unknown>)[Op.gt], new Date(1_700_000_000_000));
  });

  it('never stores or looks up the plaintext token — only its digest', async () => {
    const harness = pairingHarness();
    await harness.service.login({ method: 'qr', pairing_token: TOKEN });
    assert.equal(harness.pairings.updateWhere!['token_hash'], hashToken(TOKEN));
    assert.equal(harness.pairings.findOneWhere?.['token_hash'], hashToken(TOKEN));
    assert.notEqual(hashToken(TOKEN), TOKEN);
  });

  it('refuses a code that matched no live row — expired, consumed or unknown alike', async () => {
    const harness = pairingHarness({ updateAffected: 0 });
    await assert.rejects(
      () => harness.service.login({ method: 'qr', pairing_token: TOKEN }),
      (error: unknown) => {
        assert.ok(error instanceof UnauthorizedException);
        const envelope = envelopeOf(error);
        assert.equal(envelope.status, 401);
        assert.equal(envelope.code, CREW_PAIRING_INVALID_CODE);
        assert.equal(envelope.message, INVALID_PAIRING_CODE_MESSAGE);
        return true;
      },
    );
    assert.equal(harness.auth.issuedFor.length, 0);
    assert.equal(harness.users.findOneCalls, 0, 'a rejected code must not reach the users table');
  });

  it('answers a malformed code exactly like an expired one', async () => {
    const signatures = new Set<string>();
    // Empty and whitespace-only tokens are not in this list. `crewLoginByQrSchema`
    // trims before `min(1)`, so `' '.repeat(10)` is a 400 from the shared-contract
    // re-parse rather than a 401 from the redemption lookup. That split is
    // intentional — a structurally impossible token should never reach a database
    // query — and each half is asserted separately below.
    for (const token of [TOKEN.slice(0, -1), 'not-a-code', 'B'.repeat(64), 'x'.repeat(512)]) {
      const harness = pairingHarness({ updateAffected: 0 });
      try {
        await harness.service.login({ method: 'qr', pairing_token: token });
        signatures.add('LOGGED IN');
      } catch (error) {
        const envelope = envelopeOf(error);
        signatures.add(JSON.stringify([envelope.status, envelope.code, envelope.message]));
      }
    }
    assert.equal(signatures.size, 1, 'one message for every QR failure');
    assert.ok(!signatures.has('LOGGED IN'));
  });

  it('rejects an empty or whitespace-only token at the shared-schema gate with a 400', async () => {
    const harness = pairingHarness({ updateAffected: 0 });
    for (const pairing_token of ['', ' '.repeat(10), '\t']) {
      await assert.rejects(
        () => harness.service.login({ method: 'qr', pairing_token }),
        (error: unknown) => {
          assert.equal((error as HttpException).getStatus(), 400, `token=${JSON.stringify(pairing_token)}`);
          return true;
        },
      );
    }
    assert.equal(harness.pairings.updateCalls, 0, 'a 400 must not reach the database');
    assert.equal(
      harness.pairings.findOneCalls,
      0,
      'nor run a lookup: a structurally impossible token is refused before any query',
    );
  });

  it('refuses a redeemed code whose account is not crew, or is inactive', async () => {
    for (const userRow of [
      makeUser({ role: UserRole.PARENT }),
      makeUser({ role: UserRole.SCHOOL_ADMIN }),
      makeUser({ is_active: false }),
      null,
    ]) {
      const harness = pairingHarness({ userRow });
      await assert.rejects(
        () => harness.service.login({ method: 'qr', pairing_token: TOKEN }),
        (error: unknown) => {
          assert.equal(envelopeOf(error).code, CREW_PAIRING_INVALID_CODE);
          return true;
        },
      );
      assert.equal(harness.auth.issuedFor.length, 0);
    }
  });

  it('clears a PIN lockout — a QR login is the documented recovery route', async () => {
    const row: StubPairingRow = {
      id: 'pairing-1',
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      token_hash: hashToken(TOKEN),
      expires_at: new Date(1_700_000_000_000 + 5 * MINUTE),
      consumed_at: null,
    };
    const harness = makeHarness({ pairingRows: [row], userRows: [makeUser()] });
    const key = CrewPinAttemptStore.keyFor(SCHOOL_ID, USER_ID);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.service.login(pinBody({ pin: WRONG_PIN })).catch(() => undefined);
    }
    assert.ok(harness.attempts.peek(key, harness.now()).lockedUntil !== null, 'precondition: locked out');
    // While locked, even the correct PIN is refused.
    await assert.rejects(() => harness.service.login(pinBody()), (error: unknown) => {
      assert.equal(envelopeOf(error).status, 429);
      return true;
    });

    const result = await harness.service.login({ method: 'qr', pairing_token: TOKEN });
    assert.equal(result.response.access_token, 'mock-access-token');
    assert.equal(harness.attempts.peek(key, harness.now()).lockedUntil, null, 'the lockout must be lifted');
    // …and the driver is back on the PIN path immediately afterwards.
    const again = await harness.service.login(pinBody());
    assert.equal(again.response.access_token, 'mock-access-token');
  });

  it('checks the tenant lifecycle after a successful redemption', async () => {
    const row: StubPairingRow = {
      id: 'pairing-1',
      school_id: SCHOOL_ID,
      user_id: USER_ID,
      token_hash: hashToken(TOKEN),
      expires_at: new Date(1_700_000_000_000 + 5 * MINUTE),
      consumed_at: null,
    };
    const harness = makeHarness({
      pairingRows: [row],
      schoolAccessible: false,
    });
    await assert.rejects(
      () => harness.service.login({ method: 'qr', pairing_token: TOKEN }),
      ForbiddenException,
    );
    assert.equal(harness.auth.issuedFor.length, 0);
  });
});

// ── PIN administration ─────────────────────────────────────────────────────

describe('CrewAuthService — setPin', () => {
  it('stores a bcrypt digest and never the plaintext', async () => {
    const row = makeUser({ pin_hash: null, pin_updated_at: null });
    const harness = makeHarness({ userRows: [row] });
    const result = await harness.service.setPin(SCHOOL_ID, UserRole.DRIVER, USER_ID, PIN);

    assert.ok(row.pin_hash, 'a hash must have been written');
    assert.notEqual(row.pin_hash, PIN, 'the plaintext must never be stored');
    assert.ok(!(row.pin_hash as string).includes(PIN));
    assert.match(row.pin_hash as string, /^\$2[aby]\$12\$.{53}$/, 'production cost factor 12');
    assert.equal(row.saveCalls, 1, 'the row must be persisted exactly once');

    assert.equal(result.pin_set, true);
    assert.equal(result.id, USER_ID);
    assert.equal(result.role, UserRole.DRIVER);
    assert.ok(!('pin_hash' in (result as unknown as Record<string, unknown>)), 'no hash in the response');
  });

  it('writes a hash that actually verifies against the plaintext', async () => {
    const row = makeUser({ pin_hash: null, pin_updated_at: null });
    const harness = makeHarness({ userRows: [row] });
    await harness.service.setPin(SCHOOL_ID, UserRole.DRIVER, USER_ID, PIN);
    assert.equal(await comparePassword(PIN, row.pin_hash as string), true);
    assert.equal(await comparePassword(WRONG_PIN, row.pin_hash as string), false);
  });

  it('sets pin_updated_at when issuing and clears it when revoking', async () => {
    const row = makeUser({ pin_hash: null, pin_updated_at: null });
    const harness = makeHarness({ userRows: [row] });

    const issued = await harness.service.setPin(SCHOOL_ID, UserRole.DRIVER, USER_ID, PIN);
    assert.equal(issued.pin_updated_at, new Date(1_700_000_000_000).toISOString());

    harness.setNow(1_700_000_000_000 + MINUTE);
    const cleared = await harness.service.setPin(SCHOOL_ID, UserRole.DRIVER, USER_ID, null);
    assert.equal(row.pin_hash, null);
    // `pin_updated_at IS NOT NULL` ⟺ `pin_set` — one column to read, no
    // reconciliation, and an admin list cannot show "set 3 days ago" for a PIN
    // that no longer exists.
    assert.equal(row.pin_updated_at, null);
    assert.equal(cleared.pin_set, false);
    assert.equal(cleared.pin_updated_at, null);
  });

  it('lifts the account lockout — an admin reset is the other recovery route', async () => {
    const row = makeUser();
    const harness = makeHarness({ userRows: [row] });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.service.login(pinBody({ pin: WRONG_PIN })).catch(() => undefined);
    }
    const key = CrewPinAttemptStore.keyFor(SCHOOL_ID, USER_ID);
    assert.ok(harness.attempts.peek(key, harness.now()).lockedUntil !== null);

    await harness.service.setPin(SCHOOL_ID, UserRole.DRIVER, USER_ID, '1357');
    assert.equal(harness.attempts.peek(key, harness.now()).lockedUntil, null);

    const result = await harness.service.login(pinBody({ pin: '1357' }));
    assert.equal(result.response.access_token, 'mock-access-token');
  });

  it('is tenant- and role-scoped: another school or the wrong role is a 404', async () => {
    const harness = makeHarness({ userRows: [makeUser()] });
    await assert.rejects(
      () => harness.service.setPin(OTHER_SCHOOL_ID, UserRole.DRIVER, USER_ID, PIN),
      (error: unknown) => {
        assert.equal((error as HttpException).getStatus(), 404);
        assert.equal((error as HttpException).message, crewNotFoundMessage(UserRole.DRIVER));
        return true;
      },
    );
    await assert.rejects(
      () => harness.service.setPin(SCHOOL_ID, UserRole.CONDUCTOR, USER_ID, PIN),
      /Conductor account not found/,
    );
  });

  it('matches the staff module wording, so a wrong id is indistinguishable across endpoints', () => {
    assert.equal(crewNotFoundMessage(UserRole.DRIVER), 'Driver account not found');
    assert.equal(crewNotFoundMessage(UserRole.CONDUCTOR), 'Conductor account not found');
  });

  it('refuses a malformed PIN itself, so no caller can bypass the edge validation', async () => {
    const row = makeUser({ pin_hash: null, pin_updated_at: null });
    const harness = makeHarness({ userRows: [row] });
    for (const pin of ['123', '12345', 'abcd', '', ' 1234']) {
      // The DTO and `crewPinSetSchema` both refuse these at the edge; this
      // asserts the service is not the *only* line of defence if a future caller
      // (a bulk import, an operator script) reaches it directly.
      assert.equal(crewPinSetSchema.safeParse({ pin }).success, false, `fixture ${pin}`);
      await assert.rejects(
        () => harness.service.setPin(SCHOOL_ID, UserRole.DRIVER, USER_ID, pin),
        (error: unknown) => {
          assert.equal((error as HttpException).getStatus(), 400);
          assert.match((error as HttpException).message, /exactly 4 digits/);
          return true;
        },
        `service must reject pin="${pin}"`,
      );
    }
    assert.equal(row.pin_hash, null, 'nothing may be written for a rejected PIN');
    assert.equal(row.saveCalls, 0);
  });
});

describe('CrewAuthService — getPinState', () => {
  it('reports only whether a PIN exists and when it changed', async () => {
    const harness = makeHarness({ userRows: [makeUser()] });
    const state = await harness.service.getPinState(SCHOOL_ID, UserRole.DRIVER, USER_ID);
    assert.deepEqual(state, {
      id: USER_ID,
      role: UserRole.DRIVER,
      pin_set: true,
      pin_updated_at: '2026-09-10T08:00:00.000Z',
    });
    assert.ok(!('pin_hash' in (state as unknown as Record<string, unknown>)));
  });

  it('reports pin_set false for an account that never had one', async () => {
    const harness = makeHarness({
      userRows: [makeUser({ pin_hash: null, pin_updated_at: null })],
    });
    const state = await harness.service.getPinState(SCHOOL_ID, UserRole.DRIVER, USER_ID);
    assert.equal(state.pin_set, false);
    assert.equal(state.pin_updated_at, null);
  });

  it('requests only the columns it needs', async () => {
    const harness = makeHarness({ userRows: [makeUser()] });
    await harness.service.getPinState(SCHOOL_ID, UserRole.DRIVER, USER_ID);
    assert.deepEqual(harness.users.attributes, ['id', 'role', 'pin_hash', 'pin_updated_at']);
  });

  it('404s for an unknown account', async () => {
    const harness = makeHarness({ userRows: [null] });
    await assert.rejects(
      () => harness.service.getPinState(SCHOOL_ID, UserRole.DRIVER, USER_ID),
      /Driver account not found/,
    );
  });
});

describe('crewPinState projection', () => {
  it('treats an empty string as no PIN', () => {
    assert.equal(crewPinState({ pin_hash: '', pin_updated_at: null }).pin_set, false);
    assert.equal(crewPinState({ pin_hash: null, pin_updated_at: null }).pin_set, false);
    assert.equal(crewPinState({ pin_hash: PIN_HASH, pin_updated_at: null }).pin_set, true);
  });
});

describe('isCrewRole', () => {
  it('accepts exactly the two crew roles', () => {
    assert.equal(isCrewRole(UserRole.DRIVER), true);
    assert.equal(isCrewRole(UserRole.CONDUCTOR), true);
    for (const role of [UserRole.PARENT, UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN]) {
      assert.equal(isCrewRole(role), false, `${role} is not crew`);
    }
    assert.equal(isCrewRole(null), false);
    assert.equal(isCrewRole(undefined), false);
    assert.equal(isCrewRole('DRIVER '), false, 'no accidental trimming of a role claim');
  });
});

// ── QR pairing administration ──────────────────────────────────────────────

describe('CrewAuthService — createPairingCode', () => {
  it('returns the plaintext once, plus the exact payload a QR must encode', async () => {
    const harness = makeHarness({ userRows: [makeUser()] });
    const result = await harness.service.createPairingCode(SCHOOL_ID, UserRole.DRIVER, USER_ID);

    assert.equal(result.payload, encodeCrewPairingPayload(result.pairing_token));
    assert.deepEqual(parseCrewPairingPayload(result.payload), { ok: true, token: result.pairing_token });
    assert.equal(result.expires_in_ms, 5 * MINUTE);
    assert.equal(result.expires_at, new Date(1_700_000_000_000 + 5 * MINUTE).toISOString());
    assert.equal(result.user.id, USER_ID);
    assert.equal(result.user.role, UserRole.DRIVER);
  });

  it('stores only the SHA-256 digest — the plaintext is never persisted', async () => {
    const harness = makeHarness({ userRows: [makeUser()] });
    const result = await harness.service.createPairingCode(SCHOOL_ID, UserRole.DRIVER, USER_ID);

    assert.equal(harness.pairings.created.length, 1);
    const stored = harness.pairings.created[0]!;
    assert.equal(stored['token_hash'], hashToken(result.pairing_token));
    assert.notEqual(stored['token_hash'], result.pairing_token);
    assert.ok(
      !Object.values(stored).includes(result.pairing_token),
      'no column may hold the plaintext code',
    );
    assert.equal(stored['consumed_at'], null);
    assert.equal(stored['school_id'], SCHOOL_ID);
    assert.equal(stored['user_id'], USER_ID);
  });

  it('mints a high-entropy, single-use code that differs every time', async () => {
    const harness = makeHarness({ userRows: [makeUser()] });
    const first = await harness.service.createPairingCode(SCHOOL_ID, UserRole.DRIVER, USER_ID);
    const second = await harness.service.createPairingCode(SCHOOL_ID, UserRole.DRIVER, USER_ID);
    assert.match(first.pairing_token, /^[0-9a-f]{64}$/, '256 bits of entropy, hex encoded');
    assert.notEqual(first.pairing_token, second.pairing_token);
    assert.notEqual(hashToken(first.pairing_token), hashToken(second.pairing_token));
  });

  it('supersedes the outstanding code and purges expired rows for the tenant', async () => {
    const harness = makeHarness({ userRows: [makeUser()] });
    await harness.service.createPairingCode(SCHOOL_ID, UserRole.DRIVER, USER_ID);

    assert.equal(harness.pairings.destroyed.length, 2, 'one supersede + one purge');
    const [supersede, purge] = harness.pairings.destroyed;
    assert.equal(supersede!['school_id'], SCHOOL_ID);
    assert.equal(supersede!['user_id'], USER_ID);
    assert.equal(supersede!['consumed_at'], null);
    assert.ok((supersede!['expires_at'] as Record<symbol, unknown>)[Op.gt] instanceof Date);
    // The purge is tenant-scoped: one school minting a code must never delete
    // another school's rows.
    assert.equal(purge!['school_id'], SCHOOL_ID);
    assert.equal(purge!['user_id'], undefined);
    assert.ok((purge!['expires_at'] as Record<symbol, unknown>)[Op.lt] instanceof Date);
  });

  it('honours a configured pairing TTL', async () => {
    const harness = makeHarness({
      userRows: [makeUser()],
      config: { 'crewAuth.pairingTtlMs': 60_000 },
    });
    const result = await harness.service.createPairingCode(SCHOOL_ID, UserRole.DRIVER, USER_ID);
    assert.equal(result.expires_in_ms, 60_000);
    assert.equal(result.expires_at, new Date(1_700_000_000_000 + 60_000).toISOString());
  });

  it('refuses to mint a code for a deactivated account', async () => {
    const harness = makeHarness({ userRows: [makeUser({ is_active: false })] });
    await assert.rejects(
      () => harness.service.createPairingCode(SCHOOL_ID, UserRole.DRIVER, USER_ID),
      (error: unknown) => {
        assert.equal((error as HttpException).getStatus(), 400);
        assert.match((error as HttpException).message, /deactivated driver/);
        return true;
      },
    );
    assert.equal(harness.pairings.created.length, 0);
  });

  it('is tenant- and role-scoped', async () => {
    const harness = makeHarness({ userRows: [makeUser()] });
    await assert.rejects(
      () => harness.service.createPairingCode(OTHER_SCHOOL_ID, UserRole.DRIVER, USER_ID),
      /Driver account not found/,
    );
    await assert.rejects(
      () => harness.service.createPairingCode(SCHOOL_ID, UserRole.CONDUCTOR, USER_ID),
      /Conductor account not found/,
    );
  });
});

// ── The shared-schema re-parse ─────────────────────────────────────────────

describe('CrewAuthService.login re-parses with the shared strict schema', () => {
  it('rejects cross-branch fields the DTO cannot forbid, with a 400 message array', async () => {
    const harness = makeHarness();
    await assert.rejects(
      () =>
        harness.service.login({
          method: 'qr',
          pairing_token: 'a'.repeat(64),
          pin: '1234',
        } as never),
      (error: unknown) => {
        assert.equal((error as HttpException).getStatus(), 400);
        const response = (error as HttpException).getResponse() as Record<string, unknown>;
        assert.ok(Array.isArray(response['message']), 'the standard 400 envelope carries an array');
        return true;
      },
    );
    assert.equal(harness.auth.issuedFor.length, 0);
  });

  it('rejects a PIN of the wrong length before any lookup', async () => {
    const harness = makeHarness();
    await assert.rejects(
      () => harness.service.login(pinBody({ pin: '123' }) as never),
      (error: unknown) => {
        assert.equal((error as HttpException).getStatus(), 400);
        return true;
      },
    );
    assert.equal(harness.users.findOneCalls, 0);
    assert.equal(harness.auth.issuedFor.length, 0);
  });

  it('accepts exactly what the shared schema accepts', async () => {
    const harness = makeHarness();
    const accepted = crewPinLoginSchema.parse(pinBody());
    const result = await harness.service.login(accepted);
    assert.equal(result.response.access_token, 'mock-access-token');
  });
});

describe('hashPassword is the production work factor', () => {
  it('produces a cost-12 digest that verifies', async () => {
    // Guards the assumption every assertion above makes about `$2b$12$`.
    const digest = await hashPassword(PIN);
    assert.match(digest, /^\$2[aby]\$12\$.{53}$/);
    assert.equal(await comparePassword(PIN, digest), true);
  });
});
