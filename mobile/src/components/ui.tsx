import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type FocusEvent,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { fontScaleCaps, surface, text as textScale, touch } from '../theme';
import type { Tone } from '../lib/format';
import { keyboardBehavior } from '../lib/keyboard-aware';
import { useKeyboardForm, useKeyboardReveal, KeyboardFormContext } from './keyboard-form';
import { useTranslation } from '../lib/i18n-provider';

/**
 * Mobile UI kit — the small set of primitives every screen is built from.
 * Tokens come from the shared `@school-bus-tracking/design-tokens` package;
 * the legibility layer (`theme/tokens.ts`: text/touch/surface aliases) sits
 * on top so phone screens stay readable. Compact touch floors (32/40/48)
 * keep buttons and inputs from feeling oversized on mobile. Contrast choices
 * are pinned by `theme/contrast.spec.ts`.
 */

const TONE_COLORS: Record<Tone, { bg: string; text: string }> = {
  neutral: { bg: colors.neutral[100], text: colors.neutral[700] },
  info: { bg: '#e0f2fe', text: '#0369a1' },
  warning: { bg: '#fef3c7', text: '#b45309' },
  success: { bg: '#dcfce7', text: colors.secondary[800] },
  danger: { bg: '#fee2e2', text: '#b91c1c' },
};

/** Badge/chip text sizes: `md` is the compact admin look, `lg` the crew one. */
type BadgeSize = 'md' | 'lg';

export const Badge: React.FC<{
  tone?: Tone;
  label: string;
  size?: BadgeSize;
  style?: StyleProp<ViewStyle>;
}> = ({ tone = 'neutral', label, size = 'md', style }) => {
  const toneColors = TONE_COLORS[tone];
  return (
    <View
      style={[
        styles.badge,
        size === 'lg' ? styles.badgeLarge : null,
        { backgroundColor: toneColors.bg },
        style,
      ]}
    >
      <Text
        {...fontScaleCaps.label}
        style={[
          styles.badgeText,
          size === 'lg' ? styles.badgeLargeText : null,
          { color: toneColors.text },
        ]}
      >
        {label}
      </Text>
    </View>
  );
};

export const Dot: React.FC<{ tone?: Tone }> = ({ tone = 'neutral' }) => (
  <View style={[styles.dot, { backgroundColor: TONE_COLORS[tone].text }]} />
);

export const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text style={styles.sectionTitle}>{children}</Text>
);

export const KeyValue: React.FC<{ label: string; value: string; legible?: boolean }> = ({
  label,
  value,
  legible = false,
}) =>
  legible ? (
    <View style={styles.keyValue}>
      <Text style={styles.keyValueLabelLegible}>{label}</Text>
      <Text {...fontScaleCaps.label} style={styles.keyValueValueLegible}>
        {value}
      </Text>
    </View>
  ) : (
    <View style={styles.keyValue}>
      <Text style={styles.keyValueLabel}>{label}</Text>
      <Text style={styles.keyValueValue}>{value}</Text>
    </View>
  );

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
/** Tint override for the filled variants — e.g. a green confirm ("Board"). */
export type ButtonTone = 'primary' | 'success' | 'danger' | 'neutral';
/**
 * `sm` is the dense admin row action (32px); `md` (40px) is the default every
 * button gets; `lg` (44px) for prominent actions; `field` (48px) is the crew
 * floor for field work — start trip, board, SOS, share GPS — compact, not oversized.
 */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'field';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Tint of the filled surface (default follows the variant). */
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Leading Ionicons glyph — an icon + label is read faster than either alone. */
  icon?: keyof typeof Ionicons.glyphMap;
  iconRight?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  busy?: boolean;
  /** @deprecated Use `size="sm"` — kept so dense admin rows migrate call by call. */
  small?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

const BUTTON_HEIGHTS: Record<ButtonSize, number> = {
  sm: touch.compact, // 32
  md: touch.target, // 40
  lg: 44,
  field: touch.field, // 48
};

const BUTTON_TEXT_SIZES: Record<ButtonSize, number> = {
  // Compact scale: smaller than before so buttons don't feel oversized.
  sm: 12,
  md: 13,
  lg: 13,
  field: 14,
};

const BUTTON_ICON_SIZES: Record<ButtonSize, number> = {
  sm: 14,
  md: 16,
  lg: 18,
  field: 20,
};

const FILLED_TONES: Record<ButtonTone, string> = {
  // White on every entry here is ≥4.5:1 — pinned in `contrast.spec.ts`.
  primary: surface.actionPrimary,
  success: surface.actionSuccess,
  danger: surface.actionDanger,
  neutral: colors.neutral[700],
};

const PRESS_SCALE = 0.965;

export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  tone,
  size,
  icon,
  iconRight,
  disabled = false,
  busy = false,
  small = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}) => {
  const resolvedSize: ButtonSize = size ?? (small ? 'sm' : 'md');
  const filled = variant === 'primary' || variant === 'danger';
  const resolvedTone: ButtonTone = tone ?? (variant === 'danger' ? 'danger' : 'primary');
  // Compact floors: small rows 32px, default 40px, field 48px.
  const inert = disabled || busy;
  const scale = useRef(new Animated.Value(1)).current;

  const pressScale = (toValue: number) =>
    Animated.timing(scale, { toValue, duration: 90, useNativeDriver: true }).start();

  const contentColor = filled
    ? '#ffffff'
    : variant === 'secondary'
      ? colors.neutral[800]
      : colors.neutral[700];

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      onPressIn={() => {
        if (!inert) pressScale(PRESS_SCALE);
      }}
      onPressOut={() => {
        if (!inert) pressScale(1);
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy }}
      style={({ pressed }) => [
        styles.buttonBase,
        { minHeight: BUTTON_HEIGHTS[resolvedSize] },
        filled
          ? { backgroundColor: FILLED_TONES[resolvedTone] }
          : variant === 'secondary'
            ? styles.secondaryButton
            : styles.ghostButton,
        inert ? styles.buttonDisabled : null,
        pressed && !inert ? styles.buttonPressed : null,
        style,
      ]}
    >
      <Animated.View style={[styles.buttonContent, { transform: [{ scale }] }]}>
        {busy ? (
          <ActivityIndicator size="small" color={contentColor} />
        ) : (
          <View style={styles.buttonRow}>
            {icon ? (
              <Ionicons name={icon} size={BUTTON_ICON_SIZES[resolvedSize]} color={contentColor} />
            ) : null}
            <Text
              {...fontScaleCaps.button}
              style={[
                styles.buttonText,
                { color: contentColor, fontSize: BUTTON_TEXT_SIZES[resolvedSize] },
              ]}
            >
              {label}
            </Text>
            {iconRight ? (
              <Ionicons
                name={iconRight}
                size={BUTTON_ICON_SIZES[resolvedSize]}
                color={contentColor}
              />
            ) : null}
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
};

export interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string | null;
  /** Extra style for the label + input + message wrapper. */
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * Right-aligned accessory rendered over the input row (the show/hide eye of
   * {@link PasswordField}). The input gains extra right padding so its text
   * never slides under it.
   */
  trailing?: React.ReactNode;
}

/**
 * Text field with label, hint and error.
 *
 * Forwards its ref to the underlying `TextInput` so forms can implement
 * `Next`-key focus chaining (`ref.current?.focus()`) and keyboard-aware
 * scrolling (`ref.current?.measureInWindow(...)`).
 *
 * Keyboard-aware by construction: when a field renders inside a
 * keyboard-aware scroll form (see `keyboard-form.tsx`), it registers itself
 * on focus so the form scrolls it clear of the keyboard — every screen gets
 * the behaviour without wiring its own listeners.
 */
export const Field = React.forwardRef<TextInput, FieldProps>(function Field(
  { label, error, hint, containerStyle, trailing, onFocus, ...inputProps },
  ref,
) {
  const keyboardForm = useKeyboardForm();
  const internalRef = useRef<TextInput>(null);
  const setNode = useCallback(
    (node: TextInput | null) => {
      internalRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );
  const handleFocus = useCallback(
    (event: FocusEvent) => {
      if (internalRef.current) keyboardForm?.focusInput(internalRef.current);
      onFocus?.(event);
    },
    [keyboardForm, onFocus],
  );
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputShell}>
        <TextInput
          ref={setNode}
          placeholderTextColor={surface.placeholder}
          autoCapitalize="none"
          {...inputProps}
          onFocus={handleFocus}
          style={[
            styles.fieldInput,
            trailing ? styles.fieldInputWithAccessory : null,
            error ? styles.fieldInputError : null,
            inputProps.style,
          ]}
        />
        {trailing ? <View style={styles.fieldTrailing}>{trailing}</View> : null}
      </View>
      {hint && !error ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
});

export type PasswordFieldProps = Omit<FieldProps, 'secureTextEntry' | 'trailing'>;

/**
 * Password field with the show/hide eye built in — the one password input for
 * the app (login, staff, guardians).
 *
 * Tapping the eye toggles `secureTextEntry`; the glyph always matches the
 * visibility state (`eye-outline` while hidden, `eye-off-outline` while
 * visible), and the button's accessibility label says what the next tap will
 * do. A `secureTextEntry` passed by a caller is ignored — the field *is*
 * secure, the eye is the only switch.
 */
export const PasswordField = React.forwardRef<TextInput, PasswordFieldProps>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false);
    const t = useTranslation();
    return (
      <Field
        ref={ref}
        {...props}
        secureTextEntry={!visible}
        trailing={
          <Pressable
            onPress={() => setVisible((value) => !value)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={visible ? t('common.hidePassword') : t('common.showPassword')}
            accessibilityState={{ selected: visible }}
            style={styles.passwordEye}
          >
            <Ionicons
              name={visible ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.neutral[500]}
            />
          </Pressable>
        }
      />
    );
  },
);

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
  /** `field` gives the crew's gloved-finger bar (56px). */
  size?: 'md' | 'field';
}> = ({
  value,
  onChangeText,
  placeholder = 'Search…',
  searching = false,
  onClear,
  autoFocus,
  size = 'md',
}) => {
  const keyboardForm = useKeyboardForm();
  const inputRef = useRef<TextInput>(null);
  return (
    <View style={styles.searchBar}>
      <View
        style={[
          styles.searchInputWrap,
          size === 'field' ? { minHeight: touch.field } : { minHeight: touch.target },
        ]}
      >
        <Ionicons name="search" size={20} color={colors.neutral[500]} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={surface.placeholder}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
          autoFocus={autoFocus}
          accessibilityLabel={placeholder}
          onFocus={() => {
            if (inputRef.current) keyboardForm?.focusInput(inputRef.current);
          }}
        />
        {searching && value.length > 0 ? (
          <ActivityIndicator size="small" color={colors.neutral[500]} />
        ) : null}
        {value.length > 0 ? (
          <Pressable
            onPress={() => (onClear ? onClear() : onChangeText(''))}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            style={styles.searchClear}
          >
            <Ionicons name="close-circle" size={20} color={colors.neutral[500]} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

/** Horizontally scrollable row of filter chips with an optional reset button. */
export const FilterChips = <T,>({
  options,
  value,
  onChange,
  size = 'md',
  style,
}: {
  options: ReadonlyArray<{ value: T; label: string; icon?: keyof typeof Ionicons.glyphMap }>;
  value: T;
  onChange: (value: T) => void;
  /** `field` = the crew floor (56px, 16px text); `md` keeps the dense admin look. */
  size?: 'md' | 'field';
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
      const chipTextColor = active ? '#ffffff' : colors.neutral[700];
      return (
        <Pressable
          key={String(option.value)}
          onPress={() => onChange(option.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          style={[
            styles.chip,
            size === 'field' ? styles.chipField : null,
            active ? styles.chipActive : null,
          ]}
        >
          {option.icon ? (
            <Ionicons name={option.icon} size={size === 'field' ? 20 : 16} color={chipTextColor} />
          ) : null}
          <Text
            {...fontScaleCaps.label}
            style={[
              styles.chipText,
              size === 'field' ? styles.chipFieldText : null,
              { color: chipTextColor },
            ]}
          >
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
    <Pressable
      onPress={onClear}
      hitSlop={8}
      accessibilityRole="button"
      style={styles.filterSummaryAction}
    >
      <Text style={styles.filterSummaryActionText}>{clearLabel}</Text>
    </Pressable>
  </View>
);

/**
 * Pull-to-refresh control without a visible "Refreshing…" caption.
 *
 * React Native Web paints a top-of-screen "Refreshing…" / "Pull to refresh"
 * status label whenever a RefreshControl is mounted. That caption also
 * flashes on every list remount (tab change, laptop-driven cache bust that
 * re-renders the same screen). Native iOS can show the same title. We never
 * want that chrome: pull-to-refresh stays as a spinner-only gesture on iOS
 * and Android, and the browser's own refresh handles web.
 */
export function screenRefreshControl(
  refresh?: (() => void) | null,
  refreshing = false,
): React.ReactElement<React.ComponentProps<typeof RefreshControl>> | undefined {
  if (!refresh || Platform.OS === 'web') {
    return undefined;
  }
  const control: React.ReactElement<React.ComponentProps<typeof RefreshControl>> = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={refresh}
      tintColor={colors.secondary[700]}
      colors={[colors.secondary[700]]}
      title=""
      titleColor="transparent"
      progressViewOffset={0}
    />
  );
  return control;
}

/**
 * Scrollable screen body.
 *
 * The bottom padding always includes the device safe-area inset (Android
 * navigation bar / gesture pill, iOS home indicator) plus the tab-bar height,
 * so the last row of any list can be scrolled clear of the native navigation
 * area and stays tappable.
 *
 * Keyboard-aware like every other scroll form here: full-screen forms built
 * on `Screen` (e.g. the document-requirements editor) get the KAV plus
 * scroll-the-focused-input-into-view behaviour for free.
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
  const scrollRef = useRef<ScrollView>(null);
  const { contextValue, onScroll } = useKeyboardReveal(scrollRef);
  return (
    <KeyboardFormContext.Provider value={contextValue}>
      <KeyboardAvoidingView style={styles.screen} behavior={keyboardBehavior(Platform.OS)}>
        <ScrollView
          ref={scrollRef}
          style={styles.screen}
          contentContainerStyle={[
            padded ? { padding: spacing.md } : null,
            { paddingBottom: bottomPadding },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={screenRefreshControl(refresh, refreshing)}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </KeyboardFormContext.Provider>
  );
};

export const LoadingView: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <View style={styles.centered}>
    <ActivityIndicator size="large" color={colors.secondary[700]} />
    <Text style={styles.centeredText}>{label}</Text>
  </View>
);

export const EmptyState: React.FC<{
  title: string;
  description?: string;
  /** Optional call to action, e.g. a "Clear search" button (matches web). */
  action?: React.ReactNode;
  /** Optional icon above the title — icon + text reads faster than text alone. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** The crew/deliberate-reading variant: larger, calmer, centred icons. */
  legible?: boolean;
}> = ({ title, description, action, icon, legible = false }) => (
  <View style={[styles.stateCard, legible ? styles.stateCardLegible : null]}>
    {icon ? <Ionicons name={icon} size={legible ? 40 : 28} color={colors.neutral[500]} /> : null}
    <Text style={[styles.stateTitle, legible ? styles.stateTitleLegible : null]}>{title}</Text>
    {description ? (
      <Text style={[styles.stateDescription, legible ? styles.stateDescriptionLegible : null]}>
        {description}
      </Text>
    ) : null}
    {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
  </View>
);

export const ErrorState: React.FC<{
  message: string;
  onRetry?: () => void;
  legible?: boolean;
}> = ({ message, onRetry, legible = false }) => (
  <View style={[styles.stateCard, legible ? styles.stateCardLegible : null]}>
    <Ionicons name="cloud-offline-outline" size={legible ? 40 : 28} color={colors.status.danger} />
    <Text style={[styles.stateTitle, legible ? styles.stateTitleLegible : null]}>
      Something went wrong
    </Text>
    <Text style={[styles.stateDescription, legible ? styles.stateDescriptionLegible : null]}>
      {message}
    </Text>
    {onRetry ? (
      <Button
        label="Try again"
        variant="secondary"
        size={legible ? 'lg' : 'md'}
        icon="refresh"
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
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={styles.bannerClose}
        >
          <Ionicons name="close" size={20} color={toneColors.text} />
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
  badgeLarge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  badgeText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
  },
  badgeLargeText: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
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
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  keyValueValue: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[800],
    marginTop: 2,
  },
  keyValueLabelLegible: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[600],
    fontWeight: '600',
  },
  keyValueValueLegible: {
    fontSize: textScale.numeric,
    fontWeight: '700',
    color: colors.neutral[900],
    marginTop: 2,
  },
  buttonBase: {
    borderRadius: borderRadius.md,
    // Compact padding: 16dp horizontal, 6dp vertical — less bulky on mobile.
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: surface.borderInteractive,
  },
  ghostButton: {
    backgroundColor: colors.neutral[100],
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
  fieldInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: surface.borderInteractive,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[900],
    minHeight: touch.target,
  },
  fieldInputError: {
    borderColor: colors.status.danger,
  },
  /**
   * Row the input lives in so a `trailing` accessory (the password eye) can
   * sit over the input's right edge. With no accessory it is an invisible
   * pass-through: the input keeps its own size and layout.
   */
  fieldInputShell: {},
  /** Right pad so typed text never slides under the eye. */
  fieldInputWithAccessory: {
    paddingRight: 44,
  },
  fieldTrailing: {
    position: 'absolute',
    right: spacing.xs,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  passwordEye: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  fieldHint: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
    marginTop: spacing.xs,
  },
  fieldError: {
    fontSize: typography.fontSizes.sm,
    color: colors.status.danger,
    marginTop: spacing.xs,
  },
  searchBar: {
    marginBottom: spacing.sm,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: surface.borderInteractive,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.xs + 2,
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[900],
  },
  searchClear: {
    minHeight: touch.compact,
    minWidth: touch.compact,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: surface.borderInteractive,
    minHeight: 28,
    justifyContent: 'center',
  },
  chipField: {
    minHeight: touch.target,
    paddingHorizontal: spacing.md,
  },
  chipActive: {
    backgroundColor: surface.actionPrimary,
    borderColor: surface.actionPrimary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  chipFieldText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
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
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
    fontWeight: '600',
  },
  filterSummaryAction: {
    minHeight: touch.compact,
    justifyContent: 'center',
  },
  filterSummaryActionText: {
    fontSize: typography.fontSizes.sm,
    color: surface.actionPrimary,
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
    color: colors.neutral[600],
    fontSize: typography.fontSizes.base,
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
  stateCardLegible: {
    padding: spacing.xl,
    gap: spacing.sm,
  },
  stateTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[800],
    textAlign: 'center',
  },
  stateTitleLegible: {
    fontSize: typography.fontSizes.xl,
    color: colors.neutral[900],
  },
  stateDescription: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[600],
    textAlign: 'center',
  },
  stateDescriptionLegible: {
    fontSize: typography.fontSizes.lg,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  bannerText: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    fontWeight: '600',
  },
  bannerClose: {
    minHeight: touch.compact,
    minWidth: touch.compact,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.neutral[200],
    marginVertical: spacing.sm,
  },
});
