import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getLocale, setLocale, type Locale } from '../../lib/i18n.ts';
import {
  VOICE_DENY_PATTERNS,
  VOICE_LANGUAGE_TAGS,
  VOICE_MAX_ANNOUNCEMENTS_PER_BURST,
  VOICE_MIN_GAP_MS,
  VOICE_PITCH,
  VOICE_RATE,
  VOICE_SUMMARY_THRESHOLD,
  VoiceGate,
  isSpeakable,
  voiceLanguageFor,
  voicePhraseFor,
  voicePrivacyViolations,
  voiceStudentEvent,
  type VoiceEventKind,
} from './crew-voice.ts';
import { en } from '../../lib/i18n.en.ts';
import { hi } from '../../lib/i18n.hi.ts';

/**
 * Voice feedback rules (Phase 3b). Everything asserted here is pure — no
 * device, no TTS engine, no timer. The native `Speech.speak` boundary is
 * covered by `crew-feedback.sim.spec.ts`; this file pins *what* is decided.
 */

const EVENTS: VoiceEventKind[] = [
  'board.done',
  'board.queued',
  'board.summary',
  'drop.done',
  'drop.queued',
  'drop.summary',
  'trip.boarding',
  'trip.inProgress',
  'trip.completed',
  'sos.sent',
  'sos.queued',
  'sync.done',
  'gps.on',
  'gps.off',
  'action.failed',
  'action.conflict',
  'test',
];

const DEVANAGARI = /[\u0900-\u097F]/;

/** Run `body` in a locale and restore whatever was active before. */
function inLocale<T>(locale: Locale, body: () => T): T {
  const previous = getLocale();
  setLocale(locale, { persist: false });
  try {
    return body();
  } finally {
    setLocale(previous, { persist: false });
  }
}

const student = (name = 'Ramesh', time = '7:42 AM') => ({ firstName: name, time });

describe('voice copy: two channels, two scripts', () => {
  test('the Hindi spoken channel is Latin-script Hinglish — never Devanagari', () => {
    const devanagari = Object.keys(hi)
      .filter((key) => key.startsWith('voice.'))
      .filter((key) => DEVANAGARI.test(hi[key as keyof typeof hi]));
    assert.deepEqual(
      devanagari,
      [],
      `spoken copy must stay Latin-script (device TTS reality): ${devanagari.join(', ')}`,
    );
    assert.ok(
      Object.keys(hi).filter((key) => key.startsWith('voice.')).length >= 16,
      'the whole event set needs a spoken form',
    );
  });

  test('the written settings copy IS Devanagari — the channels are separate', () => {
    const latin = Object.keys(hi)
      .filter((key) => key.startsWith('feedback.'))
      .filter((key) => !DEVANAGARI.test(hi[key as keyof typeof hi]));
    assert.deepEqual(latin, [], `on-screen settings copy stays Devanagari: ${latin.join(', ')}`);
  });

  test('every event has a phrase in both locales, and the two differ', () => {
    for (const kind of EVENTS) {
      const fromEn = inLocale('en', () => voicePhraseFor(kind, student()));
      const fromHi = inLocale('hi', () => voicePhraseFor(kind, student()));
      assert.ok(fromEn.trim().length > 0, `${kind}: empty English phrase`);
      assert.ok(fromHi.trim().length > 0, `${kind}: empty Hindi phrase`);
      assert.notEqual(fromEn, fromHi, `${kind}: the two locales must not be identical`);
    }
  });

  test('phrases are short — a confirmation, not a sentence', () => {
    for (const kind of EVENTS) {
      const text = inLocale('hi', () => voicePhraseFor(kind, student('Ramesh', '7:42')));
      const words = text.trim().split(/\s+/).length;
      assert.ok(words <= 9, `${kind}: ${words} words is too long to be a cue ("${text}")`);
    }
  });

  test('the phrase is first name + action + time', () => {
    const text = inLocale('hi', () => voicePhraseFor('board.done', student('Ramesh', '7:42')));
    assert.ok(text.includes('Ramesh'), `missing the first name: "${text}"`);
    assert.ok(text.includes('7:42'), `missing the time: "${text}"`);
  });

  test('rate is 0.95 and pitch stays at the platform default', () => {
    assert.equal(VOICE_RATE, 0.95);
    assert.equal(VOICE_PITCH, 1);
  });
});

describe('language follows the UI locale, read at call time', () => {
  test('the language tag is derived from the active locale', () => {
    assert.equal(voiceLanguageFor('hi'), 'hi-IN');
    assert.equal(voiceLanguageFor('en'), 'en-IN');
    assert.deepEqual(Object.keys(VOICE_LANGUAGE_TAGS).sort(), ['en', 'hi']);
  });

  test('the decision carries the locale that is active when it is made', () => {
    const gate = new VoiceGate();
    const hindi = inLocale('hi', () => gate.decide('board.done', student(), 0));
    assert.equal(hindi.language, 'hi-IN');
    gate.settle();
    const english = inLocale('en', () => gate.decide('drop.done', student(), 5_000));
    assert.equal(english.language, 'en-IN');
  });

  /**
   * The Phase-3a trap, pinned: `trip-status-style.ts` and `ManifestList.tsx`
   * both froze locale-dependent values at module scope and stopped following a
   * language switch. A module-level `const PHRASES = { board: t(...) }` here
   * would reproduce it exactly, and this test is what fails if it does.
   */
  test('a language switch changes the NEXT announcement (no module-level freeze)', () => {
    const before = inLocale('hi', () => voicePhraseFor('board.done', student()));
    const after = inLocale('en', () => voicePhraseFor('board.done', student()));
    assert.notEqual(before, after, 'the phrase was captured at import time');
    assert.match(before, /boarding ho gaya/);
    assert.match(after, /boarded at/);
  });
});

describe('throttle: a bus full of board events never becomes a queue', () => {
  test('the min gap sits inside the 500–700 ms window', () => {
    assert.ok(VOICE_MIN_GAP_MS >= 500);
    assert.ok(VOICE_MIN_GAP_MS <= 700);
  });

  test('40 rapid board events produce at most the burst cap of announcements', () => {
    const gate = new VoiceGate();
    const spoken: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const decision = gate.decide('board.done', student(`S${index}`), index * 100);
      if (decision.phrase) spoken.push(decision.phrase);
      gate.settle();
    }
    assert.equal(
      spoken.length,
      VOICE_MAX_ANNOUNCEMENTS_PER_BURST,
      `expected exactly the cap (${VOICE_MAX_ANNOUNCEMENTS_PER_BURST}), got ${spoken.length}`,
    );
    assert.ok(VOICE_MAX_ANNOUNCEMENTS_PER_BURST <= 6, 'the acceptance cap is ≤6');
  });

  test('the suppressed events collapse into ONE summary — the sync-complete path', () => {
    const gate = new VoiceGate();
    for (let index = 0; index < 40; index += 1) {
      gate.decide('board.done', student(`S${index}`), index * 100);
      gate.settle();
    }
    const summary = gate.drainSummary(4_100, true);
    assert.ok(summary, 'a burst of 40 boards owes a summary');
    // 40 events, 6 of them spoken → 34 were suppressed into this one phrase.
    assert.match(summary!.phrase ?? '', /34 students boarded|34 students board ho gaye/);
    assert.ok((summary!.phrase ?? '').includes('34'), summary!.phrase ?? '');
    // Drained once: the counter was cleared with the phrase.
    assert.equal(gate.drainSummary(4_200, true), null);
  });

  test('a small burst owes no summary', () => {
    const gate = new VoiceGate();
    for (let index = 0; index < VOICE_SUMMARY_THRESHOLD - 1; index += 1) {
      gate.decide('board.done', student(), index * 1_000);
      gate.settle();
    }
    assert.equal(gate.drainSummary(9_000, true), null);
  });

  test('latest wins: a critical event interrupts whatever is playing', () => {
    const gate = new VoiceGate();
    gate.decide('board.done', student(), 0);
    const sos = gate.decide('sos.sent', null, 50);
    assert.equal(sos.action, 'interrupt');
    assert.match(sos.phrase ?? '', /SOS/);
    // A routine event in the same situation is suppressed instead.
    gate.decide('board.done', student(), 0);
    assert.equal(gate.decide('board.done', student(), 10).action, 'suppress');
  });

  test('inside the min gap a routine event is suppressed, after it, spoken', () => {
    const gate = new VoiceGate();
    assert.equal(gate.decide('board.done', student(), 0).action, 'speak');
    gate.settle();
    assert.equal(gate.decide('drop.done', student(), VOICE_MIN_GAP_MS - 1).action, 'suppress');
    gate.settle();
    assert.equal(gate.decide('drop.done', student(), 10_000).action, 'speak');
  });

  test('the gate state is counters only — structurally, no queue can grow', () => {
    const gate = new VoiceGate();
    for (let index = 0; index < 10_000; index += 1) {
      gate.decide('board.done', student(`S${index}`), index);
    }
    const values = Object.values(gate.snapshot());
    assert.ok(values.length > 0);
    for (const value of values) {
      assert.ok(
        typeof value === 'number' || typeof value === 'boolean' || value === null,
        `the gate must hold no collection, found ${typeof value}`,
      );
    }
    // The only thing that grew is a counter, and it is a single number.
    assert.equal(gate.snapshot().suppressedBoard, 10_000 - 1);
  });

  test('a fresh burst window gets a fresh budget', () => {
    const gate = new VoiceGate();
    for (let index = 0; index < 40; index += 1) {
      gate.decide('board.done', student(), index * 100);
      gate.settle();
    }
    assert.equal(gate.decide('board.done', student(), 4_000).action, 'suppress');
    // 10 s of quiet rolls the burst: the next boarding wave is announced again.
    assert.equal(gate.decide('board.done', student(), 15_000).action, 'speak');
  });
});

describe('privacy: the deny-list and the input shape', () => {
  test('the deny-list covers phone, email, admission number and free-text detail', () => {
    const names = VOICE_DENY_PATTERNS.map((entry) => entry.name).sort();
    assert.deepEqual(names, ['admissionNumber', 'email', 'medicalOrGuardianDetail', 'phone']);
  });

  test('a phone number, email, admission number or medical note is refused', () => {
    const cases: Array<[string, string]> = [
      ['phone', 'Call guardian on 98765 43210'],
      ['phone', 'Ramesh +91-9876543210'],
      ['email', 'parent ramesh@example.com'],
      ['admissionNumber', 'Ramesh ADM-20241 boarded'],
      ['medicalOrGuardianDetail', 'Ramesh needs his inhaler'],
      ['medicalOrGuardianDetail', 'guardian contact updated'],
      ['medicalOrGuardianDetail', 'asthma noted'],
    ];
    for (const [expected, text] of cases) {
      assert.ok(
        voicePrivacyViolations(text).includes(expected),
        `"${text}" should trip ${expected}`,
      );
      assert.equal(isSpeakable(text), false, `"${text}" must not be speakable`);
    }
  });

  test('every shipped phrase is speakable in both locales', () => {
    const refused: string[] = [];
    for (const kind of EVENTS) {
      for (const locale of ['en', 'hi'] as Locale[]) {
        const text = inLocale(locale, () => voicePhraseFor(kind, student('Ramesh', '7:42')));
        if (!isSpeakable(text)) {
          refused.push(`${locale}:${kind} "${text}" → ${voicePrivacyViolations(text).join(',')}`);
        }
        const counted = inLocale(locale, () => voicePhraseFor('board.summary', { count: 12 }));
        if (!isSpeakable(counted)) refused.push(`${locale}:board.summary "${counted}"`);
      }
    }
    assert.deepEqual(refused, [], `deny-list false positives would silence the app: ${refused}`);
  });

  /**
   * The structural half of the privacy rule: hand the whitelist mapper a full
   * attendance record — with everything the manifest row carries and more —
   * and check that none of it can reach the speaker.
   */
  test('a full student record in, only a first name and a clock time out', () => {
    const record = {
      id: 'att-1',
      school_id: 'school-1',
      trip_id: 'trip-1',
      student_id: 'stu-1',
      admission_number: 'ADM-20241',
      first_name: 'Ramesh',
      last_name: 'Kumar',
      grade_level: '5B',
      stop_name: 'Sector 14 Gate',
      // Fields a manifest row does not carry, added to prove the mapper cannot
      // be tricked by a wider object:
      guardian_phone: '+91-9876543210',
      guardian_email: 'parent@example.com',
      medical_note: 'asthma — inhaler in the front pocket',
    };
    const payload = voiceStudentEvent(record, '7:42 AM');
    assert.deepEqual(payload, { firstName: 'Ramesh', time: '7:42 AM' });
    assert.deepEqual(Object.keys(payload).sort(), ['firstName', 'time']);

    for (const locale of ['en', 'hi'] as Locale[]) {
      const text = inLocale(locale, () => voicePhraseFor('board.done', payload));
      for (const forbidden of [
        'ADM-20241',
        '20241',
        'Kumar',
        '9876543210',
        'parent@example.com',
        'asthma',
        'inhaler',
        'stu-1',
        'trip-1',
        'school-1',
      ]) {
        assert.ok(!text.includes(forbidden), `${locale} phrase leaked "${forbidden}": ${text}`);
      }
      assert.equal(voicePrivacyViolations(text).length, 0, text);
    }
  });

  test('a missing first name degrades to a dash, never to undefined', () => {
    const payload = voiceStudentEvent({ first_name: '   ' }, '7:42 AM');
    assert.equal(payload.firstName, '—');
    const text = inLocale('en', () => voicePhraseFor('board.done', payload));
    assert.ok(!text.includes('undefined'), text);
  });
});

describe('the dictionary really carries the voice namespace', () => {
  test('every voice key exists in both dictionaries and is non-empty', () => {
    for (const key of Object.keys(en).filter((k) => k.startsWith('voice.'))) {
      assert.ok(en[key as keyof typeof en].trim().length > 0, key);
      assert.ok(hi[key as keyof typeof hi].trim().length > 0, `${key} missing in hi`);
    }
  });
});
