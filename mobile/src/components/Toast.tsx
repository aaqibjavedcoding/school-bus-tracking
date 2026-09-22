import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import type { Tone } from '../lib/format';

/**
 * Minimal, dependency-free toast layer so CRUD mutations can confirm success
 * ("Bus added.") or surface a failure the same way the web console does with
 * its toast, without pulling in an animation library.
 *
 * ### Rendering above modals
 *
 * React Native `Modal`s draw in their own window, *above* everything the app
 * renders — a toast painted by the root provider therefore disappears behind
 * an open `FormSheet`, which is exactly how the "Route assignments are
 * read-only…" error went missing: pushed while the create sheet was still on
 * screen, visible only after the user backed out.
 *
 * The fix splits the layer in two:
 *
 * - the **provider** owns the toast state (message, tone, timer, opacity) and
 *   renders one viewport at the app root (the normal, bottom-centred toast);
 * - every modal surface (`FormSheet`, the `Select` picker, `ConfirmDialog`)
 *   renders an extra {@link ToastViewport} *inside* its own window, so the
 *   same toast also appears above the sheet that caused it — no error is
 *   ever hidden behind a form. Both viewports read the same state, so the
 *   toast animates once and stays in sync.
 */

type ToastTone = Extract<Tone, 'success' | 'danger' | 'info'>;

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (message: string, tone?: ToastTone) => void;
  /** The live toast, shared by every viewport. */
  toast: ToastMessage | null;
  /** Shared opacity so root and in-modal viewports animate as one. */
  opacity: Animated.Value;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_COLORS: Record<ToastTone, string> = {
  success: colors.secondary[700],
  danger: colors.status.danger,
  info: colors.neutral[800],
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const push = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      counter.current += 1;
      setToast({ id: counter.current, message, tone });
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start(() => setToast(null));
      }, 2600);
    },
    [opacity],
  );

  const value = useMemo(() => ({ push, toast, opacity }), [push, toast, opacity]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
};

/**
 * Renders the current toast. Mounted once by the provider (bottom-centred,
 * the app's normal position) and again inside every modal window (`top`
 * placement), where it sits above the sheet that produced the message.
 *
 * Renders nothing when no toast is live, so adding a viewport to a modal is
 * free when there is nothing to say.
 */
export const ToastViewport: React.FC<{ placement?: 'top' | 'bottom' }> = ({
  placement = 'bottom',
}) => {
  const ctx = useContext(ToastContext);
  if (!ctx || !ctx.toast) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[placement === 'top' ? styles.wrapTop : styles.wrapBottom, { opacity: ctx.opacity }]}
    >
      <View style={[styles.toast, { backgroundColor: TONE_COLORS[ctx.toast.tone] }]}>
        <Text style={styles.text}>{ctx.toast.message}</Text>
      </View>
    </Animated.View>
  );
};

export function useToast(): Pick<ToastContextValue, 'push'> {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // A no-op fallback keeps screens safe if rendered outside the provider.
    return { push: () => undefined };
  }
  return { push: ctx.push };
}

const styles = StyleSheet.create({
  wrapBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing['2xl'],
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  /**
   * In-modal placement: near the top of the modal window, clear of the
   * bottom sheet's content and footer buttons.
   */
  wrapTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: spacing.xl,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  toast: {
    maxWidth: 420,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.full,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  text: {
    color: '#ffffff',
    fontSize: typography.fontSizes.base,
    fontWeight: '600',
    textAlign: 'center',
  },
});
