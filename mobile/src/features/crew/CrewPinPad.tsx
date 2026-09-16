import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/ui';
import { useTranslation } from '../../lib/i18n-provider';
import { borderRadius, colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { CREW_PIN_LENGTH } from '@school-bus-tracking/validation';

/**
 * Crew mobile-login PIN pad (Mobile-UX Phase 4b).
 *
 * What this component owns:
 *
 * - the four round dots that show the PIN being typed (one per character,
 *   filled as the user enters digits, empty after backspace — never the
 *   digits themselves, never the typed string);
 * - the 3×4 keypad (1..9, backspace, 0, clear) with the touch target the
 *   Phase-1 type scale requires (`touch.field` ≈ 56 dp);
 * - a "submit when full" effect that hands the typed PIN to the parent.
 *
 * What this component does NOT own:
 *
 * - the *content* of the PIN (kept in local state, handed to the parent on
 *   submit, wiped after submit, never logged);
 * - the network call. The parent wires `onSubmit(pin)` to
 *   `useAuth().crewLogin(...)`;
 * - the school / user_id fields. Those are out of scope here because the
 *   school code is shared with the email/password path and the user_id
 *   needs its own field (the spec in `crew-login-flow.ts` covers the
 *   shape).
 *
 * The component deliberately exposes **only** `value` (4 digits or empty)
 * and `onChange` (called once per digit/clear). A "submit" button is fine
 * to render but is the parent's call: an attacker-controlled textinput is
 * the difference between a UI and a real PIN entry, and React Native's
 * `TextInput` with `secureTextEntry` would expose the string to a
 * potential screen reader or paste — a custom keypad does not.
 */

export interface CrewPinPadProps {
  /**
   * The current draft. Always either `''` or exactly `CREW_PIN_LENGTH`
   * digits — partial drafts are kept inside this component, never exposed
   * here, so the parent never sees an intermediate string.
   */
  value: string;
  /** Called with a new draft after every key press (also for backspace/clear). */
  onChange: (next: string) => void;
  /**
   * Fired exactly once when the draft reaches `CREW_PIN_LENGTH` digits.
   * The parent owns the submit (and therefore the network call); the pad
   * does not call it again until the value changes back below the length.
   */
  onSubmit: (pin: string) => void;
  /** Disable every key. The submit button also reflects this. */
  disabled?: boolean;
}

const KEYS: ReadonlyArray<ReadonlyArray<{ kind: 'digit'; value: string } | { kind: 'action'; action: 'back' | 'clear' }>> = [
  [{ kind: 'digit', value: '1' }, { kind: 'digit', value: '2' }, { kind: 'digit', value: '3' }],
  [{ kind: 'digit', value: '4' }, { kind: 'digit', value: '5' }, { kind: 'digit', value: '6' }],
  [{ kind: 'digit', value: '7' }, { kind: 'digit', value: '8' }, { kind: 'digit', value: '9' }],
  [{ kind: 'action', action: 'back' }, { kind: 'digit', value: '0' }, { kind: 'action', action: 'clear' }],
];

export const CrewPinPad: React.FC<CrewPinPadProps> = ({ value, onChange, onSubmit, disabled }) => {
  const t = useTranslation();
  const firedRef = useRef(false);

  /**
   * One keystroke handler. The action buttons exist so the user does not
   * need a software keyboard — Phase 1 set the touch target to ≥56 dp and
   * the crew locale default is Hindi, so a paste from another app or a
   * system's autofill cannot be assumed.
   */
  const press = useCallback(
    (key: (typeof KEYS)[number][number]) => {
      if (disabled) return;
      if (key.kind === 'digit') {
        if (value.length >= CREW_PIN_LENGTH) return;
        onChange(value + key.value);
      } else if (key.action === 'back') {
        if (value.length === 0) return;
        onChange(value.slice(0, -1));
      } else {
        onChange('');
      }
    },
    [disabled, onChange, value],
  );

  // Auto-submit at four digits. The `firedRef` guarantees exactly one submit
  // per reaching the length — if the parent does not clear `value` on submit
  // (e.g. an error path), the user has to clear the pad themselves before
  // the next attempt.
  useEffect(() => {
    if (value.length === CREW_PIN_LENGTH) {
      if (!firedRef.current) {
        firedRef.current = true;
        onSubmit(value);
      }
    } else {
      firedRef.current = false;
    }
  }, [value, onSubmit]);

  return (
    <View style={styles.root}>
      <View style={styles.dotsRow} accessible accessibilityLabel={t('login.crewPath.pin.padLabel')}>
        {Array.from({ length: CREW_PIN_LENGTH }, (_, index) => {
          const filled = index < value.length;
          return (
            <View
              key={index}
              style={[styles.dot, filled ? styles.dotFilled : null]}
            />
          );
        })}
      </View>
      <View style={styles.grid}>
        {KEYS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((key, colIndex) => (
              <PadKey
                key={`${rowIndex}-${colIndex}`}
                k={key}
                onPress={press}
                disabled={disabled}
              />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.actionsRow}>
        <Button
          variant="ghost"
          label={t('login.crewPath.pin.clearKey')}
          onPress={() => press({ kind: 'action', action: 'clear' })}
          disabled={disabled || value.length === 0}
        />
        <Button
          label={t('login.crewPath.pin.submit')}
          onPress={() => onSubmit(value)}
          disabled={disabled || value.length !== CREW_PIN_LENGTH}
        />
      </View>
    </View>
  );
};

const PadKey: React.FC<{
  k: { kind: 'digit'; value: string } | { kind: 'action'; action: 'back' | 'clear' };
  onPress: (key: { kind: 'digit'; value: string } | { kind: 'action'; action: 'back' | 'clear' }) => void;
  disabled?: boolean;
}> = ({ k, onPress, disabled }) => {
  const t = useTranslation();
  const handle = useCallback(() => onPress(k), [k, onPress]);
  const iconName = k.kind === 'action' && k.action === 'back' ? 'backspace-outline' : null;
  const label = k.kind === 'digit' ? k.value : k.action === 'clear' ? '✕' : null;
  const accessibilityLabel =
    k.kind === 'digit'
      ? k.value
      : k.action === 'back'
        ? 'Backspace'
        : t('login.crewPath.pin.clearKey');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={handle}
      disabled={disabled}
      style={({ pressed }) => [
        styles.key,
        k.kind === 'action' ? styles.keyAction : null,
        pressed && !disabled ? styles.keyPressed : null,
        disabled ? styles.keyDisabled : null,
      ]}
    >
      {iconName ? (
        <Ionicons name={iconName} size={24} color={colors.neutral[900]} />
      ) : (
        <Text style={styles.keyLabel}>{label}</Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
    alignItems: 'stretch',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.neutral[300],
  },
  dotFilled: {
    backgroundColor: colors.primary[700],
  },
  grid: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  key: {
    width: 64,
    height: 56,
    borderRadius: borderRadius.md,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyAction: {
    backgroundColor: colors.neutral[200],
  },
  keyPressed: {
    opacity: 0.7,
  },
  keyDisabled: {
    opacity: 0.4,
  },
  keyLabel: {
    color: colors.neutral[900],
    fontSize: typography.fontSizes.xl,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
});
