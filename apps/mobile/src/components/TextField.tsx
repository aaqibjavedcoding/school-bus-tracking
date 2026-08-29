import React from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, borderRadius, spacing } from '@school-bus-tracking/design-tokens';

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
}

/** Labelled input with error + hint, dark-on-light, ≥44pt tall. */
export const TextField: React.FC<TextFieldProps> = ({ label, error, hint, style, ...input }) => (
  <View style={styles.wrapper}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={colors.neutral[400]}
      style={[styles.input, Boolean(error) && styles.inputError, style]}
      {...input}
    />
    {error ? (
      <Text accessibilityRole="alert" style={styles.error}>
        {error}
      </Text>
    ) : hint ? (
      <Text style={styles.hint}>{hint}</Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[700],
    marginBottom: spacing.xs,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.neutral[900],
    backgroundColor: '#ffffff',
  },
  inputError: {
    borderColor: colors.status.danger,
  },
  error: {
    color: colors.status.danger,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  hint: {
    color: colors.neutral[500],
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
