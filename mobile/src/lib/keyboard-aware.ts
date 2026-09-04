/**
 * Pure geometry + platform helpers behind the keyboard-aware form scrolling
 * used by the login screen (and any other single-column form screen).
 *
 * Everything here is deliberately free of React Native imports so the maths
 * can be unit-tested in plain Node, exactly like the other `src/lib` helpers.
 *
 * The problem being solved: when a `TextInput` near the bottom of a form is
 * focused, the software keyboard slides up and covers it. `KeyboardAvoidingView`
 * alone only shrinks/pads the container — it does not scroll a specific input
 * into view, so on short screens (common on smaller Android devices) the
 * password field stayed hidden behind the keyboard and the user had to dismiss
 * the keyboard and tap again.
 */

/** Gap kept between the focused input and the top edge of the keyboard. */
export const KEYBOARD_REVEAL_PADDING = 16;

/**
 * `KeyboardAvoidingView`'s `behavior` for a given platform.
 *
 * - iOS has no native window resizing, so the view must add `padding` itself.
 * - Android resizes the window (`android.softwareKeyboardLayoutMode: 'resize'`,
 *   Expo's default), so adding padding on top would double-count the keyboard
 *   and produce the "excessive jump" the report describes. `height` lets the
 *   container track the already-resized window without compounding.
 */
export function keyboardBehavior(platform: string): 'padding' | 'height' | undefined {
  if (platform === 'ios') return 'padding';
  if (platform === 'android') return 'height';
  return undefined;
}

export interface RevealInputInput {
  /** Y of the input's top edge, in window coordinates. */
  inputTop: number;
  /** Y of the input's bottom edge, in window coordinates. */
  inputBottom: number;
  /** Y of the top edge of the keyboard, in window coordinates. */
  keyboardTop: number;
  /** Y of the top edge of the usable scroll viewport, in window coordinates. */
  viewportTop: number;
  /** Current vertical scroll offset of the scroll view. */
  scrollY: number;
  /** Gap to keep around the focused input. */
  padding?: number;
}

/**
 * Target scroll offset that brings a focused input fully into the visible band
 * between `viewportTop` and `keyboardTop`.
 *
 * Returns `null` when the input is already comfortably visible — the caller
 * then skips the `scrollTo` entirely, which is what prevents the jittery,
 * unwanted jumps when tapping between two inputs that both already fit.
 *
 * Positive scroll offsets move content up. The result is clamped at 0 so a
 * form that fits on screen never bounces above its own top.
 */
export function scrollOffsetToRevealInput(input: RevealInputInput): number | null {
  const padding = input.padding ?? KEYBOARD_REVEAL_PADDING;
  const { inputTop, inputBottom, keyboardTop, viewportTop, scrollY } = input;

  // A keyboard taller than the viewport leaves nothing to reveal into.
  if (keyboardTop <= viewportTop) return null;

  const overflowBelow = inputBottom + padding - keyboardTop;
  if (overflowBelow > 0) {
    // Input is (partly) behind the keyboard: scroll content up by the overlap.
    return Math.max(0, scrollY + overflowBelow);
  }

  const overflowAbove = viewportTop + padding - inputTop;
  if (overflowAbove > 0) {
    // Input is scrolled off the top (e.g. keyboard avoidance pushed it up).
    const next = Math.max(0, scrollY - overflowAbove);
    return next === scrollY ? null : next;
  }

  return null;
}

/**
 * Y of the keyboard's top edge given its height and the window height. When
 * the keyboard is closed (`height <= 0`) the whole window is usable.
 */
export function keyboardTopEdge(windowHeight: number, keyboardHeight: number): number {
  return keyboardHeight > 0 ? windowHeight - keyboardHeight : windowHeight;
}

/**
 * `returnKeyType` for a field: every field hands off to the next one, and the
 * last field submits the form.
 */
export function returnKeyForField(isLast: boolean): 'next' | 'done' {
  return isLast ? 'done' : 'next';
}
