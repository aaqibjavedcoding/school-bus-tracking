import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  CrewFeedback,
  FEEDBACK_STORAGE_KEY,
  INITIAL_FEEDBACK_PREFERENCES,
  MAX_ANNOUNCEMENTS_PER_BURST,
  feedbackDefaultsForRole,
  parsePreferences,
  type CrewFeedbackEvent,
  type FeedbackPreferences,
  type FeedbackStore,
  type HapticsAdapter,
  type VoiceAdapter,
  type VoiceSpeakOptions,
} from './crew-feedback.ts';
import { voiceStudentEvent } from './crew-voice.ts';

/**
 * The dispatcher (Phase 3b): the event→feedback matrix, the two "off means
 * nothing" directions, the non-blocking / non-fatal contract, persistence and
 * cold start, and the privacy rule applied to the payload that actually leaves
 * the module.
 *
 * Everything runs against in-memory spy adapters and a synthetic clock — no
 * device, no timer, no Expo module. The real `expo-speech`/`expo-haptics`
 * boundary is `crew-feedback.sim.spec.ts`.
 */

interface Call {
  channel: 'voice' | 'haptics';
  kind: string;
  detail: string;
}

/** Spies that record every native call, and can be made to throw. */
function spies(options: { speakThrows?: boolean } = {}) {
  const calls: Call[] = [];
  const voice: VoiceAdapter = {
    stop: () => calls.push({ channel: 'voice', kind: 'stop', detail: '' }),
    speak: (text: string, speech: VoiceSpeakOptions) => {
      calls.push({
        channel: 'voice',
        kind: 'speak',
        detail: `${text}|${speech.language}|${speech.rate}|${speech.pitch}`,
      });
      if (options.speakThrows) throw new Error('TTS engine unavailable');
    },
  };
  const haptics: HapticsAdapter = {
    impact: (style) => calls.push({ channel: 'haptics', kind: 'impact', detail: style }),
    notification: (type) => calls.push({ channel: 'haptics', kind: 'notification', detail: type }),
    selection: () => calls.push({ channel: 'haptics', kind: 'selection', detail: '' }),
  };
  return { calls, voice, haptics };
}

function inMemoryStore(initial: string | null = null): FeedbackStore & {
  writes: FeedbackPreferences[];
  value: string | null;
} {
  const writes: FeedbackPreferences[] = [];
  return {
    writes,
    value: initial,
    read: async () => (writes.length > 0 ? JSON.stringify(writes[writes.length - 1]!) : initial),
    write: async (prefs) => {
      writes.push(prefs);
    },
  };
}

/** A dispatcher on a synthetic clock, wired to fresh spies. */
function build(options: { speakThrows?: boolean; prefs?: FeedbackPreferences } = {}) {
  const spy = spies(options);
  let clock = 0;
  const service = new CrewFeedback(() => clock);
  service.configureAdapters({ voice: spy.voice, haptics: spy.haptics });
  if (options.prefs) service.setPreferences(options.prefs, { persist: false });
  return {
    service,
    calls: spy.calls,
    advance: (ms: number) => {
      clock += ms;
    },
    settle: () => service.settleVoice(),
    spoken: () =>
      spy.calls.filter((call) => call.kind === 'speak').map((call) => call.detail.split('|')[0]!),
    tapped: () =>
      spy.calls
        .filter((call) => call.channel === 'haptics')
        .map((call) => `${call.kind}:${call.detail}`),
  };
}

const both = { voice: true, vibration: true };

describe('role defaults', () => {
  test('crew get voice AND vibration; admin and parent get voice off', () => {
    assert.deepEqual(feedbackDefaultsForRole('DRIVER'), { voice: true, vibration: true });
    assert.deepEqual(feedbackDefaultsForRole('CONDUCTOR'), { voice: true, vibration: true });
    assert.deepEqual(feedbackDefaultsForRole('SCHOOL_ADMIN'), { voice: false, vibration: true });
    assert.deepEqual(feedbackDefaultsForRole('PARENT'), { voice: false, vibration: true });
    // Unknown / signed-out: the quiet default, never a guess.
    assert.deepEqual(feedbackDefaultsForRole(null), { voice: false, vibration: true });
  });

  test('before any role is known the app is silent, not chirping', () => {
    assert.deepEqual(INITIAL_FEEDBACK_PREFERENCES, { voice: false, vibration: true });
  });

  test('the role default applies once and never overrides an explicit choice', async () => {
    const service = new CrewFeedback(() => 0);
    service.applyRoleDefault('DRIVER');
    assert.deepEqual(service.preferences, { voice: true, vibration: true });
    service.setPreferences({ voice: false }, { persist: false });
    service.applyRoleDefault('DRIVER');
    assert.equal(service.preferences.voice, false, 'a deliberate switch must survive');
    assert.equal(service.hasExplicitChoice, true);
  });
});

describe('feedback matrix: role × channel × on/off', () => {
  const roles: Array<[string, FeedbackPreferences]> = [
    ['DRIVER', feedbackDefaultsForRole('DRIVER')],
    ['CONDUCTOR', feedbackDefaultsForRole('CONDUCTOR')],
    ['SCHOOL_ADMIN', feedbackDefaultsForRole('SCHOOL_ADMIN')],
    ['PARENT', feedbackDefaultsForRole('PARENT')],
  ];

  test('a board confirm at the role default produces exactly the expected calls', () => {
    for (const [role, prefs] of roles) {
      const harness = build({ prefs });
      harness.service.on('board.done', voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'));
      const spoken = harness.spoken();
      const tapped = harness.tapped();
      if (prefs.voice) {
        assert.equal(spoken.length, 1, `${role}: expected one spoken line`);
        assert.match(spoken[0]!, /Ramesh/);
      } else {
        assert.deepEqual(spoken, [], `${role}: voice must be silent`);
      }
      assert.deepEqual(tapped, ['impact:light'], `${role}: expected one light tap`);
    }
  });

  test('every event × both channels covers the matrix', () => {
    const events = [
      ['board.done', ['impact:light']] as const,
      ['drop.done', ['impact:light']] as const,
      ['board.queued', ['impact:light']] as const,
      ['trip.boarding', ['impact:medium']] as const,
      ['trip.inProgress', ['impact:medium']] as const,
      ['trip.completed', ['impact:medium']] as const,
      ['sos.hold', ['selection:']] as const,
      ['sos.sent', ['notification:success']] as const,
      ['sos.queued', ['notification:warning']] as const,
      ['sos.failed', ['notification:error']] as const,
      ['sync.done', ['notification:success']] as const,
      ['gps.on', ['impact:light']] as const,
      ['gps.off', ['impact:light']] as const,
      ['action.failed', ['notification:error']] as const,
      ['action.conflict', ['notification:error']] as const,
      ['toggle', ['selection:']] as const,
      ['test', ['notification:success']] as const,
    ];
    for (const [event, expectedTaps] of events) {
      // Both channels on.
      const on = build({ prefs: both });
      on.service.on(
        event as CrewFeedbackEvent,
        voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'),
      );
      assert.deepEqual(on.tapped(), [...expectedTaps], `${event}: taps with both on`);
      // Vibration off: no tap, voice unchanged.
      const noVibe = build({ prefs: { voice: true, vibration: false } });
      noVibe.service.on(
        event as CrewFeedbackEvent,
        voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'),
      );
      assert.deepEqual(noVibe.tapped(), [], `${event}: tapped while vibration was off`);
      // Voice off: no speech, tap unchanged.
      const noVoice = build({ prefs: { voice: false, vibration: true } });
      noVoice.service.on(
        event as CrewFeedbackEvent,
        voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'),
      );
      assert.deepEqual(noVoice.spoken(), [], `${event}: spoke while voice was off`);
      assert.deepEqual(noVoice.tapped(), [...expectedTaps], `${event}: taps with voice off`);
      // Both off: nothing at all.
      const off = build({ prefs: { voice: false, vibration: false } });
      off.service.on(
        event as CrewFeedbackEvent,
        voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'),
      );
      assert.deepEqual(off.calls, [], `${event}: fired with everything off`);
    }
  });

  test('voice off ⇒ zero native speech calls, in both directions', () => {
    const harness = build({ prefs: { voice: false, vibration: false } });
    for (const event of ['board.done', 'drop.done', 'sos.sent', 'trip.boarding', 'test']) {
      harness.service.on(event as CrewFeedbackEvent);
    }
    assert.deepEqual(
      harness.calls.filter((call) => call.channel === 'voice'),
      [],
    );
    harness.service.setPreferences({ voice: true }, { persist: false });
    harness.service.on('board.done', voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'));
    assert.equal(harness.spoken().length, 1, 're-enabling must work in the same session');
  });
});

describe('non-blocking and non-fatal', () => {
  test('a throwing Speech.speak does not change the action result', () => {
    const harness = build({ speakThrows: true, prefs: both });
    const boardStudent = (): string => {
      harness.service.on('board.done', voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'));
      // The crew action's own result — identical whether or not the phone spoke.
      return 'boarded';
    };
    assert.equal(boardStudent(), 'boarded');
    // The haptic still landed; only the speech failed.
    assert.deepEqual(harness.tapped(), ['impact:light']);
  });

  test('`on` is synchronous and never waits for the utterance', () => {
    const harness = build({ prefs: both });
    const returned = harness.service.on(
      'board.done',
      voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'),
    );
    assert.equal(typeof returned, 'object', 'on() must return a plain record, not a promise');
    assert.equal(
      typeof (returned as unknown as { then?: unknown }).then,
      'undefined',
      'on() must not be thenable — a caller could await it and block the action',
    );
    assert.equal(harness.spoken().length, 1, 'the call happened before on() returned');
    // The gate knows it is mid-utterance without waiting for a callback.
    assert.equal(harness.service.voiceSnapshot().speaking, true);
    harness.settle();
    assert.equal(harness.service.voiceSnapshot().speaking, false);
  });

  test('a missing adapter (web, stripped build) is a silent no-op', () => {
    const service = new CrewFeedback(() => 0);
    service.setPreferences(both, { persist: false });
    assert.doesNotThrow(() => service.on('board.done'));
    service.configureAdapters(null);
    assert.doesNotThrow(() => service.on('sos.sent'));
  });

  test('no feedback module awaits anything on the dispatch path', () => {
    const files = [
      'src/features/crew/crew-voice.ts',
      'src/features/crew/crew-haptics.ts',
      'src/features/crew/crew-feedback.ts',
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(`${process.cwd()}/${file}`, 'utf8'));
      // The dispatch path is what a crew action calls; it must contain no
      // `await`/`async`. (Persistence is allowed to be async — it is never on
      // an action's path.)
      for (const method of ['on', 'dispatch', 'applyVoice', 'applyHaptics', 'flushSummary']) {
        const body = methodBody(source, method);
        if (body === null) continue; // not defined in this file
        if (/\bawait\b/.test(body) || /\basync\b/.test(body)) {
          offenders.push(`${file}#${method}`);
        }
      }
      if (file.endsWith('crew-voice.ts') || file.endsWith('crew-haptics.ts')) {
        if (/\bawait\b/.test(source) || /\basync\b/.test(source)) {
          offenders.push(`${file} (whole module)`);
        }
      }
    }
    assert.deepEqual(offenders, [], `speech must never be awaited: ${offenders.join(', ')}`);
  });
});

describe('privacy, end to end', () => {
  test('nothing on the deny-list ever reaches the voice adapter', () => {
    const harness = build({ prefs: both });
    const record = {
      admission_number: 'ADM-20241',
      first_name: 'Ramesh',
      last_name: 'Kumar',
      guardian_phone: '+91-9876543210',
      medical_note: 'asthma — inhaler in the front pocket',
      guardian_email: 'parent@example.com',
    };
    harness.service.on('board.done', voiceStudentEvent(record, '7:42 AM'));
    harness.service.on('drop.done', voiceStudentEvent(record, '4:10 PM'));
    const payload = harness.calls.map((call) => call.detail).join(' ');
    for (const forbidden of [
      'ADM-20241',
      '20241',
      'Kumar',
      '9876543210',
      '91-9876543210',
      'parent@example.com',
      'asthma',
      'inhaler',
      'guardian',
    ]) {
      assert.equal(payload.includes(forbidden), false, `voice payload leaked "${forbidden}"`);
    }
    assert.equal(harness.service.mutedByPrivacy.length, 0, 'nothing should have needed muting');
  });

  test('a phrase that somehow carried a phone number would be muted, not spoken', () => {
    // The payload types make a leak structurally impossible; `applyVoice`'s
    // deny-list check is the last line if a dictionary edit ever smuggled one
    // in. It cannot be reached with the real dictionary, so pin the wiring
    // instead: inside `applyVoice`, `isSpeakable` must gate `adapter.speak`.
    const source = readFileSync(
      `${process.cwd()}/src/features/crew/crew-feedback.ts`,
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ' ');
    const body = methodBody(source, 'applyVoice');
    assert.ok(body, 'applyVoice must exist');
    const gate = body!.indexOf('isSpeakable(');
    const speak = body!.indexOf('adapter.speak(');
    assert.ok(gate >= 0, 'applyVoice must consult the deny-list');
    assert.ok(speak >= 0, 'applyVoice must be the only place that speaks');
    assert.ok(gate < speak, 'the deny-list check must run before the speak call');
    // …and it is a real check, not a logged warning: the muted branch returns.
    assert.match(body!.slice(gate, speak), /return;/);
  });
});

describe('persistence and cold start', () => {
  test('the storage key is the Phase-3a pattern (one AsyncStorage entry)', () => {
    assert.equal(FEEDBACK_STORAGE_KEY, 'sbt.mobile.feedback');
  });

  test('a toggle is persisted and applied on the next cold start', async () => {
    const store = inMemoryStore();
    const first = new CrewFeedback(() => 0);
    first.configureStore(store);
    first.setPreferences({ voice: false, vibration: false });
    assert.deepEqual(store.writes.at(-1), { voice: false, vibration: false });

    const cold = new CrewFeedback(() => 0);
    cold.configureStore(inMemoryStore(JSON.stringify({ voice: false, vibration: false })));
    await cold.loadPersisted();
    assert.deepEqual(cold.preferences, { voice: false, vibration: false });
    assert.equal(cold.hasExplicitChoice, true);
    // A role default cannot undo a saved choice.
    cold.applyRoleDefault('DRIVER');
    assert.deepEqual(cold.preferences, { voice: false, vibration: false });
  });

  test('with nothing saved, the role default decides — and is not persisted', async () => {
    const store = inMemoryStore(null);
    const service = new CrewFeedback(() => 0);
    service.configureStore(store);
    await service.loadPersisted();
    service.applyRoleDefault('DRIVER');
    assert.deepEqual(service.preferences, { voice: true, vibration: true });
    assert.deepEqual(store.writes, [], 'a default must never be written as a choice');
  });

  test('a corrupt stored value falls back to the defaults instead of crashing', async () => {
    for (const raw of ['{', 'null', '[]', '{"voice":"yes","vibration":1}', '']) {
      const service = new CrewFeedback(() => 0);
      service.configureStore(inMemoryStore(raw));
      await service.loadPersisted();
      assert.deepEqual(service.preferences, INITIAL_FEEDBACK_PREFERENCES, `raw=${raw}`);
    }
    assert.equal(parsePreferences('{"voice":true,"vibration":false}')?.voice, true);
    assert.equal(parsePreferences(null), null);
  });

  test('a failing store never breaks the toggle', async () => {
    const service = new CrewFeedback(() => 0);
    service.configureStore({
      read: async () => {
        throw new Error('AsyncStorage unavailable');
      },
      write: async () => {
        throw new Error('AsyncStorage unavailable');
      },
    });
    await service.loadPersisted();
    assert.doesNotThrow(() => service.setPreferences({ voice: true }));
    assert.equal(service.preferences.voice, true);
  });
});

describe('the throttle is wired through the dispatcher', () => {
  test('a 40-student boarding wave stays inside the announcement cap', () => {
    const harness = build({ prefs: both });
    for (let index = 0; index < 40; index += 1) {
      harness.service.on('board.done', voiceStudentEvent({ first_name: `S${index}` }, '7:42 AM'));
      harness.advance(100);
      harness.settle();
    }
    assert.ok(
      harness.spoken().length <= MAX_ANNOUNCEMENTS_PER_BURST,
      `expected ≤${MAX_ANNOUNCEMENTS_PER_BURST}, got ${harness.spoken().length}`,
    );
    // Every tap still fired — the cap is on speech, not on confirmation.
    assert.equal(harness.tapped().length, 40);
  });

  test('the sync-complete path announces the owed summary', () => {
    const harness = build({ prefs: both });
    for (let index = 0; index < 20; index += 1) {
      harness.service.on('board.done', voiceStudentEvent({ first_name: `S${index}` }, '7:42 AM'));
      harness.advance(100);
      harness.settle();
    }
    const before = harness.spoken().length;
    harness.service.on('sync.done');
    const after = harness.spoken();
    assert.equal(after.length, before + 1, 'sync.done must produce exactly one line');
    assert.match(after.at(-1)!, /students boarded|students board ho gaye/);
  });

  test('with voice off the summary is owed but never spoken', () => {
    const harness = build({ prefs: { voice: false, vibration: true } });
    for (let index = 0; index < 20; index += 1) {
      harness.service.on('board.done', voiceStudentEvent({ first_name: `S${index}` }, '7:42 AM'));
      harness.advance(100);
    }
    harness.service.on('sync.done');
    assert.deepEqual(harness.spoken(), []);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────

/** Strip block and line comments so prose about `await` is not scanned. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/**
 * The balanced-brace body of the *definition* of `name(...) {`. Anchored to a
 * line start so a call site (`this.applyVoice(x)`) is never mistaken for it.
 */
function methodBody(source: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\n)[ \\t]*(?:private\\s+)?${name}\\s*\\([^)]*\\)[^{]*\\{`).exec(
    source,
  );
  if (!match) return null;
  let depth = 0;
  for (let index = match.index + match[0].length - 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  return null;
}
