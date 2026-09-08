import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSessionPresentCookie,
  hasSessionPresentCookie,
  SESSION_PRESENT_COOKIE_NAME,
} from './session.ts';

/**
 * The readable session-presence marker drives the AuthProvider's boot
 * decision (skip the CSRF bootstrap + refresh round trip when no session can
 * exist). These tests pin the cookie-surface contract: presence is detected
 * only when the marker cookie is actually in the jar, and clearing removes
 * it regardless of surrounding cookies.
 */

const globalWithDocument = globalThis as { document?: { cookie: string } };

let savedDocument: PropertyDescriptor | undefined;

function stubDocumentCookie(value: string): void {
  const doc: Record<string, string> = {};
  Object.defineProperty(doc, 'cookie', {
    configurable: true,
    get() {
      return value;
    },
    set(next) {
      // Document.cookie assignment replaces the named cookie; the trivial
      // jar below keeps every other cookie untouched.
      const [pair] = next.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator).trim();
      const rest = pair.slice(separator + 1).trim();
      if (name === SESSION_PRESENT_COOKIE_NAME && (rest === '' || /max-age=0/i.test(next))) {
        value = value
          .split(';')
          .map((part) => part.trim())
          .filter((part) => !part.startsWith(`${name}=`))
          .join('; ');
        return;
      }
      const others = value
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith(`${name}=`));
      others.push(`${name}=${rest}`);
      value = others.join('; ');
    },
  });
  Object.defineProperty(globalWithDocument, 'document', {
    configurable: true,
    value: doc,
  });
}

beforeEach(() => {
  savedDocument = Object.getOwnPropertyDescriptor(globalWithDocument, 'document');
});

afterEach(() => {
  if (savedDocument) {
    Object.defineProperty(globalWithDocument, 'document', savedDocument);
  } else {
    delete globalWithDocument.document;
  }
});

describe('session-presence marker cookie helpers', () => {
  it('reports false when no cookie jar exists (SSR / non-browser runtime)', () => {
    delete globalWithDocument.document;
    assert.equal(hasSessionPresentCookie(), false);
  });

  it('detects the marker among other cookies, ignoring look-alike names', () => {
    stubDocumentCookie('theme=dark; sb_session=1; csrf_token=abc');
    assert.equal(hasSessionPresentCookie(), true);

    stubDocumentCookie('theme=dark; not_sb_session=1; csrf_token=abc');
    assert.equal(hasSessionPresentCookie(), false, 'similar names must not match');

    stubDocumentCookie('csrf_token=abc');
    assert.equal(hasSessionPresentCookie(), false);
  });

  it('clears only the marker, leaving unrelated cookies intact', () => {
    stubDocumentCookie('theme=dark; sb_session=1; csrf_token=abc');
    clearSessionPresentCookie();
    assert.equal(hasSessionPresentCookie(), false);
    assert.match(globalWithDocument.document?.cookie ?? '', /csrf_token=abc/);
    assert.match(globalWithDocument.document?.cookie ?? '', /theme=dark/);
  });

  it('is a no-op without a cookie jar', () => {
    delete globalWithDocument.document;
    clearSessionPresentCookie();
    assert.equal(hasSessionPresentCookie(), false);
  });
});
