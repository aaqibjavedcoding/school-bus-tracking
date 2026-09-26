import { Op } from 'sequelize';
import { BadRequestException, Logger } from '../../framework';
import type { ConfigService } from '../../framework';
import type {
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  ResetPasswordRequest,
} from '@school-bus-tracking/shared-types';
import { UserRole } from '@school-bus-tracking/shared-types';
import { APP_CONFIG } from '@school-bus-tracking/config';
import { generateRefreshToken, hashPassword, hashToken, normalizeEmail } from '../../auth';
import { PasswordResetToken, User } from '../../database/models';
import type { EmailNotificationProvider } from '../notifications/providers';
import type { AuthService } from './auth.service';
import {
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  INVALID_PASSWORD_RESET_TOKEN_MESSAGE,
  PASSWORD_RESET_SUCCESS_MESSAGE,
} from './auth.constants';
import { buildPasswordResetEmail, buildPasswordResetUrl } from './password-reset.email';
import {
  PASSWORD_RESET_RETENTION_MS,
  inspectPasswordResetToken,
  markPasswordResetTokenUsed,
  passwordResetExpiryAt,
  resolvePasswordResetTtlMs,
  type PasswordResetTokenDecision,
} from './password-reset-tokens';

/**
 * Self-service "Forgot password" for **SCHOOL_ADMIN** accounts.
 *
 * Two endpoints, one rule each:
 *
 * - `POST /auth/forgot-password` — mint a link and email it, *and say nothing
 *   about whether there was anyone to email*;
 * - `POST /auth/reset-password` — redeem the link exactly once, set the new
 *   password, and end every session the account had.
 *
 * ### Scope, and what is deliberately not here
 *
 * Only `SCHOOL_ADMIN`. A DRIVER or CONDUCTOR has no password at all on the
 * mobile app — they sign in with a 4-digit PIN or a QR pairing code, both of
 * which are admin-issued by design (`staff.ts`, `set-crew-pin.dto.ts`) — so
 * there is nothing here for them to reset and `crew-auth.service.ts` is
 * untouched by this file. PARENT and the platform SUPER_ADMIN are reasonable
 * future additions but are out of scope: the first needs a decision about
 * guardians who share an address, the second is the account that can reach
 * every tenant and deserves its own thinking.
 *
 * ### Account enumeration is the whole design constraint
 *
 * An unauthenticated endpoint that takes `(school, email)` and behaves
 * differently when the pair exists is a directory of every school on the
 * platform and who runs it. So `requestReset` returns
 * {@link FORGOT_PASSWORD_GENERIC_MESSAGE} — the same string, the same status,
 * the same body shape — for *all* of:
 *
 * - a matching, active SCHOOL_ADMIN (a link is minted and mailed);
 * - a matching account whose role is DRIVER / CONDUCTOR / PARENT / SUPER_ADMIN;
 * - a matching SCHOOL_ADMIN that is deactivated;
 * - a SCHOOL_ADMIN whose *school* is deactivated;
 * - no matching user;
 * - an unknown school code (which never reaches the users table at all).
 *
 * It also never throws for any of them: an exception is a different response.
 * Even an SMTP failure is swallowed into the same success — the caller is not
 * entitled to know whether mail left the building, and the alternative leaks
 * "this address exists, we just couldn't reach it".
 *
 * The one thing deliberately *not* equalized is response **timing**: only the
 * matching case hashes a token and talks to an SMTP relay. Timing is a much
 * noisier channel than a message (the mail send is asynchronous relative to
 * nothing the attacker controls, and the public rate limit allows 5 requests
 * per 15 minutes per IP and 3 per hour per identity, which is far too few to
 * average out), and the alternative — faking an SMTP round trip for unknown
 * addresses — costs more than it buys.
 */
/**
 * What a completed reset hands back to the route.
 *
 * `message` is the response; the other three exist only so the route can
 * write the `auth.password_reset` audit row without looking the account up a
 * second time, and it strips them before responding — they are never on the
 * wire.
 */
export interface PasswordResetResult {
  message: string;
  user_id: string;
  school_id: string | null;
  /** How many live sessions the reset ended. Useful in an investigation. */
  revoked_sessions: number;
}

export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly users: typeof User,
    private readonly tokens: typeof PasswordResetToken,
    private readonly auth: AuthService,
    private readonly email: EmailNotificationProvider,
    private readonly configService?: ConfigService,
  ) {}

  /** Honoured link lifetime, already clamped into the 30–60 minute band. */
  getTtlMs(): number {
    return resolvePasswordResetTtlMs(this.configService?.get<number>('passwordReset.ttlMs'));
  }

  /** Origin used to build the emailed link. */
  private appUrl(): string {
    return this.configService?.get<string>('app.appUrl') || 'http://localhost:3001';
  }

  /**
   * Product name used in the email copy.
   *
   * Read from the shared `APP_CONFIG`, the single place the product is named
   * (the web console reads the same constant for its titles and brand
   * lockup), so a rename never leaves the console and the email disagreeing.
   */
  private appName(): string {
    return APP_CONFIG.appName;
  }

  /** Test seam: the clock, in one place. */
  protected now(): number {
    return Date.now();
  }

  /**
   * `POST /auth/forgot-password`.
   *
   * Resolves the tenant, looks for the account, and — **only** when it is an
   * active SCHOOL_ADMIN of a live school — mints a link and mails it. Every
   * path returns the identical response and none of them throws.
   */
  async requestReset(
    dto: ForgotPasswordRequest,
    context: { ip?: string | null } = {},
  ): Promise<ForgotPasswordResponse> {
    const response: ForgotPasswordResponse = { message: FORGOT_PASSWORD_GENERIC_MESSAGE };

    try {
      const user = await this.findResettableAdmin(dto);
      if (!user) {
        return response;
      }
      const rawToken = await this.issueToken(user.id, context.ip ?? null);
      await this.deliverResetEmail(user, rawToken);
    } catch (error) {
      // A failure here must not change what the caller sees, in either
      // direction: a 500 would say "something about this input was special",
      // and a different success message would say the same thing more
      // politely. Record it for the operator and answer exactly as always.
      this.logger.error(
        `Password reset request could not be completed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    return response;
  }

  /**
   * `POST /auth/reset-password`.
   *
   * Redeems a link once: validates the digest, expiry and unused state, sets
   * the new `password_hash`, marks the token used, and revokes **every** live
   * refresh token of the account through
   * {@link AuthService.revokeAllUserSessions}.
   *
   * That last step is the point of the whole flow. A reset usually happens
   * because somebody else has the old credential; leaving their refresh
   * cookie alive would let them mint fresh access tokens for another seven
   * days, and the reset would have accomplished nothing but inconveniencing
   * the owner.
   *
   * Returns the identity of the account alongside the message so the route
   * can write the `auth.password_reset` audit row. The route strips those
   * fields before responding — they are never on the wire.
   */
  async resetPassword(dto: ResetPasswordRequest): Promise<PasswordResetResult> {
    const now = this.now();
    const tokenHash = hashToken(dto.token.trim());

    const stored = await this.tokens.unscoped().findOne({ where: { token_hash: tokenHash } });
    const decision: PasswordResetTokenDecision = inspectPasswordResetToken(stored, now);
    if (!decision.usable || !stored) {
      // The reason is logged, never returned: "expired" vs "never existed"
      // narrows an attacker's search.
      this.logger.warn(`Rejected password reset token (${decision.reason}).`);
      throw new BadRequestException(INVALID_PASSWORD_RESET_TOKEN_MESSAGE);
    }

    const user = await this.users.unscoped().findOne({ where: { id: stored.user_id } });
    if (!user || !user.is_active || user.role !== UserRole.SCHOOL_ADMIN) {
      // The account was deactivated, deleted or had its role changed between
      // the link being mailed and the link being clicked. Burn the token so a
      // later retry cannot succeed either, and answer with the same single
      // message — confirming "this account can no longer be reset" would
      // confirm the account.
      await stored.update(markPasswordResetTokenUsed(now));
      this.logger.warn('Rejected password reset token (account no longer resettable).');
      throw new BadRequestException(INVALID_PASSWORD_RESET_TOKEN_MESSAGE);
    }

    await user.update({ password_hash: await hashPassword(dto.password) });
    await stored.update(markPasswordResetTokenUsed(now));

    // Every device signed in under the old password loses its session,
    // including the one that may have prompted the reset.
    const revoked = await this.auth.revokeAllUserSessions(user.id);

    return {
      message: PASSWORD_RESET_SUCCESS_MESSAGE,
      user_id: user.id,
      school_id: user.school_id,
      revoked_sessions: revoked,
    };
  }

  /**
   * The account an emailed link may be minted for, or `null`.
   *
   * Null covers every "no" — unknown tenant, unknown email, wrong role,
   * deactivated account, deactivated school — on purpose: the caller must not
   * be able to branch on which one applied, so this method does not tell it.
   *
   * The tenant is resolved with `AuthService.resolveTenantId`, the same code
   * the login form's school-code field goes through, so a school admin types
   * one identifier and both screens accept it. An unresolvable code returns
   * `null` *before* any query — handing a raw code to a UUID column would
   * surface a 500 and, with it, the fact that the code is not a tenant.
   */
  private async findResettableAdmin(dto: ForgotPasswordRequest): Promise<User | null> {
    const schoolId = await this.auth.resolveTenantId(String(dto.school_id ?? '').trim());
    if (!schoolId) {
      return null;
    }

    const email = normalizeEmail(dto.email);
    // `unscoped()` for consistency with the other credential lookups; no
    // hidden column is read here and none is ever returned.
    const user = await this.users.unscoped().findOne({ where: { school_id: schoolId, email } });

    if (!user || !user.is_active) {
      return null;
    }
    // The role gate. Self-service reset exists for school administrators
    // only; every other role silently no-ops with the same response.
    if (user.role !== UserRole.SCHOOL_ADMIN) {
      return null;
    }

    try {
      // Reuses the single tenant-lifecycle rule every login path shares, so a
      // deactivated school cannot be reset into. It throws, which here means
      // "no" — the caller must still get the generic response.
      await this.auth.assertSchoolAccessible(user);
    } catch {
      return null;
    }

    return user;
  }

  /**
   * Mints one link for `userId` and returns the **raw** token.
   *
   * Three writes, in this order and for these reasons:
   *
   * 1. **supersede** — every other unused row of this user is marked used, so
   *    "one active link at a time" holds. A user who clicks the button three
   *    times has one working link (the newest), not three.
   * 2. **purge** — rows that have been dead longer than
   *    {@link PASSWORD_RESET_RETENTION_MS} are deleted. This is why the table
   *    needs no entry in the retention worker: its rows live for minutes and
   *    every new request cleans up after the old ones.
   * 3. **insert** — the new row, storing only the SHA-256 digest
   *    (`hashToken`) of a 256-bit random token (`generateRefreshToken`) — the
   *    same primitive `refresh_tokens` and `crew_pairing_tokens` use, not a
   *    new one.
   *
   * The raw token exists only in this function's return value and in the link
   * inside the email. It is never persisted, logged, audited or returned by
   * any endpoint.
   */
  private async issueToken(userId: string, requestedIp: string | null): Promise<string> {
    const now = this.now();

    await this.tokens.update({ used_at: new Date(now) } as Partial<PasswordResetToken>, {
      where: { user_id: userId, used_at: null },
    } as never);

    await this.tokens.destroy({
      where: { expires_at: { [Op.lt]: new Date(now - PASSWORD_RESET_RETENTION_MS) } },
    });

    const rawToken = generateRefreshToken();
    await this.tokens.create({
      user_id: userId,
      token_hash: hashToken(rawToken),
      expires_at: passwordResetExpiryAt(now, this.getTtlMs()),
      used_at: null,
      // Audit-only. Stripped by the model's default scope and `toJSON()`, and
      // never part of a response contract.
      requested_ip: requestedIp,
    } as unknown as PasswordResetToken);

    return rawToken;
  }

  /**
   * Renders and sends the email.
   *
   * Delivery failures are logged and swallowed by the caller — see the class
   * comment — so an unreachable relay cannot become an enumeration oracle.
   * The provider itself is whatever `email-provider.factory.ts` selected:
   * `SmtpEmailProvider` when the deployment configured SMTP, otherwise
   * `NoOpEmailProvider`, which logs the message and reports success so dev
   * and CI work with no credentials at all.
   */
  private async deliverResetEmail(user: User, rawToken: string): Promise<void> {
    if (!user.email) {
      return;
    }
    const content = buildPasswordResetEmail({
      resetUrl: buildPasswordResetUrl(this.appUrl(), rawToken),
      ttlMs: this.getTtlMs(),
      firstName: user.first_name,
      appName: this.appName(),
    });

    const result = await this.email.send({
      recipientId: user.id,
      to: user.email,
      subject: content.subject,
      title: content.subject,
      body: content.text,
      html: content.html,
    });

    if (!result.success) {
      // Never the body — it carries the live link.
      this.logger.error(
        `Password reset email could not be delivered via ${result.provider}: ${
          result.error ?? 'unknown error'
        }`,
      );
    }
  }
}
