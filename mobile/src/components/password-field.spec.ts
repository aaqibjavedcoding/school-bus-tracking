import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { maskCommentsAndStrings } from './scroll-owner.ts';
import { SUPPORTED_LOCALES, dictionary } from '../lib/i18n.ts';

/**
 * The wiring guard for the password / PIN visibility requirement: a show/
 * hide eye inside every password input, and a show/hide switch on the crew
 * PIN pad — tapping each one actually flips the visibility, and the control
 * always shows the state the next tap will produce.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(mobileRoot, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(mobileRoot, relative)).isDirectory()) listFiles(relative, out);
    else out.push(relative);
  }
  return out;
}

describe('PasswordField — the one password input', () => {
  const source = read('src/components/ui.tsx');

  it('owns secureTextEntry: secure by default, the eye is the only switch', () => {
    assert.ok(
      source.includes('const [visible, setVisible] = useState(false)'),
      'hidden by default, like secureTextEntry',
    );
    assert.ok(source.includes('secureTextEntry={!visible}'), 'the eye flips the secure flag');
  });

  it('the glyph and the accessibility label match the state', () => {
    assert.ok(source.includes("'eye-off-outline'"), 'open eye while hidden…');
    assert.ok(source.includes("'eye-outline'"), '…closed eye while visible');
    assert.ok(source.includes("t('common.showPassword')"), 'label names the next action');
    assert.ok(source.includes("t('common.hidePassword')"), 'label names the next action');
  });

  it('every locale ships both labels', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const dict = dictionary(locale) as Record<string, string>;
      assert.ok(dict['common.showPassword']?.trim(), `${locale}: common.showPassword`);
      assert.ok(dict['common.hidePassword']?.trim(), `${locale}: common.hidePassword`);
      assert.notEqual(dict['common.showPassword'], dict['common.hidePassword']);
    }
  });
});

describe('every password field in the app is a PasswordField', () => {
  it('no screen keeps a raw secureTextEntry Field', () => {
    const violations: string[] = [];
    const files = listFiles('app').filter((path) => path.endsWith('.tsx'));
    for (const file of files) {
      const source = maskCommentsAndStrings(read(file));
      // Masking blanks strings/comments, so what remains is live JSX.
      if (/secureTextEntry/.test(source)) {
        violations.push(`${file}: a secureTextEntry prop survived the PasswordField migration`);
      }
    }
    assert.deepEqual(violations, [], violations.join('\n'));
  });

  it('the password screens use the shared field', () => {
    for (const file of [
      'app/login.tsx',
      'app/(admin)/manage/guardians.tsx',
      'app/(admin)/manage/staff.tsx',
    ]) {
      assert.ok(read(file).includes('<PasswordField'), `${file} uses <PasswordField`);
    }
  });
});

describe('crew PIN pad shows and hides the digits', () => {
  const source = read('src/features/crew/CrewPinPad.tsx');

  it('has a visibility switch with localised labels', () => {
    assert.ok(
      /const \[showPin, setShowPin\] = useState\(false\)/.test(source),
      'hidden by default',
    );
    assert.ok(source.includes("t('login.crewPath.pin.show')"), 'label to reveal');
    assert.ok(source.includes("t('login.crewPath.pin.hide')"), 'label to conceal');
  });

  it('renders the typed digits only while revealed', () => {
    assert.ok(
      source.includes('filled && showPin'),
      'digits appear in the cells only when showPin is on',
    );
  });

  it('keeps the digits out of the screen reader', () => {
    assert.ok(
      source.includes('importantForAccessibility="no-hide-descendants"'),
      'a screen reader must never read the PIN aloud',
    );
  });

  it('every locale ships the PIN show/hide labels', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const dict = dictionary(locale) as Record<string, string>;
      assert.ok(dict['login.crewPath.pin.show']?.trim(), `${locale}: login.crewPath.pin.show`);
      assert.ok(dict['login.crewPath.pin.hide']?.trim(), `${locale}: login.crewPath.pin.hide`);
    }
  });
});
