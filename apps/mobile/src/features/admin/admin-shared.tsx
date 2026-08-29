import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { ListRow, type ListRowProps } from '../../components/ListRow';
import { RefreshList } from '../../components/RefreshList';
import { SearchBar } from '../../components/SearchBar';
import { Card } from '../../components/Card';
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge';
import { confirmAction } from '../../components/Confirm';
import { useToast } from '../../components/Toast';
import { getApiErrorMessage } from '../../utils/errors';
import { ApiClientError } from '@school-bus-tracking/api-client';

/**
 * Shared scaffolding for the Admin app so every management surface has the
 * same look and behaviour (search, pull-to-refresh, add, edit, delete) while
 * all mutation semantics stay in the API.
 */

export interface AdminRow extends Omit<ListRowProps, 'onPress'> {
  id: string;
  badge?: { label: string; tone: BadgeTone };
  detailHref?: string;
  onDelete?: () => Promise<boolean>;
  deleteLabel?: string;
}

export const AdminEntityList: React.FC<{
  rows: AdminRow[];
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  searchValue?: string;
  searchPlaceholder?: string;
  onSearch?: (value: string) => void;
  newLabel?: string;
  newHref?: string;
  emptyTitle?: string;
  emptyMessage?: string;
}> = ({
  rows,
  loading,
  refreshing,
  error,
  onRefresh,
  searchPlaceholder,
  onSearch,
  newLabel = 'Add new',
  newHref,
  emptyTitle = 'Nothing here yet',
  emptyMessage,
}) => {
  const router = useRouter();
  const toast = useToast();
  const [busyDelete, setBusyDelete] = useState<string | null>(null);

  const attemptDelete = async (row: AdminRow): Promise<void> => {
    if (!row.onDelete) {
      return;
    }
    const ok = await confirmAction(
      `Remove “${row.title}”?`,
      row.deleteLabel ??
        'The API decides whether this deletes or deactivates the record, and refuses if it is still referenced.',
      { confirmLabel: 'Delete', destructive: true },
    );
    if (!ok) {
      return;
    }
    setBusyDelete(row.id);
    try {
      const deleted = await row.onDelete();
      toast.show(
        deleted
          ? 'Record removed (server-confirmed).'
          : 'The server refused the delete — see details.',
        deleted ? 'success' : 'danger',
      );
    } finally {
      setBusyDelete(null);
    }
  };

  return (
    <Screen scroll={false}>
      {onSearch && searchPlaceholder !== undefined ? (
        <SearchBar placeholder={searchPlaceholder} onSearch={onSearch} />
      ) : null}
      {newHref ? (
        <Button
          label={newLabel}
          onPress={() => router.push(newHref as never)}
          style={styles.newButton}
        />
      ) : null}
      <RefreshList
        data={rows}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        emptyTitle={emptyTitle}
        emptyMessage={emptyMessage}
        skeleton
        keyExtractor={(item: AdminRow) => item.id}
        renderItem={({ item }: { item: AdminRow }) => (
          <ListRow
            {...item}
            right={
              <>
                {item.badge ? (
                  <StatusBadge tone={item.badge.tone} label={item.badge.label} compact />
                ) : null}
                {item.onDelete ? (
                  <Button
                    label={busyDelete === item.id ? '…' : 'Delete'}
                    small
                    variant="danger"
                    busy={busyDelete === item.id}
                    onPress={() => void attemptDelete(item)}
                    style={styles.inlineDelete}
                  />
                ) : null}
              </>
            }
            onPress={item.detailHref ? () => router.push(item.detailHref as never) : undefined}
          />
        )}
      />
    </Screen>
  );
};

/** Form scaffold for create/edit screens. */
export const AdminFormScreen: React.FC<{
  title?: string;
  children: React.ReactNode;
  onSave: () => unknown;
  saveLabel?: string;
  busy?: boolean;
  banner?: string | null;
  onRetry?: () => void;
  footer?: React.ReactNode;
}> = ({ children, onSave, saveLabel = 'Save', busy = false, banner }) => {
  const [saving, setSaving] = useState(busy);
  return (
    <Screen>
      {banner ? (
        <View style={styles.bannerWrap}>
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      ) : null}
      <Card>{children}</Card>
      <Button
        label={saving ? 'Saving…' : saveLabel}
        busy={saving || busy}
        onPress={() => {
          setSaving(true);
          void Promise.resolve(onSave()).finally(() => setSaving(false));
        }}
        fullWidth
        testID="admin-form-save"
      />
    </Screen>
  );
};

/** Extract the first message per field from a Zod error. */
export function zodFieldErrors(error: {
  issues: Array<{ path: ReadonlyArray<string | number>; message: string }>;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) {
      out[key] = issue.message;
    }
  }
  return out;
}

export function messageFromError(error: unknown, fallback = 'The request failed.'): string {
  if (error instanceof ApiClientError) {
    return getApiErrorMessage(error, fallback);
  }
  return error instanceof Error ? error.message : fallback;
}

const styles = StyleSheet.create({
  newButton: {
    marginBottom: spacing.md,
  },
  inlineDelete: {
    marginLeft: spacing.xs,
  },
  bannerWrap: {
    backgroundColor: colors.status.danger,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
