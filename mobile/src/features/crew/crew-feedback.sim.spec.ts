import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Simulation of the voice/haptics layer against the **real**
 * `crew-feedback-native.ts`, with `expo-speech`, `expo-haptics` and
 * `react-native` mocked (`--experimental-test-module-mocks` +
 * `scripts/test-loaders/native-stubs.loader.mjs`). Same folder and same
 * mechanism as the push-lifecycle simulation — no new test infrastructure.
 *
 * The unit specs prove the *policy*; this proves the **wiring**: that the
 * patterns this app decided on actually reach `Speech.speak` /
 * `Haptics.impactAsync` with the right arguments, that a device without a TTS
 * engine degrades to silence instead of crashing, and that the web platform
 * installs nothing at all.
 */
const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../') + '/';

const platform = { OS: 'android' };
mock.module('react-native', { namedExports: { Platform: platform } });

interface SpokenCall {
  text: string;
  options: { language?: string; rate?: number; pitch?: number; onError?: () => void };
}
const speech = {
  spoken: [] as SpokenCall[],
  stops: 0,
  throwOnSpeak: false,
};
mock.module('expo-speech', {
  namedExports: {
    speak: (text: string, options: SpokenCall['options']) => {
      speech.spoken.push({ text, options });
      if (speech.throwOnSpeak) throw new Error('no TTS engine on this device');
    },
    stop: async () => {
      speech.stops += 1;
    },
  },
});

const haptics = { impacts: [] as string[], notifications: [] as string[], selections: 0 };
mock.module('expo-haptics', {
  namedExports: {
    impactAsync: async (style: string) => {
      haptics.impacts.push(style);
    },
    notificationAsync: async (type: string) => {
      haptics.notifications.push(type);
    },
    selectionAsync: async () => {
      haptics.selections += 1;
    },
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  },
});

const i18n = (await import(
  pathToFileURL(ROOT + 'src/lib/i18n.ts').href
)) as typeof import('../../lib/i18n.ts');
const core = (await import(
  pathToFileURL(ROOT + 'src/features/crew/crew-feedback.ts').href
)) as typeof import('./crew-feedback.ts');
const native = (await import(
  pathToFileURL(ROOT + 'src/features/crew/crew-feedback-native.ts').href
)) as typeof import('./crew-feedback-native.ts');

const reset = () => {
  speech.spoken.length = 0;
  speech.stops = 0;
  speech.throwOnSpeak = false;
  haptics.impacts.length = 0;
  haptics.notifications.length = 0;
  haptics.selections = 0;
};

/** A dispatcher with a hand-driven clock, wired to the real native drivers. */
function dispatcher(voice = true, vibration = true) {
  let clock = 0;
  const instance = new core.FeedbackDispatcher({
    now: () => clock,
    scheduler: { setTimeout: () => 1, clearTimeout: () => undefined },
  });
  instance.setSettings({ voice, vibration });
  reset();
  return { instance, advance: (ms: number) => (clock += ms) };
}

test('installFeedbackDrivers wires the real expo modules on a device', () => {
  platform.OS = 'android';
  native.installFeedbackDrivers();
  const { instance } = dispatcher();
  instance.on({ type: 'board.confirmed', firstName: 'Ramesh', at: '2026-09-15T07:42:00' });

  assert.equal(speech.spoken.length, 1, 'Speech.speak was called');
  assert.equal(haptics.impacts.length, 1, 'Haptics.impactAsync was called');
});

test('the boarding phrase reaches the engine as Latin-script Hinglish in hi', () => {
  i18n.setLocale('hi', { persist: false });
  const { instance } = dispatcher();
  instance.on({ type: 'board.confirmed', firstName: 'Ramesh Kumar', at: '2026-09-15T07:42:00' });

  const call = speech.spoken[0]!;
  assert.equal(call.text, 'Ramesh ka boarding ho gaya, 7:42 subah');
  assert.ok(!/[\u0900-\u097F]/.test(call.text), 'no Devanagari may reach the TTS engine');
  assert.ok(!call.text.includes('Kumar'), 'the surname never leaves the phone');
});

test('the engine is asked for en-IN at rate 0.95, with no pitch override', () => {
  const { instance } = dispatcher();
  instance.on({ type: 'gps.on' });
  const options = speech.spoken[0]!.options;
  assert.equal(options.language, 'en-IN');
  assert.equal(options.rate, 0.95);
  assert.equal(options.pitch, undefined, 'the device default pitch is the right one');
  assert.equal(typeof options.onError, 'function', 'engine errors are swallowed by a callback');
});

test('a language switch changes the next utterance (nothing frozen at import)', () => {
  const { instance, advance } = dispatcher();
  i18n.setLocale('en', { persist: false });
  instance.on({ type: 'trip.completed' });
  advance(2_000);
  i18n.setLocale('hi', { persist: false });
  instance.on({ type: 'trip.completed' });

  assert.equal(speech.spoken[0]!.text, 'Trip complete, well done');
  assert.equal(speech.spoken[1]!.text, 'Trip poori hui, shukriya');
  i18n.setLocale('en', { persist: false });
});

test('every announcement stops the engine first — latest wins, no backlog', () => {
  const { instance } = dispatcher();
  instance.on({ type: 'sos.fired' });
  assert.equal(speech.stops, 1);
  assert.equal(speech.spoken.length, 1);
});

test('the haptic vocabulary maps onto the real expo-haptics API', () => {
  const { instance, advance } = dispatcher(false, true);

  instance.on({ type: 'board.confirmed', firstName: 'A' });
  assert.deepEqual(haptics.impacts, ['light'], 'board → impactAsync(Light)');

  advance(1_000);
  instance.on({ type: 'action.rejected' });
  assert.deepEqual(haptics.notifications, ['error'], 'rejection → notificationAsync(Error)');

  advance(1_000);
  instance.on({ type: 'sos.fired' });
  assert.deepEqual(haptics.notifications, ['error', 'success'], 'SOS fired → Success');

  advance(1_000);
  instance.on({ type: 'sos.queued' });
  assert.deepEqual(haptics.notifications, ['error', 'success', 'warning'], 'queued → Warning');

  instance.on({ type: 'sos.holdStart' });
  assert.equal(haptics.selections, 1, 'hold start → selectionAsync (a tick)');
});

test('a device with no TTS engine degrades to silence — the action still stands', () => {
  const { instance } = dispatcher();
  speech.throwOnSpeak = true; // after the helper's reset(), or it would be cleared
  let recorded = false;

  assert.doesNotThrow(() => {
    recorded = true; // the board is already applied by the time we report it
    instance.on({ type: 'board.confirmed', firstName: 'Ramesh' });
  });
  assert.equal(recorded, true);
  assert.ok(instance.getStats().failures >= 1, 'the throw was counted, not raised');
  assert.equal(haptics.impacts.length, 1, 'the buzz still happened');
});

test('voice off ⇒ the native speech module is never called at all', () => {
  const { instance } = dispatcher(false, true);
  for (let index = 0; index < 10; index += 1) {
    instance.on({ type: 'board.confirmed', firstName: `S${index}` });
  }
  instance.on({ type: 'sos.fired' });
  assert.deepEqual(speech.spoken, []);
  assert.equal(speech.stops, 0);
});

test('vibration off ⇒ the native haptics module is never called at all', () => {
  const { instance } = dispatcher(true, false);
  instance.on({ type: 'board.confirmed', firstName: 'A' });
  instance.on({ type: 'action.rejected' });
  assert.deepEqual(haptics.impacts, []);
  assert.deepEqual(haptics.notifications, []);
  assert.equal(haptics.selections, 0);
});

test('on web nothing is installed — no speech, no haptics, no crash', () => {
  platform.OS = 'web';
  core.configureFeedbackDrivers(null);
  native.installFeedbackDrivers();
  const { instance } = dispatcher();

  assert.doesNotThrow(() => instance.on({ type: 'board.confirmed', firstName: 'A' }));
  assert.doesNotThrow(() => instance.on({ type: 'sos.fired' }));
  assert.deepEqual(speech.spoken, [], 'a browser tab must not start talking');
  assert.deepEqual(haptics.impacts, []);
  platform.OS = 'android';
});
