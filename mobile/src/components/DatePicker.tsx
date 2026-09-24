import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { surface, touch } from '../theme';
import { useTranslation } from '../lib/i18n-provider';
import { CalendarPicker } from './date-picker-calendar';

/**
 * The ONE reusable date field for the whole app: a tappable control that
 * opens the shared {@link CalendarPicker}. No text entry — a date can only
 * ever be a real calendar day, which is what makes invalid dates impossible
 * (documents, filters, forms, every role).
 *
 * The value is the API's own unit, `YYYY-MM-DD` (empty string = unset), so
 * forms keep sending exactly what the shared zod schemas validate.
 *
 * Field fix (3E): the clear ✕ was a nested Pressable inside the open
 * Pressable, so tapping clear also opened the calendar on Android. The
 * control is now a View with two sibling Pressables — main area opens, clear
 * only clears — so the gestures never conflict.
 */
export interface DatePickerProps {
  label: string;
  /** `YYYY-MM-DD`, or `''` when unset. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string | null;
  hint?: string | null;
  /** Shows the inline ✕ and the calendar's "Clear" action (optional dates). */
  allowClear?: boolean;
  /** Inclusive lower bound (`YYYY-MM-DD`). */
  minDate?: string | null;
  /** Inclusive upper bound (`YYYY-MM-DD`) — e.g. a date of birth ≤ today. */
  maxDate?: string | null;
  /** Extra style for the label + control + message wrapper. */
  containerStyle?: StyleProp<ViewStyle>;
}

export const DatePicker: React.FC<DatePickerProps> = ({
  label,
  value,
  onChange,
  placeholder,
  error,
  hint,
  allowClear = false,
  minDate = null,
  maxDate = null,
  containerStyle,
}) => {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const filled = value !== '';

  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.control, error ? styles.controlError : null]}>
        <Pressable
          onPress={() => setOpen(true)}
          style={styles.controlMain}
          accessibilityRole="button"
          accessibilityLabel={filled ? `${label}: ${value}` : label}
          hitSlop={2}
        >
          <Ionicons name="calendar-outline" size={18} color={colors.neutral[500]} />
          <Text style={filled ? styles.controlValue : styles.controlPlaceholder} numberOfLines={1}>
            {filled ? value : (placeholder ?? t('datePicker.placeholder'))}
          </Text>
        </Pressable>
        {filled && allowClear ? (
          <Pressable
            onPress={() => onChange('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('datePicker.clear')}
            style={styles.clearButton}
          >
            <Ionicons name="close-circle" size={18} color={colors.neutral[400]} />
          </Pressable>
        ) : null}
      </View>
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <CalendarPicker
        visible={open}
        value={value}
        onConfirm={(date) => onChange(date)}
        onClose={() => setOpen(false)}
        allowClear={allowClear}
        onClear={() => onChange('')}
        minDate={minDate}
        maxDate={maxDate}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[700],
    marginBottom: spacing.xs,
  },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: surface.borderInteractive,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    minHeight: touch.target,
  },
  controlMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  clearButton: {
    paddingLeft: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlError: {
    borderColor: colors.status.danger,
  },
  controlValue: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[900],
  },
  controlPlaceholder: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
  },
  hint: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
    marginTop: spacing.xs,
  },
  error: {
    fontSize: typography.fontSizes.sm,
    color: colors.status.danger,
    marginTop: spacing.xs,
  },
});
