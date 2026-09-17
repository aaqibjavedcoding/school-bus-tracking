import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { Button } from '../../components';
import { formatRelative } from '../../lib/format';
import { crewCopy } from './crew-copy';
import { feedback } from './crew-feedback.ts';
import type { CrewLocationSharing } from './useCrewLocationSharing';

/**
 * The driver's whole GPS story on the trip screen (Phase 2): **Sharing ✅/❌,
 * the last update time, and one Retry tap.** Nothing else — the counters
 * ("Rejected", "Dropped (offline)", "Invalid fix") and every raw diagnostic
 * moved to the Help/Support screen (`app/(crew)/help.tsx`), where the
 * support team reads them *with* the driver instead of at them.
 *
 * This is presentation only: start/stop/retry call the untouched
 * `useCrewLocationSharing` actions.
 */
export const GpsShareStrip: React.FC<{
  sharing: CrewLocationSharing;
  onOpenHelp: () => void;
}> = ({ sharing, onOpenHelp }) => {
  const lastUpdate = sharing.stats.lastFix
    ? crewCopy.gps.lastUpdate(formatRelative(sharing.stats.lastFix.recorded_at))
    : crewCopy.gps.neverUpdated;

  /**
   * Phase 3b: report the *actual* sharing state changing, not the button
   * press.
   *
   * `startSharing()` resolves even when it did nothing — a denied permission
   * or a non-shareable trip sets `sharing.message` and returns — so
   * announcing after the `await` would tell the driver "location sharing on"
   * while the school still sees nothing. Watching the state the strip already
   * renders means the voice can only ever agree with the text next to it.
   * `useCrewLocationSharing` itself is untouched.
   */
  const active = sharing.sharing || sharing.backgroundActive;
  const previousActive = useRef<boolean | null>(null);
  useEffect(() => {
    const before = previousActive.current;
    previousActive.current = active;
    // Skip the first render: mounting the strip is not a toggle.
    if (before === null || before === active) return;
    feedback.on({ type: active ? 'gps.on' : 'gps.off' });
  }, [active]);

  return (
    <View style={styles.card}>
      <View style={styles.mainRow}>
        <View style={styles.statusBlock}>
          <Text style={styles.stateLine}>
            {sharing.sharing || sharing.backgroundActive
              ? crewCopy.gps.sharingOn
              : crewCopy.gps.sharingOff}
          </Text>
          <Text style={styles.updateLine}>{lastUpdate}</Text>
        </View>
        {sharing.sharing || sharing.backgroundActive ? (
          <Button
            label={crewCopy.gps.stop}
            icon="stop-circle"
            variant="secondary"
            size="md"
            onPress={() => void sharing.stopSharing()}
            busy={sharing.busy}
            disabled={sharing.busy}
          />
        ) : (
          <Button
            label={crewCopy.gps.retry}
            icon="refresh"
            tone="success"
            size="md"
            onPress={() => void sharing.startSharing()}
            busy={sharing.busy}
            disabled={sharing.busy}
          />
        )}
      </View>
      <Button
        label={crewCopy.gps.helpLink}
        icon="help-circle"
        variant="ghost"
        size="md"
        onPress={onOpenHelp}
        style={styles.helpLink}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 44,
  },
  statusBlock: {
    flex: 1,
    gap: 2,
  },
  stateLine: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  updateLine: {
    fontSize: 14,
    color: '#475569',
  },
  helpLink: {
    alignSelf: 'flex-start',
  },
});
