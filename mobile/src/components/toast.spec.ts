import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The wiring guard for "errors render above modals immediately" (the toast
 * stacking/z-order half of the assignments fix).
 *
 * Root cause of the old behaviour: a React Native `Modal` paints in its own
 * window **above the app window**, so a toast mounted in the app window could
 * never cover a `FormSheet` / picker / confirm dialog — an error fired from
 * inside the sheet was hidden behind it. The fix: the provider owns the toast
 * state and the default (bottom) viewport, while every modal window mounts a
 * second, `top`-placed {@link ToastViewport} *inside itself*, above the sheet
 * that produced the message.
 *
 * This spec pins that wiring in source so the next modal cannot ship without
 * its own viewport.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

describe('toast state lives in one provider', () => {
  const source = read('src/components/Toast.tsx');

  it('the provider owns the live toast and the default (bottom) viewport', () => {
    assert.ok(source.includes('ToastContext.Provider'), 'state is published through a context');
    // The provider mounts the default viewport once — app-window level, so
    // screens without a modal see the toast in its normal position.
    assert.ok(
      /<ToastViewport\s*\/>/.test(source),
      'the provider renders the default (bottom) viewport itself',
    );
  });

  it('the viewport supports top placement for modal windows', () => {
    assert.ok(
      source.includes("placement = 'bottom'"),
      'bottom stays the default; top is opt-in for modals',
    );
    assert.match(source, /top/);
  });
});

describe('every modal window mounts its own top viewport', () => {
  const forms = read('src/components/forms.tsx');
  const modalComponents = ['FormSheet', 'ConfirmDialog'];

  it('forms.tsx hosts a top viewport in each of its modal windows', () => {
    const viewports = forms.match(/<ToastViewport placement="top" \/>/g) ?? [];
    assert.ok(
      viewports.length >= 3,
      `FormSheet, the Select picker and ConfirmDialog each need a top viewport (found ${viewports.length})`,
    );
  });

  it('each modal component in forms.tsx renders inside the viewport-bearing part of the file', () => {
    // Structural check: every modal component is exported and the file
    // imports the viewport — the count assertion above pins the instances.
    for (const name of modalComponents) {
      assert.ok(forms.includes(`export const ${name}`), `${name} must stay in forms.tsx`);
    }
    assert.ok(forms.includes("import { ToastViewport } from './Toast'"), 'viewport import');
  });

  it('the root layout keeps the app-window viewport (the provider) mounted', () => {
    const layout = read('app/_layout.tsx');
    assert.ok(layout.includes('<ToastProvider>'), 'the provider stays in the root layout');
  });
});
