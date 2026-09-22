import React, { useEffect, useState } from 'react';
import { Modal as RNModal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { surface } from '../theme';
import { useTranslation } from '../lib/i18n-provider';
import {
  addMonths,
  compareDateOnly,
  formatDateOnly,
  monthGrid,
  parseDateOnly,
  type CalendarDate,
} from '../lib/calendar';
import { utcDateOnly } from '../lib/format';

/**
 * The calendar behind every date field in the app — the shared modal opened
 * by `DatePicker` (standalone date fields) and by the date segment of
 * `DateTimeField` (trip scheduling).
 *
 * Only real calendar days are tappable: the grid is generated from
 * `monthGrid` (see `src/lib/calendar.ts`), so February the 30th does not
 * exist as a button. That is what makes invalid dates impossible — there is
 * no text-entry path to fight.
 *
 * Single-tap confirms: pressing a day calls `onConfirm` with its
 * `YYYY-MM-DD` and closes, matching the native date pickers' form-field
 * behaviour (no extra "OK" step between picking and continuing).
 */

const MONTH_KEYS = [
  'date.month.1',
  'date.month.2',
  'date.month.3',
  'date.month.4',
  'date.month.5',
  'date.month.6',
  'date.month.7',
  'date.month.8',
  'date.month.9',
  'date.month.10',
  'date.month.11',
  'date.month.12',
] as const;

const WEEKDAY_KEYS = [
  'date.weekday.0',
  'date.weekday.1',
  'date.weekday.2',
  'date.weekday.3',
  'date.weekday.4',
  'date.weekday.5',
  'date.weekday.6',
] as const;

export interface CalendarPickerProps {
  visible: boolean;
  /** Currently selected day (`YYYY-MM-DD`) or `''` when unset. */
  value: string;
  /** Month the calendar opens on when `value` is empty. */
  initialDate?: string;
  /** Called with the picked day (`YYYY-MM-DD`) — the picker also closes. */
  onConfirm: (date: string) => void;
  onClose: () => void;
  /** Shows the "Clear" action (optional date fields). */
  allowClear?: boolean;
  /** Called by "Clear" — removes the value and closes. */
  onClear?: () => void;
  /** Inclusive lower bound; days before it are not selectable. */
  minDate?: string | null;
  /** Inclusive upper bound; days after it are not selectable (e.g. DOB ≤ today). */
  maxDate?: string | null;
}

export const CalendarPicker: React.FC<CalendarPickerProps> = ({
  visible,
  value,
  initialDate,
  onConfirm,
  onClose,
  allowClear = false,
  onClear,
  minDate = null,
  maxDate = null,
}) => {
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  const today = utcDateOnly();
  const todayDate = parseDateOnly(today);
  const selected = parseDateOnly(value);

  const [view, setView] = useState(
    () => selected ?? parseDateOnly(initialDate ?? '') ?? todayDate!,
  );

  // Re-open always lands on the month of the current value (or `initialDate`
  // / today) — the month the user navigated to last time must not leak in.
  useEffect(() => {
    if (!visible) return;
    const anchor = selected ?? parseDateOnly(initialDate ?? '') ?? todayDate;
    if (anchor) setView(anchor);
  }, [visible, value, initialDate, selected, todayDate]);

  const grid = monthGrid(view.year, view.month);
  const step = (delta: number) =>
    setView((current) => {
      const next = addMonths(current.year, current.month, delta);
      return { ...next, day: 1 };
    });

  const daySelectable = (day: CalendarDate): boolean => {
    const stamp = formatDateOnly(day);
    if (minDate && compareDateOnly(stamp, minDate) < 0) return false;
    if (maxDate && compareDateOnly(stamp, maxDate) > 0) return false;
    return true;
  };

  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.card} accessibilityLabel={t('datePicker.title')}>
          <View style={styles.header}>
            <Pressable
              onPress={() => step(-1)}
              hitSlop={8}
              style={styles.navButton}
              accessibilityRole="button"
              accessibilityLabel={`${t('datePicker.title')} ${t(MONTH_KEYS[(view.month + 10) % 12])} ${String(view.year - 1)}`}
            >
              <Ionicons name="chevron-back" size={20} color={colors.neutral[700]} />
            </Pressable>
            <Text style={styles.monthLabel}>
              {t(MONTH_KEYS[view.month - 1])} {view.year}
            </Text>
            <Pressable
              onPress={() => step(1)}
              hitSlop={8}
              style={styles.navButton}
              accessibilityRole="button"
              accessibilityLabel={`${t('datePicker.title')} ${t(MONTH_KEYS[view.month % 12])} ${String(view.year + 1)}`}
            >
              <Ionicons name="chevron-forward" size={20} color={colors.neutral[700]} />
            </Pressable>
          </View>

          <View style={styles.weekdayRow}>
            {WEEKDAY_KEYS.map((key) => (
              <View key={key} style={styles.weekdayCell}>
                <Text style={styles.weekdayText}>{t(key)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.grid}>
            {grid.map((day, index) => {
              if (!day) {
                return <View key={`empty-${index}`} style={styles.cell} />;
              }
              const stamp = formatDateOnly(day);
              const isToday = stamp === today;
              const isSelected = selected !== null && stamp === value;
              const selectable = daySelectable(day);
              return (
                <View key={stamp} style={styles.cell}>
                  <Pressable
                    onPress={() => {
                      if (!selectable) return;
                      onConfirm(stamp);
                      onClose();
                    }}
                    disabled={!selectable}
                    accessibilityRole="button"
                    accessibilityLabel={`${t(MONTH_KEYS[day.month - 1])} ${day.day}, ${day.year}`}
                    accessibilityState={{ selected: isSelected, disabled: !selectable }}
                    style={[
                      styles.day,
                      isSelected ? styles.daySelected : null,
                      isToday && !isSelected ? styles.dayToday : null,
                      !selectable ? styles.dayDisabled : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        isSelected ? styles.dayTextSelected : null,
                        !selectable ? styles.dayTextDisabled : null,
                      ]}
                    >
                      {day.day}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom * 0.5 }]}>
            <Pressable
              onPress={() => {
                onConfirm(today);
                onClose();
              }}
              disabled={Boolean(maxDate && compareDateOnly(today, maxDate) > 0)}
              style={[
                styles.footerButton,
                maxDate && compareDateOnly(today, maxDate) > 0 ? styles.footerButtonDisabled : null,
              ]}
              hitSlop={6}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.footerText,
                  maxDate && compareDateOnly(today, maxDate) > 0 ? styles.footerTextDisabled : null,
                ]}
              >
                {t('datePicker.today')}
              </Text>
            </Pressable>
            <View style={styles.footerSpacer} />
            {allowClear ? (
              <Pressable
                onPress={() => {
                  onClear?.();
                  onClose();
                }}
                disabled={value === ''}
                style={[styles.footerButton, value === '' ? styles.footerButtonDisabled : null]}
                hitSlop={6}
                accessibilityRole="button"
              >
                <Text style={[styles.footerText, value === '' ? styles.footerTextDisabled : null]}>
                  {t('datePicker.clear')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Pressable>
    </RNModal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  weekdayRow: {
    flexDirection: 'row',
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  weekdayText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[500],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '14.2857%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  day: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: {
    backgroundColor: surface.actionPrimary,
  },
  dayToday: {
    borderWidth: 1.5,
    borderColor: surface.actionPrimary,
  },
  dayDisabled: {
    opacity: 0.35,
  },
  dayText: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[800],
  },
  dayTextSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },
  dayTextDisabled: {
    color: colors.neutral[500],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
  },
  footerSpacer: {
    flex: 1,
  },
  footerButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    backgroundColor: colors.neutral[100],
  },
  footerButtonDisabled: {
    opacity: 0.45,
  },
  footerText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  footerTextDisabled: {
    color: colors.neutral[500],
  },
});
