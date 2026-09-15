import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { Button } from '../../../components';
import { feedback } from '../crew-feedback.ts';
import { discardFailed, retryFailed } from './attendance-queue.ts';
import { getSyncUserId, refreshCounts, syncNow } from './attendance-sync.ts';
import { useSyncState } from './useOfflineAction';
import { pluralKey, t } from '../../../lib/i18n.ts';
import { useTranslation } from '../../../lib/i18n-provider';

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

  /**
   * Phase 3b: the one confirmation the crew gets for an offline boarding wave —
   * "N students board ho gaye" when the queue finally lands.
   *
   * Derived from the banner's own published counts rather than hooked into the
   * sync manager, so `features/crew/offline/*` stays **zero-touch**: the queue
   * core, its retry/backoff and its idempotency keys are exactly as they were.
   * The transition "had pending → none, while online" is the sync completing,
   * whoever triggered it (the automatic replay or the Sync now button).
   *
   * This is also `crew-feedback`'s summary drain point — see the dispatch
   * comment there for why the summary replaces the plain "synced" line.
   */
  const previousPending = useRef<number | null>(null);
  useEffect(() => {
    const before = previousPending.current;
    previousPending.current = sync.pendingCount;
    if (before === null || before === 0 || sync.pendingCount !== 0 || !sync.isOnline) return;
    feedback.on('sync.done');
  }, [sync.pendingCount, sync.isOnline]);

  const hasPending = sync.pendingCount > 0;
  const hasFailed = sync.failedCount > 0;

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
  title: { fontSize: 16, fontWeight: '700', color: colors.neutral[900] },
  detail: { fontSize: 16, color: colors.neutral[700] },
  actions: { flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
});
