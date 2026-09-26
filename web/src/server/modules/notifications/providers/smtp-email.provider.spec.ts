import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { EmailNotificationPayload } from './notification-provider.interface';
import { NoOpEmailProvider } from './noop-email.provider';
import { SMTP_EMAIL_PROVIDER_NAME, createEmailProvider } from './email-provider.factory';
import {
  SmtpEmailProvider,
  type SmtpMessage,
  type SmtpTransport,
  type SmtpTransportOptions,
} from './smtp-email.provider';

/**
 * The SMTP rail, exercised end to end **without a single socket**.
 *
 * `SmtpEmailProvider` takes its transport as a constructor argument
 * (defaulting to nodemailer's), so everything below drives a recording
 * double: message shape, success, failure classification, laziness. A
 * provider that could only be tested against a live relay would not be
 * tested, and CI would either need credentials or skip the file.
 *
 * The factory half asserts the property the whole design rests on: **without
 * complete SMTP configuration you get `NoOpEmailProvider`, never a broken
 * SMTP client.** That is what lets `npm test`, CI and a fresh checkout run
 * the password-reset flow with no relay at all.
 */

const SMTP_OPTIONS = {
  host: 'smtp.example.org',
  port: 587,
  secure: false,
  auth: { user: 'mailer@example.org', pass: 'super-secret' },
  from: 'KidBus <no-reply@example.org>',
};

const PAYLOAD: EmailNotificationPayload = {
  recipientId: 'user-1',
  to: 'ada@triumph.edu',
  subject: 'Reset your KidBus password',
  title: 'Reset your KidBus password',
  body: 'Open https://app.example.org/reset-password?token=abc to choose a new password.',
  html: '<p>Open <a href="https://app.example.org/reset-password?token=abc">this link</a>.</p>',
};

/** Records what the provider handed to nodemailer, and answers as told. */
function recordingTransport(
  behaviour: { messageId?: string | null; fail?: unknown } = {},
): {
  transport: SmtpTransport;
  factory: (options: SmtpTransportOptions) => SmtpTransport;
  sent: SmtpMessage[];
  built: SmtpTransportOptions[];
} {
  const sent: SmtpMessage[] = [];
  const built: SmtpTransportOptions[] = [];
  const transport: SmtpTransport = {
    sendMail: async (message) => {
      sent.push(message);
      if (behaviour.fail !== undefined) {
        throw behaviour.fail;
      }
      // `in`, not `??`: a relay that answers without a message id passes
      // `null` explicitly, and that case has its own test below.
      return {
        messageId: 'messageId' in behaviour ? behaviour.messageId : '<generated@example.org>',
      };
    },
  };
  return {
    transport,
    sent,
    built,
    factory: (options) => {
      built.push(options);
      return transport;
    },
  };
}

describe('SmtpEmailProvider', () => {
  it('identifies itself and reports as configured', () => {
    const provider = new SmtpEmailProvider(SMTP_OPTIONS, recordingTransport().factory);
    assert.equal(provider.name, 'smtp-email');
    assert.equal(provider.isConfigured, true);
  });

  it('maps the payload onto an SMTP message', async () => {
    const double = recordingTransport();
    const provider = new SmtpEmailProvider(SMTP_OPTIONS, double.factory);

    const result = await provider.send(PAYLOAD);

    assert.deepEqual(double.sent, [
      {
        from: SMTP_OPTIONS.from,
        to: PAYLOAD.to,
        subject: PAYLOAD.subject,
        text: PAYLOAD.body,
        html: PAYLOAD.html,
      },
    ]);
    assert.deepEqual(result, {
      success: true,
      provider: 'smtp-email',
      messageId: '<generated@example.org>',
      retryable: false,
    });
  });

  it('omits the HTML part when the caller sent none', async () => {
    const double = recordingTransport();
    const provider = new SmtpEmailProvider(SMTP_OPTIONS, double.factory);
    const { html: _html, ...textOnly } = PAYLOAD;

    await provider.send(textOnly);

    assert.equal('html' in double.sent[0], false, 'no empty html part is sent');
    assert.equal(double.sent[0].text, PAYLOAD.body);
  });

  it('builds the transport lazily, and only once', async () => {
    const double = recordingTransport();
    const provider = new SmtpEmailProvider(SMTP_OPTIONS, double.factory);

    // Construction must open no socket and resolve no DNS: a bad relay should
    // not be able to turn server boot into a hang.
    assert.equal(double.built.length, 0);

    await provider.send(PAYLOAD);
    await provider.send(PAYLOAD);

    assert.equal(double.built.length, 1, 'the connection is reused across sends');
    assert.deepEqual(double.built[0], {
      host: SMTP_OPTIONS.host,
      port: SMTP_OPTIONS.port,
      secure: SMTP_OPTIONS.secure,
      auth: SMTP_OPTIONS.auth,
    });
  });

  it('never throws: a relay failure resolves to a failed result', async () => {
    const provider = new SmtpEmailProvider(
      SMTP_OPTIONS,
      recordingTransport({ fail: new Error('ECONNREFUSED 10.0.0.1:587') }).factory,
    );

    const result = await provider.send(PAYLOAD);

    assert.equal(result.success, false);
    assert.equal(result.provider, 'smtp-email');
    assert.match(result.error ?? '', /ECONNREFUSED/);
  });

  it('treats a 4xx SMTP reply as retryable and a 5xx as permanent', async () => {
    const greylisted = Object.assign(new Error('450 4.2.0 try again later'), {
      responseCode: 450,
    });
    const rejected = Object.assign(new Error('550 5.1.1 no such user'), { responseCode: 550 });

    const soft = await new SmtpEmailProvider(
      SMTP_OPTIONS,
      recordingTransport({ fail: greylisted }).factory,
    ).send(PAYLOAD);
    const hard = await new SmtpEmailProvider(
      SMTP_OPTIONS,
      recordingTransport({ fail: rejected }).factory,
    ).send(PAYLOAD);

    assert.equal(soft.retryable, true, 'greylisting is worth another attempt');
    assert.equal(hard.retryable, false, 'retrying a rejected recipient only burns reputation');
  });

  it('treats a failure with no SMTP reply (DNS, TCP, TLS, timeout) as retryable', async () => {
    const result = await new SmtpEmailProvider(
      SMTP_OPTIONS,
      recordingTransport({ fail: new Error('getaddrinfo ENOTFOUND smtp.example.org') }).factory,
    ).send(PAYLOAD);
    assert.equal(result.retryable, true);
  });

  it('survives a transport that rejects with a non-Error', async () => {
    const result = await new SmtpEmailProvider(
      SMTP_OPTIONS,
      recordingTransport({ fail: 'string rejection' }).factory,
    ).send(PAYLOAD);
    assert.equal(result.success, false);
    assert.equal(result.error, 'SMTP delivery failed');
  });

  it('copes with a transport that returns no message id', async () => {
    const result = await new SmtpEmailProvider(
      SMTP_OPTIONS,
      recordingTransport({ messageId: null }).factory,
    ).send(PAYLOAD);
    assert.equal(result.success, true);
    assert.equal(result.messageId, undefined);
  });

  it('never puts the password in the result', async () => {
    const result = await new SmtpEmailProvider(
      SMTP_OPTIONS,
      recordingTransport({ fail: new Error('535 auth failed') }).factory,
    ).send(PAYLOAD);
    assert.equal(JSON.stringify(result).includes(SMTP_OPTIONS.auth.pass), false);
  });
});

describe('createEmailProvider', () => {
  const complete = {
    provider: SMTP_EMAIL_PROVIDER_NAME,
    host: 'smtp.example.org',
    port: '587',
    secure: null,
    user: 'mailer@example.org',
    pass: 'super-secret',
    from: 'KidBus <no-reply@example.org>',
  };

  it('returns the SMTP provider when everything is configured', () => {
    const provider = createEmailProvider({ ...complete, transportFactory: recordingTransport().factory });
    assert.ok(provider instanceof SmtpEmailProvider);
    assert.equal(provider.name, 'smtp-email');
  });

  it('falls back to NoOp when EMAIL_PROVIDER is unset — the dev/CI default', () => {
    // The property the whole design rests on: no credentials anywhere, and
    // the reset flow still works end to end.
    for (const provider of [undefined, null, '', '   ', 'noop', 'ses']) {
      const selected = createEmailProvider({ ...complete, provider });
      assert.ok(
        selected instanceof NoOpEmailProvider,
        `expected NoOp for EMAIL_PROVIDER=${JSON.stringify(provider)}`,
      );
    }
  });

  it('accepts the provider name case-insensitively', () => {
    assert.ok(createEmailProvider({ ...complete, provider: 'SMTP' }) instanceof SmtpEmailProvider);
    assert.ok(createEmailProvider({ ...complete, provider: ' smtp ' }) instanceof SmtpEmailProvider);
  });

  it('falls back to NoOp when any single SMTP variable is missing', () => {
    for (const key of ['host', 'port', 'user', 'pass', 'from'] as const) {
      const selected = createEmailProvider({ ...complete, [key]: null });
      assert.ok(selected instanceof NoOpEmailProvider, `expected NoOp when ${key} is missing`);
      // A half-configured SMTP client would fail at send time, on the one
      // path (a reset link) where a silent failure is most expensive.
      assert.equal(selected.name, 'noop-email');
    }
  });

  it('falls back to NoOp for a port that is not a port', () => {
    for (const port of ['', 'smtp', '0', '-1', '70000', '587.5']) {
      assert.ok(
        createEmailProvider({ ...complete, port }) instanceof NoOpEmailProvider,
        `expected NoOp for SMTP_PORT=${JSON.stringify(port)}`,
      );
    }
  });

  it('defaults implicit TLS from the port, and lets SMTP_SECURE override', async () => {
    const implicit = recordingTransport();
    await createEmailProvider({
      ...complete,
      port: 465,
      transportFactory: implicit.factory,
    }).send(PAYLOAD);
    assert.equal(implicit.built[0].secure, true, '465 is implicit TLS');

    const starttls = recordingTransport();
    await createEmailProvider({
      ...complete,
      port: 587,
      transportFactory: starttls.factory,
    }).send(PAYLOAD);
    assert.equal(starttls.built[0].secure, false, '587 upgrades with STARTTLS');

    const forced = recordingTransport();
    await createEmailProvider({
      ...complete,
      port: 587,
      secure: true,
      transportFactory: forced.factory,
    }).send(PAYLOAD);
    assert.equal(forced.built[0].secure, true, 'an explicit SMTP_SECURE always wins');
  });

  it('trims surrounding whitespace from pasted settings', async () => {
    const double = recordingTransport();
    await createEmailProvider({
      ...complete,
      host: '  smtp.example.org  ',
      port: ' 587 ',
      transportFactory: double.factory,
    }).send(PAYLOAD);
    assert.equal(double.built[0].host, 'smtp.example.org');
    assert.equal(double.built[0].port, 587);
  });

  it('keeps the NoOp provider honest: it reports success so nothing downstream breaks', async () => {
    const provider = createEmailProvider({ provider: 'noop' });
    const result = await provider.send(PAYLOAD);
    assert.equal(result.success, true);
    assert.equal(result.provider, 'noop-email');
  });
});
