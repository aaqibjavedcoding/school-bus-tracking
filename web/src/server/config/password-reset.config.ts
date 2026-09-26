import { registerAs } from '../framework';
import {
  PASSWORD_RESET_DEFAULT_TTL_MS,
  PASSWORD_RESET_TTL_BOUNDS_MS,
  resolvePasswordResetTtlMs,
} from '../modules/auth/password-reset-tokens';

/**
 * SCHOOL_ADMIN self-service password-reset configuration.
 *
 * ```text
 * PASSWORD_RESET_TTL_MS   lifetime of one reset link  (default 2700000 = 45 min)
 * ```
 *
 * ### Why the value is clamped rather than trusted
 *
 * A reset link is a bearer credential that travels by email — a channel with
 * archives, forwards, backups and third-party hops. `resolvePasswordResetTtlMs`
 * (the pure policy in `modules/auth/password-reset-tokens.ts`) clamps whatever
 * is configured into **30–60 minutes**: below the floor the flow fails real
 * people whose mail was greylisted or who read it on a phone twenty minutes
 * later; above the ceiling the link is no longer a transient credential but a
 * standing key sitting in an inbox.
 *
 * Clamping instead of rejecting is deliberate: a fat-fingered environment
 * variable degrades to a safe lifetime rather than taking password reset down
 * for a whole deployment. The resolved number is what the email prints (the
 * sentence is derived from this value, never typed in), so what a recipient
 * reads is always what the server will honour.
 *
 * This is deliberately *not* the crew PIN configuration: PIN login is
 * admin-only by design (`staff.ts`, `set-crew-pin.dto.ts`) and is untouched by
 * this flow.
 */
export default registerAs('passwordReset', () => ({
  /** Honoured link lifetime in ms, already clamped into the 30–60 min band. */
  ttlMs: resolvePasswordResetTtlMs(process.env.PASSWORD_RESET_TTL_MS),
  /** The band itself, exposed for diagnostics and documentation. */
  minTtlMs: PASSWORD_RESET_TTL_BOUNDS_MS.min,
  maxTtlMs: PASSWORD_RESET_TTL_BOUNDS_MS.max,
  defaultTtlMs: PASSWORD_RESET_DEFAULT_TTL_MS,
}));
