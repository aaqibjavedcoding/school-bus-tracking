import { createTransport } from 'nodemailer';
import { Logger } from '../../../framework';
import type {
  EmailNotificationPayload,
  EmailNotificationProvider,
  NotificationDeliveryResult,
} from './notification-provider.interface';

/**
 * Real SMTP email delivery, built on **nodemailer** — a free, MIT-licensed
 * library talking plain SMTP to whatever server the deployment already has
 * (a school's Google Workspace / Microsoft 365 relay, a self-hosted Postfix,
 * an ISP smarthost). No paid API, no vendor SDK, no account to open.
 *
 * It is selected only by `email-provider.factory.ts`, and only when
 * `EMAIL_PROVIDER=smtp` *and* every SMTP variable is present. Without them
 * the factory keeps `NoOpEmailProvider`, so `npm test`, CI and local dev never
 * need credentials and nothing in the application breaks for their absence.
 *
 * ### Why the transport is injectable
 *
 * `transportFactory` defaults to nodemailer's `createTransport`, but the
 * constructor accepts any {@link SmtpTransport}. That is what lets
 * `smtp-email.provider.spec.ts` drive the whole provider — message shape,
 * success, failure classification — against a recording double, with **zero**
 * network traffic in CI. A provider that could only be tested by connecting
 * to a real server would, in practice, not be tested.
 *
 * The transport is created **lazily**, on the first send. Constructing the
 * provider therefore opens no socket and resolves no DNS, which keeps boot
 * cheap and keeps a misconfigured relay from turning server start into a
 * hang.
 *
 * ### It never throws
 *
 * Like every other provider in this folder, `send` resolves to a
 * {@link NotificationDeliveryResult} instead of rejecting: an SMTP outage must
 * degrade to a recorded failure, never to a 500 on the endpoint that asked for
 * the mail. The password-reset flow depends on this — a bounced email must
 * still leave the caller with the same generic "if an account exists…"
 * response, because a differing one would be an enumeration oracle.
 *
 * ### Nothing sensitive is ever logged
 *
 * `SMTP_PASS` is read once, handed to nodemailer and never echoed. Log lines
 * name the recipient and the subject at debug level and the *class* of a
 * failure at warn level — never the body, which on the reset path contains
 * the live token link.
 */

/** The single nodemailer capability this provider uses. */
export interface SmtpTransport {
  sendMail(message: SmtpMessage): Promise<{ messageId?: string | null } | undefined>;
}

/** The message shape handed to the transport. */
export interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Connection settings resolved from the `SMTP_*` environment. */
export interface SmtpTransportOptions {
  host: string;
  port: number;
  /** `true` → implicit TLS (port 465). `false` → STARTTLS upgrade (587). */
  secure: boolean;
  auth: { user: string; pass: string };
}

/** Builds the transport. Swapped for a double in tests. */
export type SmtpTransportFactory = (options: SmtpTransportOptions) => SmtpTransport;

/** Everything the provider needs, already validated by the factory. */
export interface SmtpEmailProviderOptions extends SmtpTransportOptions {
  /** `EMAIL_FROM` — the envelope/header sender of every message. */
  from: string;
}

/**
 * SMTP status codes in the 4xx range are transient by definition (greylisting,
 * mailbox busy, rate limited), so the outbox may try again. 5xx is permanent —
 * retrying a rejected recipient only burns reputation.
 */
function isRetryableSmtpError(error: unknown): boolean {
  const code = (error as { responseCode?: unknown })?.responseCode;
  if (typeof code === 'number') {
    return code >= 400 && code < 500;
  }
  // No SMTP response at all means the failure happened below the protocol —
  // DNS, TCP, TLS, a timeout. Those are exactly the failures worth retrying.
  return true;
}

export class SmtpEmailProvider implements EmailNotificationProvider {
  readonly name = 'smtp-email';
  readonly isConfigured = true;

  private readonly logger = new Logger(SmtpEmailProvider.name);
  private transport: SmtpTransport | null = null;

  constructor(
    private readonly options: SmtpEmailProviderOptions,
    private readonly transportFactory: SmtpTransportFactory = defaultSmtpTransportFactory,
  ) {}

  /** Builds the transport on first use and reuses it afterwards. */
  private resolveTransport(): SmtpTransport {
    if (!this.transport) {
      this.transport = this.transportFactory({
        host: this.options.host,
        port: this.options.port,
        secure: this.options.secure,
        auth: { user: this.options.auth.user, pass: this.options.auth.pass },
      });
    }
    return this.transport;
  }

  async send(payload: EmailNotificationPayload): Promise<NotificationDeliveryResult> {
    const message: SmtpMessage = {
      from: this.options.from,
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
      ...(payload.html ? { html: payload.html } : {}),
    };

    try {
      const info = await this.resolveTransport().sendMail(message);
      this.logger.debug(`[SMTP] Sent "${payload.subject}" to ${payload.to}`);
      return {
        success: true,
        provider: this.name,
        messageId: info?.messageId ?? undefined,
        retryable: false,
      };
    } catch (error) {
      const retryable = isRetryableSmtpError(error);
      // The *class* of failure, never the message body (which on the reset
      // path carries a live token) and never the credentials.
      this.logger.warn(
        `[SMTP] Delivery to ${payload.to} failed (${retryable ? 'retryable' : 'permanent'}): ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return {
        success: false,
        provider: this.name,
        error: error instanceof Error ? error.message : 'SMTP delivery failed',
        retryable,
      };
    }
  }
}

/** Real nodemailer transport. Not used by any test. */
export const defaultSmtpTransportFactory: SmtpTransportFactory = (options) =>
  createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: options.auth,
  }) as unknown as SmtpTransport;
