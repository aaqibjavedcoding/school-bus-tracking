import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PaginationMeta } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';

/**
 * Shared list-screen building blocks for the school-admin CRUD surfaces:
 * a tappable/action-carrying row card and a compact pager — mirroring the
 * web console's tables + `Pagination` without a table on a phone.
 */

export const ListCard: React.FC<{
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  right?: React.ReactNode;
  onPress?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}> = ({ title, subtitle, meta, right, onPress, onEdit, onDelete, children, style }) => {
  const body = (
    <>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
          {meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
        {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.neutral[300]} /> : null}
      </View>
      {children}
      {onEdit || onDelete ? (
        <View style={styles.actions}>
          {onEdit ? (
            <Pressable onPress={onEdit} style={styles.actionBtn} hitSlop={6}>
              <Ionicons name="create-outline" size={16} color={colors.primary[700]} />
              <Text style={styles.actionText}>Edit</Text>
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable onPress={onDelete} style={styles.actionBtn} hitSlop={6}>
              <Ionicons name="trash-outline" size={16} color={colors.status.danger} />
              <Text style={[styles.actionText, { color: colors.status.danger }]}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null, style]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{body}</View>;
};

export const Pagination: React.FC<{ meta: PaginationMeta; onPage: (page: number) => void }> = ({
  meta,
  onPage,
}) => {
  if (meta.totalPages <= 1) return null;
  return (
    <View style={styles.pager}>
      <Pressable
        onPress={() => onPage(meta.page - 1)}
        disabled={!meta.hasPreviousPage}
        style={[styles.pagerBtn, !meta.hasPreviousPage ? styles.pagerBtnDisabled : null]}
      >
        <Ionicons name="chevron-back" size={18} color={colors.neutral[700]} />
      </Pressable>
      <Text style={styles.pagerText}>
        Page {meta.page} of {meta.totalPages}
      </Text>
      <Pressable
        onPress={() => onPage(meta.page + 1)}
        disabled={!meta.hasNextPage}
        style={[styles.pagerBtn, !meta.hasNextPage ? styles.pagerBtnDisabled : null]}
      >
        <Ionicons name="chevron-forward" size={18} color={colors.neutral[700]} />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardPressed: {
    opacity: 0.7,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  subtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
    marginTop: 2,
  },
  meta: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.primary[700],
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  pagerBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  pagerBtnDisabled: {
    opacity: 0.4,
  },
  pagerText: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
    fontWeight: '600',
  },
});
