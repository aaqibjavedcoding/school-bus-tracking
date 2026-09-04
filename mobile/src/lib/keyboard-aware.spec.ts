import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  KEYBOARD_REVEAL_PADDING,
  keyboardBehavior,
  keyboardTopEdge,
  returnKeyForField,
  scrollOffsetToRevealInput,
} from './keyboard-aware.ts';

describe('keyboardBehavior', () => {
  it('pads on iOS, which does not resize the window', () => {
    assert.equal(keyboardBehavior('ios'), 'padding');
  });

  it('uses height on Android so the resized window is not double-counted', () => {
    assert.equal(keyboardBehavior('android'), 'height');
  });

  it('is inert on web', () => {
    assert.equal(keyboardBehavior('web'), undefined);
  });
});

describe('keyboardTopEdge', () => {
  it('is the window bottom while the keyboard is closed', () => {
    assert.equal(keyboardTopEdge(800, 0), 800);
  });

  it('sits above an open keyboard', () => {
    assert.equal(keyboardTopEdge(800, 300), 500);
  });
});

describe('scrollOffsetToRevealInput', () => {
  const base = { viewportTop: 0, scrollY: 0, keyboardTop: 500 };

  it('does not scroll when the input is already fully visible', () => {
    assert.equal(
      scrollOffsetToRevealInput({ ...base, inputTop: 100, inputBottom: 150 }),
      null,
      'a comfortably visible input must not cause a jump',
    );
  });

  it('scrolls a password field out from behind the keyboard', () => {
    // Input bottom 540 is 40px below the keyboard top (500); +16px padding.
    const offset = scrollOffsetToRevealInput({ ...base, inputTop: 490, inputBottom: 540 });
    assert.equal(offset, 56);
  });

  it('accounts for the current scroll offset', () => {
    const offset = scrollOffsetToRevealInput({
      ...base,
      scrollY: 100,
      inputTop: 490,
      inputBottom: 540,
    });
    assert.equal(offset, 156);
  });

  it('scrolls back down when the input is pushed above the viewport', () => {
    const offset = scrollOffsetToRevealInput({
      ...base,
      viewportTop: 40,
      scrollY: 200,
      inputTop: 20,
      inputBottom: 66,
    });
    // Needs 40 + 16 - 20 = 36 less scroll.
    assert.equal(offset, 164);
  });

  it('never scrolls above the top of the form', () => {
    const offset = scrollOffsetToRevealInput({
      ...base,
      viewportTop: 40,
      scrollY: 5,
      inputTop: 0,
      inputBottom: 46,
    });
    assert.equal(offset, 0);
  });

  it('gives up when the keyboard leaves no usable viewport', () => {
    assert.equal(
      scrollOffsetToRevealInput({
        inputTop: 10,
        inputBottom: 60,
        keyboardTop: 100,
        viewportTop: 120,
        scrollY: 0,
      }),
      null,
    );
  });

  it('keeps a padding gap between the input and the keyboard', () => {
    const offset = scrollOffsetToRevealInput({
      ...base,
      inputTop: 450,
      inputBottom: 500,
    });
    assert.equal(offset, KEYBOARD_REVEAL_PADDING);
  });

  it('is stable: re-running against the produced offset asks for no further scroll', () => {
    const first = scrollOffsetToRevealInput({ ...base, inputTop: 490, inputBottom: 540 });
    assert.ok(first !== null);
    // After scrolling by `first`, the input has moved up by the same amount.
    const second = scrollOffsetToRevealInput({
      ...base,
      scrollY: first,
      inputTop: 490 - first,
      inputBottom: 540 - first,
    });
    assert.equal(second, null, 'must settle in one scroll — no oscillation');
  });
});

describe('returnKeyForField', () => {
  it('chains to the next field', () => {
    assert.equal(returnKeyForField(false), 'next');
  });

  it('submits from the last field', () => {
    assert.equal(returnKeyForField(true), 'done');
  });
});
