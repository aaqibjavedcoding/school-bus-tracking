import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  APPROACHING_DISTANCE_M,
  APPROACHING_ETA_MINUTES,
  MAX_SPOKEN_STUDENTS,
  NEAR_DISTANCE_M,
  NextStopAnnouncer,
  isApproaching,
  isNear,
  spokenStudentCount,
  type NextStopSnapshot,
} from './next-stop-announcer.ts';
import { STOP_ANNOUNCEMENT_EVENTS, voicePhrase } from './crew-voice.ts';
import { setLocale } from '../../lib/i18n.ts';

/**
 * The next-stop announcement policy (batch 3C), as a table.
 *
 * Pure and clock-free on purpose: every input is a snapshot of what the trip
 * screen already has, so a whole run — stops, ETA pushes, a refetch, a trip
 * change — is replayed here in microseconds. What the *voice* does with the
 * resulting event (600 ms floor, latest-wins, the Voice switch) belongs to
 * `crew-voice.spec.ts` and `crew-feedback.spec.ts`; this suite proves which
 * facts become announcements at all.
 */

setLocale('en', { persist: false });

const TRIP = 'trip-1';

function snapshot(overrides: Partial<NextStopSnapshot> = {}): NextStopSnapshot {
  return {
    tripId: TRIP,
    stopId: 'stop-a',
    stopName: 'Shivaji Chowk',
    studentCount: 12,
    countKnown: true,
    etaMinutes: 8,
    distanceMeters: 2_400,
    sequenceNumber: 4,
    ...overrides,
  };
}

/** Feeds snapshots in order and returns the events they produced. */
function replay(announcer: NextStopAnnouncer, snapshots: NextStopSnapshot[]): string[] {
  return snapshots
    .map((entry) => announcer.observe(entry))
    .filter((event): event is NonNullable<typeof event> => event !== null)
    .map((event) => event.type);
}

describe('the next-stop change is announced once', () => {
  test('a stop that becomes next says "next stop" with its name and count', () => {
    const announcer = new NextStopAnnouncer();
    const event = announcer.observe(snapshot());
    assert.deepEqual(event, { type: 'stop.next', stopName: 'Shivaji Chowk', studentCount: 12 });
  });

  test('the same stop on every later push says nothing — edge-triggered, not level', () => {
    const announcer = new NextStopAnnouncer();
    announcer.observe(snapshot());
    // An ETA push arrives every few seconds, each with a new distance.
    const repeats = replay(
      announcer,
      [7, 6, 5, 4, 3].map((etaMinutes) => snapshot({ etaMinutes, distanceMeters: etaMinutes * 300 })),
    );
    assert.deepEqual(repeats, [], `a stationary bus must not chatter: ${repeats.join(', ')}`);
  });

  test('a whole run announces each stop once, not once per push', () => {
    const announcer = new NextStopAnnouncer();
    const run: NextStopSnapshot[] = [];
    for (const [index, stop] of ['stop-a', 'stop-b', 'stop-c'].entries()) {
      for (let push = 0; push < 6; push += 1) {
        run.push(
          snapshot({
            stopId: stop,
            stopName: `Stop ${index + 1}`,
            etaMinutes: 9 - push, // 9…4 — never crosses the approaching threshold
            distanceMeters: (9 - push) * 500,
          }),
        );
      }
    }
    assert.deepEqual(replay(announcer, run), ['stop.next', 'stop.next', 'stop.next']);
  });

  test('a stop the run comes back to later is news again', () => {
    const announcer = new NextStopAnnouncer();
    announcer.observe(snapshot({ stopId: 'stop-a' }));
    announcer.observe(snapshot({ stopId: 'stop-b', stopName: 'Depot' }));
    const second = announcer.observe(snapshot({ stopId: 'stop-a' }));
    assert.equal(second?.type, 'stop.next', 'a return visit is a new fact');
  });

  test('no next stop (run finished, or nothing resolved yet) says nothing', () => {
    const announcer = new NextStopAnnouncer();
    assert.equal(announcer.observe(snapshot({ stopId: null })), null);
    assert.equal(announcer.observe(snapshot({ tripId: null })), null);
  });
});

describe('"approaching" is said once per stop, when the bus is nearly there', () => {
  test('crossing the ETA threshold upgrades the announcement — once', () => {
    const announcer = new NextStopAnnouncer();
    announcer.observe(snapshot({ etaMinutes: 8, distanceMeters: 3_000 }));
    const events = replay(announcer, [
      snapshot({ etaMinutes: 5, distanceMeters: 1_800 }),
      snapshot({ etaMinutes: APPROACHING_ETA_MINUTES, distanceMeters: 900 }),
      snapshot({ etaMinutes: 1, distanceMeters: 400 }),
      snapshot({ etaMinutes: 1, distanceMeters: 120 }),
      snapshot({ etaMinutes: 0, distanceMeters: 30 }),
    ]);
    // One reminder per tier: "approaching" at the ETA threshold, then the
    // ~300 m proximity line — never one per push.
    assert.deepEqual(events, ['stop.approaching', 'stop.near'], 'one reminder, not one per push');
  });

  test('distance alone triggers it when the ETA has no minutes', () => {
    const announcer = new NextStopAnnouncer();
    announcer.observe(snapshot({ etaMinutes: null, distanceMeters: 5_000 }));
    assert.equal(
      announcer.observe(snapshot({ etaMinutes: null, distanceMeters: APPROACHING_DISTANCE_M }))?.type,
      'stop.approaching',
    );
  });

  test('no GPS fix at all (both null) is not "approaching"', () => {
    assert.equal(isApproaching(snapshot({ etaMinutes: null, distanceMeters: null })), false);
  });

  test('nonsense values from a bad payload are ignored, not trusted', () => {
    assert.equal(isApproaching(snapshot({ etaMinutes: -5, distanceMeters: null })), false);
    assert.equal(isApproaching(snapshot({ etaMinutes: null, distanceMeters: -20 })), false);
    assert.equal(isApproaching(snapshot({ etaMinutes: 1, distanceMeters: null })), true);
  });

  test('a stop that is ALREADY close when it becomes next is announced once, most urgent line', () => {
    // Hearing "Next stop: X" and then "Approaching X" a second later says one
    // thing twice; the most urgent line the facts support wins the moment.
    const announcer = new NextStopAnnouncer();
    const first = announcer.observe(snapshot({ etaMinutes: 1, distanceMeters: 200 }));
    assert.equal(first?.type, 'stop.near', 'inside 300 m the proximity line is the first word');
    assert.equal(announcer.observe(snapshot({ etaMinutes: 1, distanceMeters: 120 })), null);
    // Outside the near ring the approaching reminder is still the close line.
    const second = new NextStopAnnouncer();
    assert.equal(
      second.observe(snapshot({ etaMinutes: 1, distanceMeters: 350, sequenceNumber: null }))?.type,
      'stop.approaching',
    );
  });

  test('the thresholds are the ones the policy states', () => {
    assert.equal(APPROACHING_ETA_MINUTES, 2);
    assert.equal(APPROACHING_DISTANCE_M, 400);
  });
});

describe('the ~300 m proximity alert fires once, by stop number (N7)', () => {
  test('the pinned threshold is 300 m and it is distance-only', () => {
    assert.equal(NEAR_DISTANCE_M, 300);
    assert.equal(isNear(snapshot({ etaMinutes: null, distanceMeters: 300 })), true);
    assert.equal(isNear(snapshot({ etaMinutes: 0, distanceMeters: 301 })), false);
    assert.equal(isNear(snapshot({ etaMinutes: null, distanceMeters: null })), false);
    assert.equal(isNear(snapshot({ etaMinutes: null, distanceMeters: -5 })), false);
    // Tighter than the approaching reminder, never looser.
    assert.ok(NEAR_DISTANCE_M < APPROACHING_DISTANCE_M);
  });

  test('crossing 300 m upgrades the run to "Stop {n} aa raha hai" — once', () => {
    const announcer = new NextStopAnnouncer();
    assert.deepEqual(announcer.observe(snapshot({ etaMinutes: 6, distanceMeters: 2_400 })), {
      type: 'stop.next',
      stopName: 'Shivaji Chowk',
      studentCount: 12,
    });
    const events = replay(announcer, [
      snapshot({ etaMinutes: 2, distanceMeters: 380 }), // approaching tier
      snapshot({ etaMinutes: 1, distanceMeters: 290 }), // the near line
      snapshot({ etaMinutes: 1, distanceMeters: 250 }),
      snapshot({ etaMinutes: 0, distanceMeters: 90 }),
    ]);
    assert.deepEqual(events, ['stop.approaching', 'stop.near'], 'one reminder per tier, not per push');
  });

  test('a stop that becomes next already inside 300 m says only the near line', () => {
    const announcer = new NextStopAnnouncer();
    assert.equal(announcer.observe(snapshot({ etaMinutes: 1, distanceMeters: 250 }))?.type, 'stop.near');
    assert.equal(announcer.observe(snapshot({ etaMinutes: 1, distanceMeters: 120 })), null);
  });

  test('the threshold is configurable on the announcer (spec pins the default)', () => {
    const announcer = new NextStopAnnouncer(250);
    // 290 m is inside the approaching ring (400) but outside this announcer's
    // 250 m near ring — the reminder tier fires first.
    assert.equal(announcer.observe(snapshot({ etaMinutes: null, distanceMeters: 290 }))?.type, 'stop.approaching');
    assert.equal(announcer.observe(snapshot({ etaMinutes: null, distanceMeters: 240 }))?.type, 'stop.near');
  });

  test('an unknown stop number keeps the lower tiers — a guessed position is never spoken', () => {
    const announcer = new NextStopAnnouncer();
    assert.equal(
      announcer.observe(snapshot({ distanceMeters: 200, sequenceNumber: null }))?.type,
      'stop.approaching',
    );
    assert.equal(announcer.observe(snapshot({ distanceMeters: 200, sequenceNumber: null })), null);
    assert.equal(
      announcer.observe(snapshot({ distanceMeters: 150, sequenceNumber: 0 })),
      null,
      "0 is the summary's unknown fallback, not a position",
    );
  });

  test('the approaching tier still fires when the near line is unavailable', () => {
    // 350 m: inside approaching (400), outside near (300) — the reminder fires;
    // crossing 300 without a sequence number changes nothing further.
    const announcer = new NextStopAnnouncer();
    announcer.observe(snapshot({ etaMinutes: 5, distanceMeters: 900, sequenceNumber: null }));
    const events = replay(announcer, [
      snapshot({ etaMinutes: 1, distanceMeters: 350, sequenceNumber: null }),
      snapshot({ etaMinutes: 1, distanceMeters: 200, sequenceNumber: null }),
    ]);
    assert.deepEqual(events, ['stop.approaching']);
  });
});

describe('it never announces a fact it does not have', () => {
  test('an in-flight count is waited for, never spoken as zero', () => {
    const announcer = new NextStopAnnouncer();
    assert.equal(announcer.observe(snapshot({ countKnown: false, studentCount: 0 })), null);
    assert.equal(announcer.observe(snapshot({ countKnown: false, studentCount: 0 })), null);
    // The count lands: the announcement is still owed, and now it is true.
    assert.deepEqual(announcer.observe(snapshot({ countKnown: true, studentCount: 12 })), {
      type: 'stop.next',
      stopName: 'Shivaji Chowk',
      studentCount: 12,
    });
  });

  test('a genuinely empty stop is announced as zero — that is a fact, not a gap', () => {
    const announcer = new NextStopAnnouncer();
    assert.equal(announcer.observe(snapshot({ countKnown: true, studentCount: 0 }))?.studentCount, 0);
  });

  test('a nameless stop says nothing, and is announced once the name arrives', () => {
    const announcer = new NextStopAnnouncer();
    assert.equal(announcer.observe(snapshot({ stopName: '   ' })), null);
    // Not marked as announced, so the retry when the stops list lands works.
    assert.equal(announcer.observe(snapshot({ stopName: 'Shivaji Chowk' }))?.type, 'stop.next');
  });
});

describe('the run scopes the memory', () => {
  test('a different trip announces its first stop again', () => {
    const announcer = new NextStopAnnouncer();
    announcer.observe(snapshot({ tripId: 'trip-1', stopId: 'stop-a' }));
    const evening = announcer.observe(snapshot({ tripId: 'trip-2', stopId: 'stop-a' }));
    assert.equal(evening?.type, 'stop.next', 'the same stop on another run is new information');
  });

  test('reset() forgets everything (logout)', () => {
    const announcer = new NextStopAnnouncer();
    announcer.observe(snapshot());
    announcer.reset();
    assert.equal(announcer.observe(snapshot())?.type, 'stop.next');
  });

  test('a momentary null next stop does not clear what was already said', () => {
    const announcer = new NextStopAnnouncer();
    announcer.observe(snapshot());
    announcer.observe(snapshot({ stopId: null }));
    assert.equal(announcer.observe(snapshot()), null, 'the same stop, still announced');
  });
});

describe('the spoken payload stays inside the privacy rule', () => {
  test('only the three stop events are ever produced', () => {
    const announcer = new NextStopAnnouncer();
    const events = [
      announcer.observe(snapshot()),
      announcer.observe(snapshot({ etaMinutes: 1 })),
      announcer.observe(snapshot({ distanceMeters: 200 })),
      announcer.observe(snapshot({ stopId: 'stop-b', stopName: 'Depot' })),
    ].filter((event) => event !== null);
    for (const event of events) {
      assert.ok(STOP_ANNOUNCEMENT_EVENTS.includes(event.type), `${event.type} is not a stop event`);
      const keys = Object.keys(event).sort();
      const expected =
        event.type === 'stop.near'
          ? ['sequenceNumber', 'stopName', 'studentCount', 'type']
          : ['stopName', 'studentCount', 'type'];
      assert.deepEqual(keys, expected);
    }
  });

  test('every announcement it can produce is speakable, in every locale', () => {
    const announcer = new NextStopAnnouncer();
    const event = announcer.observe(snapshot());
    for (const locale of ['en', 'hi', 'mr'] as const) {
      setLocale(locale, { persist: false });
      const phrase = voicePhrase(event!);
      assert.ok(phrase && phrase.length > 0, `${locale}: the next stop said nothing`);
      assert.ok(!/\d{6,}/.test(phrase), `${locale}: "${phrase}" carries an identifier, not a count`);
    }
    setLocale('en', { persist: false });
  });

  test('a count is capped, floored and never NaN', () => {
    assert.equal(spokenStudentCount(12), 12);
    assert.equal(spokenStudentCount(12.7), 12);
    assert.equal(spokenStudentCount(0), 0);
    assert.equal(spokenStudentCount(-4), 0);
    assert.equal(spokenStudentCount(Number.NaN), 0);
    assert.equal(spokenStudentCount(Number.POSITIVE_INFINITY), 0);
    assert.equal(spokenStudentCount(1_000_000), MAX_SPOKEN_STUDENTS);
    assert.ok(MAX_SPOKEN_STUDENTS <= 999, 'above this the digit net drops the whole line');
  });

  test('the capped count reaches the phrase, so the net is never tripped', () => {
    const announcer = new NextStopAnnouncer();
    const event = announcer.observe(snapshot({ studentCount: 987_654 }));
    assert.equal(event?.studentCount, MAX_SPOKEN_STUDENTS);
    assert.ok(voicePhrase(event!), 'a corrupt payload degrades to a sane announcement, not silence');
  });
});
