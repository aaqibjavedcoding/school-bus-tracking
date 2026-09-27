import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MARKETING_SAFE_UTM_PARAMETERS } from '@school-bus-tracking/shared-types';
import {
  assertRenderableVariables,
  buildMarketingMessage,
  describeMarketingMessage,
  generateMarketingToken,
  hashMarketingToken,
  isMarketingRenderVariable,
  marketingClickUrl,
  marketingUnsubscribeHeaders,
  marketingUnsubscribeUrl,
  MARKETING_RENDER_VARIABLES,
  pickSafeUtmParameters,
  type MarketingRenderableVersion,
} from './marketing-message.builder';

/**
 * Per-recipient rendering, tokens and headers.
 *
 * The properties under test are the ones that cannot be fixed after a send:
 * an address leaked into a URL, a raw token written to the database, an
 * unescaped school name that turns a body into markup, or a missing
 * `List-Unsubscribe` header that makes readers press "report spam" instead.
 */

const APP_URL = 'https://app.zeromilesystems.test';

const ALLOWED = MARKETING_RENDER_VARIABLES.map((name) => ({ name, required: false }));

function version(overrides: Partial<MarketingRenderableVersion> = {}): MarketingRenderableVersion {
  return {
    subject: 'News for {{school_name}}',
    html_body:
      '<p>Hello {{recipient_name}} at {{school_name}}</p><p><a href="{{campaign_url}}">Read more</a></p><p>&copy; {{current_year}}</p>',
    text_body: 'Hello {{recipient_name}} at {{school_name}}. Read more: {{campaign_url}}',
    allowed_variables: ALLOWED,
    ...overrides,
  };
}

const RECIPIENT = {
  id: '11111111-1111-4111-8111-111111111111',
  normalized_email: 'principal@school.test',
  recipient_name: 'Asha Rao',
  school_name: 'Sunrise Public School',
};

/** Deterministic token mint so assertions can be exact. */
function mintSequence(values: string[]): () => { raw: string; hash: string } {
  let index = 0;
  return () => {
    const raw = values[Math.min(index, values.length - 1)];
    index += 1;
    return { raw, hash: hashMarketingToken(raw) };
  };
}

describe('marketing token minting', () => {
  it('produces 256 bits of hex entropy and a SHA-256 digest of it', () => {
    const token = generateMarketingToken();
    assert.match(token.raw, /^[a-f0-9]{64}$/);
    assert.equal(token.hash, createHash('sha256').update(token.raw).digest('hex'));
    assert.notEqual(token.hash, token.raw, 'the stored form must not be the usable form');
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateMarketingToken().raw));
    assert.equal(tokens.size, 50);
  });
});

describe('marketing link construction', () => {
  it('points at the public tracking endpoints under the configured origin', () => {
    assert.equal(
      marketingClickUrl(APP_URL, 'abc'),
      `${APP_URL}/api/v1/public/marketing/click/abc`,
    );
    assert.equal(
      marketingUnsubscribeUrl(`${APP_URL}/`, 'abc'),
      `${APP_URL}/api/v1/public/marketing/unsubscribe/abc`,
    );
  });
});

describe('buildMarketingMessage', () => {
  it('renders the snapshot values into subject, HTML and text', () => {
    const message = buildMarketingMessage({
      recipient: RECIPIENT,
      version: version(),
      appUrl: APP_URL,
      mintToken: mintSequence(['click-token', 'unsub-token']),
      now: new Date('2026-09-27T00:00:00.000Z'),
    });

    assert.equal(message.to, 'principal@school.test');
    assert.equal(message.subject, 'News for Sunrise Public School');
    assert.ok(message.html.includes('Hello Asha Rao at Sunrise Public School'));
    assert.ok(message.text.includes('Hello Asha Rao at Sunrise Public School'));
    assert.ok(message.html.includes('2026'), 'current_year comes from the clock');
  });

  it('renders from the snapshot, never from live school data', () => {
    // The row carries the name frozen when the audience was approved; a later
    // rename must not change what an already-scheduled campaign says.
    const message = buildMarketingMessage({
      recipient: { ...RECIPIENT, school_name: 'Old Name Academy' },
      version: version(),
      appUrl: APP_URL,
      mintToken: mintSequence(['c', 'u']),
    });
    assert.ok(message.subject.includes('Old Name Academy'));
  });

  it('escapes recipient values in the HTML body but not in the text part', () => {
    const message = buildMarketingMessage({
      recipient: { ...RECIPIENT, school_name: 'Foo & Bar <Trust>' },
      version: version(),
      appUrl: APP_URL,
      mintToken: mintSequence(['c', 'u']),
    });
    assert.ok(
      message.html.includes('Foo &amp; Bar &lt;Trust&gt;'),
      'a school name must render as text, never as markup',
    );
    assert.equal(message.html.includes('<Trust>'), false);
    assert.ok(message.text.includes('Foo & Bar <Trust>'), 'the text part is not HTML');
  });

  it('falls back to neutral wording when the snapshot has no names', () => {
    const message = buildMarketingMessage({
      recipient: { ...RECIPIENT, recipient_name: null, school_name: null },
      version: version(),
      appUrl: APP_URL,
      mintToken: mintSequence(['c', 'u']),
    });
    assert.ok(message.html.includes('Hello there'), 'never "Hello ,"');
    assert.ok(message.subject.includes('your school'));
  });

  it('puts opaque tokens — and never the address or an id — in the links', () => {
    const message = buildMarketingMessage({
      recipient: RECIPIENT,
      version: version(),
      appUrl: APP_URL,
      mintToken: mintSequence(['click-token', 'unsub-token']),
    });

    assert.ok(message.html.includes(`${APP_URL}/api/v1/public/marketing/click/click-token`));
    assert.ok(message.text.includes('unsub-token'));
    for (const body of [message.html, message.text, message.subject]) {
      assert.equal(body.includes(RECIPIENT.normalized_email), false, 'no address in a URL or body');
      assert.equal(body.includes(RECIPIENT.id), false, 'no internal id in the message');
    }
  });

  it('returns digests for persistence and keeps the raw tokens out of them', () => {
    const message = buildMarketingMessage({
      recipient: RECIPIENT,
      version: version(),
      appUrl: APP_URL,
      mintToken: mintSequence(['click-token', 'unsub-token']),
    });
    assert.equal(message.clickTokenHash, hashMarketingToken('click-token'));
    assert.equal(message.unsubscribeTokenHash, hashMarketingToken('unsub-token'));
    assert.equal(message.clickTokenHash.includes('click-token'), false);
  });

  it('uses independent tokens for clicking and unsubscribing', () => {
    // A click link must not double as an unsubscribe: readers forward these.
    const message = buildMarketingMessage({
      recipient: RECIPIENT,
      version: version(),
      appUrl: APP_URL,
    });
    assert.notEqual(message.clickTokenHash, message.unsubscribeTokenHash);
  });

  it('always carries a visible unsubscribe link, even if the template omits one', () => {
    const message = buildMarketingMessage({
      recipient: RECIPIENT,
      version: version({ html_body: '<p>No footer here</p>', text_body: 'No footer here' }),
      appUrl: APP_URL,
      mintToken: mintSequence(['c', 'unsub-token']),
    });
    assert.ok(message.html.includes('/marketing/unsubscribe/unsub-token'));
    assert.ok(message.text.includes('/marketing/unsubscribe/unsub-token'));
  });

  it('sets the RFC 8058 one-click unsubscribe headers', () => {
    const message = buildMarketingMessage({
      recipient: RECIPIENT,
      version: version(),
      appUrl: APP_URL,
      mintToken: mintSequence(['c', 'unsub-token']),
      replyTo: ' ops@zeromilesystems.test ',
    });
    assert.equal(
      message.headers['List-Unsubscribe'],
      `<${APP_URL}/api/v1/public/marketing/unsubscribe/unsub-token>`,
    );
    assert.equal(message.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.equal(message.replyTo, 'ops@zeromilesystems.test', 'Reply-To is trimmed config, not a recipient');
  });

  it('advertises no mailto: unsubscribe (it would leak an address rail)', () => {
    const headers = marketingUnsubscribeHeaders(`${APP_URL}/x`);
    assert.equal(headers['List-Unsubscribe'].includes('mailto:'), false);
  });

  it('rejects content using a variable the worker cannot fill', () => {
    // Failing before the first send is the point: the alternative is
    // thousands of emails containing a literal {{cta_url}}.
    assert.throws(
      () =>
        buildMarketingMessage({
          recipient: RECIPIENT,
          version: version({ html_body: '<p>{{cta_url}}</p>' }),
          appUrl: APP_URL,
        }),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 400);
        return true;
      },
    );
  });

  it('rejects a renderable variable the version never declared', () => {
    assert.throws(() =>
      assertRenderableVariables(
        version({ allowed_variables: [{ name: 'recipient_name', required: true }] }),
      ),
    );
  });

  it('accepts content that only uses declared, server-derivable variables', () => {
    assert.doesNotThrow(() => assertRenderableVariables(version()));
  });
});

describe('describeMarketingMessage', () => {
  it('summarizes sizes and header names — never body content or tokens', () => {
    const message = buildMarketingMessage({
      recipient: RECIPIENT,
      version: version(),
      appUrl: APP_URL,
      mintToken: mintSequence(['click-token', 'unsub-token']),
    });
    const description = describeMarketingMessage(message);

    assert.match(description, /html=\d+b text=\d+b/);
    assert.ok(description.includes('List-Unsubscribe'));
    assert.equal(description.includes('click-token'), false, 'a log line must never carry a token');
    assert.equal(description.includes('Asha Rao'), false);
    assert.equal(description.includes(RECIPIENT.normalized_email), false);
  });
});

describe('pickSafeUtmParameters', () => {
  it('keeps only the allowlisted attribution keys', () => {
    const utm = pickSafeUtmParameters(
      new URLSearchParams(
        'utm_source=newsletter&utm_medium=email&next=https://evil.test&redirect=/admin',
      ),
      MARKETING_SAFE_UTM_PARAMETERS,
    );
    assert.deepEqual(utm, { utm_source: 'newsletter', utm_medium: 'email' });
  });

  it('bounds length and strips control characters', () => {
    const utm = pickSafeUtmParameters(
      new URLSearchParams([['utm_campaign', `spring\n\u0000${'x'.repeat(200)}`]]),
      MARKETING_SAFE_UTM_PARAMETERS,
    );
    assert.ok((utm.utm_campaign ?? '').length <= 120);
    assert.equal(
      [...(utm.utm_campaign ?? '')].some((character) => (character.codePointAt(0) ?? 0) <= 0x1f),
      false,
    );
  });
});

describe('MARKETING_RENDER_VARIABLES', () => {
  it('is the closed set the session specifies', () => {
    assert.deepEqual([...MARKETING_RENDER_VARIABLES], [
      'recipient_name',
      'school_name',
      'campaign_url',
      'unsubscribe_url',
      'current_year',
    ]);
    assert.equal(isMarketingRenderVariable('school_name'), true);
    assert.equal(isMarketingRenderVariable('admin_email'), false);
  });
});
