import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';

/**
 * Non-blocking confirmation feedback ("Student boarded", "Trip started").
 *
 * A lightweight in-app snackbar (no third-party dependency): attendance
 * actions must show the *server-confirmed* result right where the thumb is.
 */

export type ToastTone = 'success' | 'danger' | 'info';

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = nextId.current++;
    setEntries((prev) => [...prev.slice(-2), { id, message, tone }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <View pointerEvents="box-none" style={styles.host}>
        {entries.map((entry) => (
          <ToastBubble key={entry.id} entry={entry} onExpire={() => dismiss(entry.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
};

const ToastBubble: React.FC<{ entry: ToastEntry; onExpire: () => void }> = ({
  entry,
  onExpire,
}) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.delay(2_600),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) {
        onExpire();
      }
    });
  }, []);

  return (
    <Animated.View style={[styles.bubble, opacity ? { opacity } : undefined]}>
      <Text style={styles.text}>{entry.message}</Text>
      <View style={[styles.toneBar, styles[`tone_${entry.tone}`]]} />
    </Animated.View>
  );
};

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  bubble: {
    maxWidth: '90%',
    backgroundColor: colors.neutral[900],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  text: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  toneBar: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginLeft: spacing.sm,
  },
  tone_success: {
    backgroundColor: colors.secondary[400],
  },
  tone_danger: {
    backgroundColor: colors.status.danger,
  },
  tone_info: {
    backgroundColor: colors.primary[400],
  },
});
