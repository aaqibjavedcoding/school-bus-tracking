import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { setLocale } from '../../lib/i18n.ts';
import {
  CREW_SOUND_DEFAULTS,
  FeedbackDispatcher,
  OFFICE_SOUND_DEFAULTS,
  VOICE_DEFAULT_ON_ROLES,
  configureFeedbackDrivers,
  defaultSoundSettings,
  type FeedbackDrivers,
  type FeedbackScheduler,
  type SoundSettings,
} from './crew-feedback.ts';
import { HapticPattern } from './crew-haptics.ts';
import {
  configureVoiceCapabilities,
  parseVoiceCapabilities,
  VOICE_MIN_GAP_MS,
  type CrewFeedbackEvent,
  type VoiceUtterance,
} from './crew-voice.ts';
import { parseSoundSettings, serializeSoundSettings } from './feedback-preferences.ts';

/**
 * The dispatcher suite — the acceptance matrix, and the two negatives that
 * matter most: **voice off ⇒ zero speech calls** and **haptics off ⇒ zero
 * haptic calls**, proven with a spy rather than asserted in prose.
 *
 * The drivers are the injected native seam, so this is the same code path the
 * device runs, minus `expo-speech` / `expo-haptics`.
 */

interface Spy {
  drivers: FeedbackDrivers;
  spoken: VoiceUtterance[];
  stops: number;
  haptics: HapticPattern[];
  /** Total native calls of any kind — the "we sent nothing" counter. */
  total(): number;
  reset(): void;
}

function spyDrivers(options: { throwOnSpeak?: boolean; rejectHaptics?: boolean } = {}): Spy {
  const spoken: VoiceUtterance[] = [];
  const haptics: HapticPattern[] = [];
  let stops = 0;
  const spy: Spy = {
    spoken,
    haptics,
    get stops() {
      return stops;
    },
    total: () => spoken.length + haptics.length + stops,
    reset: () => {
      spoken.length = 0;
      haptics.length = 0;
      stops = 0;
    },
    drivers: {
      speak: (utterance) => {
        spoken.push(utterance);
        if (options.throwOnSpeak) throw new Error('TTS engine missing');
      },
      stopSpeaking: () => {
        stops += 1;
      },
      haptic: (pattern) => {
        haptics.push(pattern);
        if (options.rejectHaptics) {
          // `impactAsync` returns a promise; a rejecting one must not become
          // an unhandled rejection.
          return Promise.reject(new Error('no vibrator')) as unknown as void;
        }
      },
    },
  };
  return spy;
}

/** A scheduler the test drives by hand — no real timers anywhere. */
function manualScheduler(): FeedbackScheduler & { run(): void; pending: number } {
  let queue: Array<{ handler: () => void; handle: number }> = [];
  let nextHandle = 1;
  return {
    get pending() {
      return queue.length;
    },
    setTimeout(handler) {
      const handle = nextHandle++;
      queue.push({ handler, handle });
      return handle;
    },
    clearTimeout(handle) {
      queue = queue.filter((entry) => entry.handle !== handle);
    },
    run() {
      const due = queue;
      queue = [];
      for (const entry of due) entry.handler();
    },
  };
}

function makeDispatcher(spy: Spy, settings: SoundSettings) {
  configureFeedbackDrivers(spy.drivers);
  const scheduler = manualScheduler();
  let clock = 0;
  const dispatcher = new FeedbackDispatcher({ now: () => clock, scheduler });
  dispatcher.setSettings(settings);
  spy.reset(); // `setSettings` may stop speech; start the count at zero
  return {
    dispatcher,
    scheduler,
    advance: (ms: number) => {
      clock += ms;
    },
    at: (ms: number) => {
      clock = ms;
    },
  };
}

const board = (name = 'Ramesh'): CrewFeedbackEvent => ({
  type: 'board.confirmed',
  firstName: name,
  at: null,
});

setLocale('en', { persist: false });

// ── Role defaults ──────────────────────────────────────────────────────────

describe('defaults by role', () => {
  test('crew roles get voice ON and vibration ON', () => {
    for (const role of ['DRIVER', 'CONDUCTOR']) {
      assert.deepEqual(defaultSoundSettings(role), { voice: true, vibration: true });
    }
    assert.deepEqual(CREW_SOUND_DEFAULTS, { voice: true, vibration: true });
    assert.deepEqual([...VOICE_DEFAULT_ON_ROLES].sort(), ['CONDUCTOR', 'DRIVER']);
  });

  test('SCHOOL_ADMIN and PARENT get voice OFF (an office phone must not chatter)', () => {
    for (const role of ['SCHOOL_ADMIN', 'PARENT', 'SUPER_ADMIN']) {
      assert.equal(defaultSoundSettings(role).voice, false, `${role} must be silent by default`);
      assert.equal(defaultSoundSettings(role).vibration, true, `${role} keeps ordinary buzz`);
    }
    assert.deepEqual(OFFICE_SOUND_DEFAULTS, { voice: false, vibration: true });
  });

  test('an unknown or absent role falls back to the office (quiet) default', () => {
    assert.equal(defaultSoundSettings(null).voice, false);
    assert.equal(defaultSoundSettings(undefined).voice, false);
    assert.equal(defaultSoundSettings('SOMETHING_NEW').voice, false);
  });
});

// ── The matrix ─────────────────────────────────────────────────────────────

describe('feedback matrix: role × (voice, vibration) × on/off', () => {
  test('crew default (on/on) → the board both speaks and buzzes', () => {
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(spy, defaultSoundSettings('DRIVER'));
    dispatcher.on(board());
    assert.equal(spy.spoken.length, 1);
    assert.deepEqual(spy.haptics, [HapticPattern.light]);
  });

  test('VOICE OFF ⇒ ZERO speech calls (spy proves we sent nothing)', () => {
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(spy, { voice: false, vibration: true });
    for (let index = 0; index < 20; index += 1) dispatcher.on(board(`S${index}`));
    dispatcher.on({ type: 'sos.fired' }); // not even a priority event escapes
    dispatcher.on({ type: 'offline.synced', count: 3 });
    assert.deepEqual(spy.spoken, [], 'voice is off — nothing may be spoken');
    assert.equal(spy.stops, 0, 'not even a stop() is issued');
    assert.ok(spy.haptics.length > 0, 'vibration is still on, so it still buzzes');
  });

  test('VIBRATION OFF ⇒ ZERO haptic calls', () => {
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(spy, { voice: true, vibration: false });
    dispatcher.on(board());
    dispatcher.on({ type: 'action.rejected' });
    dispatcher.on({ type: 'sos.fired' });
    assert.deepEqual(spy.haptics, [], 'vibration is off — nothing may buzz');
    assert.ok(spy.spoken.length > 0, 'voice is still on');
  });

  test('BOTH OFF ⇒ zero native calls of any kind, for every event', () => {
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(spy, { voice: false, vibration: false });
    const events: CrewFeedbackEvent[] = [
      board(),
      { type: 'drop.confirmed', firstName: 'Sita' },
      { type: 'action.rejected' },
      { type: 'trip.boarding' },
      { type: 'trip.inProgress' },
      { type: 'trip.completed' },
      { type: 'sos.holdStart' },
      { type: 'sos.fired' },
      { type: 'sos.queued' },
      { type: 'offline.synced', count: 2 },
      { type: 'gps.on' },
      { type: 'gps.off' },
      // Batch 3C — the next-stop announcements obey the same switch.
      { type: 'stop.next', stopName: 'Shivaji Chowk', studentCount: 12 },
      { type: 'stop.approaching', stopName: 'Shivaji Chowk', studentCount: 12 },
    ];
    for (const event of events) dispatcher.on(event);
    assert.equal(spy.total(), 0, 'we sent nothing');
  });

  test('toggling at runtime takes effect on the very next event', () => {
    const spy = spyDrivers();
    const { dispatcher, advance } = makeDispatcher(spy, { voice: true, vibration: true });
    dispatcher.on(board('A'));
    assert.equal(spy.spoken.length, 1);

    dispatcher.setSettings({ voice: false, vibration: true });
    spy.reset();
    advance(VOICE_MIN_GAP_MS * 2);
    dispatcher.on(board('B'));
    assert.deepEqual(spy.spoken, [], 'switched off mid-session');

    dispatcher.setSettings({ voice: true, vibration: true });
    advance(VOICE_MIN_GAP_MS * 2);
    dispatcher.on(board('C'));
    assert.equal(spy.spoken.length, 1, 'switched back on');
  });

  test('turning voice off stops an announcement already in flight', () => {
    // "Off" has to mean silent *now*, not silent after the current sentence.
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(spy, { voice: true, vibration: true });
    dispatcher.on(board('A'));
    spy.reset();
    dispatcher.setSettings({ voice: false, vibration: true });
    assert.equal(spy.stops, 1, 'the engine was told to stop');
  });

  test('a deferred flush scheduled before voice was switched off never speaks', () => {
    const spy = spyDrivers();
    const { dispatcher, scheduler } = makeDispatcher(spy, { voice: true, vibration: true });
    dispatcher.on(board('A'));
    dispatcher.on(board('B')); // deferred → a flush is scheduled
    spy.reset();
    dispatcher.setSettings({ voice: false, vibration: true });
    scheduler.run();
    assert.deepEqual(spy.spoken, [], 'the pending flush was cancelled with the switch');
  });

  test('the office default in practice: an admin phone stays quiet but buzzes', () => {
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(spy, defaultSoundSettings('SCHOOL_ADMIN'));
    dispatcher.on(board());
    assert.deepEqual(spy.spoken, []);
    assert.deepEqual(spy.haptics, [HapticPattern.light]);
  });
});

// ── Cold start / persistence ───────────────────────────────────────────────

describe('preference persistence (cold start)', () => {
  test('a saved preference round-trips', () => {
    const settings: SoundSettings = { voice: false, vibration: true };
    assert.deepEqual(parseSoundSettings(serializeSoundSettings(settings)), settings);
  });

  test('a saved preference beats the role default at cold start', () => {
    // The provider applies `saved ?? defaultSoundSettings(role)`; this pins
    // the precedence the same way `resolveInitialLocale` does for language.
    const saved = parseSoundSettings('{"voice":false,"vibration":false}');
    const applied = saved ?? defaultSoundSettings('DRIVER');
    assert.deepEqual(applied, { voice: false, vibration: false });
  });

  test('no saved preference falls through to the role default', () => {
    const applied = parseSoundSettings(null) ?? defaultSoundSettings('DRIVER');
    assert.deepEqual(applied, CREW_SOUND_DEFAULTS);
  });

  test('a corrupt, partial or hostile stored value is ignored, never thrown', () => {
    for (const raw of [
      '',
      'not json',
      '{}',
      '[]',
      'null',
      '{"voice":"yes","vibration":true}',
      '{"voice":true}',
    ]) {
      assert.equal(parseSoundSettings(raw), null, `"${raw}" must not parse`);
    }
    assert.doesNotThrow(() => parseSoundSettings('{'));
  });

  test('cold start applies the settings to the dispatcher, not just to React', () => {
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(
      spy,
      parseSoundSettings('{"voice":false,"vibration":false}')!,
    );
    dispatcher.on(board());
    assert.equal(spy.total(), 0, 'the restored preference is live immediately');
  });
});

// ── Non-blocking / non-fatal ───────────────────────────────────────────────

describe('feedback never blocks and never fails an action', () => {
  test('a throwing Speech.speak does not change the result of the board', () => {
    const spy = spyDrivers({ throwOnSpeak: true });
    const { dispatcher } = makeDispatcher(spy, { voice: true, vibration: true });

    // The call site's shape: record the action, then report it.
    let recorded = false;
    const recordBoard = () => {
      recorded = true;
      dispatcher.on(board());
      return 'boarded';
    };

    assert.doesNotThrow(recordBoard);
    assert.equal(recordBoard(), 'boarded', 'the action result is identical');
    assert.equal(recorded, true);
    assert.equal(dispatcher.getStats().failures > 0, true, 'the failure was counted, not raised');
  });

  test('a rejecting haptic promise is swallowed (no unhandled rejection)', async () => {
    const spy = spyDrivers({ rejectHaptics: true });
    const { dispatcher } = makeDispatcher(spy, { voice: true, vibration: true });
    assert.doesNotThrow(() => dispatcher.on(board()));
    // Let the rejection settle; an unhandled one would fail the test run.
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(dispatcher.getStats().failures >= 1);
  });

  test('`on()` returns void — it cannot be awaited into a critical path', () => {
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(spy, { voice: true, vibration: true });
    assert.equal(dispatcher.on(board()), undefined);
  });

  test('an un-configured dispatcher (no drivers installed) is silent, not broken', () => {
    configureFeedbackDrivers(null);
    const dispatcher = new FeedbackDispatcher({ now: () => 0 });
    dispatcher.setSettings({ voice: true, vibration: true });
    assert.doesNotThrow(() => dispatcher.on(board()));
    assert.doesNotThrow(() => dispatcher.on({ type: 'sos.fired' }));
  });
});

// ── Throttle, through the dispatcher ───────────────────────────────────────

describe('throttle behaviour end-to-end', () => {
  test('40 rapid boards → ≤6 utterances, 40 taps, one scheduled flush at a time', () => {
    const spy = spyDrivers();
    const { dispatcher, scheduler, at } = makeDispatcher(spy, { voice: true, vibration: true });
    for (let index = 0; index < 40; index += 1) {
      at(index * 25);
      dispatcher.on(board(`S${index}`));
      assert.ok(scheduler.pending <= 1, 'never more than one pending flush timer');
      scheduler.run();
    }
    at(40 * 25 + VOICE_MIN_GAP_MS);
    scheduler.run();

    assert.ok(spy.spoken.length <= 6, `expected ≤6 announcements, got ${spy.spoken.length}`);
    assert.equal(spy.haptics.length, 40, 'every tap still buzzes');
  });

  test('every speak is preceded by a stop — latest-wins interrupt', () => {
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(spy, { voice: true, vibration: false });
    dispatcher.on({ type: 'sos.fired' });
    assert.equal(spy.spoken.length, 1);
    assert.equal(spy.stops, 1, 'Speech.stop precedes Speech.speak');
  });

  test('the utterance carries the language and rate from the policy module', () => {
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(spy, { voice: true, vibration: false });
    dispatcher.on({ type: 'gps.on' });
    assert.equal(spy.spoken[0]?.language, 'en-IN');
    assert.equal(spy.spoken[0]?.rate, 0.95);
    assert.equal(spy.spoken[0]?.voiceId, null, 'un-probed: the engine picks the voice itself');
  });

  test('a measured device upgrades the SAME dispatcher to the native voice', () => {
    // Batch 3C: no second code path and no per-role copy — the dispatcher hands
    // the engine whatever the cached probe resolved, at call time.
    const spy = spyDrivers();
    const { dispatcher, advance } = makeDispatcher(spy, { voice: true, vibration: false });
    configureVoiceCapabilities(
      parseVoiceCapabilities([
        { identifier: 'en-1', language: 'en-IN' },
        { identifier: 'hi-1', language: 'hi-IN' },
      ]),
    );
    try {
      setLocale('hi', { persist: false });
      dispatcher.on({ type: 'gps.on' });
      assert.equal(spy.spoken[0]?.language, 'hi-IN');
      assert.equal(spy.spoken[0]?.voiceId, 'hi-1');

      advance(VOICE_MIN_GAP_MS + 1);
      setLocale('mr', { persist: false }); // a locale this phone cannot speak
      dispatcher.on({ type: 'gps.off' });
      assert.equal(spy.spoken[1]?.language, 'en-IN', 'Latin fallback, en-IN tag');
      assert.equal(spy.spoken[1]?.voiceId, 'en-1', 'the best English voice is pinned instead');
    } finally {
      configureVoiceCapabilities(null);
      setLocale('en', { persist: false });
    }
  });

  test('reset() stops speech and clears pending work', () => {
    const spy = spyDrivers();
    const { dispatcher, scheduler } = makeDispatcher(spy, { voice: true, vibration: true });
    dispatcher.on(board('A'));
    dispatcher.on(board('B'));
    spy.reset();
    dispatcher.reset();
    scheduler.run();
    assert.deepEqual(spy.spoken, []);
    assert.equal(spy.stops, 1);
  });
});

// ── Batch 3C: next-stop announcements ──────────────────────────────────────

describe('next-stop announcements use the one dispatcher, both roles', () => {
  const nextStop = (stopName = 'Shivaji Chowk', studentCount = 12): CrewFeedbackEvent => ({
    type: 'stop.next',
    stopName,
    studentCount,
  });

  test('voice ON: the stop line is spoken once, and it buzzes', () => {
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(spy, { voice: true, vibration: true });
    dispatcher.on(nextStop());

    assert.equal(spy.spoken.length, 1);
    assert.equal(spy.spoken[0]?.text, 'Next stop: Shivaji Chowk, 12 students');
    assert.equal(spy.stops, 1, 'every speak is preceded by a stop');
    assert.deepEqual(spy.haptics, [HapticPattern.light]);
    assert.equal(dispatcher.getStats().spoken, 1);
  });

  test('voice OFF: zero speech calls — the announcement is not a special case', () => {
    const spy = spyDrivers();
    const { dispatcher } = makeDispatcher(spy, { voice: false, vibration: true });
    dispatcher.on(nextStop());
    dispatcher.on({ type: 'stop.approaching', stopName: 'Depot Gate', studentCount: 3 });

    assert.deepEqual(spy.spoken, []);
    assert.equal(spy.stops, 0);
    assert.equal(spy.haptics.length, 2, 'the vibration switch is its own decision');
  });

  test('inside the gap it waits in the one-item slot, then speaks the newest fact', () => {
    const spy = spyDrivers();
    const { dispatcher, scheduler, advance } = makeDispatcher(spy, {
      voice: true,
      vibration: false,
    });
    dispatcher.on(board('A'));
    dispatcher.on(nextStop());
    assert.equal(spy.spoken.length, 1, 'the stop line did not jump the 600 ms floor');
    assert.equal(dispatcher.getStats().coalesced, 1);
    assert.equal(scheduler.pending, 1, 'one timer, never a pile');

    advance(VOICE_MIN_GAP_MS + 1);
    scheduler.run();
    assert.equal(spy.spoken.length, 2);
    assert.equal(spy.spoken[1]?.text, 'Next stop: Shivaji Chowk, 12 students');
  });

  test('the native seam grew no probe: detection is not on the announcement path', () => {
    // The structural half of "never probe the TTS engine per utterance" — the
    // dispatcher still has exactly three native calls to make, so there is no
    // way for an announcement to trigger capability detection.
    const spy = spyDrivers();
    assert.deepEqual(Object.keys(spy.drivers).sort(), ['haptic', 'speak', 'stopSpeaking']);
  });
});
