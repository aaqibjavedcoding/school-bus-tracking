import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREW_TRACKING_CONTEXT_KEY,
  LEGACY_CREW_ACTIVE_TRIP_KEY,
  TRACKING_CONTEXT_MAX_AGE_MS,
  createCrewTrackingContext,
  decideTrackingContextRestore,
  parseCrewTrackingContext,
  serializeCrewTrackingContext,
} from './tracking-context.ts';

/**
 * The persisted tracking context is what a headless OS relaunch has to trust —
 * so ownership is the whole point of these tests: a context written by one
 * account must never be resumed by another, and a value that cannot be proven
 * to belong to the current session must never be guessed at.
 */

const NOW = Date.parse('2026-09-19T08:00:00.000Z');
const DRIVER = { id: 'driver-1', school_id: 'school-1' };

function context(overrides: Partial<Parameters<typeof createCrewTrackingContext>[0]> = {}) {
  return createCrewTrackingContext({
    userId: DRIVER.id,
    schoolId: DRIVER.school_id,
    tripId: 'trip-1',
    now: NOW,
    ...overrides,
  });
}

describe('tracking context serialisation', () => {
  it('round-trips the non-secret identifiers only', () => {
    const serialised = serializeCrewTrackingContext(context());
    assert.equal(parseCrewTrackingContext(serialised)?.tripId, 'trip-1');
    assert.deepEqual(Object.keys(JSON.parse(serialised)).sort(), [
      'schoolId',
      'tripId',
      'updatedAt',
      'userId',
    ]);
    assert.ok(
      !/token|password|refresh|pin/i.test(serialised),
      'no credential material may ever be persisted',
    );
  });

  it('uses a dedicated key and remembers the legacy ownerless key for deletion', () => {
    assert.equal(CREW_TRACKING_CONTEXT_KEY, '@sbt/crew-tracking-context');
    assert.equal(LEGACY_CREW_ACTIVE_TRIP_KEY, '@sbt/crew-active-trip-id');
    assert.notEqual(CREW_TRACKING_CONTEXT_KEY, LEGACY_CREW_ACTIVE_TRIP_KEY);
  });

  it('rejects a legacy bare trip id (no owner, so no proof)', () => {
    assert.equal(parseCrewTrackingContext('trip-1'), null);
  });

  it('rejects corrupt, partial and wrong-typed values', () => {
    assert.equal(parseCrewTrackingContext(null), null);
    assert.equal(parseCrewTrackingContext(''), null);
    assert.equal(parseCrewTrackingContext('{not json'), null);
    assert.equal(parseCrewTrackingContext('42'), null);
    assert.equal(parseCrewTrackingContext(JSON.stringify({ tripId: 'trip-1' })), null);
    assert.equal(
      parseCrewTrackingContext(JSON.stringify({ userId: 'u', tripId: 't', updatedAt: 'nope' })),
      null,
    );
    assert.equal(
      parseCrewTrackingContext(JSON.stringify({ userId: '', tripId: 't', updatedAt: 'x' })),
      null,
    );
  });
});

describe('decideTrackingContextRestore', () => {
  it('resumes the signed-in crew member’s own fresh context', () => {
    const result = decideTrackingContextRestore({
      raw: serializeCrewTrackingContext(context()),
      session: DRIVER,
      now: NOW + 60_000,
    });
    assert.equal(result.decision, 'resume');
    assert.equal(result.context?.tripId, 'trip-1');
  });

  it('never resumes another user’s trip after an account switch', () => {
    const result = decideTrackingContextRestore({
      raw: serializeCrewTrackingContext(context()),
      session: { id: 'driver-2', school_id: 'school-1' },
      now: NOW,
    });
    assert.equal(result.decision, 'other-user');
  });

  it('never resumes another tenant’s trip', () => {
    const result = decideTrackingContextRestore({
      raw: serializeCrewTrackingContext(context({ schoolId: 'school-2' })),
      session: DRIVER,
      now: NOW,
    });
    assert.equal(result.decision, 'other-school');
  });

  it('refuses to resume without a recovered session (ownership unprovable)', () => {
    const result = decideTrackingContextRestore({
      raw: serializeCrewTrackingContext(context()),
      session: null,
      now: NOW,
    });
    assert.equal(result.decision, 'no-session');
    assert.equal(result.context?.userId, DRIVER.id, 'the parsed context is still reported');
  });

  it('drops a context older than the bound instead of chasing a dead trip', () => {
    const result = decideTrackingContextRestore({
      raw: serializeCrewTrackingContext(context()),
      session: DRIVER,
      now: NOW + TRACKING_CONTEXT_MAX_AGE_MS + 1,
    });
    assert.equal(result.decision, 'expired');
  });

  it('reports ownership before freshness (a wrong-user context says so)', () => {
    const result = decideTrackingContextRestore({
      raw: serializeCrewTrackingContext(context()),
      session: { id: 'driver-2', school_id: 'school-9' },
      now: NOW + TRACKING_CONTEXT_MAX_AGE_MS * 10,
    });
    assert.equal(result.decision, 'other-user');
  });

  it('reports nothing persisted and corrupt values distinctly', () => {
    assert.equal(
      decideTrackingContextRestore({ raw: null, session: DRIVER, now: NOW }).decision,
      'none',
    );
    assert.equal(
      decideTrackingContextRestore({ raw: 'garbage', session: DRIVER, now: NOW }).decision,
      'corrupt',
    );
  });

  it('accepts a null school on either side (platform accounts, legacy rows)', () => {
    const result = decideTrackingContextRestore({
      raw: serializeCrewTrackingContext(context({ schoolId: null })),
      session: DRIVER,
      now: NOW,
    });
    assert.equal(result.decision, 'resume');
  });
});
