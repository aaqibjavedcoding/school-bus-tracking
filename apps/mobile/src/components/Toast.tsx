import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import type { Tone } from '../lib/format';

/**
 * Minimal, dependency-free toast layer so CRUD mutations can confirm success
 * ("Bus added.") or surface a failure the same way the web console does with
 * its toast, without pulling in an animation library.
 */

type ToastTone = Extract<Tone, 'success' | 'danger' | 'info'>;

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_COLORS: Record<ToastTone, string> = {
  success: colors.secondary[600],
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

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="none" style={[styles.wrap, { opacity }]}>
          <View style={[styles.toast, { backgroundColor: TONE_COLORS[toast.tone] }]}>
            <Text style={styles.text}>{toast.message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // A no-op fallback keeps screens safe if rendered outside the provider.
    return { push: () => undefined };
  }
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing['2xl'],
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
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
});
