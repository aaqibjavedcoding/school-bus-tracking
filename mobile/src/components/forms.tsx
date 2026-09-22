import React, { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal as RNModal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { surface, touch } from '../theme';
import { keyboardBehavior } from '../lib/keyboard-aware';
import { KeyboardFormContext, useKeyboardReveal } from './keyboard-form';
import { ToastViewport } from './Toast';
import { Button } from './ui';
import { optionList } from './option-list';

/**
 * Form + interaction primitives for the mobile CRUD surfaces.
 *
 * These are intentionally dependency-free (built only on React Native's own
 * `Modal`, `Pressable` and `ScrollView`) so the app stays lightweight while
 * matching the web console's create / edit / delete flows.
 */

/**
 * Slide-up sheet used for create / edit forms.
 *
 * Keyboard-aware: the sheet's scroll view scrolls the focused field clear of
 * the keyboard (the same mechanism as `Screen` / `KeyboardForm`), and the
 * in-modal toast viewport keeps errors visible *while the sheet is open* —
 * a save failure must not wait for the user to back out.
 */
export const FormSheet: React.FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ open, title, onClose, children, footer }) => {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { contextValue, onScroll } = useKeyboardReveal(scrollRef);
  return (
    <RNModal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.sheetRoot} behavior={keyboardBehavior(Platform.OS)}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <KeyboardFormContext.Provider value={contextValue}>
          <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={colors.neutral[500]} />
              </Pressable>
            </View>
            <ScrollView
              ref={scrollRef}
              style={styles.sheetBody}
              contentContainerStyle={styles.sheetBodyContent}
              keyboardShouldPersistTaps="handled"
              onScroll={onScroll}
              scrollEventThrottle={16}
            >
              {children}
            </ScrollView>
            {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
          </View>
        </KeyboardFormContext.Provider>
        {/* Errors raised while this sheet is open must render above it. */}
        <ToastViewport placement="top" />
      </KeyboardAvoidingView>
    </RNModal>
  );
};

export interface SelectOption {
  value: string;
  label: string;
}

/** Tap-to-open option picker (mobile equivalent of the web `Select`). */
export const Select: React.FC<{
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string | null;
}> = ({ label, value, options, onChange, placeholder = 'Select…', error }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const pickerScrollRef = useRef<ScrollView>(null);
  const pickerInputRef = useRef<TextInput>(null);
  const { contextValue: pickerContext, onScroll: pickerOnScroll } =
    useKeyboardReveal(pickerScrollRef);
  const selected = options.find((option) => option.value === value);

  // Long option lists (assignments, parents, stops) get an inline filter.
  const searchable = options.length > 8;
  const visibleOptions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => option.label.toLowerCase().includes(term));
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.selectControl, error ? styles.selectControlError : null]}
      >
        <Text style={selected ? styles.selectValue : styles.selectPlaceholder} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.neutral[500]} />
      </Pressable>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}

      <RNModal visible={open} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView style={styles.flex} behavior={keyboardBehavior(Platform.OS)}>
          <Pressable style={styles.pickerBackdrop} onPress={close}>
            <KeyboardFormContext.Provider value={pickerContext}>
              <Pressable style={styles.pickerCard} onPress={() => undefined}>
                <Text style={styles.pickerTitle}>{label}</Text>
                {searchable ? (
                  <TextInput
                    ref={pickerInputRef}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Filter options…"
                    placeholderTextColor={surface.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.pickerSearch}
                    accessibilityLabel={`Filter ${label} options`}
                    onFocus={() => {
                      if (pickerInputRef.current) {
                        pickerContext.focusInput(pickerInputRef.current);
                      }
                    }}
                  />
                ) : null}
                <ScrollView
                  ref={pickerScrollRef}
                  style={styles.pickerList}
                  contentContainerStyle={styles.pickerListContent}
                  keyboardShouldPersistTaps="handled"
                  onScroll={pickerOnScroll}
                  scrollEventThrottle={16}
                >
                  {options.length === 0 ? (
                    <Text style={styles.pickerEmpty}>No options available.</Text>
                  ) : visibleOptions.length === 0 ? (
                    <Text style={styles.pickerEmpty}>No options match “{query.trim()}”.</Text>
                  ) : (
                    visibleOptions.map((option, index) => {
                      const active = option.value === value;
                      // One hairline *between* rows — never under the last one, so
                      // the list does not end on a stray rule.
                      const divider = index < visibleOptions.length - 1;
                      return (
                        <View key={option.value}>
                          <Pressable
                            onPress={() => {
                              onChange(option.value);
                              close();
                            }}
                            accessibilityRole="menuitem"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={option.label}
                            style={({ pressed }) => [
                              styles.pickerRow,
                              active ? styles.pickerRowActive : null,
                              pressed ? styles.pickerRowPressed : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.pickerRowText,
                                active ? styles.pickerRowTextActive : null,
                              ]}
                              numberOfLines={2}
                            >
                              {option.label}
                            </Text>
                            {active ? (
                              <Ionicons
                                name="checkmark"
                                size={optionList.tickSize}
                                color={optionList.tickColor}
                              />
                            ) : null}
                          </Pressable>
                          {divider ? <View style={styles.pickerDivider} /> : null}
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              </Pressable>
            </KeyboardFormContext.Provider>
            {/* Errors raised while this picker is open must render above it. */}
            <ToastViewport placement="top" />
          </Pressable>
        </KeyboardAvoidingView>
      </RNModal>
    </View>
  );
};

/** Labelled on/off toggle used for `is_active` style flags. */
export const SwitchRow: React.FC<{
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}> = ({ label, value, onChange, hint }) => (
  <Pressable style={styles.switchRow} onPress={() => onChange(!value)} accessibilityRole="switch">
    <View style={{ flex: 1 }}>
      <Text style={styles.switchLabel}>{label}</Text>
      {hint ? <Text style={styles.switchHint}>{hint}</Text> : null}
    </View>
    <View style={[styles.switchTrack, value ? styles.switchTrackOn : null]}>
      <View style={[styles.switchThumb, value ? styles.switchThumbOn : null]} />
    </View>
  </Pressable>
);

/** Floating action button anchored bottom-right of a screen. */
export const Fab: React.FC<{
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  label?: string;
  style?: StyleProp<ViewStyle>;
}> = ({ onPress, icon = 'add', label, style }) => {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        // Keep the FAB clear of the Android nav bar / iOS home indicator.
        { bottom: spacing.lg + insets.bottom },
        pressed ? styles.fabPressed : null,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label ?? 'Add'}
    >
      <Ionicons name={icon} size={22} color="#ffffff" />
      {label ? <Text style={styles.fabLabel}>{label}</Text> : null}
    </Pressable>
  );
};

/** Confirmation dialog (destructive-aware) built on the native modal. */
export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) => (
  <RNModal visible={open} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={styles.dialogBackdrop}>
      <View style={styles.dialogCard}>
        <Text style={styles.dialogTitle}>{title}</Text>
        {message ? <Text style={styles.dialogMessage}>{message}</Text> : null}
        <View style={styles.dialogActions}>
          <Button label={cancelLabel} variant="secondary" onPress={onCancel} style={styles.flex} />
          <Button
            label={confirmLabel}
            variant={danger ? 'danger' : 'primary'}
            onPress={onConfirm}
            busy={busy}
            style={styles.flex}
          />
        </View>
      </View>
      {/* A failed confirm (e.g. a retired-write 410) must not hide behind the dialog. */}
      <ToastViewport placement="top" />
    </View>
  </RNModal>
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    // RN 0.86 (Expo SDK 57) removed `StyleSheet.absoluteFillObject`; the
    // frozen `StyleSheet.absoluteFill` object is the single replacement.
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  sheet: {
    backgroundColor: colors.neutral[50],
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '92%',
    paddingBottom: spacing.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.neutral[300],
    marginTop: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sheetTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  sheetBody: {
    paddingHorizontal: spacing.lg,
  },
  sheetBodyContent: {
    paddingBottom: spacing.md,
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  field: {
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[700],
    marginBottom: spacing.xs,
  },
  fieldError: {
    fontSize: 13,
    color: colors.status.danger,
    marginTop: spacing.xs,
  },
  selectControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: surface.borderInteractive,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    minHeight: touch.target,
    gap: spacing.xs,
  },
  selectControlError: {
    borderColor: colors.status.danger,
  },
  selectValue: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[900],
  },
  selectPlaceholder: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pickerCard: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    maxHeight: '70%',
  },
  pickerTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
    marginBottom: spacing.sm,
  },
  pickerSearch: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[900],
    minHeight: touch.target,
  },
  pickerList: {
    // `flexShrink` (not the default 0) is what lets the card's `maxHeight`
    // actually bound a long option list: the list shrinks and scrolls instead
    // of overflowing the sheet.
    flexGrow: 0,
    flexShrink: 1,
  },
  pickerListContent: {
    paddingVertical: spacing.xs,
  },
  pickerEmpty: {
    color: colors.neutral[600],
    fontSize: typography.fontSizes.sm,
    padding: spacing.sm,
    textAlign: 'center',
  },
  // Every value below comes from `./option-list` so this picker and the login
  // screen's language menu cannot drift apart.
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: optionList.rowMinHeight,
    paddingVertical: optionList.rowPaddingVertical,
    paddingHorizontal: optionList.rowPaddingHorizontal,
    borderRadius: optionList.rowRadius,
    gap: optionList.rowGap,
  },
  pickerRowActive: {
    backgroundColor: optionList.rowBackgroundSelected,
  },
  pickerRowPressed: {
    backgroundColor: optionList.rowBackgroundPressed,
  },
  pickerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: optionList.dividerColor,
    marginLeft: optionList.dividerInset,
  },
  pickerRowText: {
    flex: 1,
    fontSize: optionList.labelSize,
    color: optionList.labelColor,
  },
  pickerRowTextActive: {
    color: optionList.labelColorSelected,
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    minHeight: touch.target,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  switchLabel: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  switchHint: {
    fontSize: 13,
    color: colors.neutral[500],
    marginTop: 2,
  },
  switchTrack: {
    width: 40,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.neutral[300],
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackOn: {
    // secondary-600 keeps the ON state ≥3:1 against the white track area.
    backgroundColor: colors.secondary[600],
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
  },
  switchThumbOn: {
    alignSelf: 'flex-end',
  },
  fab: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    minWidth: 44,
    height: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: 22,
    backgroundColor: colors.secondary[700],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  fabPressed: {
    opacity: 0.85,
  },
  fabLabel: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: typography.fontSizes.sm,
  },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dialogCard: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  dialogTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  dialogMessage: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[600],
    lineHeight: 20,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
