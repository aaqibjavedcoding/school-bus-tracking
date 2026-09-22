import { Op } from 'sequelize';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '../../framework';
import type { ConfigService } from '../../framework';
import type {
  CrewLoginByPinRequest,
  CrewLoginByQrRequest,
  CrewLoginRequest,
  CrewLoginResponse,
  CrewPairingResponse,
  CrewPinSetResponse,
  CrewPinState,
} from '@school-bus-tracking/shared-types';
import { UserRole } from '@school-bus-tracking/shared-types';
import {
  CREW_PIN_COMBINATIONS,
  CREW_PIN_LENGTH,
  crewPinLoginSchema,
  crewPinSchema,
  encodeCrewPairingPayload,
} from '@school-bus-tracking/validation';
import { comparePassword, generateRefreshToken, hashPassword, hashToken } from '../../auth';
import { CrewPairingToken, User } from '../../database/models';
import type { AuthSessionResult } from './auth.service';
import type { AuthService } from './auth.service';
import {
  CREW_LOGIN_ROLES,
  CREW_PAIRING_INVALID_CODE,
  CREW_PIN_AMBIGUOUS_CODE,
  CREW_PIN_AMBIGUOUS_MESSAGE,
  CREW_PIN_DUPLICATE_CODE,
  CREW_PIN_DUPLICATE_MESSAGE,
  CREW_PIN_INVALID_CODE,
  CREW_PIN_LOCKED_CODE,
  CREW_PIN_LOCKED_MESSAGE,
  INVALID_CREW_CREDENTIALS_MESSAGE,
  INVALID_PAIRING_CODE_MESSAGE,
  PIN_TIMING_EQUALIZATION_HASH,
} from './auth.constants';
import {
  CREW_PIN_DEFAULT_POLICY,
  CrewPinAttemptStore,
  estimatePinExhaustionDays,
  inspectPinAttempt,
  registerPinFailure,
  registerPinSuccess,
  type CrewPinBruteForcePolicy,
} from './crew-pin-attempts';

/**
 * Crew mobile login (Mobile-UX Phase 4): a 4-digit PIN, or a scanned QR pairing
 * code, for DRIVER and CONDUCTOR accounts only.
 *
 * Email/password login is untouched and remains the only path for SCHOOL_ADMIN,
 * PARENT and the platform SUPER_ADMIN. This service exists because a driver
 * standing in a depot at 6am cannot be asked for an email address and an
 * 8-character password on a phone, and because a 4-digit PIN is only survivable
 * inside a purpose-built throttle — which is what most of this file is.
 *
 * The PIN branch takes **exactly two inputs**: the school's code and the PIN.
 * There is no user id anywhere in the request, the DTO or the service — the
 * server resolves which crew member that PIN belongs to, which is why PINs are
 * unique per school and why the brute-force counter is school-wide.
 *
 * ### It mints no sessions of its own
 *
 * Both branches end in `AuthService.issueSession()`, the single place in the
 * application that signs an access token and persists a refresh-token row. A
 * crew session is therefore an ordinary session: same JWT claims, same rotation,
 * same cookies, same sockets, same `LoginResponse` shape. Nothing downstream
 * needs to know how the user got in — except the audit log, which is told.
 *
 * ### The threat model, concretely
 *
 * A 4-digit PIN covers `10 ** 4 = 10_000` values (`CREW_PIN_COMBINATIONS`). With
 * the shipped defaults — 5 failures per 15-minute window, then a 15-minute
 * lockout — one **school** yields 480 guesses per day, so walking the entire
 * space against a school takes ≈20.8 days of continuous, perfectly-timed
 * guessing, and every one of those attempts is an audited failure. That figure
 * is computed by `estimatePinExhaustionDays()` and pinned by
 * `crew-pin-attempts.spec.ts`; it is not a number someone typed into a document.
 *
 * Note the unit: the budget is **per school**, not per driver. A PIN login body
 * is `{ school_id, pin }` — no user id — so the counter is keyed by school (see
 * `crew-pin-attempts.ts` for why no narrower key would bound a sweep of distinct
 * PINs, and the DoS trade that costs).
 *
 * Three independent layers produce it:
 *
 * 1. the per-school attempt lockout below (`CrewPinAttemptStore`);
 * 2. the `auth_crew_login` rate-limit policy — per IP *and* per submitted
 *    school, so one host cannot walk a list of school codes;
 * 3. the audit trail — success and failure both, with the school aimed at.
 *
 * Two properties make the PIN check itself leak nothing:
 *
 * - **a fixed number of bcrypt comparisons always runs.** The submitted PIN is
 *   compared against every candidate at the school, padded with
 *   `PIN_TIMING_EQUALIZATION_HASH` comparisons up to
 *   `CREW_PIN_COMPARISON_COUNT` — the same trick `AuthService.login()` uses for
 *   passwords — so response timing cannot reveal whether a match was found, or
 *   whether the school has any crew PINs at all;
 * - **the lockout counts unknown schools too.** A failure is registered against
 *   the submitted school code whether or not it resolves, so the
 *   `remaining_attempts` countdown is identical for a real school and for a
 *   random string. Without that, the countdown alone would be an enumeration
 *   oracle.
 *
 * ### Known limitations — stated, not hidden
 *
 * - **The attempt counters are process-local.** `CrewPinAttemptStore` is an
 *   in-memory map, exactly like `MemoryRateLimitStore`. README §18 pins the
 *   supported topology at a single Node process; behind N instances an
 *   attacker's guesses are spread across processes, the effective allowance
 *   becomes `N × maxAttempts` per window, and a restart clears every counter
 *   mid-window. Raising the configured numbers does not fix that — a distributed
 *   counter does, and it is the same deferred Redis work the rate limiter
 *   already names. See `docs/security.md` → "Crew PIN brute force".
 * - **A school-wide lockout is a tenant-wide denial of service.** Five wrong
 *   PINs from anyone lock the PIN path for *every* driver at that school for up
 *   to `lockoutMs`. This is inherent to the only key that bounds a PIN sweep
 *   (see `crew-pin-attempts.ts`), and it is the deliberate trade: the
 *   alternative is an unbounded guess budget. Recovery does not depend on
 *   waiting it out — a QR pairing login clears the school's counter, and an
 *   administrator setting, resetting or clearing any PIN at that school clears
 *   it too.
 * - **PIN uniqueness is enforced at write time, not by the database.** Two crew
 *   members at one school sharing a PIN would make a login ambiguous, so
 *   `setPin` refuses to create one and `loginWithPin` refuses to resolve one.
 *   No unique index backs this — a bcrypt digest is salted per row, so the
 *   database cannot see that two hashes are the same PIN — which is why the
 *   ambiguous branch is kept as defence in depth rather than deleted as
 *   unreachable.
 * - **A stolen `pin_hash` column is crackable.** bcrypt at cost 12 slows an
 *   offline attack on a password to impracticality, but a 4-digit PIN has only
 *   10,000 candidates, so an attacker who has already read the database can
 *   exhaust them in minutes regardless of the work factor. The PIN is therefore
 *   not a standalone secret: it authorises a device that has already been paired
 *   by an administrator, and a database compromise is game over on every
 *   credential in it. This is documented rather than papered over with a higher
 *   cost factor that would only make login slower.
 *
 * The QR half does **not** share the first limitation: pairing codes live in
 * PostgreSQL, so they survive a restart and are correct under more than one
 * instance.
 */
export class CrewAuthService {
  constructor(
    private readonly users: typeof User,
    private readonly pairingTokens: typeof CrewPairingToken,
    private readonly auth: AuthService,
    private readonly configService?: ConfigService,
    /**
     * Per-user PIN attempt counters. Injectable so a test can hand in a fresh
     * store (or a pre-seeded one) and drive a whole lockout timeline without
     * waiting for real minutes to pass.
     */
    private readonly attempts: CrewPinAttemptStore = new CrewPinAttemptStore(),
    private readonly now: () => number = () => Date.now(),
    /**
     * The bcrypt comparison used by the PIN sweep. Injectable for the same
     * reason the clock is: "exactly N comparisons ran, whatever the outcome" is
     * a property a spec has to be able to *count*, and the only honest way to
     * count bcrypt calls is to hand in the function being called.
     */
    private readonly compare: (
      plaintext: string,
      hash: string,
    ) => Promise<boolean> = comparePassword,
  ) {}

  /** The configured brute-force policy, falling back to the shipped defaults. */
  get pinPolicy(): CrewPinBruteForcePolicy {
    return {
      maxAttempts:
        this.configService?.get<number>('crewAuth.pin.maxAttempts') ??
        CREW_PIN_DEFAULT_POLICY.maxAttempts,
      windowMs:
        this.configService?.get<number>('crewAuth.pin.windowMs') ??
        CREW_PIN_DEFAULT_POLICY.windowMs,
      lockoutMs:
        this.configService?.get<number>('crewAuth.pin.lockoutMs') ??
        CREW_PIN_DEFAULT_POLICY.lockoutMs,
    };
  }

  /** Configured lifetime of a QR pairing code, in ms. */
  get pairingTtlMs(): number {
    return this.configService?.get<number>('crewAuth.pairingTtlMs') ?? 5 * 60_000;
  }

  // ---------------------------------------------------------------- login

  /**
   * Authenticates a crew member by PIN or by scanned pairing code.
   *
   * The body is re-parsed with the shared `crewPinLoginSchema` even though the
   * route already ran it through `CrewLoginDto`: that schema is `.strict()` on
   * both union arms and is the exact contract the mobile client validated before
   * sending, so parsing it here is what makes the two ends unable to drift. A
   * rejection is a 400 in the repository's standard envelope.
   */
  async login(body: CrewLoginRequest): Promise<AuthSessionResult<CrewLoginResponse>> {
    const parsed = crewPinLoginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: parsed.error.issues.map((issue) =>
          [issue.path.join('.'), issue.message].filter(Boolean).join(' '),
        ),
        error: 'Bad Request',
      });
    }

    return parsed.data.method === 'pin'
      ? this.loginWithPin(parsed.data)
      : this.loginWithPairingCode(parsed.data);
  }

  /**
   * PIN branch: **school code + PIN**, with the server resolving the account.
   *
   * Ordering is the security property here, so it is spelled out:
   *
   * 1. the school-wide lockout is consulted **before** any database work, so a
   *    locked school is cheap to hammer and — because no lookup happens — a
   *    locked response says nothing about whether the school exists or how many
   *    crew it has;
   * 2. a **fixed** number of bcrypt comparisons runs (see
   *    `resolveCrewPinMatch`): one per candidate, padded with
   *    `PIN_TIMING_EQUALIZATION_HASH` comparisons up to
   *    `CREW_PIN_COMPARISON_COUNT`, so neither "no match" nor "this school has
   *    one driver" is distinguishable from the outside by timing;
   * 3. a failure is registered against the **school** either way — wrong PIN,
   *    ambiguous PIN, or a school code that resolved to nothing;
   * 4. only after the PIN is verified is the tenant lifecycle checked, so a
   *    deactivated school cannot be probed with an arbitrary credential.
   *
   * ### Why the candidate set is "every crew PIN at this school"
   *
   * The body no longer names a user, so the account *is* the answer to "whose
   * hash does this PIN verify against?". That is only a well-posed question if
   * the answer is unique, which is enforced where PINs are written
   * (`setPin` refuses a collision) and defended against here (2+ matches is a
   * `CREW_PIN_AMBIGUOUS` 401, never a session).
   */
  private async loginWithPin(
    request: CrewLoginByPinRequest,
  ): Promise<AuthSessionResult<CrewLoginResponse>> {
    const policy = this.pinPolicy;
    const now = this.now();

    // An unresolvable tenant code is keyed on the submitted string so the
    // countdown an attacker sees stays consistent, and so a bogus code cannot be
    // used to consume a real school's allowance.
    const submittedSchool = request.school_id.trim();
    const schoolId = await this.auth.resolveTenantId(submittedSchool);
    const bucket = CrewPinAttemptStore.keyForSchool(schoolId ?? submittedSchool.toLowerCase());

    const inspected = inspectPinAttempt(this.attempts.peek(bucket, now), now, policy);
    if (inspected.locked) {
      this.attempts.write(bucket, inspected.state, now);
      throw this.pinLockedException(inspected.retryAfterMs ?? policy.lockoutMs);
    }

    // `unscoped()` opts out of the default scope that hides both credential
    // columns; `pin_hash` is needed here and is never returned. The WHERE is the
    // whole candidate set: this tenant, a crew role, active, and actually holding
    // a PIN — nothing else can be the account this PIN belongs to.
    const candidates = schoolId
      ? await this.users.unscoped().findAll({
          where: {
            school_id: schoolId,
            role: { [Op.in]: [...CREW_LOGIN_ROLES] },
            is_active: true,
            pin_hash: { [Op.ne]: null },
          },
        })
      : [];

    const resolution = await resolveCrewPinMatch({
      pin: request.pin,
      candidates,
      compare: this.compare,
    });

    // Exactly one match is the only success. Everything else — zero matches, an
    // ambiguous PIN — is a failure against the school's counter, so a sweep of
    // distinct PINs is bounded by the same five-per-window budget whichever
    // branch it lands in.
    if (resolution.matches.length !== 1) {
      const failed = registerPinFailure(inspected.state, now, policy);
      this.attempts.write(bucket, failed.state, now);
      if (failed.locked) {
        throw this.pinLockedException(failed.retryAfterMs ?? policy.lockoutMs);
      }
      if (resolution.matches.length > 1) {
        // Never echoes the PIN, and never names the accounts: this is an
        // administrator's problem, described in one sentence.
        throw new UnauthorizedException({
          statusCode: HttpStatus.UNAUTHORIZED,
          message: CREW_PIN_AMBIGUOUS_MESSAGE,
          error: CREW_PIN_AMBIGUOUS_CODE,
          details: { remaining_attempts: failed.remainingAttempts },
        });
      }
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: INVALID_CREW_CREDENTIALS_MESSAGE,
        error: CREW_PIN_INVALID_CODE,
        details: { remaining_attempts: failed.remainingAttempts },
      });
    }

    const user = resolution.matches[0]!;

    // Same ordering rule as `AuthService.login()`: only a verified credential
    // may learn anything about the tenant's lifecycle state.
    await this.auth.assertSchoolAccessible(user);

    this.attempts.write(bucket, registerPinSuccess(inspected.state), now);
    return this.auth.issueSession(user);
  }

  /**
   * QR branch: redeem a short-lived, single-use pairing code.
   *
   * Redemption is one atomic `UPDATE … WHERE token_hash = ? AND consumed_at IS
   * NULL AND expires_at > now()`. Of N concurrent scans of the same code,
   * Postgres row locking lets exactly one update a row; every other caller
   * matches zero rows and is refused. There is no read-then-write window, so a
   * code cannot be spent twice even by two requests that arrive simultaneously.
   */
  private async loginWithPairingCode(
    request: CrewLoginByQrRequest,
  ): Promise<AuthSessionResult<CrewLoginResponse>> {
    const now = this.now();
    const tokenHash = hashToken(request.pairing_token.trim());

    const [consumed] = await this.pairingTokens.update(
      { consumed_at: new Date(now) },
      {
        where: {
          token_hash: tokenHash,
          consumed_at: null,
          expires_at: { [Op.gt]: new Date(now) },
        },
      },
    );

    if (consumed !== 1) {
      // Malformed, unknown, expired or already spent — one message for all of
      // them, because a code is a secret and "expired" versus "never existed"
      // would narrow an attacker's search.
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: INVALID_PAIRING_CODE_MESSAGE,
        error: CREW_PAIRING_INVALID_CODE,
      });
    }

    const pairing = await this.pairingTokens.findOne({ where: { token_hash: tokenHash } });
    const user = pairing
      ? await this.users.unscoped().findOne({
          where: { school_id: pairing.school_id, id: pairing.user_id },
        })
      : null;

    if (!user || !user.is_active || !isCrewRole(user.role)) {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: INVALID_PAIRING_CODE_MESSAGE,
        error: CREW_PAIRING_INVALID_CODE,
      });
    }

    await this.auth.assertSchoolAccessible(user);

    // A successful QR login is the documented recovery route out of a PIN
    // lockout, so it clears the counter. Only an administrator can mint the code
    // that gets a device here, which is exactly the authority that should be
    // able to lift a lockout.
    if (user.school_id) {
      this.attempts.forget(CrewPinAttemptStore.keyForSchool(user.school_id));
    }

    return this.auth.issueSession(user);
  }

  /**
   * The 429 raised while an account is inside its PIN lockout.
   *
   * Specific on purpose, unlike every other crew auth failure: the caller has
   * already named the account they are attacking, the legitimate user needs the
   * wait explained to them, and `Retry-After` plus `retry_after_seconds` give the
   * app a countdown to render instead of a spinner that never ends.
   */
  private pinLockedException(retryAfterMs: number): HttpException {
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: CREW_PIN_LOCKED_MESSAGE,
        error: CREW_PIN_LOCKED_CODE,
        details: { retry_after_seconds: retryAfterSeconds, remaining_attempts: 0 },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // ------------------------------------------------------------ PIN admin

  /**
   * Sets, resets or clears the mobile login PIN of one crew account.
   *
   * Administrator-driven only — there is deliberately no self-service PIN
   * change in this phase, because a crew member who could set their own PIN
   * could also set it from a session obtained by any other means, and the
   * admin-issued PIN is what ties a device to a person the school vouched for.
   *
   * The plaintext is hashed with the same bcrypt cost factor as a password and
   * is never returned: the response reports only `pin_set` and when it changed.
   * An administrator who has lost a PIN cannot read it back and must set a
   * new one.
   *
   * Setting or clearing a PIN also **lifts the whole school's lockout** — it is
   * the second documented recovery route, and an admin who has just been told
   * "locked out" should not have to also wait a quarter of an hour.
   *
   * A PIN that another **active** crew member of the same school already holds
   * is refused with `CREW_PIN_DUPLICATE` (409). See the inline comment for why
   * that is a correctness rule and not a preference.
   */
  async setPin(
    schoolId: string,
    role: CrewLoginRoleArg,
    userId: string,
    pin: string | null,
  ): Promise<CrewPinSetResponse> {
    // Defence in depth: the DTO and `crewPinSetSchema` both reject a malformed
    // PIN at the edge, and the service refuses one too, so no future caller — a
    // bulk import, an operator script, a new endpoint — can persist a PIN that
    // the login side would then be unable to verify.
    if (pin !== null && !crewPinSchema.safeParse(pin).success) {
      throw new BadRequestException(`Please enter the PIN as exactly ${CREW_PIN_LENGTH} digits.`);
    }

    const user = await this.users.unscoped().findOne({
      where: { school_id: schoolId, id: userId, role },
    });
    if (!user) {
      throw new NotFoundException(crewNotFoundMessage(role));
    }

    if (pin !== null) {
      // Uniqueness is checked *before* the write, and it is a login
      // requirement rather than a housekeeping preference: a PIN login names no
      // user, so "whose hash does this PIN verify against?" must have exactly
      // one answer at this school. Comparing digests directly is impossible
      // (bcrypt salts each hash), so the plaintext is verified against every
      // other active crew member's stored hash — the same
      // `comparePassword` the login path uses, so the two sides cannot
      // disagree about what "the same PIN" means.
      //
      // Cost, stated rather than hidden: one comparison per active crew member
      // who has a PIN, run concurrently. A school with 20 PIN-carrying crew
      // spends ~20 × the per-digest cost of its stored format (native PBKDF2
      // for new rows, bcrypt for legacy rows) on a rare admin action. That is
      // the price of not storing a second, fast digest column; it is acceptable
      // here and would not be on a login hot path.
      const others = await this.users.unscoped().findAll({
        where: {
          school_id: schoolId,
          role: { [Op.in]: [...CREW_LOGIN_ROLES] },
          is_active: true,
          id: { [Op.ne]: userId },
          pin_hash: { [Op.ne]: null },
        },
      });
      const collisions = await Promise.all(
        others.map(async (other) =>
          other.pin_hash === null ? false : comparePassword(pin, other.pin_hash),
        ),
      );
      if (collisions.some(Boolean)) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: CREW_PIN_DUPLICATE_MESSAGE,
          error: CREW_PIN_DUPLICATE_CODE,
        });
      }
    }

    const at = new Date(this.now());
    if (pin === null) {
      // `pin_updated_at` is cleared with the hash so the invariant holds in both
      // directions: `pin_updated_at IS NOT NULL` ⟺ `pin_set`. An admin list can
      // then show "PIN set 3 days ago" without a second column to reconcile.
      user.pin_hash = null;
      user.pin_updated_at = null;
    } else {
      user.pin_hash = await hashPassword(pin);
      user.pin_updated_at = at;
    }
    await user.save();

    // Clears the **school's** counter, not one account's: the lockout is
    // school-wide now, and an administrator resetting a PIN is the recovery
    // route a locked-out depot actually has. Setting, resetting *and* clearing
    // all lift it, because in every one of those three cases the credential the
    // driver was failing with has just been changed by someone with authority.
    this.attempts.forget(CrewPinAttemptStore.keyForSchool(schoolId));

    return {
      id: user.id,
      role: user.role as CrewLoginRoleArg,
      ...crewPinState(user),
    };
  }

  /**
   * Non-secret PIN status of a crew account, for an admin list or detail view.
   *
   * One query, and an explicit `attributes` list: `pin_hash` is hidden by the
   * default scope, so deriving `pin_set` needs an unscoped read — but the
   * projection returns only the boolean and the timestamp, so the digest is
   * fetched for a comparison and never leaves this method.
   */
  async getPinState(
    schoolId: string,
    role: CrewLoginRoleArg,
    userId: string,
  ): Promise<CrewPinState & { id: string; role: UserRole }> {
    const user = await this.users.unscoped().findOne({
      where: { school_id: schoolId, id: userId, role },
      attributes: ['id', 'role', 'pin_hash', 'pin_updated_at'],
    });
    if (!user) {
      throw new NotFoundException(crewNotFoundMessage(role));
    }
    return {
      id: user.id,
      role: user.role,
      ...crewPinState(user),
    };
  }

  // ------------------------------------------------------- QR pairing admin

  /**
   * Mints a short-lived, single-use QR pairing code for one crew account.
   *
   * The plaintext token is returned **once**, to the administrator who asked for
   * it, and only its SHA-256 digest is stored — so a later database read, or a
   * leaked backup, cannot resurrect a live code. The response also carries the
   * exact string the QR must encode (`encodeCrewPairingPayload`), so the admin
   * console and the mobile parser cannot disagree about the wire format.
   *
   * Minting supersedes the crew member's outstanding code: one live code per
   * person, so a stale QR left open on a screen cannot be redeemed after a newer
   * one was issued. Expired rows for the tenant are purged on the same write,
   * which is what keeps the table near-empty without extending the retention
   * worker (see `crew_pairing_tokens` migration notes).
   */
  async createPairingCode(
    schoolId: string,
    role: CrewLoginRoleArg,
    userId: string,
  ): Promise<CrewPairingResponse> {
    const user = await this.users.unscoped().findOne({
      where: { school_id: schoolId, id: userId, role },
    });
    if (!user) {
      throw new NotFoundException(crewNotFoundMessage(role));
    }
    if (!user.is_active) {
      // A deactivated account can never redeem a code (`loginWithPairingCode`
      // refuses it), so minting one would only produce a QR that scans and then
      // fails — say so at the point the administrator can act on it.
      throw new BadRequestException(
        `Cannot create a login QR for a deactivated ${role.toLowerCase()} account`,
      );
    }

    const now = this.now();

    // One live code per crew member.
    await this.pairingTokens.destroy({
      where: {
        school_id: schoolId,
        user_id: userId,
        consumed_at: null,
        expires_at: { [Op.gt]: new Date(now) },
      },
    });
    // Tenant-scoped purge of expired rows, bounded in practice by the
    // `crew_pairing` rate limit (10 mints per 15 min per administrator).
    await this.pairingTokens.destroy({
      where: { school_id: schoolId, expires_at: { [Op.lt]: new Date(now) } },
    });

    const pairingToken = generateRefreshToken();
    const expiresAt = new Date(now + this.pairingTtlMs);

    await this.pairingTokens.create({
      school_id: schoolId,
      user_id: userId,
      token_hash: hashToken(pairingToken),
      expires_at: expiresAt,
      consumed_at: null,
    } as unknown as CrewPairingToken);

    return {
      pairing_token: pairingToken,
      payload: encodeCrewPairingPayload(pairingToken),
      expires_in_ms: this.pairingTtlMs,
      expires_at: expiresAt.toISOString(),
      user: this.auth.toAuthenticatedUser(user),
    };
  }

  /**
   * The brute-force arithmetic, computed rather than quoted.
   *
   * Exposed so the documentation and the admin console can state the shipped
   * policy's real bound instead of a figure someone typed into a markdown file
   * and forgot to update.
   */
  describeBruteForcePolicy(): {
    pinLength: number;
    combinations: number;
    maxAttempts: number;
    windowMs: number;
    lockoutMs: number;
    guessesPerDay: number;
    exhaustionDays: number;
    pairingTtlMs: number;
    counterScope: 'process-local';
  } {
    const policy = this.pinPolicy;
    const cycleMs = Math.max(policy.windowMs, policy.lockoutMs);
    return {
      pinLength: Math.log10(CREW_PIN_COMBINATIONS),
      combinations: CREW_PIN_COMBINATIONS,
      maxAttempts: policy.maxAttempts,
      windowMs: policy.windowMs,
      lockoutMs: policy.lockoutMs,
      guessesPerDay: policy.maxAttempts * (86_400_000 / cycleMs),
      exhaustionDays: estimatePinExhaustionDays({
        combinations: CREW_PIN_COMBINATIONS,
        policy,
      }),
      pairingTtlMs: this.pairingTtlMs,
      counterScope: 'process-local',
    };
  }
}

/**
 * The fixed number of bcrypt comparisons a PIN login performs.
 *
 * A submitted PIN is compared against **every** candidate at the school (that
 * is what resolves the account), and if the school has fewer than this many
 * PIN-carrying crew the shortfall is padded with comparisons against
 * `PIN_TIMING_EQUALIZATION_HASH`. Eight is chosen so that the overwhelmingly
 * common case — a school with one to eight drivers — always does exactly the
 * same work, which is what makes the response time uninformative:
 *
 * - a school with **no** crew PINs at all takes as long as one with eight;
 * - a **wrong** PIN takes as long as a right one;
 * - an **unknown school code** (no candidates, full padding) takes as long as
 *   either.
 *
 * A school with *more* than eight candidates does more work — it must, or the
 * ninth driver could not log in — and that is the one thing the timing can
 * reveal: roughly how many crew a school has. It cannot reveal whether the PIN
 * was correct, which is the property that matters, and the school-wide lockout
 * bounds how many probes an attacker gets anyway.
 *
 * Latency is bounded, not free: the fixed work is still *real* per comparison
 * (so the count cannot be faked), but the digest format produced by
 * `auth/password.util` costs ~15 ms of native PBKDF2 per comparison instead of
 * ~250–300 ms of pure-JS bcrypt — a PIN login answers in a few tens of
 * milliseconds of comparison work rather than a couple of seconds. The
 * comparisons are issued concurrently and the KDF runs on OpenSSL's threadpool,
 * so the server keeps serving other requests throughout.
 */
export const CREW_PIN_COMPARISON_COUNT = 8;

/** A row the PIN can be resolved against: anything carrying a `pin_hash`. */
export interface CrewPinCandidate {
  pin_hash: string | null;
}

/** Outcome of the constant-time comparison sweep. */
export interface CrewPinResolution<T> {
  /** Candidates whose stored hash the PIN verified against, in query order. */
  matches: T[];
  /**
   * How many bcrypt comparisons ran. Always `max(candidates, CREW_PIN_COMPARISON_COUNT)`
   * — pinned by `crew-auth.service.spec.ts`, because the whole timing argument
   * rests on this number not varying with the outcome.
   */
  comparisons: number;
}

/**
 * Compare a submitted PIN against a school's candidate hashes, with a fixed
 * amount of work.
 *
 * Pure and injectable on purpose: `compare`, `padHash` and `minComparisons` are
 * parameters, so `crew-auth.service.spec.ts` can count the comparisons with a
 * stub instead of spending real bcrypt seconds, while production passes
 * `comparePassword` and `PIN_TIMING_EQUALIZATION_HASH`.
 *
 * Every candidate is compared even after a match is found — short-circuiting
 * would make "matched on the first driver" faster than "matched on the eighth",
 * which is exactly the leak this exists to prevent. Candidates without a hash
 * (which the login query excludes, but a caller might not) still consume one
 * padded comparison, so the count never depends on the data either.
 */
export async function resolveCrewPinMatch<T extends CrewPinCandidate>(input: {
  pin: string;
  candidates: readonly T[];
  minComparisons?: number;
  padHash?: string;
  compare?: (plaintext: string, hash: string) => Promise<boolean>;
}): Promise<CrewPinResolution<T>> {
  const min = input.minComparisons ?? CREW_PIN_COMPARISON_COUNT;
  const padHash = input.padHash ?? PIN_TIMING_EQUALIZATION_HASH;
  const compare = input.compare ?? comparePassword;

  // Real comparisons first, then padding up to the floor. Padding against a
  // genuine digest that costs real work (never against a malformed string,
  // which `bcrypt`/PBKDF2 would reject without doing the work — see the
  // `PIN_TIMING_EQUALIZATION_HASH` spec) is what makes the padded and unpadded
  // paths equally expensive.
  const padded = Math.max(0, min - input.candidates.length);
  const results = await Promise.all([
    ...input.candidates.map((candidate) => compare(input.pin, candidate.pin_hash ?? padHash)),
    ...Array.from({ length: padded }, () => compare(input.pin, padHash)),
  ]);

  const matches: T[] = [];
  results.slice(0, input.candidates.length).forEach((matched, index) => {
    const candidate = input.candidates[index];
    // A candidate with no hash can never match: `padHash` is a digest of a
    // random throwaway value, but the belt-and-braces check means a caller that
    // hands in hash-less rows cannot authenticate one by accident.
    if (matched && candidate.pin_hash !== null) {
      matches.push(candidate);
    }
  });

  return { matches, comparisons: results.length };
}

/** The two roles a crew PIN may be issued to, as `UserRole` members. */
export type CrewLoginRoleArg = UserRole.DRIVER | UserRole.CONDUCTOR;

/** True for the roles allowed to hold a PIN and to use `/auth/crew-login`. */
export function isCrewRole(role: string | null | undefined): role is CrewLoginRoleArg {
  return typeof role === 'string' && (CREW_LOGIN_ROLES as readonly string[]).includes(role);
}

/**
 * Non-secret PIN status projection.
 *
 * Reads only whether a hash exists and when it was written. It never returns the
 * hash, and because the hash is of a 4-digit value it is treated as more
 * sensitive than a password hash, not less.
 */
export function crewPinState(user: Pick<User, 'pin_hash' | 'pin_updated_at'>): CrewPinState {
  return {
    pin_set: typeof user.pin_hash === 'string' && user.pin_hash.length > 0,
    pin_updated_at: user.pin_updated_at ? new Date(user.pin_updated_at).toISOString() : null,
  };
}

/**
 * 404 message for a crew account that is not in the caller's tenant.
 *
 * Deliberately identical to `staffNotFoundMessage()` for the same role, so
 * `PUT /drivers/:id/pin` and `GET /drivers/:id` are indistinguishable when the
 * id is wrong, belongs to another tenant, or belongs to a conductor: one message
 * for "not your driver", whichever crew endpoint you reached it through.
 */
export function crewNotFoundMessage(role: CrewLoginRoleArg): string {
  return `${role === UserRole.DRIVER ? 'Driver' : 'Conductor'} account not found`;
}
