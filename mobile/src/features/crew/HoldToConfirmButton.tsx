import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { fontScaleCaps, surface, touch } from '../../theme';
import { HOLD_DURATION_MS, HoldToConfirm } from './hold-to-confirm.ts';
import { crewCopy } from './crew-copy.ts';
import { feedback } from './crew-feedback.ts';
import type { CrewActionIcon } from './crew-action-meta';

/**
 * Press-and-hold danger button (Phase 2 SOS).
 *
 * A brush can fire an SOS — a hold cannot be made by accident. The hold
 * decision is the pure {@link HoldToConfirm} controller (spec-pinned); this
 * component only renders its state with the built-in `Animated`:
 *
 * - a dark fill sweeps the button across `HOLD_DURATION_MS` (900 ms,
 *   inside the required 600–1200 ms window);
 * - releasing early cancels (fill retreats, nothing fires);
 * - the fire happens exactly once per completed hold;
 * - screen readers bypass the hold: the accessibility *activate* action
 *   fires immediately (holding is a motor pattern, not an a11y one).
 *
 * Visuals reuse the measured danger surface (white on `status.danger` =
 * 4.83:1); the fill darkens the surface, which only *raises* the label
 * contrast while holding.
 */
export const HoldToConfirmButton: React.FC<{
  label: string;
  icon: CrewActionIcon;
  onFire: () => void;
  /** True while the raised action is in flight — the button shows progress. */
  busy?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Text shown while the finger is down (defaults to the shared copy). */
  holdingLabel?: string;
  style?: StyleProp<ViewStyle>;
}> = ({
  label,
  icon,
  onFire,
  busy = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  holdingLabel = crewCopy.sos.holdingHint,
  style,
}) => {
  const hold = useMemo(() => new HoldToConfirm(), []);
  const fill = useRef(new Animated.Value(0)).current;
  const fillAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const holdingRef = useRef(false);
  const [width, setWidth] = useState(0);
  const [holding, setHolding] = useState(false);
  const inert = disabled || busy;

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
      fillAnimation.current?.stop();
    },
    [],
  );

  const clearHold = () => {
    if (timeout.current) {
      clearTimeout(timeout.current);
      timeout.current = null;
    }
    fillAnimation.current?.stop();
    fillAnimation.current = null;
  };

  const startHold = () => {
    fill.setValue(0);
    const animation = Animated.timing(fill, {
      toValue: 1,
      duration: HOLD_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    fillAnimation.current = animation;
    animation.start(({ finished }) => {
      if (!finished) return;
      const event = hold.complete();
      if (event.fire) {
        onFire();
      }
    });
    timeout.current = setTimeout(() => animation.stop(), HOLD_DURATION_MS + 50);
  };

  const endGesture = () => {
    setHolding(false);
    holdingRef.current = false;
    clearHold();
    if (hold.currentPhase === 'fired') {
      // The fire was consumed; re-arm for the next press.
      hold.reset();
      return;
    }
    hold.release(Date.now());
    fill.setValue(0);
  };

  const pressIn = () => {
    if (inert || busyRef.current) return;
    hold.press(Date.now());
    setHolding(true);
    holdingRef.current = true;
    // Phase 3b: a tick the instant the finger lands, in sync with the fill
    // that starts on the next line — "I am registering your hold". It is
    // fired from the *component*, so the pure `HoldToConfirm` controller and
    // its spec are untouched: no timing logic changed, the 900 ms hold, the
    // early-release cancel and the single-fire guarantee are byte-identical.
    feedback.on({ type: 'sos.holdStart' });
    startHold();
  };

  // Screen-reader activation fires straight away — no hold on that path.
  const activateNow = () => {
    if (inert || busyRef.current) return;
    clearHold();
    hold.reset();
    onFire();
  };

  return (
    <Pressable
      onPressIn={pressIn}
      onPressOut={() => {
        if (holdingRef.current || hold.currentPhase !== 'idle') endGesture();
      }}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint ?? crewCopy.sos.a11yHint}
      accessibilityState={{ disabled: inert, busy }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') activateNow();
      }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.button, inert ? styles.disabled : null, style]}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            transform: [
              {
                translateX: fill.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-width / 2, 0],
                }),
              },
              { scaleX: fill },
            ],
          },
        ]}
      />
      <View style={styles.content} pointerEvents="none">
        {busy ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Ionicons name={icon} size={20} color="#ffffff" />
        )}
        <Text {...fontScaleCaps.button} style={styles.label}>
          {holding ? holdingLabel : label}
        </Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    minHeight: touch.field,
    borderRadius: borderRadius.md,
    backgroundColor: surface.actionDanger,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.neutral[900],
    opacity: 0.35,
    transform: [{ translateX: 0 }, { scaleX: 0 }],
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  label: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.6,
  },
});
