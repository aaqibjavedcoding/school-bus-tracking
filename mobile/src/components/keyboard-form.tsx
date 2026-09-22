import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  keyboardBehavior,
  keyboardTopEdge,
  scrollOffsetToRevealInput,
} from '../lib/keyboard-aware';

/**
 * The ONE reusable keyboard-avoiding form wrapper for the mobile app.
 *
 * `KeyboardAvoidingView` alone only shrinks or pads the container — it never
 * scrolls a specific input into view, so on short screens (common on smaller
 * Android devices) the focused field stays hidden behind the keyboard. The
 * wrapper fixes that in two cooperating parts:
 *
 * 1. the **KAV** with the correct per-platform `behavior` (`padding` on iOS,
 *    `height` on Android — see `keyboardBehavior`; adding padding on Android
 *    would double-count the already-resized window);
 * 2. a **scroll view** that, whenever an input inside gains focus or the
 *    keyboard moves, scrolls the focused input clear of the keyboard
 *    (`scrollOffsetToRevealInput` owns the geometry).
 *
 * Inputs register themselves through {@link KeyboardFormContext}: `Field`,
 * `SearchBar`, the `DateTimeField` segments and the `Select` filter all call
 * `focusInput(node)` on focus, so **every** form field is covered without
 * each screen wiring its own listeners. `Screen`, `ListScreen`, `FormSheet`
 * and the `Select` picker provide the same context for their own scroll
 * containers; a full-screen form that is not one of those (the login screen)
 * is wrapped in this component directly.
 */

/** The slice of a `TextInput` the reveal math needs. */
export interface KeyboardFormInputNode {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

export interface KeyboardFormContextValue {
  /**
   * Called by a field when it gains focus, with the focused input node.
   * The nearest scrollable form scrolls it into the band above the keyboard.
   */
  focusInput: (node: KeyboardFormInputNode | null) => void;
}

export const KeyboardFormContext = createContext<KeyboardFormContextValue | null>(null);

/**
 * The nearest keyboard-aware scroll form, or `null` when this input renders
 * outside one (the input then simply does not auto-reveal — same as today).
 */
export function useKeyboardForm(): KeyboardFormContextValue | null {
  return useContext(KeyboardFormContext);
}

/** What the reveal machinery needs from a scroll container. */
interface ScrollContainerLike {
  scrollTo(options: { x?: number; y?: number; animated?: boolean }): void;
}

/**
 * Wires one scroll container to "keep the focused input above the keyboard":
 * keyboard listeners (platform-correct show/hide events), the focused-input
 * ref, the live scroll offset and the reveal calculation.
 *
 * Returns the context value to publish and the `onScroll` handler to attach.
 * Generic over the container so both `ScrollView` and `FlatList` scroll refs
 * work without casts.
 */
export function useKeyboardReveal<T extends ScrollContainerLike>(
  scrollRef: React.RefObject<T | null>,
): {
  contextValue: KeyboardFormContextValue;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const focusedInputRef = useRef<KeyboardFormInputNode | null>(null);
  const scrollYRef = useRef(0);
  const keyboardHeightRef = useRef(0);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const revealFocusedInput = useCallback(() => {
    const target = focusedInputRef.current;
    const scroller = scrollRef.current;
    if (!target || !scroller || typeof target.measureInWindow !== 'function') return;
    target.measureInWindow((_x: number, y: number, _width: number, height: number) => {
      const offset = scrollOffsetToRevealInput({
        inputTop: y,
        inputBottom: y + height,
        keyboardTop: keyboardTopEdge(windowHeight, keyboardHeightRef.current),
        viewportTop: insets.top,
        scrollY: scrollYRef.current,
      });
      if (offset === null) return;
      scroller.scrollTo({ y: offset, animated: true });
    });
  }, [scrollRef, windowHeight, insets.top]);

  const focusInput = useCallback(
    (node: KeyboardFormInputNode | null) => {
      if (node) focusedInputRef.current = node;
      // Reveal on the next frame: the focus event can fire before the
      // keyboard has moved, and the keyboard-show listener re-runs this.
      requestAnimationFrame(revealFocusedInput);
    },
    [revealFocusedInput],
  );

  useEffect(() => {
    // `will` events on iOS (animate while the keyboard slides), `did` on
    // Android (the window has already resized by then).
    const showEvents: Array<'keyboardWillShow' | 'keyboardDidShow'> =
      Platform.OS === 'ios' ? ['keyboardWillShow'] : ['keyboardDidShow'];
    const hideEvents: Array<'keyboardWillHide' | 'keyboardDidHide'> =
      Platform.OS === 'ios' ? ['keyboardWillHide'] : ['keyboardDidHide'];
    const subs = [
      ...showEvents.map((event) =>
        Keyboard.addListener(event, (payload: KeyboardEvent) => {
          keyboardHeightRef.current = payload.endCoordinates?.height ?? 0;
          revealFocusedInput();
        }),
      ),
      ...hideEvents.map((event) =>
        Keyboard.addListener(event, () => {
          keyboardHeightRef.current = 0;
        }),
      ),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, [revealFocusedInput]);

  const contextValue = useMemo(() => ({ focusInput }), [focusInput]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  return { contextValue, onScroll };
}

export interface KeyboardFormProps {
  children: React.ReactNode;
  /** KAV style — e.g. the login screen's dark, full-height background. */
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardDismissMode?: 'none' | 'on-drag' | 'interactive';
  keyboardShouldPersistTaps?: boolean | 'always' | 'handled' | 'never';
  showsVerticalScrollIndicator?: boolean;
}

/**
 * Full-screen keyboard-avoiding form: KAV + scroll view + reveal-on-focus,
 * published to every descendant input through the context.
 */
export const KeyboardForm: React.FC<KeyboardFormProps> = ({
  children,
  style,
  contentContainerStyle,
  keyboardDismissMode = 'on-drag',
  keyboardShouldPersistTaps = 'handled',
  showsVerticalScrollIndicator = false,
}) => {
  const scrollRef = useRef<ScrollView>(null);
  const { contextValue, onScroll } = useKeyboardReveal(scrollRef);
  return (
    <KeyboardFormContext.Provider value={contextValue}>
      <KeyboardAvoidingView style={[styles.flex, style]} behavior={keyboardBehavior(Platform.OS)}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={contentContainerStyle}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          keyboardDismissMode={keyboardDismissMode}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </KeyboardFormContext.Provider>
  );
};

const styles = {
  flex: { flex: 1 } as ViewStyle,
};
