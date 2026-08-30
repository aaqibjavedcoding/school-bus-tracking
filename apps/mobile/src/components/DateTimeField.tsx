import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import {
  isValidDateTimeLocal,
  joinDateTimeLocal,
  maskDate,
  maskTime,
  splitDateTimeLocal,
  toDateTimeLocalValue,
} from '../lib/datetime';

/**
 * Mobile equivalent of the web `<Input type="datetime-local" />`.
 *
 * The value is the exact same `YYYY-MM-DDTHH:mm` *local* string the web form
 * holds in state, so both platforms feed `fromDateTimeLocalValue()` and the
 * shared `tripCreateSchema` with identical data. Nothing is hardcoded: the
 * field starts empty and the quick actions are computed from the device clock
 * at press time.
 *
 * Two segments (date + time) keep it usable without pulling in a native
 * picker dependency, and both are validated as you type.
 */

export interface DateTimeFieldProps {
  label: string;
  /** `YYYY-MM-DDTHH:mm` local value, or `''` when unset. */
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string | null;
  /** Renders "Now"/"+1 hour"/"Clear" shortcuts computed from the device clock. */
  quickActions?: boolean;
  optional?: boolean;
}

export const DateTimeField: React.FC<DateTimeFieldProps> = ({
  label,
  value,
  onChange,
  error,
  hint,
  quickActions = true,
  optional = false,
}) => {
  const { date, time } = useMemo(() => splitDateTimeLocal(value), [value]);
  const incomplete = value.length > 0 && !isValidDateTimeLocal(value);

  const setDate = (next: string) => onChange(joinDateTimeLocal(maskDate(next), time));
  const setTime = (next: string) => onChange(joinDateTimeLocal(date, maskTime(next)));

  const shift = (minutes: number) => {
    const base = isValidDateTimeLocal(value) ? new Date(value) : new Date();
    base.setMinutes(base.getMinutes() + minutes);
    onChange(toDateTimeLocalValue(base));
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {optional ? <Text style={styles.optional}> (optional)</Text> : null}
      </Text>
      <View style={styles.row}>
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.neutral[400]}
          keyboardType="number-pad"
          maxLength={10}
          accessibilityLabel={`${label} date`}
          style={[styles.input, styles.dateInput, error || incomplete ? styles.inputError : null]}
        />
        <TextInput
          value={time}
          onChangeText={setTime}
          placeholder="HH:mm"
          placeholderTextColor={colors.neutral[400]}
          keyboardType="number-pad"
          maxLength={5}
          accessibilityLabel={`${label} time`}
          style={[styles.input, styles.timeInput, error || incomplete ? styles.inputError : null]}
        />
      </View>

      {quickActions ? (
        <View style={styles.actions}>
          <Pressable onPress={() => onChange(toDateTimeLocalValue(new Date()))} hitSlop={6}>
            <Text style={styles.action}>Now</Text>
          </Pressable>
          <Pressable onPress={() => shift(30)} hitSlop={6}>
            <Text style={styles.action}>+30 min</Text>
          </Pressable>
          <Pressable onPress={() => shift(60)} hitSlop={6}>
            <Text style={styles.action}>+1 hour</Text>
          </Pressable>
          {value ? (
            <Pressable onPress={() => onChange('')} hitSlop={6}>
              <Text style={[styles.action, styles.clear]}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : incomplete ? (
        <Text style={styles.error}>Enter a valid date and time (24-hour clock).</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[700],
    marginBottom: spacing.xs,
  },
  optional: {
    color: colors.neutral[400],
    fontWeight: '400',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: 46,
    fontSize: typography.fontSizes.base,
    color: colors.neutral[900],
  },
  dateInput: {
    flex: 3,
  },
  timeInput: {
    flex: 2,
  },
  inputError: {
    borderColor: colors.status.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  action: {
    fontSize: typography.fontSizes.xs,
    fontWeight: '700',
    color: colors.primary[700],
  },
  clear: {
    color: colors.neutral[500],
  },
  error: {
    fontSize: typography.fontSizes.xs,
    color: colors.status.danger,
    marginTop: spacing.xs,
  },
  hint: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
});
