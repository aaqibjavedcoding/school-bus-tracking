import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Simulation of the real native boundary (`crew-feedback.native.ts`) against
 * mocked `expo-speech`, `expo-haptics`, `react-native` and AsyncStorage, using
 * the repo's existing loader (`scripts/test-loaders/native-stubs.loader.mjs` +
 * `--experimental-test-module-mocks`) — the same mechanism as the push
 * lifecycle simulation. No new test infrastructure.
 *
 * The pure rules are covered by `crew-voice.spec.ts` / `crew-haptics.spec.ts` /
 * `crew-feedback.spec.ts`; this file proves only what those cannot: that the
 * thin wrapper actually reaches `Speech.stop()` → `Speech.speak()` in that
 * order, that a native failure is swallowed, that the web path is a no-op, and
 * that the preference really lands in AsyncStorage.
 */
const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../') + '/';

/** One ordered log so "stop before speak" is a checkable fact, not a claim. */
const log: string[] = [];
let speakThrows = false;
const storage = new Map<string, string>();

/** Flippable: the module reads `Platform.OS` per call, so web is testable. */
const platform: { OS: string } = { OS: 'android' };

mock.module('react-native', { namedExports: { Platform: platform } });
mock.module('expo-speech', {
  namedExports: {
    speak: (text: string, options: Record<string, unknown>) => {
      log.push(`speak:${text}:${options.language}:${options.rate}:${options.pitch}`);
      if (speakThrows) throw new Error('no TTS engine on this device');
    },
    stop: async () => {
      log.push('stop');
    },
  },
});
mock.module('expo-haptics', {
  namedExports: {
    impactAsync: async (style: string) => {
      log.push(`impact:${style}`);
    },
    notificationAsync: async (type: string) => {
      log.push(`notification:${type}`);
    },
    selectionAsync: async () => {
      log.push('selection');
    },
    ImpactFeedbackStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
    NotificationFeedbackType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
  },
});
mock.module('@react-native-async-storage/async-storage', {
  defaultExport: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.delete(key);
    },
  },
});

// Importing the native module installs the adapters (its documented side
// effect). The dispatcher instance is shared with the spec through the same
// module URL the native file imports.
await import(pathToFileURL(ROOT + 'src/features/crew/crew-feedback.native.ts').href);
const { feedback, FEEDBACK_STORAGE_KEY } = (await import(
  pathToFileURL(ROOT + 'src/features/crew/crew-feedback.ts').href
)) as typeof import('./crew-feedback.ts');
const { voiceStudentEvent } = (await import(
  pathToFileURL(ROOT + 'src/features/crew/crew-voice.ts').href
)) as typeof import('./crew-voice.ts');

const clear = () => {
  log.length = 0;
};
const settle = () => feedback.settleVoice();

test('a board confirm reaches the real Speech and Haptics modules', () => {
  clear();
  feedback.setPreferences({ voice: true, vibration: true }, { persist: false });
  feedback.on('board.done', voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'));
  const speech = log.filter((entry) => entry.startsWith('speak:'));
  assert.equal(speech.length, 1, `expected one speak call, got: ${log.join(' | ')}`);
  assert.match(speech[0]!, /Ramesh/);
  // rate 0.95 and the default pitch, straight through to SpeechOptions.
  assert.match(speech[0]!, /:0\.95:1$/);
  assert.deepEqual(
    log.filter((entry) => entry.startsWith('impact:')),
    ['impact:LIGHT'],
  );
});

test('an interrupting event stops the current utterance BEFORE speaking', () => {
  clear();
  feedback.resetVoice();
  feedback.on('board.done', voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'));
  // Still "speaking": no onDone has fired, exactly as on a device mid-phrase.
  const sos = feedback.on('sos.sent');
  assert.equal(sos.voice?.action, 'interrupt');
  const stopIndex = log.indexOf('stop');
  const sosSpeakIndex = log.findIndex((entry, index) => index > stopIndex && entry.includes('SOS'));
  assert.ok(stopIndex >= 0, `no Speech.stop() call: ${log.join(' | ')}`);
  assert.ok(sosSpeakIndex > stopIndex, 'stop must precede the new speak');
  settle();
});

test('a native speech failure is swallowed and the action still stands', () => {
  clear();
  speakThrows = true;
  feedback.resetVoice();
  const boardStudent = (): string => {
    feedback.on('board.done', voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'));
    return 'boarded';
  };
  assert.equal(boardStudent(), 'boarded', 'a TTS failure must not change the action result');
  speakThrows = false;
  // The haptic is independent of the speech failure.
  assert.deepEqual(
    log.filter((entry) => entry.startsWith('impact:')),
    ['impact:LIGHT'],
  );
  settle();
});

test('the notification tones map to the expo-haptics enum values', () => {
  clear();
  feedback.resetVoice();
  feedback.setPreferences({ voice: false, vibration: true }, { persist: false });
  feedback.on('sos.sent');
  feedback.on('sos.queued');
  feedback.on('sos.failed');
  feedback.on('sos.hold');
  assert.deepEqual(log, [
    'notification:SUCCESS',
    'notification:WARNING',
    'notification:ERROR',
    'selection',
  ]);
  settle();
});

test('vibration off means the native haptics module is never touched', () => {
  clear();
  feedback.resetVoice();
  feedback.setPreferences({ voice: false, vibration: false }, { persist: false });
  for (const event of ['board.done', 'drop.done', 'sos.sent', 'trip.boarding'] as const) {
    feedback.on(event);
  }
  assert.deepEqual(log, [], `native calls while everything was off: ${log.join(' | ')}`);
});

test('web is a no-op — no speech, no haptics, no crash', () => {
  clear();
  platform.OS = 'web';
  try {
    feedback.resetVoice();
    feedback.setPreferences({ voice: true, vibration: true }, { persist: false });
    assert.doesNotThrow(() => feedback.on('board.done'));
    assert.doesNotThrow(() => feedback.on('sos.sent'));
    assert.deepEqual(log, [], `react-native-web must stay silent: ${log.join(' | ')}`);
  } finally {
    platform.OS = 'android';
  }
  settle();
});

test('a preference change is written to AsyncStorage under the documented key', async () => {
  feedback.setPreferences({ voice: true, vibration: false });
  // The write is fire-and-forget; let the microtask run.
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(FEEDBACK_STORAGE_KEY, 'sbt.mobile.feedback');
  assert.equal(storage.get(FEEDBACK_STORAGE_KEY), '{"voice":true,"vibration":false}');
});

test('cold start: the stored preference is read back and applied', async () => {
  storage.set(FEEDBACK_STORAGE_KEY, '{"voice":false,"vibration":true}');
  const applied = await feedback.loadPersisted();
  assert.deepEqual(applied, { voice: false, vibration: true });
  assert.deepEqual(feedback.preferences, { voice: false, vibration: true });
  clear();
  feedback.resetVoice();
  feedback.on('board.done', voiceStudentEvent({ first_name: 'Ramesh' }, '7:42 AM'));
  assert.deepEqual(
    log.filter((entry) => entry.startsWith('speak:')),
    [],
    'voice was off',
  );
  assert.deepEqual(
    log.filter((entry) => entry.startsWith('impact:')),
    ['impact:LIGHT'],
  );
});
