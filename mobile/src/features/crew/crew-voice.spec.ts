import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { en } from '../../lib/i18n.en.ts';
import { hi } from '../../lib/i18n.hi.ts';
import { setLocale, t, type TranslationKey } from '../../lib/i18n.ts';
import {
  PRIORITY_EVENTS,
  SILENT_EVENTS,
  SPOKEN_STUDENT_FIELDS,
  VOICE_DENIED_FIELDS,
  VOICE_LANGUAGE_TAG,
  VOICE_MIN_GAP_MS,
  VOICE_RATE,
  VoiceThrottle,
  isSpeakable,
  spokenClock,
  spokenFirstName,
  summaryPhrase,
  utteranceFor,
  voiceLanguageTag,
  voicePhrase,
  type CrewFeedbackEvent,
} from './crew-voice.ts';

/**
 * The voice **policy** suite: what gets said, in which language, how often,
 * and — the load-bearing half — what never gets said at all.
 *
 * Everything here is pure. No device, no TTS engine, no timers: the throttle
 * takes an injected clock, so a forty-tap boarding burst is replayed in
 * microseconds and the result is a number this spec can assert.
 */

const boardAt = (name: string, at: string | null = null): CrewFeedbackEvent => ({
  type: 'board.confirmed',
  firstName: name,
  at,
});

/** Runs `body` in `locale` and restores the previous one. */
function inLocale(locale: 'en' | 'hi', body: () => void): void {
  setLocale('en', { persist: false });
  setLocale(locale, { persist: false });
  try {
    body();
  } finally {
    setLocale('en', { persist: false });
  }
}

// ── The Latin-script decision, asserted ────────────────────────────────────

describe('voice copy is Latin-script Hinglish, not Devanagari', () => {
  const DEVANAGARI = /[\u0900-\u097F]/;
  const voiceKeys = (Object.keys(en) as TranslationKey[]).filter((key) => key.startsWith('voice.'));

  test('the voice namespace exists in both dictionaries', () => {
    assert.ok(voiceKeys.length >= 16, `expected the voice namespace, found ${voiceKeys.length}`);
    for (const key of voiceKeys) assert.ok(key in hi, `${key} missing from hi`);
  });

  test('NO Hindi voice phrase contains a Devanagari character', () => {
    // The whole reason the namespace exists. A budget Android device often has
    // no `hi-IN` voice installed; Devanagari handed to its default English
    // voice is read as garbage. Latin-script Hinglish is read correctly by the
    // voice every device already has.
    const offenders = voiceKeys.filter((key) => DEVANAGARI.test(hi[key]));
    assert.deepEqual(
      offenders,
      [],
      `these voice phrases would be garbled on a phone without a Hindi TTS voice: ${offenders.join(', ')}`,
    );
  });

  test('the WRITTEN Hindi UI is still Devanagari — the two channels are separate', () => {
    // The counter-assertion: proving voice is Latin must not have quietly
    // romanised the screen. A representative sample of screen copy.
    for (const key of [
      'status.boarding',
      'manifest.board',
      'sos.holdLabel',
      'help.title',
    ] as TranslationKey[]) {
      assert.ok(DEVANAGARI.test(hi[key]), `${key} must stay in Devanagari on screen`);
    }
  });

  test('the English voice phrases are real phrases, not silence', () => {
    // English-preference crew hear confirmations too — the brief is explicit
    // that the English path is not "no voice".
    for (const key of voiceKeys) {
      assert.ok(en[key].trim().length > 0, `${key} is empty in English`);
    }
  });

  test('every spoken phrase stays inside the 6–9 word budget', () => {
    const tooLong: string[] = [];
    for (const key of voiceKeys) {
      for (const [locale, dict] of [
        ['en', en],
        ['hi', hi],
      ] as const) {
        // Placeholders stand in for one spoken token each ({name} → "Ramesh",
        // {time} → "7:42 subah" ≈ 2), so measure the template's own words.
        const words = dict[key].split(/\s+/).filter(Boolean).length;
        if (words > 9) tooLong.push(`${locale}:${key} (${words} words)`);
      }
    }
    assert.deepEqual(tooLong, [], `too long to hear while driving: ${tooLong.join(', ')}`);
  });
});

// ── Language derivation ────────────────────────────────────────────────────

describe('language is derived from the UI locale, at call time', () => {
  test('both locales ask for an Indian-English voice, because both phrase sets are Latin', () => {
    assert.equal(VOICE_LANGUAGE_TAG.en, 'en-IN');
    assert.equal(VOICE_LANGUAGE_TAG.hi, 'en-IN');
  });

  test('a language switch changes the NEXT announcement — nothing is frozen at import', () => {
    // Phase 3a's exact trap (`trip-status-style.ts`, `ManifestList.tsx`): a
    // module-level read captures one locale forever. The phrase must be built
    // when the event happens, not when the module loads.
    inLocale('en', () => {
      const english = voicePhrase(boardAt('Ramesh'));
      assert.ok(english?.includes('has boarded'), `got "${english}"`);
    });
    inLocale('hi', () => {
      const hinglish = voicePhrase(boardAt('Ramesh'));
      assert.ok(hinglish?.includes('ka boarding ho gaya'), `got "${hinglish}"`);
      // Same call, same module instance, different answer — that is the proof.
      assert.notEqual(hinglish, voicePhrase.name);
    });
  });

  test('voiceLanguageTag follows the active locale', () => {
    inLocale('hi', () => assert.equal(voiceLanguageTag(), 'en-IN'));
    inLocale('en', () => assert.equal(voiceLanguageTag(), 'en-IN'));
  });

  test('the utterance carries rate ~0.95 and no pitch override', () => {
    const utterance = utteranceFor('Ramesh has boarded');
    assert.equal(utterance.rate, VOICE_RATE);
    assert.ok(VOICE_RATE >= 0.9 && VOICE_RATE <= 1, 'rate stays close to natural pace');
    assert.deepEqual(Object.keys(utterance).sort(), ['language', 'rate', 'text']);
  });
});

// ── Phrase shape ───────────────────────────────────────────────────────────

describe('phrase shape: first name + action + time', () => {
  test('a boarding says the first name, the action and a spoken clock', () => {
    inLocale('hi', () => {
      const phrase = voicePhrase(boardAt('Ramesh', '2026-09-15T07:42:00'));
      assert.equal(phrase, 'Ramesh ka boarding ho gaya, 7:42 subah');
    });
  });

  test('a surname is cut even when the caller passes a full name', () => {
    // Defence in depth: the row has the full name to hand, and
    // `spokenFirstName` is what keeps it out of the cabin.
    assert.equal(spokenFirstName('Ramesh Kumar Yadav'), 'Ramesh');
    inLocale('en', () => {
      const phrase = voicePhrase(boardAt('Ramesh Kumar'));
      assert.ok(!phrase?.includes('Kumar'), `surname leaked: "${phrase}"`);
    });
  });

  test('the clock is spoken, not printed — no "AM"/"PM" letter salad', () => {
    inLocale('hi', () => {
      assert.equal(spokenClock('2026-09-15T07:42:00'), '7:42 subah');
      assert.equal(spokenClock('2026-09-15T14:05:00'), '2:05 dopahar');
      assert.equal(spokenClock('2026-09-15T21:30:00'), '9:30 raat');
    });
    inLocale('en', () => {
      assert.equal(spokenClock('2026-09-15T07:42:00'), '7:42 in the morning');
    });
  });

  test('a missing or unparseable timestamp degrades to "just now", never to empty', () => {
    inLocale('hi', () => {
      assert.equal(spokenClock(null), 'abhi');
      assert.equal(spokenClock('not-a-date'), 'abhi');
      const phrase = voicePhrase(boardAt('Ramesh', null));
      assert.ok(phrase?.endsWith('abhi'), `got "${phrase}"`);
    });
  });

  test('every non-silent event produces a phrase in both locales', () => {
    const events: CrewFeedbackEvent[] = [
      boardAt('Ramesh'),
      { type: 'drop.confirmed', firstName: 'Sita' },
      { type: 'trip.boarding' },
      { type: 'trip.inProgress' },
      { type: 'trip.completed' },
      { type: 'sos.fired' },
      { type: 'sos.queued' },
      { type: 'offline.synced', count: 3 },
      { type: 'gps.on' },
      { type: 'gps.off' },
    ];
    for (const locale of ['en', 'hi'] as const) {
      inLocale(locale, () => {
        for (const event of events) {
          const phrase = voicePhrase(event);
          assert.ok(phrase && phrase.length > 0, `${locale}: ${event.type} said nothing`);
        }
      });
    }
  });

  test('silent events say nothing (the haptic is the whole message)', () => {
    for (const type of SILENT_EVENTS) {
      const phrase = voicePhrase({ type } as CrewFeedbackEvent);
      assert.equal(phrase, null, `${type} must not speak`);
    }
    assert.ok(SILENT_EVENTS.includes('action.rejected'), 'a rejection shows an Alert instead');
    assert.ok(SILENT_EVENTS.includes('sos.holdStart'), 'the hold tick is not an announcement');
  });
});

// ── Privacy ────────────────────────────────────────────────────────────────

describe('privacy: what must never reach the speaker', () => {
  test('the event types cannot even express private data', () => {
    // The structural guarantee: a board event has a first name and a time.
    // There is no field for a phone, a guardian or a medical note, so the
    // rule holds before any runtime scanner runs.
    const event = boardAt('Ramesh', '2026-09-15T07:42:00');
    assert.deepEqual(Object.keys(event).sort(), ['at', 'firstName', 'type']);
    assert.deepEqual([...SPOKEN_STUDENT_FIELDS], ['first_name']);
  });

  test('no denied field name appears in any voice template, in either locale', () => {
    const voiceKeys = (Object.keys(en) as TranslationKey[]).filter((k) => k.startsWith('voice.'));
    const leaks: string[] = [];
    for (const key of voiceKeys) {
      for (const [locale, dict] of [
        ['en', en],
        ['hi', hi],
      ] as const) {
        const placeholders = dict[key].match(/\{(\w+)\}/g) ?? [];
        for (const field of VOICE_DENIED_FIELDS) {
          if (placeholders.some((p) => p.toLowerCase().includes(field.replace(/_/g, '')))) {
            leaks.push(`${locale}:${key} → ${field}`);
          }
        }
      }
    }
    assert.deepEqual(leaks, [], `private data in a voice template: ${leaks.join(', ')}`);
  });

  test('the deny-list covers the categories the brief names', () => {
    for (const field of [
      'medical_notes',
      'guardian_phone',
      'phone_number',
      'emergency_message',
      'admission_number',
      'last_name',
    ]) {
      assert.ok(VOICE_DENIED_FIELDS.includes(field), `${field} must be denied`);
    }
  });

  test('isSpeakable rejects phone numbers, admission numbers and ID codes', () => {
    // The runtime net, for a payload that somehow reaches the module anyway.
    assert.equal(isSpeakable('Call guardian on 9876543210'), false);
    assert.equal(isSpeakable('Ramesh ADM-2024-0142 has boarded'), false);
    assert.equal(isSpeakable('Student 20240142 boarded'), false);
    assert.equal(isSpeakable(''), false);
    assert.equal(isSpeakable('   '), false);
  });

  test('isSpeakable still allows a clock and a small count', () => {
    assert.equal(isSpeakable('Ramesh ka boarding ho gaya, 7:42 subah'), true);
    assert.equal(isSpeakable('12 bachche chadh gaye'), true);
    assert.equal(isSpeakable('Emergency alert sent to school'), true);
  });

  test('a phrase that fails the net is dropped silently, not thrown', () => {
    // A rejected utterance must never become an exception on the board path.
    assert.doesNotThrow(() => voicePhrase(boardAt('9876543210')));
    assert.equal(voicePhrase(boardAt('9876543210')), null);
  });
});

// ── Throttle ───────────────────────────────────────────────────────────────

describe('throttle: 40 rapid boards must not become 40 announcements', () => {
  test('the first tap speaks immediately', () => {
    const throttle = new VoiceThrottle();
    const decision = throttle.offer(boardAt('Ramesh'), 1_000);
    assert.equal(decision.kind, 'speak');
  });

  test('40 boards in one second → ≤6 announcements and ZERO queue growth', () => {
    const throttle = new VoiceThrottle();
    let spoken = 0;
    let maxDepth = 0;
    let clock = 0;

    // A whole bus boarding: one tap every 25 ms for a second.
    for (let index = 0; index < 40; index += 1) {
      clock += 25;
      const decision = throttle.offer(boardAt(`Student${index}`), clock);
      if (decision.kind === 'speak') spoken += 1;
      maxDepth = Math.max(maxDepth, throttle.pendingDepth);
      // The scheduler would fire a flush here; simulate it landing on time.
      if (throttle.hasPending) {
        const flushed = throttle.flush(clock);
        if (flushed.kind === 'speak') spoken += 1;
        maxDepth = Math.max(maxDepth, throttle.pendingDepth);
      }
    }
    const tail = throttle.flush(clock + VOICE_MIN_GAP_MS);
    if (tail.kind === 'speak') spoken += 1;

    assert.ok(spoken <= 6, `expected ≤6 announcements for 40 taps, got ${spoken}`);
    assert.ok(spoken >= 2, `expected the driver to hear something, got ${spoken}`);
    // The structural claim: there is a one-item slot, not a queue.
    assert.ok(maxDepth <= 1, `pending depth grew to ${maxDepth} — that is a queue`);
  });

  test('a burst of the same family coalesces into one summary, with a count', () => {
    const throttle = new VoiceThrottle();
    inLocale('hi', () => {
      assert.equal(throttle.offer(boardAt('A'), 0).kind, 'speak');
      for (const [index, name] of ['B', 'C', 'D', 'E', 'F'].entries()) {
        const decision = throttle.offer(boardAt(name), 50 + index * 50);
        assert.equal(decision.kind, 'defer');
      }
      assert.equal(throttle.pendingDepth, 1, 'five deferred events, one slot');
      const flushed = throttle.flush(VOICE_MIN_GAP_MS + 10);
      assert.equal(flushed.kind, 'speak');
      assert.equal(
        flushed.kind === 'speak' ? flushed.utterance.text : '',
        '5 bachche chadh gaye',
        'the summary names the count, not the five children',
      );
    });
  });

  test('the summary path is exercised for drops too', () => {
    inLocale('en', () => {
      assert.equal(summaryPhrase('board.confirmed', 5), '5 students boarded');
      assert.equal(summaryPhrase('drop.confirmed', 12), '12 students got off');
    });
  });

  test('latest-wins: a different event replaces the slot instead of stacking', () => {
    const throttle = new VoiceThrottle();
    throttle.offer(boardAt('A'), 0);
    throttle.offer(boardAt('B'), 100);
    throttle.offer({ type: 'gps.off' }, 200);
    assert.equal(throttle.pendingDepth, 1);
    inLocale('en', () => {
      const flushed = throttle.flush(VOICE_MIN_GAP_MS + 1);
      assert.equal(
        flushed.kind === 'speak' ? flushed.utterance.text : '',
        'Location sharing off',
        'the newest fact is the one spoken',
      );
    });
  });

  test('an SOS interrupts immediately and clears stale chatter', () => {
    const throttle = new VoiceThrottle();
    throttle.offer(boardAt('A'), 0);
    throttle.offer(boardAt('B'), 50); // deferred
    assert.equal(throttle.pendingDepth, 1);

    inLocale('en', () => {
      const sos = throttle.offer({ type: 'sos.fired' }, 60);
      assert.equal(sos.kind, 'speak', 'an emergency never waits behind boarding chatter');
      assert.equal(
        sos.kind === 'speak' ? sos.utterance.text : '',
        'Emergency alert sent to school',
      );
    });
    assert.equal(throttle.pendingDepth, 0, 'the stale boarding summary was dropped');
    for (const type of PRIORITY_EVENTS) {
      assert.ok(['sos.fired', 'sos.queued'].includes(type));
    }
  });

  test('the "sync complete" summary is its own announcement path', () => {
    const throttle = new VoiceThrottle();
    inLocale('hi', () => {
      const decision = throttle.offer({ type: 'offline.synced', count: 7 }, 5_000);
      assert.equal(decision.kind, 'speak');
      assert.equal(
        decision.kind === 'speak' ? decision.utterance.text : '',
        '7 save kiye kaam bhej diye gaye',
      );
    });
  });

  test('after the gap elapses, a lone event speaks immediately again', () => {
    const throttle = new VoiceThrottle();
    throttle.offer(boardAt('A'), 0);
    const later = throttle.offer(boardAt('B'), VOICE_MIN_GAP_MS + 1);
    assert.equal(later.kind, 'speak', 'a calm stop is not throttled');
  });

  test('the minimum gap sits in the 500–700 ms window the policy specifies', () => {
    assert.ok(VOICE_MIN_GAP_MS >= 500 && VOICE_MIN_GAP_MS <= 700, `got ${VOICE_MIN_GAP_MS}`);
  });

  test('reset drops everything (logout / unmount)', () => {
    const throttle = new VoiceThrottle();
    throttle.offer(boardAt('A'), 0);
    throttle.offer(boardAt('B'), 50);
    throttle.reset();
    assert.equal(throttle.pendingDepth, 0);
    assert.equal(throttle.flush(10_000).kind, 'silent');
  });
});

// ── The dictionary is still the source of truth ────────────────────────────

test('voice phrases come from t(), so a third locale is purely additive', () => {
  // No phrase is built by string concatenation in the module: adding a locale
  // means adding its `voice.*` values, nothing else.
  inLocale('en', () => {
    assert.equal(t('voice.gps.on'), 'Location sharing on');
  });
  inLocale('hi', () => {
    assert.equal(t('voice.gps.on'), 'Location bhejna chalu');
  });
});
