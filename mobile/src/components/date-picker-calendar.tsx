import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal as RNModal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
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
  monthOverlapsRange,
  parseDateOnly,
  yearOverlapsRange,
  type CalendarDate,
} from '../lib/calendar';
import { schoolDateOnly } from '../lib/format';

/**
 * The calendar behind every date field in the app — the shared modal opened
 * by `DatePicker` (standalone date fields) and by the date segment of
 * `DateTimeField` (trip scheduling).
 *
 * Only real calendar days are tappable: the grid is generated from
 * `monthGrid` (see `src/lib/calendar.ts`), so February the 30th does not
 * exist as a button. That is what makes invalid dates impossible — there is
 * no text-entry path to fight. `minDate` / `maxDate` extend the guarantee:
 * out-of-window days, months and years render disabled, and the "Today"
 * shortcut honours both bounds too.
 *
 * ### Month + year navigation
 *
 * Three drill-down views share the one modal: **days** (the 6×7 grid),
 * **months** (12 tappable month names) and **years** (12 tappable years,
 * paged in steps of 12). The header label is split into two buttons: the
 * month opens the month picker, the year opens the year picker. Arrows step
 * the current view by one unit (±1 month / ±1 year / ±12 years), and a
 * horizontal swipe over the grid does the same. Selecting a year lands back
 * on the day grid of that same month, selecting a month on the day grid of
 * that month — so any date inside the visible 12-year window is at most
 * three taps away from the open calendar (year → day, or month → day, or
 * just day), and one swipe/arrow per step beyond it.
 *
 * Single-tap confirms: pressing a day calls `onConfirm` with its
 * `YYYY-MM-DD` and closes, matching the native date pickers' form-field
 * behaviour (no extra "OK" step between picking and continuing).
 *
 * ### Android device fix (field batch 3E)
 *
 * Previous build used `Pressable` backdrop wrapping `View` card. On Android,
 * tapping inside the card still fired the backdrop's `onPress`, closing the
 * picker before the day handler ran. The card is now a `Pressable` with an
 * empty `onPress` that claims the gesture, matching the pattern in
 * `forms.tsx` `Select`. Modal also uses `statusBarTranslucent` so it renders
 * above the status bar on Android. The `useEffect` that resets the view on
 * open previously depended on object identities (`selected`, `todayDate`) that
 * changed every render, causing the view to snap back to the initial month on
 * every render and breaking arrow/swipe navigation. It now depends only on
 * `visible` and the string inputs.
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

/** How many years one year-picker page shows (and one arrow/swipe steps). */
const YEARS_PER_PAGE = 12;
/** Horizontal distance that turns a drag into a month/year swipe. */
const SWIPE_MIN_DX = 24;

type PickerViewMode = 'days' | 'months' | 'years';

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
  /** IANA timezone used to calculate and highlight "today". */
  timeZone?: string | null;
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
  timeZone,
}) => {
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  const today = schoolDateOnly(timeZone);
  const todayDate = useMemo(() => parseDateOnly(today), [today]);
  const selected = useMemo(() => parseDateOnly(value), [value]);

  const [view, setView] = useState<CalendarDate>(
    () =>
      selected ?? parseDateOnly(initialDate ?? '') ?? todayDate ?? { year: 2026, month: 1, day: 1 },
  );
  const [viewMode, setViewMode] = useState<PickerViewMode>('days');

  // Re-open always lands on the month of the current value (or `initialDate`
  // / today) in the day view — the month the user navigated to last time
  // must not leak in. Depends only on `visible` becoming true and the string
  // inputs, not on object identities that change every render.
  const prevVisibleRef = useRef(false);
  useEffect(() => {
    const becameVisible = visible && !prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (!becameVisible) return;
    const anchor =
      parseDateOnly(value) ?? parseDateOnly(initialDate ?? '') ?? parseDateOnly(today) ?? todayDate;
    if (anchor) setView(anchor);
    setViewMode('days');
  }, [visible, value, initialDate, today, todayDate]);

  const grid = useMemo(() => monthGrid(view.year, view.month), [view.year, view.month]);
  const yearPageStart = view.year - Math.floor(YEARS_PER_PAGE / 2);
  const yearPage = useMemo(
    () => Array.from({ length: YEARS_PER_PAGE }, (_, index) => yearPageStart + index),
    [yearPageStart],
  );

  const monthEnabled = (year: number, month: number): boolean =>
    monthOverlapsRange(year, month, minDate, maxDate);
  const yearEnabled = (year: number): boolean => yearOverlapsRange(year, minDate, maxDate);
  const pageHasEnabledYear = (startYear: number): boolean =>
    Array.from({ length: YEARS_PER_PAGE }, (_, index) => yearEnabled(startYear + index)).some(
      Boolean,
    );

  const previousMonth = useMemo(
    () => addMonths(view.year, view.month, -1),
    [view.year, view.month],
  );
  const nextMonth = useMemo(() => addMonths(view.year, view.month, 1), [view.year, view.month]);
  const canStepBack =
    viewMode === 'days'
      ? monthEnabled(previousMonth.year, previousMonth.month)
      : viewMode === 'months'
        ? yearEnabled(view.year - 1)
        : pageHasEnabledYear(yearPageStart - YEARS_PER_PAGE);

  /** Steps the active view by one unit (arrow or swipe): month, year, 12 years. */
  const step = (direction: -1 | 1) => {
    if (viewMode === 'days') {
      const next = addMonths(view.year, view.month, direction);
      if (!monthEnabled(next.year, next.month)) return;
      setView({ ...next, day: 1 });
      return;
    }
    if (viewMode === 'months') {
      if (!yearEnabled(view.year + direction)) return;
      setView({ ...view, year: view.year + direction });
      return;
    }
    const target = view.year + direction * YEARS_PER_PAGE;
    if (!pageHasEnabledYear(target - Math.floor(YEARS_PER_PAGE / 2))) return;
    setView({ ...view, year: target });
  };

  // The stable PanResponder callbacks always call the latest `step`.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });

  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        // The day/month/year buttons keep their taps; the grid only claims
        // the gesture once it is clearly a horizontal drag.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > SWIPE_MIN_DX && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < SWIPE_MIN_DX || Math.abs(gesture.dx) <= Math.abs(gesture.dy)) {
            return;
          }
          stepRef.current(gesture.dx < 0 ? 1 : -1);
        },
      }),
    [],
  );

  const daySelectable = (day: CalendarDate): boolean => {
    const stamp = formatDateOnly(day);
    if (minDate && compareDateOnly(stamp, minDate) < 0) return false;
    if (maxDate && compareDateOnly(stamp, maxDate) > 0) return false;
    return true;
  };

  const pickMonth = (month: number) => {
    setView({ year: view.year, month, day: 1 });
    setViewMode('days');
  };

  /** A year tap lands straight back on the day grid of the shown month. */
  const pickYear = (year: number) => {
    setView({ year, month: view.month, day: 1 });
    setViewMode('days');
  };

  const todayOutOfRange =
    (minDate !== null && compareDateOnly(today, minDate) < 0) ||
    (maxDate !== null && compareDateOnly(today, maxDate) > 0);

  const cardLabel =
    viewMode === 'months'
      ? t('datePicker.selectMonth')
      : viewMode === 'years'
        ? t('datePicker.selectYear')
        : t('datePicker.title');

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}} accessibilityLabel={cardLabel}>
          {viewMode === 'years' ? (
            <View style={styles.header}>
              <NavButton
                onPress={() => step(-1)}
                disabled={!canStepBack}
                icon="chevron-back"
                accessibilityLabel={t('datePicker.previousYear')}
              />
              <Text style={styles.monthLabel}>
                {yearPageStart}–{yearPage[YEARS_PER_PAGE - 1]}
              </Text>
              <NavButton
                onPress={() => step(1)}
                disabled={!pageHasEnabledYear(yearPageStart + YEARS_PER_PAGE)}
                icon="chevron-forward"
                accessibilityLabel={t('datePicker.nextYear')}
              />
            </View>
          ) : viewMode === 'months' ? (
            <View style={styles.header}>
              <NavButton
                onPress={() => step(-1)}
                disabled={!canStepBack}
                icon="chevron-back"
                accessibilityLabel={t('datePicker.previousYear')}
              />
              <Pressable
                onPress={() => setViewMode('years')}
                hitSlop={8}
                style={styles.headerTitleButton}
                accessibilityRole="button"
                accessibilityLabel={`${view.year}, ${t('datePicker.selectYear')}`}
              >
                <Text style={styles.monthLabel}>{view.year}</Text>
              </Pressable>
              <NavButton
                onPress={() => step(1)}
                disabled={!yearEnabled(view.year + 1)}
                icon="chevron-forward"
                accessibilityLabel={t('datePicker.nextYear')}
              />
            </View>
          ) : (
            <View style={styles.header}>
              <NavButton
                onPress={() => step(-1)}
                disabled={!canStepBack}
                icon="chevron-back"
                accessibilityLabel={t('datePicker.previousMonth')}
              />
              <View style={styles.headerTitle}>
                <Pressable
                  onPress={() => setViewMode('months')}
                  hitSlop={8}
                  style={styles.headerTitleButton}
                  accessibilityRole="button"
                  accessibilityLabel={`${t(MONTH_KEYS[view.month - 1])}, ${t('datePicker.selectMonth')}`}
                >
                  <Text style={styles.monthLabel}>{t(MONTH_KEYS[view.month - 1])}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setViewMode('years')}
                  hitSlop={8}
                  style={styles.headerTitleButton}
                  accessibilityRole="button"
                  accessibilityLabel={`${view.year}, ${t('datePicker.selectYear')}`}
                >
                  <Text style={styles.yearLabel}>{view.year}</Text>
                </Pressable>
              </View>
              <NavButton
                onPress={() => step(1)}
                disabled={!monthEnabled(nextMonth.year, nextMonth.month)}
                icon="chevron-forward"
                accessibilityLabel={t('datePicker.nextMonth')}
              />
            </View>
          )}

          {viewMode === 'days' ? (
            <View {...swipeResponder.panHandlers}>
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
                        hitSlop={2}
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
            </View>
          ) : viewMode === 'months' ? (
            <View style={styles.unitsGrid} {...swipeResponder.panHandlers}>
              {MONTH_KEYS.map((key, index) => {
                const month = index + 1;
                const enabled = monthEnabled(view.year, month);
                const isSelectedMonth =
                  selected !== null && selected.year === view.year && selected.month === month;
                const isCurrentMonth =
                  todayDate !== null && todayDate.year === view.year && todayDate.month === month;
                return (
                  <View key={key} style={styles.unitCell}>
                    <Pressable
                      onPress={() => pickMonth(month)}
                      disabled={!enabled}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelectedMonth, disabled: !enabled }}
                      style={[
                        styles.unit,
                        isSelectedMonth ? styles.daySelected : null,
                        isCurrentMonth && !isSelectedMonth ? styles.dayToday : null,
                        !enabled ? styles.dayDisabled : null,
                      ]}
                      hitSlop={4}
                    >
                      <Text
                        style={[
                          styles.unitText,
                          isSelectedMonth ? styles.dayTextSelected : null,
                          !enabled ? styles.dayTextDisabled : null,
                        ]}
                        numberOfLines={1}
                      >
                        {t(key)}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.unitsGrid} {...swipeResponder.panHandlers}>
              {yearPage.map((year) => {
                const enabled = yearEnabled(year);
                const isSelectedYear = selected !== null && selected.year === year;
                const isCurrentYear = todayDate !== null && todayDate.year === year;
                return (
                  <View key={year} style={styles.unitCell}>
                    <Pressable
                      onPress={() => pickYear(year)}
                      disabled={!enabled}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelectedYear, disabled: !enabled }}
                      style={[
                        styles.unit,
                        isSelectedYear ? styles.daySelected : null,
                        isCurrentYear && !isSelectedYear ? styles.dayToday : null,
                        !enabled ? styles.dayDisabled : null,
                      ]}
                      hitSlop={4}
                    >
                      <Text
                        style={[
                          styles.unitText,
                          isSelectedYear ? styles.dayTextSelected : null,
                          !enabled ? styles.dayTextDisabled : null,
                        ]}
                      >
                        {year}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom * 0.5 }]}>
            <Pressable
              onPress={() => {
                onConfirm(today);
                onClose();
              }}
              disabled={todayOutOfRange}
              style={[styles.footerButton, todayOutOfRange ? styles.footerButtonDisabled : null]}
              hitSlop={6}
              accessibilityRole="button"
            >
              <Text style={[styles.footerText, todayOutOfRange ? styles.footerTextDisabled : null]}>
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
        </Pressable>
      </Pressable>
    </RNModal>
  );
};

/** Round chevron used by every view's header arrows. */
const NavButton: React.FC<{
  onPress: () => void;
  disabled: boolean;
  icon: 'chevron-back' | 'chevron-forward';
  accessibilityLabel: string;
}> = ({ onPress, disabled, icon, accessibilityLabel }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    hitSlop={8}
    style={[styles.navButton, disabled ? styles.navButtonDisabled : null]}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ disabled }}
  >
    <Ionicons name={icon} size={20} color={colors.neutral[700]} />
  </Pressable>
);

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
  navButtonDisabled: {
    opacity: 0.35,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitleButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  monthLabel: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  yearLabel: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[600],
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
  unitsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    minHeight: 6 * 44,
    alignContent: 'center',
  },
  unitCell: {
    width: '25%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  unit: {
    minWidth: 64,
    minHeight: 40,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[800],
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
