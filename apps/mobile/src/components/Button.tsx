import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, borderRadius, spacing } from '@school-bus-tracking/design-tokens';

/**
 * Mobile button with explicit sizes, a 48pt minimum touch target, a busy
 * state that *also* blocks double-taps, and accessibility roles.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  fullWidth?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  fullWidth = false,
  small = false,
  style,
  testID,
}) => {
  const blocked = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy }}
      accessibilityLabel={label}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        small ? styles.small : styles.regular,
        fullWidth && styles.fullWidth,
        styles[`variant_${variant}` as const],
        pressed && !blocked && styles.pressed,
        blocked && styles.blocked,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={variant === 'secondary' || variant === 'ghost' ? colors.primary[700] : '#ffffff'}
        />
      ) : null}
      <Text
        style={[styles.label, variant !== 'primary' && variant !== 'danger' && styles.labelDark]}
      >
        {label}
      </Text>
    </Pressable>
  );
};

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: {
    backgroundColor: colors.primary[500],
  },
  secondary: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  danger: {
    backgroundColor: colors.status.danger,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
};

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  regular: {},
  small: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  pressed: {
    opacity: 0.85,
  },
  blocked: {
    opacity: 0.5,
  },
  label: {
    fontWeight: '700',
    fontSize: 16,
    color: '#ffffff',
  },
  labelDark: {
    color: colors.neutral[800],
  },
  variant_primary: variantStyles.primary,
  variant_secondary: variantStyles.secondary,
  variant_danger: variantStyles.danger,
  variant_ghost: variantStyles.ghost,
});

export const linkStyle: TextStyle = {
  color: colors.primary[700],
  fontWeight: '600',
};
