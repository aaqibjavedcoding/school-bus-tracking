import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { en } from '../../lib/i18n.en.ts';
import { budgetFor } from '../../lib/i18n-budget.ts';
import { SUPPORTED_LOCALES, dictionary, type TranslationKey } from '../../lib/i18n.ts';

/**
 * Where "My Profile" lives and what it is allowed to do — a source scanner in
 * the family of `help-routing.spec.ts` and `crew-feedback-wiring.spec.ts`.
 *
 * ### Rewritten with the read-back (this change)
 *
 * This file used to pin the opposite of what the feature needed. It asserted
 * that the card is rendered by `app/(crew)/help.tsx` and that
 * `app/(crew)/_layout.tsx` contains no route called `profile` — which
 * described the shipped state, not a requirement. The consequence was the
 * bug: Help is reached from a link the trip screen renders only **after**
 * today's trip has loaded, so on a day off, before the first dispatch, or in
 * the first seconds after login, the photo card could not be reached at all.
 *
 * The rules are now written as requirements:
 *
 * - the card has its own route, opened from the header of every crew screen,
 *   so it is reachable with no active trip and immediately after login;
 * - the **crew tab bar is still exactly four driving actions** — that part of
 *   the old spec was a real constraint and is kept verbatim;
 * - the school admin, who may own a photo too ([DECISION 1]), has the same
 *   card in their own navigator, which is why the feature now lives in
 *   `features/profile` rather than `features/crew`;
 * - the photo comes from the server, with AsyncStorage demoted to an offline
 *   cache keyed by the storage key;
 * - and the parts that were already right are unchanged: `expo-camera` only
 *   (no new native dependency, no gallery), online-only with one manual
 *   retry, and every word through `t()`.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(`${mobileRoot}${path}`, 'utf8');

/** Source with comments removed — a guard about calls must read code. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const CARD = 'src/features/profile/ProfilePhotoCard.tsx';
const LOGIC = 'src/features/profile/profile-photo.ts';
const SOURCE = 'src/features/profile/profile-photo-source.ts';
const STORAGE = 'src/features/profile/profile-photo-storage.ts';
const HEADER_BUTTON = 'src/features/profile/ProfileHeaderButton.tsx';
const PHOTO_HOOK = 'src/features/profile/useProfilePhoto.ts';
const CREW_LAYOUT = 'app/(crew)/_layout.tsx';
const CREW_SCREEN = 'app/(crew)/profile.tsx';
const ADMIN_LAYOUT = 'app/(admin)/_layout.tsx';
const ADMIN_SCREEN = 'app/(admin)/profile.tsx';

/** The five strings this feature was allowed to add. */
const PROFILE_KEYS: TranslationKey[] = [
  'profile.title',
  'profile.takePhoto',
  'profile.removePhoto',
  'profile.updated',
  'profile.error',
];

describe('the card is reachable with no trip and right after login', () => {
  test('the crew group has a profile route that renders the card', () => {
    const screen = code(CREW_SCREEN);
    assert.match(
      screen,
      /import \{ ProfilePhotoCard \} from '\.\.\/\.\.\/src\/features\/profile'/,
      'the screen mounts the shared card',
    );
    assert.match(screen, /<ProfilePhotoCard\s*\/>/, 'the route must render <ProfilePhotoCard />');
  });

  test('it is opened from the header, which every crew screen shows', () => {
    const layout = code(CREW_LAYOUT);
    assert.ok(layout.includes('ProfileHeaderButton'), 'the header carries the profile action');
    assert.match(
      layout,
      /href="\/\(crew\)\/profile"/,
      'the header action points at the crew profile route',
    );
    // The header belongs to `screenOptions`, i.e. to every screen of the
    // navigator — NOT to one screen that needs a loaded trip first.
    const headerIndex = layout.indexOf('headerRight');
    const optionsIndex = layout.indexOf('screenOptions');
    assert.ok(
      optionsIndex >= 0 && headerIndex > optionsIndex,
      'the profile action must live in screenOptions, not on a single screen',
    );
    assert.match(
      layout,
      /<Tabs\.Screen\s+name="profile"[\s\S]{0,160}href: null/,
      'the profile route is registered and hidden from the bar',
    );
  });

  test("nothing about reaching it depends on today's trip", () => {
    const screen = code(CREW_SCREEN);
    assert.ok(
      !/useCrewToday|trip\?\.|data\?\.trip/.test(screen),
      'the profile screen must render without a dispatched trip',
    );
    const header = code(HEADER_BUTTON);
    assert.ok(
      !/useCrewToday|trip/.test(header),
      'the header action must not wait for a trip either',
    );
  });

  test('the crew tab bar still has exactly its four driving actions', () => {
    const layout = read(CREW_LAYOUT);
    assert.equal(
      layout.match(/tabBarLabel:/g)?.length ?? 0,
      4,
      'the crew bar stays at four labelled actions',
    );
    // The profile route exists, but never as a tab: every hidden route in
    // this navigator is `href: null`.
    const profileScreen = /<Tabs\.Screen\s+name="profile"[\s\S]*?\/>/.exec(layout)?.[0] ?? '';
    assert.ok(profileScreen.includes('href: null'), 'My Profile must not add a crew tab');
    assert.ok(!profileScreen.includes('tabBarLabel'), 'My Profile must not be labelled in the bar');
  });

  test('the school admin gets the same card in their own navigator', () => {
    // [DECISION 1]: a school admin may own a profile photo, so the mobile
    // console needs a surface for it — the same one, not a copy.
    const screen = code(ADMIN_SCREEN);
    assert.match(
      screen,
      /import \{ ProfilePhotoCard \} from '\.\.\/\.\.\/src\/features\/profile'/,
      'the admin screen mounts the shared card',
    );
    assert.match(screen, /<ProfilePhotoCard\s*\/>/);
    const layout = code(ADMIN_LAYOUT);
    assert.ok(layout.includes('ProfileHeaderButton'), 'the admin header carries the action');
    assert.match(layout, /href="\/\(admin\)\/profile"/);
    assert.match(
      layout,
      /<Tabs\.Screen\s+name="profile"[\s\S]{0,120}href: null/,
      'hidden from the admin tab bar, like every pushed admin route',
    );
  });

  test('shared logic left features/crew — it serves more than one role now', () => {
    for (const path of [CARD, LOGIC, SOURCE, STORAGE, HEADER_BUTTON, PHOTO_HOOK]) {
      assert.ok(path.startsWith('src/features/profile/'), `${path} must live in features/profile`);
    }
    assert.ok(
      !code('src/features/crew/index.ts').includes("from './profile-photo'"),
      'the crew barrel must no longer own the profile feature',
    );
  });

  test('the card shows the photo or a placeholder avatar — never a broken image', () => {
    const card = code(CARD);
    assert.ok(
      card.includes('profileAvatarPresentation'),
      'the avatar comes from the pure resolver',
    );
    assert.match(card, /kind === 'photo'/, 'the photo branch is rendered from the resolution');
    assert.match(card, /name="person"/, 'the fallback is the neutral person icon');
  });
});

describe("the photo comes from the server, not from this phone's memory", () => {
  test('the card resolves the photo from the session key through the API', () => {
    const card = code(CARD);
    assert.ok(card.includes('useProfilePhoto'), 'the bytes are fetched, not remembered');
    assert.ok(
      card.includes('profile_photo_key'),
      'the session key decides which photo this account has',
    );
    const hook = code(PHOTO_HOOK);
    assert.ok(hook.includes('fetchProfilePhoto'), 'the hook calls the authenticated photo route');
    assert.match(hook, /from '\.\.\/\.\.\/services\/api'/, 'one API client for the whole app');
  });

  test('a confirmed change lands in the session, so every surface updates at once', () => {
    const card = code(CARD);
    assert.match(
      card,
      /profile_photo_key[\s\S]{0,400}applyProfilePhoto/,
      'the new key is pushed into the session from the API response',
    );
    assert.match(card, /applyProfilePhoto\(null, null\)/, 'a removal clears the session key too');
  });

  test('AsyncStorage is a cache keyed by storage key, and only the storage module touches it', () => {
    const storage = code(STORAGE);
    assert.match(storage, /AsyncStorage/, 'the cache uses the shared storage module');
    assert.ok(storage.includes('photoCacheKey'), 'entries are keyed by the storage key');
    for (const path of [CARD, HEADER_BUTTON, PHOTO_HOOK, LOGIC, SOURCE]) {
      assert.ok(
        !code(path).includes('AsyncStorage'),
        `${path} must go through the storage module, never AsyncStorage directly`,
      );
    }
  });

  test('the cache can never outrank the server', () => {
    const source = code(SOURCE);
    assert.ok(source.includes('resolvePhoto'), 'one pure resolver decides what is shown');
    // No key in the session means no photo, whatever the device cached.
    assert.match(source, /storageKey[\s\S]{0,200}kind: 'none'/);
  });
});

describe('camera only — no new native dependency, no gallery', () => {
  test('capture goes through the already-installed expo-camera', () => {
    const card = code(CARD);
    assert.match(card, /from 'expo-camera'/, 'the card uses expo-camera');
    assert.ok(card.includes('useCameraPermissions'), 'the OS permission is requested explicitly');
    assert.ok(card.includes('takePictureAsync'), 'the photo is taken in-app');
  });

  test('expo-camera is a dependency the app already had (no new install)', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    assert.match(pkg.dependencies['expo-camera'] ?? '', /^~?57\./, 'pinned to the SDK 57 line');
  });

  test('no image picker / file-system dependency was pulled in', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    for (const banned of ['expo-image-picker', 'expo-document-picker', 'expo-image-manipulator']) {
      assert.ok(!(banned in pkg.dependencies), `${banned} must not be a dependency`);
      assert.ok(!(banned in pkg.devDependencies), `${banned} must not be a dev dependency`);
    }
    for (const file of [CARD, LOGIC, SOURCE, STORAGE, HEADER_BUTTON, PHOTO_HOOK]) {
      assert.ok(
        !/image-picker|document-picker|launchImageLibrary/.test(read(file)),
        `${file} must not reach for a gallery picker`,
      );
    }
  });

  test('the native build declares the camera permission it will ask for', () => {
    const appJson = JSON.parse(read('app.json')) as {
      expo: { android: { permissions: string[] }; plugins: unknown[] };
    };
    assert.ok(
      appJson.expo.android.permissions.includes('android.permission.CAMERA'),
      'Android needs the CAMERA permission declared',
    );
    assert.match(
      JSON.stringify(appJson.expo.plugins),
      /expo-camera/,
      'the config plugin supplies NSCameraUsageDescription for iOS',
    );
  });
});

describe('online only: no offline queue for a low-stakes action', () => {
  test('the card never touches the durable attendance queue', () => {
    for (const file of [CARD, LOGIC, SOURCE, STORAGE]) {
      const source = code(file);
      assert.ok(
        !/from '\.\/offline|useOfflineAction|enqueue|shouldQueueAfterError|syncManager/.test(
          source,
        ),
        `${file} must not wire the offline queue`,
      );
    }
  });

  test('the state machine has no queued state at all', () => {
    const logic = code(LOGIC);
    assert.ok(!/'queued'/.test(logic), 'a queued status would promise a sync that never happens');
  });

  test('a failure offers a manual retry of exactly what failed', () => {
    const card = code(CARD);
    assert.ok(card.includes('retryAttempt'), 'the retry target comes from the pure helper');
    assert.match(card, /t\('common\.retry'\)/, 'the retry button reuses the shared label');
    // No timer, no interval, no reconnect listener: nothing retries by itself.
    assert.ok(
      !/setTimeout|setInterval|addEventListener|useNetworkStatus/.test(card),
      'nothing may retry in the background',
    );
  });

  test('the offline cache is the only persistence, and it is never a queue', () => {
    const storage = code(STORAGE);
    assert.ok(
      !/enqueue|pending|queue|syncManager/i.test(storage),
      'the cache stores bytes; it must not become a write queue',
    );
  });
});

describe('the account photo endpoints are used as-is', () => {
  test('the card calls the account photo endpoints through the shared client', () => {
    const card = code(CARD);
    assert.ok(card.includes('setAccountPhoto'), 'Take Photo does PUT /account/me/photo');
    assert.ok(card.includes('clearAccountPhoto'), 'Remove Photo does DELETE /account/me/photo');
    assert.match(card, /from '\.\.\/\.\.\/services\/api'/, 'one API client for the whole app');
  });

  test('Remove Photo stays available even when no photo is on screen', () => {
    // The server may hold a photo this phone never saw (re-install, second
    // device), so the button must not be hidden behind `state.photoUri`.
    const card = code(CARD);
    const removeButton = /label=\{t\('profile\.removePhoto'\)\}/.exec(card);
    assert.ok(removeButton, 'the Remove Photo button must exist');
    const before = card.slice(0, removeButton.index);
    assert.ok(
      !/photoUri \?[^?]*$/.test(before.slice(-200)),
      'Remove Photo must not be conditional on a locally known photo',
    );
  });

  test('only a server-confirmed change is applied anywhere', () => {
    const card = code(CARD);
    assert.match(
      card,
      /result\?\.profile_photo_key[\s\S]{0,200}dispatch\(\{ type: 'failed' \}\)/,
      'an upload without a key in the response is a failure, not a success',
    );
  });
});

describe('copy: five new strings, all localised', () => {
  test('the card renders every word through t()', () => {
    const card = code(CARD);
    for (const key of PROFILE_KEYS) {
      if (key === 'profile.updated' || key === 'profile.error') continue;
      assert.ok(card.includes(`t('${key}')`), `${key} must be rendered through t()`);
    }
    assert.ok(card.includes("t('profile.updated')"), 'the success message is localised');
    assert.ok(card.includes("t('profile.error')"), 'the error message is localised');
    assert.ok(card.includes('useTranslation()'), 'the card re-reads copy on a language switch');
  });

  test('the feature added exactly these five keys — no extra explanatory copy', () => {
    const keys = Object.keys(en).filter((key) => key.startsWith('profile.'));
    assert.deepEqual(keys.sort(), [...PROFILE_KEYS].sort());
  });

  test('all three locales carry them, and nobody left English behind', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const dict = dictionary(locale);
      for (const key of PROFILE_KEYS) {
        assert.ok(dict[key]?.trim().length, `${locale}:${key} is empty`);
        if (locale !== 'en') {
          assert.notEqual(dict[key], en[key], `${locale}:${key} is still the English string`);
        }
      }
    }
  });

  test('the two button labels carry a clipping budget in every locale', () => {
    for (const key of ['profile.takePhoto', 'profile.removePhoto'] as TranslationKey[]) {
      const budget = budgetFor(key);
      assert.equal(budget?.kind, 'buttonRow', `${key} is a button label and needs a budget`);
      for (const locale of SUPPORTED_LOCALES) {
        assert.ok(
          dictionary(locale)[key].length <= budget!.maxChars,
          `${locale}:${key} is ${dictionary(locale)[key].length} chars, over ${budget!.maxChars}`,
        );
      }
    }
  });
});
