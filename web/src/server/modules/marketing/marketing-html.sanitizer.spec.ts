import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { isSafeMarketingUrl, sanitizeMarketingHtml } from './marketing-html.sanitizer';

/**
 * The sanitizer is the template system's HTML security boundary — these
 * vectors are the classic filter bypasses a regex-only approach misses, plus
 * the benign cases that must survive sanitization untouched (placeholders in
 * particular, or the renderer would never see them).
 */

describe('sanitizeMarketingHtml — rejection (validation)', () => {
  it('rejects script tags in every casing and spacing variant', () => {
    for (const html of [
      '<script>alert(1)</script>',
      '<SCRIPT>alert(1)</SCRIPT>',
      '<ScRiPt>alert(1)</ScRiPt>',
      '<script >alert(1)</script >',
      '<script src="https://evil.example/x.js"></script>',
      '<script/xss src="https://evil.example/x.js"></script>',
    ]) {
      const result = sanitizeMarketingHtml(html);
      assert.ok(result.violations.length > 0, `must reject: ${html}`);
      assert.ok(
        result.violations.some((violation) => violation.includes('script')),
        `must name script: ${html} → ${result.violations.join('; ')}`,
      );
    }
  });

  it('rejects the classic half-open-tag smuggling vector', () => {
    // A regex sanitizer that strips `<script>` substrings would turn this
    // into a live tag; the tokenizer must reject it outright.
    const result = sanitizeMarketingHtml('<scr<script>ipt>alert(1)</scr</script>ipt>');
    assert.ok(result.violations.length > 0, 'must reject');
    assert.ok(
      result.violations.some((violation) => violation.includes('Malformed')),
      `must flag malformed markup: ${result.violations.join('; ')}`,
    );
  });

  it('rejects iframe, form and the other embedding/form elements', () => {
    for (const tag of ['iframe', 'form', 'input', 'object', 'embed', 'svg', 'math', 'style']) {
      const result = sanitizeMarketingHtml(`<${tag}></${tag}>`);
      assert.ok(
        result.violations.some((violation) => violation.includes(tag)),
        `<${tag}> must be rejected`,
      );
    }
  });

  it('rejects event-handler attributes', () => {
    for (const html of [
      '<img src="https://x.example/i.png" onerror="alert(1)">',
      '<a href="https://x.example" onclick="alert(1)">x</a>',
      '<p ONMOUSEOVER="alert(1)">x</p>',
      '<div onfocusin=alert(1) tabindex=0>x</div>',
    ]) {
      const result = sanitizeMarketingHtml(html);
      assert.ok(
        result.violations.some((violation) => violation.startsWith('Event-handler')),
        `event handler must be rejected: ${html} → ${result.violations.join('; ')}`,
      );
    }
  });

  it('rejects unsafe URL schemes, including entity- and whitespace-obfuscated ones', () => {
    for (const html of [
      '<a href="javascript:alert(1)">x</a>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
      '<a href="javascript&colon;alert(1)">x</a>',
      '<a href="jav&Tab;ascript:alert(1)">x</a>',
      '<a href="jav\tascript:alert(1)">x</a>',
      '<a href="jav&#x09;ascript:alert(1)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a href="  javascript:alert(1)">x</a>',
      '<a href="vbscript:msgbox(1)">x</a>',
      '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
      '<img src="data:image/svg+xml,<svg onload=alert(1)>">',
      '<img src="javascript:alert(1)">',
    ]) {
      const result = sanitizeMarketingHtml(html);
      assert.ok(
        result.violations.some((violation) => violation.includes('Unsafe URL')),
        `unsafe URL must be rejected: ${html} → ${result.violations.join('; ')}`,
      );
    }
  });

  it('caps the reported violations so a hostile body cannot bloat an error', () => {
    const html = Array.from({ length: 50 }, () => '<script></script>').join('');
    assert.ok(sanitizeMarketingHtml(html).violations.length <= 10);
  });
});

describe('sanitizeMarketingHtml — sanitization', () => {
  it('keeps a benign marketing email body intact', () => {
    const html = [
      '<p>Hello {{school_name}},</p>',
      '<p>Your <strong>trial</strong> ends soon. <a href="https://kidbus.example/pricing">Upgrade</a></p>',
      '<ul><li>Live tracking</li><li>Parent app</li></ul>',
      '<p><small>Zero Mile Systems</small></p>',
    ].join('');
    const result = sanitizeMarketingHtml(html);
    assert.deepEqual(result.violations, []);
    assert.equal(result.html, html);
  });

  it('keeps mailto and tel links, and forces rel on target=_blank', () => {
    const result = sanitizeMarketingHtml(
      '<a href="mailto:ops@zeromile.example">mail</a><a href="tel:+911234567890">call</a>' +
        '<a href="https://kidbus.example" target="_blank">site</a>',
    );
    assert.deepEqual(result.violations, []);
    assert.ok(result.html.includes('href="mailto:ops@zeromile.example"'));
    assert.ok(result.html.includes('href="tel:+911234567890"'));
    assert.ok(result.html.includes('rel="noopener noreferrer"'));
  });

  it('unwraps unknown benign tags but keeps their text', () => {
    const result = sanitizeMarketingHtml(
      '<marquee>Big savings!</marquee><custom-tag>x</custom-tag>',
    );
    assert.deepEqual(result.violations, []);
    assert.equal(result.html, 'Big savings!x');
  });

  it('drops comments, doctypes and processing instructions', () => {
    const result = sanitizeMarketingHtml(
      '<!-- hidden --><!DOCTYPE html><?php echo "x" ?><p>visible</p>',
    );
    assert.deepEqual(result.violations, []);
    assert.equal(result.html, '<p>visible</p>');
  });

  it('escapes stray markup in text so it can never re-enter as tags', () => {
    const result = sanitizeMarketingHtml('<p>a < b & c > d</p>');
    assert.deepEqual(result.violations, []);
    assert.equal(result.html, '<p>a &lt; b &amp; c &gt; d</p>');
  });

  it('preserves well-formed entities in text', () => {
    const result = sanitizeMarketingHtml('<p>Tom &amp; Jerry &nbsp; &#39;quoted&#39;</p>');
    assert.deepEqual(result.violations, []);
    assert.equal(result.html, '<p>Tom &amp; Jerry &nbsp; &#39;quoted&#39;</p>');
  });

  it('drops non-allowlisted attributes but keeps allowlisted ones', () => {
    const result = sanitizeMarketingHtml(
      '<table border="1" cellpadding="4" style="x:1" data-track="abc"><tr><td colspan="2" bgcolor="#eee">x</td></tr></table>',
    );
    assert.deepEqual(result.violations, []);
    assert.ok(result.html.includes('border="1"'));
    assert.ok(result.html.includes('cellpadding="4"'));
    assert.ok(result.html.includes('colspan="2"'));
    assert.ok(result.html.includes('bgcolor="#eee"'));
    assert.ok(!result.html.includes('style'));
    assert.ok(!result.html.includes('data-track'));
  });

  it('re-escapes attribute values that decode to quotes or angle brackets', () => {
    const result = sanitizeMarketingHtml(
      '<img src="https://x.example/a.png" alt="&quot;&gt;&lt;script&gt;">',
    );
    assert.deepEqual(result.violations, []);
    assert.ok(result.html.includes('alt="&quot;&gt;&lt;script&gt;"'));
  });

  it('survives malformed input without throwing (totality)', () => {
    for (const html of [
      '<',
      '<p',
      '<p class=',
      '<p class="unterminated',
      '<<<>>>',
      '<a href=',
      '</',
      '<!-- unterminated comment',
      '\x00<p>nul\x00bytes</p>',
    ]) {
      const result = sanitizeMarketingHtml(html);
      assert.ok(typeof result.html === 'string');
      assert.ok(Array.isArray(result.violations));
    }
  });

  it('never emits a forbidden tag, even when violations are present', () => {
    // The html output for a violating document is never stored, but the
    // invariant is checked anyway: sanitization alone must also be safe.
    const result = sanitizeMarketingHtml('<p>ok</p><script>alert(1)</script>');
    assert.ok(!result.html.toLowerCase().includes('<script'));
  });
});

describe('isSafeMarketingUrl', () => {
  it('allows http, https, mailto, tel and relative URLs', () => {
    for (const url of [
      'https://kidbus.example/pricing',
      'http://kidbus.example',
      'mailto:ops@zeromile.example',
      'tel:+911234567890',
      '/pricing',
      '#section',
      '//cdn.example/logo.png',
    ]) {
      assert.equal(isSafeMarketingUrl(url, ['http', 'https', 'mailto', 'tel']), true, url);
    }
  });

  it('rejects every other scheme and scheme-looking value', () => {
    for (const url of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,x',
      'vbscript:x',
      'file:///etc/passwd',
      'blob:https://x',
      'jav&#x09;ascript:alert(1)',
      'javascript&colon;alert(1)',
    ]) {
      assert.equal(isSafeMarketingUrl(url, ['http', 'https', 'mailto', 'tel']), false, url);
    }
  });
});
