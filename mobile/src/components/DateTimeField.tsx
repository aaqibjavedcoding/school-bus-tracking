import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import {
  isValidDateTimeLocal,
  joinDateTimeLocal,
  maskTime,
  splitDateTimeLocal,
  toDateTimeLocalValue,
} from '../lib/datetime';
import { useKeyboardForm } from './keyboard-form';
import { CalendarPicker } from './date-picker-calendar';

/**
 * Mobile equivalent of the web `<Input type="datetime-local" />`.
 *
 * The value is the exact same `YYYY-MM-DDTHH:mm` *local* string the web form
 * holds in state, so both platforms feed `fromDateTimeLocalValue()` and the
 * shared `tripCreateSchema` with identical data. Nothing is hardcoded: the
 * field starts empty and the quick actions are computed from the device clock
 * at press time.
 *
 * The **date** half is picked on the shared {@link CalendarPicker} — no
 * manual date typing anywhere in the app, so an impossible date (31 February)
 * can never be entered. The **time** half stays a masked `HH:mm` entry
 * (time is not a date), and the quick actions ("Now", "+30 min", "+1 hour")
 * remain the fastest way to fill both at once.
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
  const [calendarOpen, setCalendarOpen] = useState(false);
  const keyboardForm = useKeyboardForm();
  const timeRef = useRef<TextInput>(null);
  const { date, time } = useMemo(() => splitDateTimeLocal(value), [value]);
  const incomplete = value.length > 0 && !isValidDateTimeLocal(value);

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
        <Pressable
          onPress={() => setCalendarOpen(true)}
          style={[styles.input, styles.dateControl, error || incomplete ? styles.inputError : null]}
          accessibilityRole="button"
          accessibilityLabel={`${label} date`}
        >
          <Ionicons name="calendar-outline" size={16} color={colors.neutral[500]} />
          <Text style={date ? styles.controlValue : styles.controlPlaceholder} numberOfLines={1}>
            {date || 'YYYY-MM-DD'}
          </Text>
        </Pressable>
        <TextInput
          ref={timeRef}
          value={time}
          onChangeText={setTime}
          placeholder="HH:mm"
          placeholderTextColor={colors.neutral[400]}
          keyboardType="number-pad"
          maxLength={5}
          accessibilityLabel={`${label} time`}
          style={[styles.input, styles.timeInput, error || incomplete ? styles.inputError : null]}
          onFocus={() => {
            if (timeRef.current) keyboardForm?.focusInput(timeRef.current);
          }}
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

      <CalendarPicker
        visible={calendarOpen}
        value={date}
        initialDate={date || undefined}
        onConfirm={(day) => onChange(joinDateTimeLocal(day, time))}
        onClose={() => setCalendarOpen(false)}
      />
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
    color: colors.neutral[600],
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
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    minHeight: 40,
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[900],
  },
  dateControl: {
    flex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  controlValue: {
    flex: 1,
    color: colors.neutral[900],
  },
  controlPlaceholder: {
    flex: 1,
    color: colors.neutral[400],
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
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.secondary[700],
  },
  clear: {
    color: colors.neutral[500],
  },
  error: {
    fontSize: typography.fontSizes.sm,
    color: colors.status.danger,
    marginTop: spacing.xs,
  },
  hint: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
});
