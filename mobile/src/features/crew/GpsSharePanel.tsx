import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import type { TripResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { Badge, Banner, Button } from '../../components';
import { formatRelative } from '../../lib/format';
import { gpsSignalTier } from '../../lib/geo';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import type { CrewLocationSharing } from './useCrewLocationSharing';
import { t } from '../../lib/i18n.ts';

/**
 * GPS sharing panel of the shared crew trip screen.
 *
 * Shows the real state of native location sharing: OS permissions, the
 * foreground watch, the background task, the last device fix (with its
 * accuracy and age), what the server accepted or rejected, and device
 * connectivity. Nothing is inferred or simulated — when nothing has been
 * sent yet, it says so.
 */
export const GpsSharePanel: React.FC<{
  trip: TripResponse;
  sharing: CrewLocationSharing;
}> = ({ trip, sharing }) => {
  const network = useNetworkStatus();
  const { stats } = sharing;

  const lastFixAge = stats.lastFix
    ? Date.now() - new Date(stats.lastFix.recorded_at).getTime()
    : null;
  const tier = gpsSignalTier(lastFixAge, stats.lastFix?.accuracy ?? null);
  const tierLabel =
    tier === 'good' ? t('gps.tierGood') : tier === 'weak' ? t('gps.tierWeak') : t('gps.tierStale');
  const tierTone = tier === 'good' ? 'success' : tier === 'weak' ? 'warning' : 'neutral';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('gps.panelTitle')}</Text>
        <Badge
          size="lg"
          tone={sharing.sharing ? 'success' : 'neutral'}
          label={sharing.sharing ? t('gps.badgeSharing') : t('gps.badgeOff')}
        />
      </View>

      {/**
       * The delivery truth, separate from the device truth above: this line is
       * derived from the **server acknowledgement**, so it can never read as
       * "the school sees the bus" on the strength of a local fix alone.
       */}
      <View style={styles.deliveryRow}>
        <Badge size="lg" tone={sharing.statusTone} label={t('gps.deliveryBadge')} />
        <Text style={styles.mutedSmall}>{sharing.statusLine || t('gps.noFix')}</Text>
      </View>

      {!sharing.canShare ? (
        <Text style={styles.muted}>
          {/* The raw status word is server data — shown as the enum reads. */}
          {t('gps.notReady', { status: trip.status.toLowerCase().replace('_', ' ') })}
        </Text>
      ) : (
        <View style={styles.buttonRow}>
          {!sharing.sharing ? (
            <Button
              label={t('gps.share')}
              icon="locate"
              tone="success"
              size="field"
              onPress={() => void sharing.startSharing()}
              busy={sharing.busy}
              disabled={sharing.busy}
            />
          ) : (
            <Button
              label={t('gps.stopSharing')}
              icon="stop-circle"
              variant="danger"
              size="field"
              onPress={() => void sharing.stopSharing()}
              busy={sharing.busy}
              disabled={sharing.busy}
            />
          )}
        </View>
      )}

      {sharing.sharing || sharing.backgroundActive ? (
        <View style={styles.backgroundRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.backgroundTitle}>{t('gps.backgroundTitle')}</Text>
            <Text style={styles.mutedSmall}>
              {sharing.backgroundActive
                ? t('gps.backgroundOn')
                : sharing.backgroundPermission === 'granted'
                  ? t('gps.backgroundAllowed')
                  : t('gps.backgroundNeeded')}
            </Text>
          </View>
          <Switch
            value={sharing.backgroundActive}
            disabled={
              sharing.busy ||
              sharing.backgroundPermission === 'unavailable' ||
              (!sharing.sharing && !sharing.backgroundActive)
            }
            onValueChange={(value) =>
              void (value ? sharing.enableBackground() : sharing.disableBackground())
            }
            trackColor={{ true: colors.secondary[600], false: colors.neutral[300] }}
            thumbColor="#ffffff"
          />
        </View>
      ) : null}

      <View style={styles.chipRow}>
        <Badge size="lg" tone={tierTone} label={tierLabel} />
        <Badge
          size="lg"
          tone={network === 'online' ? 'success' : network === 'offline' ? 'danger' : 'neutral'}
          label={t('gps.network', { state: network })}
        />
        <Badge
          size="lg"
          tone={sharing.foregroundPermission === 'granted' ? 'success' : 'warning'}
          label={t('gps.location', { state: sharing.foregroundPermission })}
        />
        {/**
         * Approximate location is its own fact: a coarse fix cannot confirm a
         * 100 m geofence, so it is reported instead of being folded into
         * "granted". `unknown` (the platform did not say) is not shown at all.
         */}
        {sharing.accuracy === 'reduced' ? (
          <Badge size="lg" tone="warning" label={t('gps.accuracyReduced')} />
        ) : null}
        {sharing.servicesEnabled === false ? (
          <Badge size="lg" tone="danger" label={t('gps.servicesOff')} />
        ) : null}
        {sharing.recovery.attempts > 0 ? (
          <Badge
            size="lg"
            tone={sharing.recovery.exhausted ? 'danger' : 'warning'}
            label={t('gps.recoveryAttempts', { count: sharing.recovery.attempts })}
          />
        ) : null}
      </View>

      <View style={styles.statsGrid}>
        <Stat label="Sent" value={String(stats.emittedCount)} />
        <Stat label="Rejected" value={String(stats.rejectedCount)} />
        <Stat label="Dropped (offline)" value={String(stats.disconnectedCount)} />
        <Stat label="Invalid fix" value={String(stats.invalidCount)} />
      </View>
      {/**
       * Recovery counters (this patch): how many held fixes were re-sent after a
       * reconnect, how many were discarded for exceeding the age limit, and how
       * many were superseded by a newer fix. Support reads these to tell "the
       * phone had no network" from "the phone never got a fix".
       */}
      <View style={styles.statsGrid}>
        <Stat label="Retried" value={String(stats.retriedCount)} />
        <Stat label="Expired" value={String(stats.expiredCount)} />
        <Stat label="Superseded" value={String(stats.supersededCount)} />
        <Stat label="No session" value={String(stats.unauthenticatedCount)} />
      </View>

      <Text style={styles.mutedSmall}>
        {stats.lastFix
          ? `${t('gps.lastFix', { time: formatRelative(stats.lastFix.recorded_at) })}${
              stats.lastFix.accuracy !== null
                ? ` · ${t('gps.accuracy', { meters: Math.round(stats.lastFix.accuracy) })}`
                : ''
            }`
          : t('gps.noFix')}
        {/* A local fix is not a delivered fix: the ack line says which it was. */}
        {stats.lastAckAt
          ? ` · ${t('gps.serverAck', { time: formatRelative(stats.lastAckAt) })}`
          : ` · ${t('gps.serverNoAck')}`}
        {/* `lastReason` is the server's own English sentence — passed through. */}
        {stats.lastReason ? ` · ${t('gps.serverReason', { reason: stats.lastReason })}` : ''}
      </Text>

      {sharing.message ? (
        <Banner
          tone={
            sharing.message.includes('required') || sharing.message.includes('Allow')
              ? 'warning'
              : 'info'
          }
          message={sharing.message}
        />
      ) : null}
    </View>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  muted: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[600],
  },
  mutedSmall: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[600],
  },
  buttonRow: {
    gap: spacing.sm,
  },
  backgroundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.neutral[50],
    borderRadius: borderRadius.md,
    padding: spacing.xs + 2,
    minHeight: 48,
  },
  backgroundTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.neutral[50],
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  statValue: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: '800',
    color: colors.neutral[900],
  },
  statLabel: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[600],
    textAlign: 'center',
  },
});
