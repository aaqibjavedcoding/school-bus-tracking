import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { GpsStatusBadge } from '../../components/GpsStatus';
import { useDriverGps } from '../../gps/use-driver-gps';
import { confirmAction } from '../../components/Confirm';
import { GPS_STATUS_LABELS } from '../../gps/status';
import { formatFixLine } from '../../utils/format';
import { useOnAppForeground } from '../../hooks/use-app-state';

/**
 * Driver GPS sharing control + honest status readout (Task 23 §D/E).
 *
 * The panel never shows `LIVE` unless the backend accepted a fix. The subtext
 * states exactly what the OS allows: background-on, foreground-only, denied
 * or services off. Re-checks run whenever the app returns to the foreground
 * (the driver may have fixed permissions in Settings while we were away).
 */
export const GpsPanel: React.FC<{
  tripId: string;
  tripOpen: boolean;
  /** Called when tracking goes live for the first time in this mount. */
  onLiveChange?: (live: boolean) => void;
}> = ({ tripId, tripOpen, onLiveChange }) => {
  const { snapshot, start, stop, refresh } = useDriverGps(tripId);
  const running = snapshot.status !== 'stopped';

  useEffect(() => {
    onLiveChange?.(snapshot.status === 'live');
  }, [snapshot.status]);

  useOnAppForeground((state) => {
    if (state === 'active' && running) {
      void refresh();
    }
  });

  const handleStart = async (): Promise<void> => {
    const ok = await confirmAction(
      'Start GPS tracking?',
      tripOpen
        ? 'The bus position will stream to parents and admins while the app is open — and in the background while the OS allows it.'
        : 'The trip is not open yet: fixes will wait server-side until boarding starts. You can still begin now.',
      { confirmLabel: 'Start tracking' },
    );
    if (ok) {
      await start();
    }
  };

  const handleStop = async (): Promise<void> => {
    const ok = await confirmAction(
      'Stop sharing GPS?',
      'Parents and admins will no longer see live bus movement.',
      {
        confirmLabel: 'Stop',
        destructive: true,
      },
    );
    if (ok) {
      await stop();
    }
  };

  return (
    <Card
      title="Live GPS sharing"
      description="Fixes go straight to the existing live-tracking channel — the backend validates, stores and rebroadcasts them."
      right={<GpsStatusBadge status={snapshot.status} />}
    >
      <View style={styles.row}>
        {running ? (
          <Button
            label="Stop tracking"
            variant="secondary"
            onPress={() => void handleStop()}
            small
          />
        ) : (
          <Button
            label="Start GPS tracking"
            onPress={() => void handleStart()}
            small
            testID="gps-start"
          />
        )}
        <Button label="Check status" variant="ghost" small onPress={() => void refresh()} />
      </View>
      {snapshot.message ? <Text style={styles.message}>{snapshot.message}</Text> : null}
      {running ? (
        <Text style={styles.detail}>
          {snapshot.backgroundGranted
            ? 'Background sharing enabled: locking the phone keeps the trip visible to parents.'
            : 'Foreground only: the OS has not granted background location, so sharing pauses when the app closes.'}
        </Text>
      ) : null}
      <Text style={styles.detail}>
        {snapshot.lastAcceptedAt
          ? `Last server-accepted fix at ${snapshot.lastAcceptedAt.slice(11, 19)}Z`
          : 'No server-accepted fix yet this run.'}
      </Text>
      <StatusBadge tone="neutral" label={GPS_STATUS_LABELS[snapshot.status]} compact />
    </Card>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: 12,
    color: colors.status.warning,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  detail: {
    fontSize: 12,
    color: colors.neutral[500],
    marginBottom: spacing.xs,
  },
});

export const GpsFixPreview: React.FC<{
  fix: { latitude: number; longitude: number; speed: number | null; recorded_at: string } | null;
}> = ({ fix }) => <Text style={styles.detail}>{formatFixLine(fix)}</Text>;
