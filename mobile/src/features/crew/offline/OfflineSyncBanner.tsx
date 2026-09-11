import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { Button } from '../../../components';
import { discardFailed, retryFailed } from './attendance-queue.ts';
import { getSyncUserId, refreshCounts, syncNow } from './attendance-sync.ts';
import { useSyncState } from './useOfflineAction';

/**
 * Crew-facing offline/sync status strip.
 *
 * Renders nothing while everything is confirmed and online. Otherwise it
 * tells the crew exactly what is happening with their actions:
 *
 * - offline with pending items → "Saved on this phone · will sync…"
 * - online, replaying → "Syncing N actions…"
 * - transient error → "Will retry" + manual Sync now
 * - permanent failures → the server's reason + Retry / Dismiss
 */
export const OfflineSyncBanner: React.FC = () => {
  const sync = useSyncState();
  const [busy, setBusy] = useState(false);

  const hasPending = sync.pendingCount > 0;
  const hasFailed = sync.failedCount > 0;

  if (sync.isOnline && !hasPending && !hasFailed && sync.status !== 'error') {
    return null;
  }

  const tone: 'offline' | 'syncing' | 'error' =
    hasFailed || sync.status === 'error' ? 'error' : sync.isOnline ? 'syncing' : 'offline';

  const title = !sync.isOnline
    ? hasPending
      ? `Offline · ${sync.pendingCount} action${sync.pendingCount === 1 ? '' : 's'} saved on this phone`
      : 'Offline · actions will be saved and synced later'
    : sync.status === 'syncing'
      ? `Syncing ${sync.pendingCount} action${sync.pendingCount === 1 ? '' : 's'}…`
      : hasFailed
        ? `${sync.failedCount} action${sync.failedCount === 1 ? '' : 's'} could not be synced`
        : hasPending
          ? `${sync.pendingCount} action${sync.pendingCount === 1 ? '' : 's'} waiting to sync`
          : 'Sync problem';

  const detail = !sync.isOnline
    ? 'They will be sent automatically when the connection returns.'
    : hasFailed && sync.lastError
      ? sync.lastError
      : sync.status === 'error' && sync.lastError
        ? `Will retry automatically. ${sync.lastError}`
        : null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.wrap, styles[tone]]} accessibilityRole="alert">
      <Text style={styles.title}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      <View style={styles.actions}>
        {sync.isOnline && hasPending && sync.status !== 'syncing' ? (
          <Button
            label="Sync now"
            small
            variant="secondary"
            disabled={busy}
            onPress={() => void run(() => syncNow())}
          />
        ) : null}
        {hasFailed ? (
          <>
            <Button
              label="Retry"
              small
              variant="secondary"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await retryFailed(getSyncUserId());
                  await refreshCounts();
                  await syncNow();
                })
              }
            />
            <Button
              label="Dismiss"
              small
              variant="ghost"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await discardFailed(getSyncUserId());
                  await refreshCounts();
                })
              }
            />
          </>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 4,
  },
  offline: { backgroundColor: colors.neutral[100], borderColor: colors.neutral[300] },
  syncing: { backgroundColor: colors.primary[50], borderColor: colors.primary[200] },
  error: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  title: { fontSize: 13, fontWeight: '700', color: colors.neutral[900] },
  detail: { fontSize: 12, color: colors.neutral[600] },
  actions: { flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
});
