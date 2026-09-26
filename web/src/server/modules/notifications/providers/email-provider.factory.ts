import { Logger } from '../../../framework';
import type { EmailNotificationProvider } from './notification-provider.interface';
import { NoOpEmailProvider } from './noop-email.provider';
import { SmtpEmailProvider, type SmtpTransportFactory } from './smtp-email.provider';

/**
 * Email provider selection — the mirror of `push-provider.factory.ts`.
 *
 * Exactly one rail exists and it is free:
 *
 * - `EMAIL_PROVIDER=smtp` **and** `SMTP_HOST` + `SMTP_PORT` + `SMTP_USER` +
 *   `SMTP_PASS` + `EMAIL_FROM` all present → {@link SmtpEmailProvider}
 *   (nodemailer over plain SMTP: a school's Workspace/365 relay, a
 *   self-hosted Postfix, an ISP smarthost — no paid API).
 * - anything else → {@link NoOpEmailProvider}.
 *
 * The fallback is the whole point of this file. `npm test`, CI and a fresh
 * local checkout have no SMTP credentials and must never need any: the NoOp
 * provider logs what it *would* have sent and reports success, so the
 * password-reset flow (and anything else that mails) works end to end without
 * a relay. Nothing in the application branches on which provider is active.
 *
 * ### Silence is the one unacceptable outcome
 *
 * A deployment that *asked* for SMTP and did not get it is a real incident —
 * every reset link that school admin waits for is being written to a log file
 * instead of an inbox. So an `EMAIL_PROVIDER=smtp` with missing or malformed
 * variables logs a warning naming the missing keys, and, in production, an
 * unmissable error. A misconfigured relay is never a silent success.
 *
 * Credential values are never logged or echoed; only the *absence* or
 * *invalidity* of a setting is reported, by name.
 */

/** The `EMAIL_PROVIDER` value that selects real SMTP delivery. */
export const SMTP_EMAIL_PROVIDER_NAME = 'smtp';

/** Raw settings, as read from configuration. */
export interface EmailProviderOptions {
  /** `EMAIL_PROVIDER` — `smtp` selects SMTP; anything else keeps the NoOp. */
  provider?: string | null;
  host?: string | null;
  /** `SMTP_PORT`. A string is accepted so config can pass the raw env value. */
  port?: string | number | null;
  /** `SMTP_SECURE` — `true` for implicit TLS (465), `false` for STARTTLS (587). */
  secure?: boolean | null;
  user?: string | null;
  pass?: string | null;
  /** `EMAIL_FROM` — header sender of every message. */
  from?: string | null;
  /**
   * Transport builder, for tests. Production leaves it unset and the provider
   * uses nodemailer; `smtp-email.provider.spec.ts` passes a recording double
   * so the suite never opens a socket.
   */
  transportFactory?: SmtpTransportFactory;
}

function trimmed(value: string | null | undefined): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text;
}

/**
 * A TCP port, or `null` when the value is absent or not a usable port.
 *
 * Deliberately `Number()` and not `parseInt()`: `parseInt('587.5')` and
 * `parseInt('587abc')` both silently yield 587, which would let a typo'd
 * `SMTP_PORT` look valid and quietly reshape the connection. Anything that is
 * not exactly an integer port is rejected here so the caller reports it by
 * name.
 */
function parsePort(value: string | number | null | undefined): number | null {
  const parsed = typeof value === 'number' ? value : Number(trimmed(value) ?? Number.NaN);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    return null;
  }
  return parsed;
}

export function createEmailProvider(options: EmailProviderOptions): EmailNotificationProvider {
  const logger = new Logger('EmailProviderSelection');
  const provider = trimmed(options.provider)?.toLowerCase() ?? null;

  if (provider !== SMTP_EMAIL_PROVIDER_NAME) {
    // The expected state in dev/CI and for any deployment that has not opted
    // in. Logged at `log` level, not `warn`: it is a choice, not a fault.
    logger.log(
      `NoOpEmailProvider active — EMAIL_PROVIDER is ${
        provider === null ? 'unset' : `"${provider}"`
      } (set EMAIL_PROVIDER=smtp plus SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/EMAIL_FROM for real delivery).`,
    );
    return new NoOpEmailProvider();
  }

  const host = trimmed(options.host);
  const port = parsePort(options.port);
  const user = trimmed(options.user);
  const pass = trimmed(options.pass);
  const from = trimmed(options.from);

  const missing = [
    host === null ? 'SMTP_HOST' : null,
    port === null ? 'SMTP_PORT' : null,
    user === null ? 'SMTP_USER' : null,
    pass === null ? 'SMTP_PASS' : null,
    from === null ? 'EMAIL_FROM' : null,
  ].filter((key): key is string => key !== null);

  if (missing.length > 0 || host === null || port === null || user === null || pass === null || from === null) {
    const detail = `EMAIL_PROVIDER=smtp but the SMTP configuration is incomplete (missing or invalid: ${missing.join(
      ', ',
    )}) — falling back to NoOpEmailProvider, so NO email will be delivered. (Values are never logged.)`;
    if (process.env.NODE_ENV === 'production') {
      logger.error(detail);
    } else {
      logger.warn(detail);
    }
    return new NoOpEmailProvider();
  }

  logger.log(`SmtpEmailProvider active — delivering through ${host}:${port}.`);
  return new SmtpEmailProvider(
    {
      host,
      port,
      // Implicit TLS is the default only for the conventional SMTPS port; on
      // 587 nodemailer performs the STARTTLS upgrade, which is what almost
      // every relay expects. An explicit SMTP_SECURE always wins.
      secure: options.secure ?? port === 465,
      auth: { user, pass },
      from,
    },
    options.transportFactory,
  );
}
