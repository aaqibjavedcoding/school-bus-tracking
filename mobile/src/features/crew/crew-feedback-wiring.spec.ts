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

/**
 * Source with the comments removed.
 *
 * These modules *document* the native APIs they deliberately never call —
 * `crew-voice.ts` explains why it does not import `expo-speech`, the Sound card
 * explains why the engine's own note is honest — so a guard about **calls** has
 * to read code, not prose. Same device `i18n-literals.spec.ts` uses.
 */
function code(path: string): string {
  return read(path).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/** Every file allowed to import a Phase-3b native module. */
const NATIVE_OWNER = 'src/features/crew/crew-feedback-native.ts';

const FEEDBACK_MODULES = [
  'src/features/crew/crew-voice.ts',
  'src/features/crew/crew-haptics.ts',
  'src/features/crew/crew-feedback.ts',
  'src/features/crew/feedback-preferences.ts',
  // Batch 3C: the next-stop announcement policy is pure like the rest, so the
  // whole "when does the bus talk about stops" behaviour is spec-covered.
  'src/features/crew/next-stop-announcer.ts',
];

/** Call sites wired in Phase 3b (and by batch 3C). */
const WIRED_SURFACES = [
  'src/features/crew/ManifestList.tsx',
  'src/features/crew/TripStatusActions.tsx',
  'src/features/crew/SosPanel.tsx',
  'src/features/crew/HoldToConfirmButton.tsx',
  'src/features/crew/GpsShareStrip.tsx',
  'src/features/crew/offline/OfflineSyncBanner.tsx',
  // Batch 3C — ONE announcer call site, used by both crew roles (the trip
  // screen is shared, so there is no per-role wiring to drift).
  'src/features/crew/useNextStopAnnouncements.ts',
];

/** Every file that could be tempted to ask the TTS engine something itself. */
const VOICE_SURFACES = [
  ...FEEDBACK_MODULES,
  ...WIRED_SURFACES,
  'src/features/crew/FeedbackProvider.tsx',
  'src/features/crew/SoundSettingsCard.tsx',
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
  test('no `await` on a speech or haptic DELIVERY call anywhere in the feature', () => {
    // Delivery only. `Speech.getAvailableVoicesAsync()` is awaited by design in
    // the memoised capability probe — it is not on any action's path, it runs
    // once per process, and the next describe pins both facts.
    const delivery =
      /await\s+(Speech\.(speak|stop|pause|resume)|Haptics\.(impactAsync|notificationAsync|selectionAsync))\b/;
    const offenders: string[] = [];
    for (const file of [...FEEDBACK_MODULES, ...WIRED_SURFACES, NATIVE_OWNER]) {
      for (const [index, line] of read(file).split('\n').entries()) {
        if (delivery.test(line)) {
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

describe('the TTS engine is asked once, in one file, and the answer is cached', () => {
  test('only `crew-feedback-native.ts` probes the installed voices', () => {
    // Batch 3C's performance rule: capability detection is a native round-trip,
    // so it belongs to the seam and nowhere else — a screen that probed per
    // render would make the app slower than the feature is worth.
    const offenders = VOICE_SURFACES.filter((file) => /getAvailableVoicesAsync/.test(code(file)));
    assert.deepEqual(
      offenders,
      [],
      `these ask the engine directly instead of reading the cache: ${offenders.join(', ')}`,
    );
    assert.ok(/getAvailableVoicesAsync/.test(code(NATIVE_OWNER)), 'the wrapper owns the probe');
  });

  test('the probe is memoised — a second caller shares the one round-trip', () => {
    const native = read(NATIVE_OWNER);
    assert.ok(
      /let capabilityProbe: Promise<VoiceCapabilitySet \| null> \| null = null;/.test(native),
      'the memo lives in the native seam',
    );
    assert.ok(/if \(capabilityProbe === null\)/.test(native), 'it is checked before probing');
  });

  test('a failed probe is not cached as "this phone has no voices"', () => {
    assert.ok(
      /capabilityProbe = null;/.test(read(NATIVE_OWNER)),
      'an unmeasured phone must not be told it is missing a voice',
    );
  });

  test('the policy layer resolves from the cache and imports no native module', () => {
    const voice = code('src/features/crew/crew-voice.ts');
    assert.ok(!/expo-speech/.test(voice), 'crew-voice.ts stays loadable under node --test');
    assert.ok(/export function configureVoiceCapabilities/.test(voice), 'the cache seam exists');
    assert.ok(
      /export function resolveVoicePlan/.test(voice),
      'ONE resolver — the driver and the conductor cannot have two',
    );
  });

  test('the React layer publishes the probe result instead of repeating it', () => {
    const provider = code('src/features/crew/FeedbackProvider.tsx');
    assert.ok(
      /void detectVoiceCapabilities\(\)/.test(provider),
      'fire-and-forget: the voice channel works while the probe is in flight',
    );
  });

  test('the Sound card reads the resolver, never the engine', () => {
    const card = code('src/features/crew/SoundSettingsCard.tsx');
    assert.ok(/resolveVoicePlan\(/.test(card), 'the hint comes from the shared resolver');
    assert.ok(!/getAvailableVoicesAsync|expo-speech/.test(card));
  });
});

describe('one announcer, both crew roles (batch 3C)', () => {
  test('the shared trip screen wires it exactly once', () => {
    const trip = code('app/(crew)/trip.tsx');
    assert.equal(
      trip.match(/useNextStopAnnouncements\(/g)?.length,
      1,
      'a per-role copy would announce every stop twice for one of the roles',
    );
  });

  test('the role never reaches the announcer or its glue', () => {
    for (const file of [
      'src/features/crew/next-stop-announcer.ts',
      'src/features/crew/useNextStopAnnouncements.ts',
    ]) {
      assert.ok(
        !/\bisDriver\b|UserRole/.test(code(file)),
        `${file} must stay role-free — the conductor boards the same kids the driver carries`,
      );
    }
  });

  test('the announcer reports through the dispatcher, never into the engine', () => {
    const hook = code('src/features/crew/useNextStopAnnouncements.ts');
    assert.ok(/feedback\.on\(event\)/.test(hook), 'the Voice switch and the throttle gate it');
    assert.ok(!/await\s+feedback\.on/.test(hook), 'and it is never awaited');
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
