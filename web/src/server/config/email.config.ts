import { registerAs } from '../framework';

/**
 * Outbound email configuration.
 *
 * The codebase ships **one** free rail (`nodemailer` over plain SMTP) and one
 * fallback (`NoOpEmailProvider`, which logs and never sends). Selection is
 * made by `email-provider.factory.ts`, which mirrors the push factory:
 *
 * ```text
 * EMAIL_PROVIDER=smtp   selects real SMTP delivery; anything else (or unset)
 *                       keeps the NoOp provider
 * SMTP_HOST             relay hostname                 e.g. smtp.gmail.com
 * SMTP_PORT             relay port                     465 (TLS) or 587 (STARTTLS)
 * SMTP_SECURE           true = implicit TLS (465)      defaults to (port === 465)
 * SMTP_USER             SMTP username / mailbox
 * SMTP_PASS             SMTP password or app password
 * EMAIL_FROM            header sender, e.g. "KidBus <no-reply@school.edu>"
 * ```
 *
 * All five SMTP values must be present for the SMTP provider to be selected;
 * a partial configuration falls back to the NoOp with a warning (an error in
 * production). That is deliberate: `npm test`, CI and a fresh local checkout
 * have no relay and must never need one.
 *
 * **Security**: `SMTP_PASS` is read here and handed to nodemailer. It is never
 * logged, echoed, rendered or persisted.
 *
 * ### `APP_URL` lives in `app.config.ts`, not here
 *
 * The reset link's origin is a property of the deployment, not of email — the
 * same value would be needed by any other absolute link the server ever
 * produces. It falls back to the first `CORS_ORIGIN` entry, which is already
 * "the origin browsers reach this app on", so a normal deployment needs no new
 * variable at all.
 */
export default registerAs('email', () => ({
  /** `smtp` selects the SMTP provider; anything else keeps the NoOp. */
  provider: process.env.EMAIL_PROVIDER?.trim().toLowerCase() || 'noop',
  smtpHost: process.env.SMTP_HOST?.trim() || null,
  smtpPort: process.env.SMTP_PORT?.trim() || null,
  /**
   * `null` means "decide from the port" (implicit TLS on 465, STARTTLS
   * otherwise) — the behaviour almost every relay documents. An explicit
   * value always wins.
   */
  smtpSecure: parseOptionalBoolean(process.env.SMTP_SECURE),
  smtpUser: process.env.SMTP_USER?.trim() || null,
  smtpPass: process.env.SMTP_PASS || null,
  from: process.env.EMAIL_FROM?.trim() || null,
}));

/** `true`/`false` when explicitly set, `null` when absent or unrecognised. */
function parseOptionalBoolean(raw: string | undefined): boolean | null {
  const value = raw?.trim().toLowerCase();
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return null;
}
