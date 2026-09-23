import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { en } from '../../lib/i18n.en.ts';
import { hi } from '../../lib/i18n.hi.ts';
import { mr } from '../../lib/i18n.mr.ts';
import {
  dictionary,
  getLocale,
  placeholderNames,
  setLocale,
  SUPPORTED_LOCALES,
  t,
  type Locale,
  type TranslationKey,
} from '../../lib/i18n.ts';
import {
  activeVoicePlan,
  configureVoiceCapabilities,
  FALLBACK_VOICE_TAG,
  languageSelfName,
  NATIVE_VOICE_TAG,
  parseVoiceCapabilities,
  PRIORITY_EVENTS,
  resolveVoicePlan,
  shouldShowNativeVoiceHint,
  SILENT_EVENTS,
  SPOKEN_STUDENT_FIELDS,
  SPOKEN_STOP_NAME_MAX,
  STOP_ANNOUNCEMENT_EVENTS,
  VOICE_DENIED_FIELDS,
  VOICE_MIN_GAP_MS,
  VOICE_RATE,
  VoiceThrottle,
  voiceCapabilities,
  isSpeakable,
  spokenClock,
  spokenFirstName,
  spokenStopName,
  summaryPhrase,
  utteranceFor,
  voiceLanguageTag,
  voicePhrase,
  type CrewFeedbackEvent,
  type EngineVoiceRecord,
  type VoiceCapabilitySet,
} from './crew-voice.ts';

/**
 * The voice **policy** suite: what gets said, in which language and which
 * script, how often, and — the load-bearing half — what never gets said at
 * all.
 *
 * Everything here is pure. No device, no TTS engine, no timers: the throttle
 * takes an injected clock, so a forty-tap boarding burst is replayed in
 * microseconds and the result is a number this spec can assert. The engine's
 * voice list is injected the same way — a phone with a Marathi voice and a
 * phone without one are two arguments to `resolveVoicePlan`, not two devices.
 */

const boardAt = (name: string, at: string | null = null): CrewFeedbackEvent => ({
  type: 'board.confirmed',
  firstName: name,
  at,
});

/** Runs `body` in `locale` and restores the previous one. */
function inLocale(locale: Locale, body: () => void): void {
  setLocale('en', { persist: false });
  setLocale(locale, { persist: false });
  try {
    body();
  } finally {
    setLocale('en', { persist: false });
  }
}

/** A phone that reports exactly these voice languages, one identifier each. */
function phoneWith(...languages: string[]): VoiceCapabilitySet {
  const records: EngineVoiceRecord[] = languages.map((language, index) => ({
    identifier: `voice-${index}`,
    language,
    quality: 'Default',
  }));
  return parseVoiceCapabilities(records);
}

/** Runs `body` with the cached capability set, then restores the previous one. */
function withCapabilities(capabilities: VoiceCapabilitySet | null, body: () => void): void {
  const previous = voiceCapabilities();
  configureVoiceCapabilities(capabilities);
  try {
    body();
  } finally {
    configureVoiceCapabilities(previous);
  }
}

/** Runs `body` in `locale` on `phone`. */
function onPhone(
  locale: Locale,
  capabilities: VoiceCapabilitySet | null,
  body: () => void,
): void {
  withCapabilities(capabilities, () => inLocale(locale, body));
}

// ── The Latin-script decision, asserted ────────────────────────────────────

describe('two voice namespaces: Latin fallback, native script when the phone can', () => {
  const DEVANAGARI = /[\u0900-\u097F]/;
  const voiceKeys = (Object.keys(en) as TranslationKey[]).filter((key) => key.startsWith('voice.'));
  const nativeKeys = voiceKeys.filter((key) => key.startsWith('voice.native.'));
  const latinKeys = voiceKeys.filter((key) => !key.startsWith('voice.native.'));
  /** `voice.native.board.done` → `voice.board.done`. */
  const twinOf = (key: TranslationKey): TranslationKey =>
    key.replace('voice.native.', 'voice.') as TranslationKey;

  test('both namespaces exist in every dictionary', () => {
    assert.ok(latinKeys.length >= 16, `expected the Latin namespace, found ${latinKeys.length}`);
    assert.equal(
      nativeKeys.length,
      latinKeys.length,
      'every Latin line needs a native twin — a phrase with no Devanagari version silently keeps sounding English',
    );
    for (const locale of SUPPORTED_LOCALES) {
      const dict = dictionary(locale);
      for (const key of voiceKeys) assert.ok(key in dict, `${key} missing from ${locale}`);
    }
  });

  test('every native line is the twin of a Latin line (no orphans either way)', () => {
    const missingTwin = nativeKeys.filter((key) => !latinKeys.includes(twinOf(key)));
    const unpaired = latinKeys.filter(
      (key) => !nativeKeys.includes(`voice.native.${key.slice('voice.'.length)}` as TranslationKey),
    );
    assert.deepEqual(missingTwin, [], `native lines with no Latin twin: ${missingTwin.join(', ')}`);
    assert.deepEqual(unpaired, [], `Latin lines with no native twin: ${unpaired.join(', ')}`);
  });

  test('NO Latin fallback line contains Devanagari, in any locale', () => {
    // The fallback exists for phones whose only voice is English: Devanagari
    // handed to such an engine is spelled out or skipped. This is the assertion
    // the whole Latin namespace exists to satisfy, and it still holds for every
    // line the fallback can speak.
    const offenders = latinKeys.filter((key) => DEVANAGARI.test(hi[key]) || DEVANAGARI.test(mr[key]));
    assert.deepEqual(
      offenders,
      [],
      `these fallback lines would be garbled on a phone without a native TTS voice: ${offenders.join(', ')}`,
    );
  });

  test('every hi/mr NATIVE line really is Devanagari — not a Latin copy', () => {
    // The point of batch 3C: a phone that CAN speak Marathi must be handed
    // Marathi. A native namespace full of Hinglish would satisfy the type
    // checker and still sound like "English speaking Hindi".
    const notNative: string[] = [];
    for (const key of nativeKeys) {
      if (!DEVANAGARI.test(hi[key])) notNative.push(`hi:${key}`);
      if (!DEVANAGARI.test(mr[key])) notNative.push(`mr:${key}`);
    }
    assert.deepEqual(notNative, [], `not in native script: ${notNative.join(', ')}`);
  });

  test('English has one script, so its native line IS its fallback line', () => {
    // Pinned because it is duplicated in the dictionary on purpose: `t()`'s
    // placeholder inference needs a literal per key, and a pair that drifts
    // would make the same phone say two different things depending on which
    // branch a future edit takes.
    const drifted = nativeKeys.filter((key) => en[key] !== en[twinOf(key)]);
    assert.deepEqual(drifted, [], `en native/latin pair drifted: ${drifted.join(', ')}`);
  });

  test('a native/latin pair carries the SAME placeholders, in every locale', () => {
    // The resolver picks a key at runtime, so both rows must accept the same
    // params — otherwise switching voice mode would render "{name}" aloud.
    const drifted: string[] = [];
    for (const key of nativeKeys) {
      for (const locale of SUPPORTED_LOCALES) {
        const dict = dictionary(locale);
        const native = placeholderNames(dict[key]).sort();
        const latin = placeholderNames(dict[twinOf(key)]).sort();
        if (native.length !== latin.length || native.some((n, i) => n !== latin[i])) {
          drifted.push(`${locale}:${key} [${native}] vs [${latin}]`);
        }
      }
    }
    assert.deepEqual(drifted, [], `placeholder drift between scripts: ${drifted.join('; ')}`);
  });

  test('the WRITTEN UI is Devanagari in both voice modes — the channels stay separate', () => {
    // The counter-assertion: adding a native voice must not have touched the
    // screen, and the Latin fallback must not have romanised it either.
    for (const key of [
      'status.boarding',
      'manifest.board',
      'sos.holdLabel',
      'help.title',
    ] as TranslationKey[]) {
      assert.ok(DEVANAGARI.test(hi[key]), `${key} must stay in Devanagari on screen`);
      assert.ok(DEVANAGARI.test(mr[key]), `${key} must stay in Devanagari on screen`);
    }
  });

  test('the English voice phrases are real phrases, not silence', () => {
    // English-preference crew hear confirmations too — the brief is explicit
    // that the English path is not "no voice".
    for (const key of voiceKeys) {
      assert.ok(en[key].trim().length > 0, `${key} is empty in English`);
    }
  });

  test('every spoken phrase stays inside the 6–9 word budget, in both scripts', () => {
    const tooLong: string[] = [];
    for (const key of voiceKeys) {
      for (const locale of SUPPORTED_LOCALES) {
        const dict = dictionary(locale);
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

describe('the tag table', () => {
  test('a native tag per locale, and one Latin fallback tag', () => {
    assert.deepEqual({ ...NATIVE_VOICE_TAG }, { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' });
    assert.equal(FALLBACK_VOICE_TAG, 'en-IN');
  });

  test('the tag always matches the script of the line it will speak', () => {
    // The bug in both directions: `hi-IN` reading Latin garbles, and `en-IN`
    // reading Devanagari garbles. So native ⇔ native tag, latin ⇔ en-IN.
    onPhone('hi', phoneWith('hi-IN'), () => {
      assert.equal(activeVoicePlan().script, 'native');
      assert.equal(activeVoicePlan().language, 'hi-IN');
    });
    onPhone('hi', phoneWith('en-IN'), () => {
      assert.equal(activeVoicePlan().script, 'latin');
      assert.equal(activeVoicePlan().language, FALLBACK_VOICE_TAG);
    });
  });
});

describe('capability detection: parsed once, cached, tolerant', () => {
  test('the engine\'s own tag spellings all resolve to one language subtag', () => {
    for (const raw of ['hi-IN', 'hi_IN', 'hi', 'HI-in', 'hin-IND', 'hin']) {
      const parsed = parseVoiceCapabilities([{ identifier: 'v', language: raw }]);
      assert.ok(parsed.bestByLanguage.has('hi'), `"${raw}" must be recognised as Hindi`);
    }
  });

  test('an `mr-IN` voice is found under `mr`, and a three-letter code too', () => {
    assert.ok(phoneWith('mr-IN').bestByLanguage.has('mr'));
    assert.ok(phoneWith('mar-IND').bestByLanguage.has('mr'));
  });

  test('the best voice of a language wins: region IN first, then enhanced', () => {
    const parsed = parseVoiceCapabilities([
      { identifier: 'hi-generic', language: 'hi' },
      { identifier: 'hi-enhanced', language: 'hi-IN', quality: 'Enhanced' },
      { identifier: 'hi-other-region', language: 'hi-US' },
    ]);
    assert.equal(parsed.bestByLanguage.get('hi')?.voiceId, 'hi-enhanced');

    const regionBeatsDefault = parseVoiceCapabilities([
      { identifier: 'plain-in', language: 'en-IN' },
      { identifier: 'plain-us', language: 'en-US' },
    ]);
    assert.equal(regionBeatsDefault.bestByLanguage.get('en')?.voiceId, 'plain-in');
  });

  test('a malformed record is skipped, never thrown over', () => {
    const parsed = parseVoiceCapabilities([
      { identifier: 'ok', language: 'hi-IN' },
      { identifier: 'no-language' },
      { language: 42 },
      null as unknown as EngineVoiceRecord,
      { identifier: '', language: 'mr-IN' }, // no usable identifier, still a voice
    ]);
    assert.equal(parsed.bestByLanguage.get('hi')?.voiceId, 'ok');
    assert.equal(parsed.bestByLanguage.get('mr')?.voiceId, null, 'a voice with no id is still a voice');
    assert.equal(parsed.bestByLanguage.size, 2);
  });

  test('an empty answer is a MEASURED "nothing usable", not an un-probed phone', () => {
    const parsed = parseVoiceCapabilities([]);
    assert.equal(parsed.bestByLanguage.size, 0);
    assert.notEqual(parsed, null);
  });

  test('the set is cached in the policy layer, and resettable', () => {
    assert.equal(voiceCapabilities(), null, 'un-probed until the native seam says otherwise');
    const installed = phoneWith('hi-IN');
    configureVoiceCapabilities(installed);
    assert.equal(voiceCapabilities(), installed, 'the probe result is what resolution reads');
    configureVoiceCapabilities(null);
    assert.equal(voiceCapabilities(), null);
  });

  test('resolution is synchronous and never re-probes: same input, same plan', () => {
    // The structural claim behind "never probe the engine per utterance": the
    // resolver takes the cached set and returns a value, with no async and no
    // native call to make. (`crew-feedback-wiring.spec.ts` pins the probe to
    // exactly one file and one memoised call.)
    const installed = phoneWith('mr-IN');
    const first = resolveVoicePlan('mr', installed);
    for (let index = 0; index < 1_000; index += 1) {
      assert.deepEqual(resolveVoicePlan('mr', installed), first);
    }
  });
});

describe('the voice plan: native when installed, Latin fallback when not', () => {
  test('hi-IN installed → real Hindi, native tag, that exact voice pinned', () => {
    const plan = resolveVoicePlan('hi', phoneWith('en-IN', 'hi-IN'));
    assert.equal(plan.script, 'native');
    assert.equal(plan.language, 'hi-IN');
    assert.equal(plan.voiceId, 'voice-1', 'the identifier the engine reported');
    assert.equal(plan.nativeVoiceMissing, false);
  });

  test('mr-IN installed → real Marathi, native tag', () => {
    const plan = resolveVoicePlan('mr', phoneWith('mr-IN'));
    assert.equal(plan.script, 'native');
    assert.equal(plan.language, 'mr-IN');
    assert.equal(plan.nativeVoiceMissing, false);
  });

  test('no native voice → Latin line, en-IN, and the hint is owed', () => {
    const plan = resolveVoicePlan('hi', phoneWith('en-IN', 'en-US'));
    assert.equal(plan.script, 'latin');
    assert.equal(plan.language, 'en-IN');
    assert.equal(plan.voiceId, 'voice-0', 'the best English voice is pinned instead');
    assert.equal(plan.nativeVoiceMissing, true);
  });

  test('a phone with NO voices at all still gets a speakable plan', () => {
    const plan = resolveVoicePlan('mr', parseVoiceCapabilities([]));
    assert.equal(plan.script, 'latin');
    assert.equal(plan.language, FALLBACK_VOICE_TAG);
    assert.equal(plan.voiceId, null);
    assert.equal(plan.nativeVoiceMissing, true);
  });

  test('un-probed (cold start) → Latin fallback, and NO accusation of a missing voice', () => {
    // The probe is async; the first announcements of a launch must not wait for
    // it, and a state we have not measured must not tell the driver their phone
    // is missing something.
    const plan = resolveVoicePlan('hi', null);
    assert.equal(plan.script, 'latin');
    assert.equal(plan.language, FALLBACK_VOICE_TAG);
    assert.equal(plan.voiceId, null);
    assert.equal(plan.nativeVoiceMissing, false);
  });

  test('English always asks for an explicit en-IN voice, never the blind default', () => {
    const withVoice = resolveVoicePlan('en', phoneWith('en-IN', 'hi-IN'));
    assert.equal(withVoice.script, 'native');
    assert.equal(withVoice.language, 'en-IN');
    assert.equal(withVoice.voiceId, 'voice-0', 'an explicit en-IN voice, not "whatever"');
    assert.equal(withVoice.nativeVoiceMissing, false);

    const without = resolveVoicePlan('en', phoneWith('hi-IN'));
    assert.equal(without.language, 'en-IN', 'the tag stays en-IN even with no English voice');
    assert.equal(without.voiceId, null);
    assert.equal(without.nativeVoiceMissing, false, 'English has no native voice to miss');
  });
});

describe('language and voice mode are derived at call time', () => {
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
    });
  });

  test('voiceLanguageTag follows the active locale AND the installed voices', () => {
    // Without a probe every locale falls back to en-IN…
    withCapabilities(null, () => {
      for (const locale of SUPPORTED_LOCALES) {
        inLocale(locale, () => assert.equal(voiceLanguageTag(), FALLBACK_VOICE_TAG));
      }
    });
    // …and with one, each locale speaks through its own voice.
    withCapabilities(phoneWith('en-IN', 'hi-IN', 'mr-IN'), () => {
      inLocale('hi', () => assert.equal(voiceLanguageTag(), 'hi-IN'));
      inLocale('mr', () => assert.equal(voiceLanguageTag(), 'mr-IN'));
      inLocale('en', () => assert.equal(voiceLanguageTag(), 'en-IN'));
    });
  });

  test('a switch to a language the phone CANNOT speak changes the script too', () => {
    // The spec the brief pins: mr/hi/en switching, on one phone, with one
    // resolver. Same module instance, three different answers.
    const phone = phoneWith('en-IN', 'mr-IN');
    onPhone('mr', phone, () => {
      const phrase = voicePhrase(boardAt('Ramesh'));
      assert.ok(/[\u0900-\u097F]/.test(phrase ?? ''), `expected Devanagari, got "${phrase}"`);
      assert.equal(activeVoicePlan().language, 'mr-IN');
    });
    onPhone('hi', phone, () => {
      const phrase = voicePhrase(boardAt('Ramesh'));
      assert.ok(phrase?.includes('ka boarding ho gaya'), `expected Hinglish, got "${phrase}"`);
      assert.equal(activeVoicePlan().language, FALLBACK_VOICE_TAG);
      assert.equal(activeVoicePlan().nativeVoiceMissing, true);
    });
    onPhone('en', phone, () => {
      assert.equal(voicePhrase(boardAt('Ramesh')), 'Ramesh has boarded, just now');
      assert.equal(activeVoicePlan().language, 'en-IN');
    });
  });

  test('the whole utterance follows the switch: text, tag and voice identifier', () => {
    onPhone('hi', phoneWith('en-IN', 'hi-IN'), () => {
      const utterance = utteranceFor(voicePhrase(boardAt('Ramesh')) ?? '');
      assert.equal(utterance.language, 'hi-IN');
      assert.equal(utterance.voiceId, 'voice-1');
      assert.ok(/[\u0900-\u097F]/.test(utterance.text));
    });
    onPhone('en', phoneWith('en-IN', 'hi-IN'), () => {
      const utterance = utteranceFor(voicePhrase(boardAt('Ramesh')) ?? '');
      assert.equal(utterance.language, 'en-IN');
      assert.equal(utterance.voiceId, 'voice-0');
      assert.equal(utterance.text, 'Ramesh has boarded, just now');
    });
  });

  test('a probe that lands LATE upgrades the next announcement, not a past one', () => {
    inLocale('hi', () => {
      const before = utteranceFor(voicePhrase({ type: 'gps.on' }) ?? '');
      assert.equal(before.language, FALLBACK_VOICE_TAG);
      assert.ok(before.text.includes('Location bhejna chalu'));

      configureVoiceCapabilities(phoneWith('hi-IN'));
      try {
        const after = utteranceFor(voicePhrase({ type: 'gps.on' }) ?? '');
        assert.equal(after.language, 'hi-IN');
        assert.equal(after.text, t('voice.native.gps.on'));
      } finally {
        configureVoiceCapabilities(null);
      }
    });
  });

  test('the utterance carries rate ~0.95, a voice slot and no pitch override', () => {
    const utterance = utteranceFor('Ramesh has boarded');
    assert.equal(utterance.rate, VOICE_RATE);
    assert.ok(VOICE_RATE >= 0.9 && VOICE_RATE <= 1, 'rate stays close to natural pace');
    assert.deepEqual(
      Object.keys(utterance).sort(),
      ['language', 'rate', 'text', 'voiceId'],
      'nothing else travels to the native seam',
    );
    assert.equal(
      'pitch' in utterance,
      false,
      'every device tunes its own pitch; overriding it is how speech starts sounding wrong',
    );
  });
});

describe('the missing-voice hint is explained, once', () => {
  test('shown only for a MEASURED gap in the active locale', () => {
    assert.equal(shouldShowNativeVoiceHint(resolveVoicePlan('hi', phoneWith('en-IN')), false), true);
    assert.equal(shouldShowNativeVoiceHint(resolveVoicePlan('hi', phoneWith('hi-IN')), false), false);
    assert.equal(shouldShowNativeVoiceHint(resolveVoicePlan('hi', null), false), false);
    assert.equal(shouldShowNativeVoiceHint(resolveVoicePlan('en', phoneWith('hi-IN')), false), false);
  });

  test('dismissing it stops it — one-time means one-time', () => {
    const plan = resolveVoicePlan('mr', phoneWith('en-IN'));
    assert.equal(shouldShowNativeVoiceHint(plan, true), false);
  });

  test('the hint names the language in its own script, in every UI locale', () => {
    // A support call is easier when the driver can read which voice is missing.
    inLocale('en', () => {
      assert.equal(languageSelfName('hi'), 'हिन्दी');
      assert.equal(languageSelfName('mr'), 'मराठी');
    });
    inLocale('mr', () => assert.equal(languageSelfName('mr'), 'मराठी'));
    assert.equal(languageSelfName(), languageSelfName(getLocale()));
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

  test('every non-silent event produces a phrase in every locale, in BOTH voice modes', () => {
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
      { type: 'stop.next', stopName: 'Shivaji Chowk', studentCount: 12 },
      { type: 'stop.approaching', stopName: 'Shivaji Chowk', studentCount: 12 },
    ];
    const phones: Array<[string, VoiceCapabilitySet | null]> = [
      ['un-probed (Latin fallback)', null],
      ['no native voice (Latin fallback)', phoneWith('en-IN')],
      ['native voices installed', phoneWith('en-IN', 'hi-IN', 'mr-IN')],
    ];
    for (const [phoneName, phone] of phones) {
      for (const locale of SUPPORTED_LOCALES) {
        onPhone(locale, phone, () => {
          for (const event of events) {
            const phrase = voicePhrase(event);
            assert.ok(
              phrase && phrase.length > 0,
              `${phoneName} / ${locale}: ${event.type} said nothing`,
            );
            assert.ok(isSpeakable(phrase), `${phoneName} / ${locale}: "${phrase}" is not speakable`);
          }
        });
      }
    }
  });

  test('silent events say nothing (the haptic is the whole message)', () => {
    for (const type of SILENT_EVENTS) {
      const phrase = voicePhrase({ type } as CrewFeedbackEvent);
      assert.equal(phrase, null, `${type} must not speak`);
    }
    assert.ok(SILENT_EVENTS.includes('action.rejected'), 'a rejection shows an Alert instead');
    assert.ok(SILENT_EVENTS.includes('sos.holdStart'), 'the hold tick is not an announcement');
    assert.ok(
      !SILENT_EVENTS.some((type) => STOP_ANNOUNCEMENT_EVENTS.includes(type)),
      'a next-stop announcement is meant to be heard',
    );
  });
});

// ── Next-stop announcements ────────────────────────────────────────────────

describe('next-stop announcements: stop + count, in the active voice', () => {
  const stopEvent: CrewFeedbackEvent = {
    type: 'stop.next',
    stopName: 'Shivaji Chowk',
    studentCount: 12,
  };

  test('the line is "Next stop: <name>, <N> students" in English', () => {
    inLocale('en', () => {
      assert.equal(voicePhrase(stopEvent), 'Next stop: Shivaji Chowk, 12 students');
      assert.equal(
        voicePhrase({ type: 'stop.approaching', stopName: 'Shivaji Chowk', studentCount: 12 }),
        'Approaching Shivaji Chowk, 12 students',
      );
    });
  });

  test('Hinglish on a phone without a Hindi voice, Devanagari on one with it', () => {
    onPhone('hi', phoneWith('en-IN'), () => {
      assert.equal(voicePhrase(stopEvent), 'Agla stop: Shivaji Chowk, 12 bachche');
    });
    onPhone('hi', phoneWith('hi-IN'), () => {
      assert.equal(voicePhrase(stopEvent), 'अगला स्टॉप: Shivaji Chowk, 12 बच्चे');
    });
    onPhone('mr', phoneWith('mr-IN'), () => {
      assert.equal(voicePhrase(stopEvent), 'पुढील स्टॉप: Shivaji Chowk, 12 मुले');
    });
    onPhone('mr', phoneWith('en-IN'), () => {
      assert.equal(voicePhrase(stopEvent), 'Pudhil stop: Shivaji Chowk, 12 balek');
    });
  });

  test('a long or padded stop name is squeezed and capped', () => {
    inLocale('en', () => {
      const long = 'Maharaja  Jyotiba Phule Chowk, Near Railway Gate Number Two';
      assert.equal(spokenStopName(long).length, SPOKEN_STOP_NAME_MAX);
      assert.ok(!spokenStopName(long).includes('  '), 'a double space is read aloud as a pause');
      assert.equal(spokenStopName('  Gate 2 '), 'Gate 2');
      assert.equal(spokenStopName(''), '');
    });
  });

  test('a stop with no name says nothing, rather than a hole in the sentence', () => {
    // The announcer refuses to fire without a name (`next-stop-announcer.ts`);
    // this pins the phrase layer's own net for one that reaches it anyway.
    inLocale('en', () => {
      assert.equal(voicePhrase({ type: 'stop.next', stopName: '   ', studentCount: 4 }), null);
      assert.equal(voicePhrase({ type: 'stop.next', stopName: '', studentCount: 4 }), null);
    });
  });

  test('an implausible count is dropped by the digit net (the announcer caps first)', () => {
    // `MAX_SPOKEN_STUDENTS` keeps this out of reach in practice; the net is what
    // makes a corrupt payload silence instead of a six-digit read-out.
    inLocale('en', () => {
      const phrase = voicePhrase({ type: 'stop.next', stopName: 'Gate 2', studentCount: 987_654 });
      assert.equal(phrase, null, 'six digits is an identifier, not a count — dropped, never spoken');
    });
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

  test('batch 3C added no student field: a stop event carries a name and a count', () => {
    // The next-stop announcement is the one place a *list* of children was
    // tempting. It stayed an aggregate: a stop is school data, and how many
    // children are waiting is the fact the crew need.
    for (const type of STOP_ANNOUNCEMENT_EVENTS) {
      const event = { type, stopName: 'Shivaji Chowk', studentCount: 12 } as CrewFeedbackEvent;
      assert.deepEqual(Object.keys(event).sort(), ['stopName', 'studentCount', 'type']);
    }
    assert.deepEqual(
      [...SPOKEN_STUDENT_FIELDS],
      ['first_name'],
      'the speakable-student set is unchanged by the next-stop work',
    );
  });

  test('no denied field name appears in any voice template, in every locale', () => {
    const voiceKeys = (Object.keys(en) as TranslationKey[]).filter((k) => k.startsWith('voice.'));
    const leaks: string[] = [];
    for (const key of voiceKeys) {
      for (const locale of SUPPORTED_LOCALES) {
        const dict = dictionary(locale);
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
  inLocale('mr', () => {
    assert.equal(t('voice.gps.on'), 'Location pathavne suru');
  });
});
