import React, { useMemo, useState } from 'react';
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
import { Button } from './ui';

/**
 * Form + interaction primitives for the mobile CRUD surfaces.
 *
 * These are intentionally dependency-free (built only on React Native's own
 * `Modal`, `Pressable` and `ScrollView`) so the app stays lightweight while
 * matching the web console's create / edit / delete flows.
 */

/** Slide-up sheet used for create / edit forms. */
export const FormSheet: React.FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ open, title, onClose, children, footer }) => {
  const insets = useSafeAreaInsets();
  return (
  <RNModal visible={open} transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView
      style={styles.sheetRoot}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={colors.neutral[500]} />
          </Pressable>
        </View>
        <ScrollView
          style={styles.sheetBody}
          contentContainerStyle={styles.sheetBodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
      </View>
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
        <Ionicons name="chevron-down" size={18} color={colors.neutral[400]} />
      </Pressable>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}

      <RNModal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.pickerBackdrop} onPress={close}>
          <Pressable style={styles.pickerCard} onPress={() => undefined}>
            <Text style={styles.pickerTitle}>{label}</Text>
            {searchable ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Filter options…"
                placeholderTextColor={colors.neutral[400]}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.pickerSearch}
                accessibilityLabel={`Filter ${label} options`}
              />
            ) : null}
            <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
              {options.length === 0 ? (
                <Text style={styles.pickerEmpty}>No options available.</Text>
              ) : visibleOptions.length === 0 ? (
                <Text style={styles.pickerEmpty}>No options match “{query.trim()}”.</Text>
              ) : (
                visibleOptions.map((option) => {
                  const active = option.value === value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => {
                        onChange(option.value);
                        close();
                      }}
                      style={[styles.pickerRow, active ? styles.pickerRowActive : null]}
                    >
                      <Text
                        style={[styles.pickerRowText, active ? styles.pickerRowTextActive : null]}
                        numberOfLines={2}
                      >
                        {option.label}
                      </Text>
                      {active ? (
                        <Ionicons name="checkmark" size={18} color={colors.primary[600]} />
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
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
    ...StyleSheet.absoluteFillObject,
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
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[700],
    marginBottom: spacing.xs,
  },
  fieldError: {
    fontSize: typography.fontSizes.xs,
    color: colors.status.danger,
    marginTop: spacing.xs,
  },
  selectControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: 46,
    gap: spacing.sm,
  },
  selectControlError: {
    borderColor: colors.status.danger,
  },
  selectValue: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    color: colors.neutral[900],
  },
  selectPlaceholder: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    color: colors.neutral[400],
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[900],
    minHeight: 42,
  },
  pickerList: {
    flexGrow: 0,
  },
  pickerEmpty: {
    color: colors.neutral[500],
    fontSize: typography.fontSizes.sm,
    padding: spacing.md,
    textAlign: 'center',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  pickerRowActive: {
    backgroundColor: colors.primary[50],
  },
  pickerRowText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[700],
  },
  pickerRowTextActive: {
    color: colors.primary[700],
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  switchLabel: {
    fontSize: typography.fontSizes.base,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  switchHint: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: 2,
  },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.neutral[300],
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackOn: {
    backgroundColor: colors.secondary[500],
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
  },
  switchThumbOn: {
    alignSelf: 'flex-end',
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    minWidth: 56,
    height: 56,
    paddingHorizontal: spacing.md,
    borderRadius: 28,
    backgroundColor: colors.primary[600],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
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
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
    lineHeight: 20,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
