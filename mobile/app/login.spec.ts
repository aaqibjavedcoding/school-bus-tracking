import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { loginText, loginTouch, touch } from '../src/theme/tokens.ts';
import { typography } from '@school-bus-tracking/design-tokens';

/**
 * The login screen's contract, pinned without a device.
 *
 * Two kinds of assertion, because the screen has two kinds of risk:
 *
 * 1. **Token values** — imported from `theme/tokens.ts` and compared to the
 *    numbers the design pass specified (title 24, labels 16, input values 18,
 *    PIN digits 28, 48 dp touch floor). A token that drifts fails here.
 * 2. **Source wiring** — the login screen is mostly JSX, which no unit test can
 *    render here, so the *seams* are asserted against the source: which
 *    components the screen mounts, which fields the crew card contains, and
 *    which token each style uses. This is the same filesystem-guard approach
 *    `i18n-literals.spec.ts` and `theme/legibility.spec.ts` already take.
 *
 * What is deliberately NOT asserted here: the network behaviour of the crew PIN
 * submission. That lives in `src/features/crew/crew-login-flow.spec.ts` (the
 * body shape) and in the server's `crew-auth.service.spec.ts` (what happens to
 * it), so it is pinned exactly once, where it can be exercised for real.
 */

const read = (path: string): string => readFileSync(`${process.cwd()}/${path}`, 'utf8');

const loginSource = () => read('app/login.tsx');
const pinPadSource = () => read('src/features/crew/CrewPinPad.tsx');
const languageSource = () => read('src/components/LanguageSwitcher.tsx');

describe('login screen type scale', () => {
  it('matches the specified sizes, and reuses the shared scale where it has a step', () => {
    assert.equal(loginText.cardTitle, 24);
    assert.equal(loginText.label, 16);
    assert.equal(loginText.inputValue, 18);
    assert.equal(loginText.pinDigit, 28);

    // Three of the four are existing shared tokens; only the 28 dp PIN digit
    // is a local addition, because the shared scale steps 24 → 30.
    assert.equal(loginText.cardTitle, typography.fontSizes['2xl']);
    assert.equal(loginText.label, typography.fontSizes.base);
    assert.equal(loginText.inputValue, typography.fontSizes.lg);
    const sharedSizes = Object.values(typography.fontSizes) as number[];
    assert.ok(
      !sharedSizes.includes(loginText.pinDigit),
      'the PIN digit is the one value the shared scale does not have',
    );
  });

  it('wires those tokens into the screen and the pad, not hardcoded numbers', () => {
    const login = loginSource();
    for (const token of ['loginText.cardTitle', 'loginText.label', 'loginText.inputValue']) {
      assert.ok(login.includes(token), `app/login.tsx must size text with ${token}`);
    }
    const pad = pinPadSource();
    assert.ok(pad.includes('loginText.pinDigit'), 'the PIN digits must use loginText.pinDigit');
  });

  it('applies the bigger input size to every field on both cards', () => {
    const login = loginSource();
    // Three email fields + the crew school field, all carrying the override.
    assert.equal(
      login.match(/style=\{styles\.fieldInput\}/g)?.length ?? 0,
      4,
      'every Field on the login screen gets the 18 dp input size',
    );
    assert.ok(
      /fieldInput:\s*\{[^}]*fontSize: loginText\.inputValue/.test(login),
      'styles.fieldInput is the 18 dp override',
    );
  });
});

describe('login screen touch targets', () => {
  it('floors every tappable row at 48 dp and keeps the in-app floors untouched', () => {
    assert.equal(loginTouch.min, 48);
    assert.equal(loginTouch.chip, 48);
    assert.equal(loginTouch.menuRow, 48);
    // The shared in-app floors are other screens' business and must not move.
    assert.equal(touch.compact, 44);
    assert.equal(touch.target, 56);
    assert.equal(touch.field, 64);
  });

  it('makes the PIN pad full-width square cells instead of fixed boxes', () => {
    // Scoped to the StyleSheet block: `key: { kind: 'digit' … }` also appears in
    // the pad's TypeScript, and matching that instead would pass on a screen
    // whose keys were still fixed-size boxes.
    const pad = pinPadSource();
    const sheet = pad.slice(pad.indexOf('const styles = StyleSheet.create({'));
    const keyStyle = /\n {2}key: \{[^}]*\}/s.exec(sheet)?.[0] ?? '';
    assert.ok(keyStyle.length > 0, 'the pad stylesheet declares a `key` style');
    assert.match(keyStyle, /flex: 1/, 'each key takes a third of the card width');
    assert.match(keyStyle, /aspectRatio: 1/, 'and stays square at any screen size');
    assert.match(keyStyle, /minHeight: loginTouch\.min/, 'with the 48 dp floor as a backstop');
    assert.ok(!/width: 64/.test(keyStyle), 'the old fixed 64×56 box must be gone');
  });

  it('gives the PIN/QR tabs and the language control the same floor', () => {
    const login = loginSource();
    const tabStyle = /submodeTab:\s*\{[^}]*\}/s.exec(login)?.[0] ?? '';
    assert.match(tabStyle, /minHeight: loginTouch\.min/);

    const language = languageSource();
    assert.match(language, /minHeight: loginTouch\.chip/, 'the closed dropdown chip');
    assert.match(language, /minHeight: loginTouch\.menuRow/, 'and every row inside it');
  });
});

describe('crew card asks for a school code and a PIN only', () => {
  it('has no user-id field, state or wire field left in the screen', () => {
    const login = loginSource();
    for (const gone of [
      'crewUserId',
      'userIdLabel',
      'userIdPlaceholder',
      'userIdHint',
      'user_id',
    ]) {
      assert.ok(!login.includes(gone), `app/login.tsx still mentions ${gone}`);
    }
  });

  it('keeps exactly one text field on the crew card — the school code', () => {
    const login = loginSource();
    const crewCard = login.slice(
      login.indexOf('const renderCrewPath'),
      login.indexOf('renderEmailPath'),
    );
    assert.equal(
      crewCard.match(/<Field/g)?.length ?? 0,
      1,
      'the crew card is a school field plus the PIN pad, nothing else',
    );
    assert.ok(crewCard.includes('id="crew-school"'), 'and that field is the school code');
  });

  it('builds the request from the two-field draft helper', () => {
    const login = loginSource();
    assert.match(login, /buildCrewPinDraft\(\{\s*schoolId: crewSchoolId,\s*pin,?\s*\}\)/);
  });

  it('keeps the amber lockout card with its countdown and the red error card', () => {
    const login = loginSource();
    assert.ok(login.includes('styles.lockoutCard'), 'the amber lockout card is still rendered');
    assert.ok(login.includes('styles.lockoutCountdown'), 'with a countdown');
    assert.ok(login.includes('styles.errorCard'), 'and the red error card');
    // The amber/red surfaces are pinned for WCAG AA in theme/contrast.spec.ts.
    assert.match(login, /backgroundColor: '#FEF3C7'/);
    assert.match(login, /backgroundColor: '#FEE2E2'/);
  });
});

describe('language is one dropdown, not a row of pills', () => {
  it('mounts a single LanguageMenu on the login screen', () => {
    const login = loginSource();
    assert.equal(login.match(/<LanguageMenu \/>/g)?.length ?? 0, 1);
    assert.ok(!login.includes('LanguagePillRow'), 'the pill row is gone from the screen');
  });

  it('no longer exports a pill row, so the pattern cannot come back by import', () => {
    assert.ok(!languageSource().includes('LanguagePillRow'));
    assert.ok(!read('src/components/index.ts').includes('LanguagePillRow'));
  });

  it('is a chip that opens a menu, with the three locales and a tick on the active one', () => {
    const language = languageSource();
    // Chip: globe + current label + caret. Menu: one row per locale.
    assert.match(language, /name="language"/);
    assert.match(language, /open \? 'chevron-up' : 'chevron-down'/);
    assert.match(language, /SUPPORTED_LOCALES\.map/);
    assert.match(language, /selected \? 'checkmark' : 'language'/);
    assert.match(language, /accessibilityState=\{\{ expanded: open \}\}/);
  });

  it('persists through the existing provider call, with no new dependency', () => {
    const language = languageSource();
    assert.match(
      language,
      /setLocale\(option\)/,
      'selecting uses the same setLocale as the Help screen',
    );
    // Checked on the import lines only: the doc comment explains *why* there is
    // no `Modal`, so the word appears in prose by design.
    const imports = language
      .split('\n')
      .filter((line) => /^import |^} from |from '.*';?$/.test(line.trim()))
      .join('\n');
    assert.ok(
      !/@react-native-picker|@gorhom|Modal/.test(imports),
      'no picker library and no RN Modal — a Pressable plus an absolutely-positioned menu',
    );
    assert.match(language, /position: 'absolute'/, 'the menu is absolutely positioned');
    assert.match(language, /from '..\/lib\/i18n'/, 'locale state still comes from the i18n module');
  });
});
