import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { Button } from '../../../components';
import { discardFailed, retryFailed } from './attendance-queue.ts';
import { getSyncUserId, refreshCounts, syncNow } from './attendance-sync.ts';
import { useSyncState } from './useOfflineAction';
import { pluralKey, t } from '../../../lib/i18n.ts';
import { useTranslation } from '../../../lib/i18n-provider';
import { feedback } from '../crew-feedback.ts';

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
  // Subscribes to the locale: the banner's whole payload is translated copy.
  useTranslation();
  const sync = useSyncState();
  const [busy, setBusy] = useState(false);

  const hasPending = sync.pendingCount > 0;
  const hasFailed = sync.failedCount > 0;

  /**
   * Phase 3b: announce the queue draining — "7 saved actions have been sent".
   *
   * Derived purely from the sync state this banner already subscribes to, so
   * the **queue itself is zero-touch**: nothing was added to `queue-core`,
   * `attendance-queue`, `attendance-sync` or `useOfflineAction`
   * (`crew-feedback-wiring.spec.ts` asserts that in both directions).
   *
   * Edge it deliberately gets right: it only speaks when a *non-zero* backlog
   * reaches zero with nothing failed, so a crew member who was never offline
   * is never told their zero actions synced.
   */
  const previousPending = useRef(0);
  useEffect(() => {
    const drained = previousPending.current;
    previousPending.current = sync.pendingCount;
    if (drained > 0 && sync.pendingCount === 0 && sync.failedCount === 0) {
      feedback.on({ type: 'offline.synced', count: drained });
    }
  }, [sync.pendingCount, sync.failedCount]);

  if (sync.isOnline && !hasPending && !hasFailed && sync.status !== 'error') {
    return null;
  }

  const tone: 'offline' | 'syncing' | 'error' =
    hasFailed || sync.status === 'error' ? 'error' : sync.isOnline ? 'syncing' : 'offline';

  const title = !sync.isOnline
    ? hasPending
      ? t(pluralKey('offline.pending', sync.pendingCount), { count: sync.pendingCount })
      : t('offline.idle')
    : sync.status === 'syncing'
      ? t(pluralKey('offline.syncing', sync.pendingCount), { count: sync.pendingCount })
      : hasFailed
        ? t(pluralKey('offline.failed', sync.failedCount), { count: sync.failedCount })
        : hasPending
          ? t(pluralKey('offline.waiting', sync.pendingCount), { count: sync.pendingCount })
          : t('offline.problem');

  const detail = !sync.isOnline
    ? t('offline.detailOffline')
    : // `lastError` is the server's own English message — passed through as-is.
      hasFailed && sync.lastError
      ? sync.lastError
      : sync.status === 'error' && sync.lastError
        ? t('offline.willRetry', { error: sync.lastError })
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
            label={t('offline.syncNow')}
            icon="cloud-upload"
            variant="secondary"
            disabled={busy}
            onPress={() => void run(() => syncNow())}
          />
        ) : null}
        {hasFailed ? (
          <>
            <Button
              label={t('offline.retry')}
              icon="refresh"
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
              label={t('offline.dismiss')}
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
  title: { fontSize: 14, fontWeight: '700', color: colors.neutral[900] },
  detail: { fontSize: 14, color: colors.neutral[700] },
  actions: { flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
});
