import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import type { Tone } from '../lib/format';

/**
 * Mobile UI kit — the small set of primitives every screen is built from.
 * Tokens come from the shared `@school-bus-tracking/design-tokens` package so
 * the app stays visually consistent with the web product.
 */

const TONE_COLORS: Record<Tone, { bg: string; text: string }> = {
  neutral: { bg: colors.neutral[100], text: colors.neutral[700] },
  info: { bg: '#e0f2fe', text: '#0369a1' },
  warning: { bg: '#fef3c7', text: '#b45309' },
  success: { bg: '#dcfce7', text: colors.secondary[800] },
  danger: { bg: '#fee2e2', text: '#b91c1c' },
};

export const Badge: React.FC<{ tone?: Tone; label: string; style?: StyleProp<ViewStyle> }> = ({
  tone = 'neutral',
  label,
  style,
}) => {
  const toneColors = TONE_COLORS[tone];
  return (
    <View style={[styles.badge, { backgroundColor: toneColors.bg }, style]}>
      <Text style={[styles.badgeText, { color: toneColors.text }]}>{label}</Text>
    </View>
  );
};

export const Dot: React.FC<{ tone?: Tone }> = ({ tone = 'neutral' }) => (
  <View style={[styles.dot, { backgroundColor: TONE_COLORS[tone].text }]} />
);

export const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text style={styles.sectionTitle}>{children}</Text>
);

export const KeyValue: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.keyValue}>
    <Text style={styles.keyValueLabel}>{label}</Text>
    <Text style={styles.keyValueValue}>{value}</Text>
  </View>
);

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  small = false,
  style,
}) => {
  const variantStyle = styles[`${variant}Button`];
  const variantTextStyle = styles[`${variant}ButtonText`];
  const pressed = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={pressed}
      style={({ pressed: isPressed }) => [
        styles.buttonBase,
        small ? styles.buttonSmall : null,
        variantStyle,
        pressed ? styles.buttonDisabled : null,
        isPressed && !pressed ? styles.buttonPressed : null,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? '#ffffff' : colors.neutral[800]}
        />
      ) : (
        <Text style={[styles.buttonText, variantTextStyle, small ? styles.buttonSmallText : null]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
};

export interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string | null;
  /** Extra style for the label + input + message wrapper. */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Text field with label, hint and error.
 *
 * Forwards its ref to the underlying `TextInput` so forms can implement
 * `Next`-key focus chaining (`ref.current?.focus()`) and keyboard-aware
 * scrolling (`ref.current?.measureInWindow(...)`). `onLayout` on the wrapper
 * is likewise forwarded via `containerProps` for screens that need the row's
 * position inside a scroll view.
 */
export const Field = React.forwardRef<TextInput, FieldProps>(function Field(
  { label, error, hint, containerStyle, ...inputProps },
  ref,
) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.neutral[400]}
        autoCapitalize="none"
        {...inputProps}
        style={[styles.fieldInput, error ? styles.fieldInputError : null, inputProps.style]}
      />
      {hint && !error ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
});

/**
 * Search input with a leading icon, an inline "searching" spinner while the
 * debounce is pending and a clear (✕) button that resets the query in one tap.
 */
export const SearchBar: React.FC<{
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** True while a debounced request is pending — renders an inline spinner. */
  searching?: boolean;
  /** Optional explicit reset handler; defaults to `onChangeText('')`. */
  onClear?: () => void;
  autoFocus?: boolean;
}> = ({ value, onChangeText, placeholder = 'Search…', searching = false, onClear, autoFocus }) => (
  <View style={styles.searchBar}>
    <View style={styles.searchInputWrap}>
      <Ionicons name="search" size={18} color={colors.neutral[400]} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.neutral[400]}
        style={styles.searchInput}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        autoFocus={autoFocus}
        accessibilityLabel={placeholder}
      />
      {searching && value.length > 0 ? (
        <ActivityIndicator size="small" color={colors.neutral[400]} />
      ) : null}
      {value.length > 0 ? (
        <Pressable
          onPress={() => (onClear ? onClear() : onChangeText(''))}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={18} color={colors.neutral[400]} />
        </Pressable>
      ) : null}
    </View>
  </View>
);

/** Horizontally scrollable row of filter chips with an optional reset button. */
export const FilterChips = <T,>({
  options,
  value,
  onChange,
  style,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    keyboardShouldPersistTaps="handled"
    contentContainerStyle={[styles.chipRow, style]}
  >
    {options.map((option) => {
      const active = option.value === value;
      return (
        <Pressable
          key={String(option.value)}
          onPress={() => onChange(option.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          style={[styles.chip, active ? styles.chipActive : null]}
        >
          <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
            {option.label}
          </Text>
        </Pressable>
      );
    })}
  </ScrollView>
);

/** "3 filters active · Clear" strip shown above a filtered list. */
export const FilterSummary: React.FC<{
  label: string;
  onClear: () => void;
  clearLabel?: string;
}> = ({ label, onClear, clearLabel = 'Clear filters' }) => (
  <View style={styles.filterSummary}>
    <Text style={styles.filterSummaryText} numberOfLines={1}>
      {label}
    </Text>
    <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button">
      <Text style={styles.filterSummaryAction}>{clearLabel}</Text>
    </Pressable>
  </View>
);

/**
 * Scrollable screen body.
 *
 * The bottom padding always includes the device safe-area inset (Android
 * navigation bar / gesture pill, iOS home indicator) plus the tab-bar height,
 * so the last row of any list can be scrolled clear of the native navigation
 * area and stays tappable.
 */
export const Screen: React.FC<{
  children: React.ReactNode;
  refresh?: (() => void) | null;
  refreshing?: boolean;
  padded?: boolean;
  /** Extra bottom space, e.g. to clear a floating action button. */
  extraBottomSpace?: number;
}> = ({ children, refresh, refreshing = false, padded = true, extraBottomSpace = 0 }) => {
  const insets = useSafeAreaInsets();
  const bottomPadding = spacing.xl + insets.bottom + extraBottomSpace;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        padded ? { padding: spacing.md } : null,
        { paddingBottom: bottomPadding },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        refresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.primary[600]}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
};

export const LoadingView: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <View style={styles.centered}>
    <ActivityIndicator size="large" color={colors.primary[600]} />
    <Text style={styles.centeredText}>{label}</Text>
  </View>
);

export const EmptyState: React.FC<{
  title: string;
  description?: string;
  /** Optional call to action, e.g. a "Clear search" button (matches web). */
  action?: React.ReactNode;
}> = ({ title, description, action }) => (
  <View style={styles.stateCard}>
    <Text style={styles.stateTitle}>{title}</Text>
    {description ? <Text style={styles.stateDescription}>{description}</Text> : null}
    {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
  </View>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({
  message,
  onRetry,
}) => (
  <View style={styles.stateCard}>
    <Text style={styles.stateTitle}>Something went wrong</Text>
    <Text style={styles.stateDescription}>{message}</Text>
    {onRetry ? (
      <Button
        label="Try again"
        variant="secondary"
        onPress={onRetry}
        style={{ marginTop: spacing.md }}
      />
    ) : null}
  </View>
);

export const Banner: React.FC<{ tone?: Tone; message: string; onClose?: () => void }> = ({
  tone = 'info',
  message,
  onClose,
}) => {
  const toneColors = TONE_COLORS[tone];
  return (
    <View style={[styles.banner, { backgroundColor: toneColors.bg }]}>
      <Text style={[styles.bannerText, { color: toneColors.text }]}>{message}</Text>
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={8} style={styles.bannerClose}>
          <Text style={[styles.bannerCloseText, { color: toneColors.text }]}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

export const Divider: React.FC = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: '600',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.neutral[900],
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  keyValue: {
    flex: 1,
    minWidth: 0,
  },
  keyValueLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  keyValueValue: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[800],
    marginTop: 2,
  },
  buttonBase: {
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    minHeight: 44,
  },
  buttonSmall: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    minHeight: 32,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
  },
  buttonSmallText: {
    fontSize: typography.fontSizes.sm,
  },
  primaryButton: {
    backgroundColor: colors.primary[500],
  },
  primaryButtonText: {
    color: '#ffffff',
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  secondaryButtonText: {
    color: colors.neutral[800],
  },
  dangerButton: {
    backgroundColor: colors.status.danger,
  },
  dangerButtonText: {
    color: '#ffffff',
  },
  ghostButton: {
    backgroundColor: colors.neutral[100],
  },
  ghostButtonText: {
    color: colors.neutral[700],
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
  fieldInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: typography.fontSizes.base,
    color: colors.neutral[900],
    minHeight: 46,
  },
  fieldInputError: {
    borderColor: colors.status.danger,
  },
  fieldHint: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
  fieldError: {
    fontSize: typography.fontSizes.xs,
    color: colors.status.danger,
    marginTop: spacing.xs,
  },
  searchBar: {
    marginBottom: spacing.md,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    fontSize: typography.fontSizes.base,
    color: colors.neutral[900],
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 3,
    borderRadius: borderRadius.full,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    minHeight: 34,
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: colors.primary[600],
    borderColor: colors.primary[600],
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  chipTextActive: {
    color: '#ffffff',
  },
  filterSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  filterSummaryText: {
    flex: 1,
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    fontWeight: '600',
  },
  filterSummaryAction: {
    fontSize: typography.fontSizes.xs,
    color: colors.primary[700],
    fontWeight: '700',
  },
  screen: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.neutral[50],
  },
  centeredText: {
    color: colors.neutral[500],
    fontSize: typography.fontSizes.sm,
  },
  stateCard: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  stateTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[800],
    textAlign: 'center',
  },
  stateDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    textAlign: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  bannerText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
  },
  bannerClose: {
    padding: spacing.xs,
  },
  bannerCloseText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.neutral[200],
    marginVertical: spacing.sm,
  },
});
