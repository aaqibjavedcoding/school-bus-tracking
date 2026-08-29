import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  meta?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The app's core navigation row: title, context line, status slot, chevron. */
export const ListRow: React.FC<ListRowProps> = ({
  title,
  subtitle,
  meta,
  right,
  onPress,
  disabled,
  style,
  testID,
}) => {
  const body = (
    <View style={styles.rowContent}>
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      <View style={styles.rowRight}>
        {right}
        {onPress && !disabled ? <Text style={styles.chevron}>›</Text> : null}
      </View>
    </View>
  );
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          pressed && styles.pressed,
          !onPress && styles.plain,
          style,
        ]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={[styles.row, styles.plain, style]}>{body}</View>;
};

const styles = StyleSheet.create({
  row: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 56,
    justifyContent: 'center',
  },
  plain: {
    minHeight: 48,
  },
  pressed: {
    backgroundColor: colors.neutral[100],
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowText: {
    flex: 1,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  subtitle: {
    fontSize: 13,
    color: colors.neutral[600],
    marginTop: 2,
  },
  meta: {
    fontSize: 12,
    color: colors.neutral[500],
    marginTop: 2,
  },
  chevron: {
    fontSize: 20,
    color: colors.neutral[400],
    marginLeft: spacing.xs,
  },
});
