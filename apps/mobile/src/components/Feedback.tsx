import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';
import { Button } from './Button';

export const LoadingView: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <View style={styles.center} accessibilityLabel={label} accessibilityLiveRegion="polite">
    <ActivityIndicator size="large" color={colors.primary[600]} />
    <Text style={styles.muted}>{label}</Text>
  </View>
);

/** Lightweight skeleton block for list headers while data streams in. */
export const SkeletonBlock: React.FC<{ height?: number; style?: StyleProp<ViewStyle> }> = ({
  height = 18,
  style,
}) => <View style={[styles.skeleton, { height }, style]} />;

export const SkeletonList: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <View>
    {Array.from({ length: rows }).map((_, index) => (
      <View key={index} style={styles.skeletonRow}>
        <SkeletonBlock height={44} style={{ flex: 1 }} />
      </View>
    ))}
  </View>
);

export const EmptyState: React.FC<{
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: string;
}> = ({ title, message, actionLabel, onAction, icon = '🚌' }) => (
  <View style={[styles.emptyBox, { borderColor: colors.neutral[200] }]}>
    <Text style={styles.emptyIcon}>{icon}</Text>
    <Text style={styles.emptyTitle}>{title}</Text>
    {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
    {actionLabel && onAction ? (
      <Button
        label={actionLabel}
        onPress={onAction}
        variant="secondary"
        small
        style={{ marginTop: spacing.md }}
      />
    ) : null}
  </View>
);

export const ErrorBanner: React.FC<{
  message: string;
  onRetry?: () => void;
  tone?: 'danger' | 'warning' | 'info';
}> = ({ message, onRetry, tone = 'danger' }) => (
  <View style={[styles.banner, styles[`banner_${tone}`]]} accessibilityRole="alert">
    <Text style={styles.bannerText}>{message}</Text>
    {onRetry ? (
      <Pressable onPress={onRetry} accessibilityRole="button">
        <Text style={styles.bannerRetry}>Retry</Text>
      </Pressable>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  center: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  muted: {
    color: colors.neutral[500],
    fontSize: 13,
  },
  skeleton: {
    backgroundColor: colors.neutral[200],
    borderRadius: borderRadius.sm,
    opacity: 0.7,
  },
  skeletonRow: {
    marginBottom: spacing.sm,
  },
  emptyBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    marginVertical: spacing.md,
    backgroundColor: '#ffffff',
  },
  emptyIcon: {
    fontSize: 28,
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  emptyMessage: {
    fontSize: 13,
    color: colors.neutral[500],
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  banner: {
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  banner_danger: {
    backgroundColor: '#fee2e2',
  },
  banner_warning: {
    backgroundColor: colors.primary[100],
  },
  banner_info: {
    backgroundColor: '#e0f2fe',
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    color: colors.neutral[800],
  },
  bannerRetry: {
    fontWeight: '700',
    color: colors.primary[800],
  },
});
