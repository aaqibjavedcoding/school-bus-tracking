import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

/**
 * Source-scanning guard for the feedback layer, in the family of
 * `help-routing.spec.ts`, `legibility.spec.ts` and `i18n-literals.spec.ts`.
 *
 * Some Phase-3b rules are architectural rather than behavioural — "the native
 * module is imported in exactly one file", "speech is never awaited", "the
 * offline queue core was not touched". A unit test cannot see those; a
 * filesystem assertion can, and it keeps holding for code nobody has written
 * yet.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(`${mobileRoot}${path}`, 'utf8');

/** Every file allowed to import a Phase-3b native module. */
const NATIVE_OWNER = 'src/features/crew/crew-feedback-native.ts';

const FEEDBACK_MODULES = [
  'src/features/crew/crew-voice.ts',
  'src/features/crew/crew-haptics.ts',
  'src/features/crew/crew-feedback.ts',
  'src/features/crew/feedback-preferences.ts',
];

/** Call sites wired in Phase 3b. */
const WIRED_SURFACES = [
  'src/features/crew/ManifestList.tsx',
  'src/features/crew/TripStatusActions.tsx',
  'src/features/crew/SosPanel.tsx',
  'src/features/crew/HoldToConfirmButton.tsx',
  'src/features/crew/GpsShareStrip.tsx',
  'src/features/crew/offline/OfflineSyncBanner.tsx',
];

describe('the native seam is exactly one file', () => {
  test('only `crew-feedback-native.ts` imports expo-speech / expo-haptics', () => {
    const offenders: string[] = [];
    for (const file of [...FEEDBACK_MODULES, ...WIRED_SURFACES]) {
      const source = read(file);
      if (/from '(expo-speech|expo-haptics)'/.test(source)) offenders.push(file);
    }
    assert.deepEqual(
      offenders,
      [],
      `these must go through the injected drivers instead: ${offenders.join(', ')}`,
    );
    const native = read(NATIVE_OWNER);
    assert.ok(native.includes("from 'expo-speech'"), 'the wrapper owns the speech import');
    assert.ok(native.includes("from 'expo-haptics'"), 'the wrapper owns the haptics import');
  });

  test('the policy modules stay loadable under plain node (no react-native import)', () => {
    // This is what lets every rule above be spec-covered without a device.
    for (const file of FEEDBACK_MODULES) {
      const source = read(file);
      assert.ok(
        !/from 'react-native'/.test(source),
        `${file} must not import react-native — it would stop loading under node --test`,
      );
    }
  });

  test('the native wrapper guards the web platform', () => {
    const native = read(NATIVE_OWNER);
    assert.ok(
      /Platform\.OS === 'web'/.test(native),
      'react-native-web has no haptics engine and a talking browser tab is a bug',
    );
  });
});

describe('speech is never awaited and never fails an action', () => {
  test('no `await` on a speech or haptic call anywhere in the feature', () => {
    const offenders: string[] = [];
    for (const file of [...FEEDBACK_MODULES, ...WIRED_SURFACES, NATIVE_OWNER]) {
      for (const [index, line] of read(file).split('\n').entries()) {
        if (/await\s+(Speech|Haptics)\./.test(line)) {
          offenders.push(`${file}:${index + 1}`);
        }
        if (/await\s+\w*[Ff]eedback\.(on|speak)\b/.test(line)) {
          offenders.push(`${file}:${index + 1}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `awaiting feedback would block the crew action behind the speaker: ${offenders.join(', ')}`,
    );
  });

  test('`feedback.on(...)` is a bare statement at every call site, never chained', () => {
    // `.then(...)` on the dispatcher would re-introduce exactly the coupling
    // the phase forbids. `on()` returns void, so this is belt and braces.
    const offenders: string[] = [];
    for (const file of WIRED_SURFACES) {
      if (/feedback\.on\([^)]*\)\s*\.\s*then/.test(read(file))) offenders.push(file);
    }
    assert.deepEqual(offenders, []);
  });

  test('the dispatcher wraps every native call', () => {
    const dispatcher = read('src/features/crew/crew-feedback.ts');
    assert.ok(dispatcher.includes('private safely('), 'the swallow-and-count helper exists');
    // Every driver call goes through it.
    for (const call of ['drivers.speak(', 'drivers.stopSpeaking()', 'drivers.haptic(']) {
      const pattern = new RegExp(`safely\\(\\(\\) => ${call.replace(/[.()]/g, '\\$&')}`);
      assert.ok(pattern.test(dispatcher), `${call} must be wrapped by safely()`);
    }
  });
});

describe('every wired surface reports through the one dispatcher', () => {
  test('each integration point calls feedback.on(...)', () => {
    for (const file of WIRED_SURFACES) {
      assert.ok(
        /feedback\.on\(/.test(read(file)),
        `${file} is listed as an integration point but reports nothing`,
      );
    }
  });

  test('no surface reaches past the dispatcher into the policy modules', () => {
    // The whole point of one dispatch module: a call site says *what
    // happened*, never *how it should feel*.
    const offenders: string[] = [];
    for (const file of WIRED_SURFACES) {
      const source = read(file);
      if (/\b(VoiceThrottle|hapticFor|voicePhrase|HapticPattern)\b/.test(source)) {
        offenders.push(file);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these bypass the event→feedback mapping: ${offenders.join(', ')}`,
    );
  });
});

describe('zero-touch boundaries (Phase 3b is a feedback layer only)', () => {
  test('the offline queue core carries no feedback import', () => {
    // `OfflineSyncBanner.tsx` lives in the same folder and IS wired — it is
    // presentation. The queue itself must stay untouched.
    for (const file of [
      'src/features/crew/offline/queue-core.ts',
      'src/features/crew/offline/attendance-queue.ts',
      'src/features/crew/offline/attendance-sync.ts',
      'src/features/crew/offline/useOfflineAction.ts',
    ]) {
      assert.ok(
        !/crew-feedback|crew-voice|crew-haptics/.test(read(file)),
        `${file} is zero-touch in Phase 3b`,
      );
    }
  });

  test('the SOS idempotency lifecycle carries no feedback import', () => {
    assert.ok(
      !/crew-feedback|crew-voice|crew-haptics/.test(read('src/features/crew/sos-flow.ts')),
      'key mint/rotate is business logic, not feedback',
    );
  });

  test('the hold-to-confirm timing controller is untouched', () => {
    const hold = read('src/features/crew/hold-to-confirm.ts');
    assert.ok(!/crew-feedback|crew-voice|crew-haptics/.test(hold));
    // The haptic is fired by the *component* on press-in; the timing brain
    // stays a pure clock, so `hold-to-confirm.spec.ts` needs no edit.
    assert.ok(hold.includes('HOLD_DURATION_MS = 900'), 'the 900 ms hold is unchanged');
  });
});
