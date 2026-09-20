import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { Button } from '../../components';
import { crewCopy } from './crew-copy';
import { feedback } from './crew-feedback.ts';
import { gpsStripActions } from './gps-strip-action.ts';
import type { CrewLocationSharing } from './useCrewLocationSharing';

/**
 * The driver's whole GPS story on the trip screen (Phase 2): **Sharing ✅/❌,
 * the last update time, and one tap.** Nothing else — the counters
 * ("Rejected", "Dropped (offline)", "Invalid fix") and every raw diagnostic
 * moved to the Help/Support screen (`app/(crew)/help.tsx`), where the
 * support team reads them *with* the driver instead of at them.
 *
 * The one tap says what it does (`gps-strip-action.ts`): **Share GPS** when
 * nothing is running yet, **Retry** when the last run failed, **Stop** while
 * running — plus a Retry beside Stop when the reconnect budget has given up.
 * Since the driver's lifecycle taps ("Start boarding" / "Depart & drive")
 * start sharing themselves, Share GPS is the fallback for a refused or
 * stopped start, not the normal way in.
 *
 * This is presentation only: start/stop/retry call the untouched
 * `useCrewLocationSharing` actions.
 */
export const GpsShareStrip: React.FC<{
  sharing: CrewLocationSharing;
  onOpenHelp: () => void;
}> = ({ sharing, onOpenHelp }) => {
  /**
   * Two lines, two different truths — and never the same one twice:
   *
   * - the **device** line ("Sharing ✅/❌") says whether this phone is producing
   *   fixes at all;
   * - the **delivery** line comes from the shared lifecycle's derived status,
   *   which is only `live` when the *server acknowledged* a fix inside the live
   *   window. A local fix the server never accepted reads as "GPS fix, not
   *   delivered yet", never as "the school can see the bus".
   *
   * The line ages on its own (the hook ticks every 5 s), so "updated just now"
   * becomes "stale" even when no new fix arrives.
   */
  const deviceLine =
    sharing.sharing || sharing.backgroundActive ? crewCopy.gps.sharingOn : crewCopy.gps.sharingOff;
  const deliveryLine = sharing.statusLine || crewCopy.gps.neverUpdated;

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

  const actions = gpsStripActions({
    foregroundActive: sharing.sharing,
    backgroundActive: sharing.backgroundActive,
    lastStopReason: sharing.lastStopReason,
    recoveryExhausted: sharing.statusDetail.recoveryExhausted,
    message: sharing.message,
    servicesEnabled: sharing.servicesEnabled,
    foregroundPermission: sharing.foregroundPermission,
  });

  /**
   * The failure line: when the lifecycle has a message (a refused start, a
   * revoked session, a background the runtime cannot run), the strip says it
   * in words instead of leaving the driver to guess why "Sharing ❌". Spoken
   * by screen readers the moment it appears (`accessibilityLiveRegion`).
   */
  const failureLine = sharing.message;

  return (
    <View style={styles.card}>
      <View style={styles.mainRow}>
        <View style={styles.statusBlock}>
          <Text style={styles.stateLine}>{deviceLine}</Text>
          <Text style={styles.updateLine}>{deliveryLine}</Text>
        </View>
        {actions.primary === 'stop' ? (
          <View style={styles.buttonRow}>
            {actions.showRetryWhileRunning ? (
              <Button
                label={crewCopy.gps.retry}
                icon="refresh"
                tone="success"
                size="md"
                onPress={() => void sharing.retry()}
                busy={sharing.busy}
                disabled={sharing.busy}
              />
            ) : null}
            <Button
              label={crewCopy.gps.stop}
              icon="stop-circle"
              variant="secondary"
              size="md"
              onPress={() => void sharing.stopSharing()}
              busy={sharing.busy}
              disabled={sharing.busy}
            />
          </View>
        ) : actions.primary === 'open-settings' ? (
          // The blocker is OS-side and only Settings can fix it — the tap
          // says exactly that instead of offering a retry that fails again.
          <Button
            label={crewCopy.gps.openSettings}
            icon="settings-outline"
            tone="success"
            size="md"
            onPress={() => void sharing.openLocationSettings()}
            busy={sharing.busy}
            disabled={sharing.busy}
          />
        ) : actions.primary === 'request-permission' ? (
          <Button
            label={crewCopy.gps.requestPermission}
            icon="location-outline"
            tone="success"
            size="md"
            onPress={() => void sharing.requestLocationPermission()}
            busy={sharing.busy}
            disabled={sharing.busy}
          />
        ) : (
          <Button
            // Both start the same way (`retry()` starts when nothing runs);
            // only the word differs: "Share GPS" first, "Retry" after a failure.
            label={actions.primary === 'retry' ? crewCopy.gps.retry : crewCopy.gps.share}
            icon={actions.primary === 'retry' ? 'refresh' : 'navigate'}
            tone="success"
            size="md"
            onPress={() => void sharing.retry()}
            busy={sharing.busy}
            disabled={sharing.busy}
          />
        )}
      </View>
      {failureLine ? (
        <Text style={styles.failureLine} accessibilityLiveRegion="polite">
          {failureLine}
        </Text>
      ) : null}
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
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  // The failure line reuses the measured badge-danger foreground (5.30:1 on
  // white) — the error tone is stated by the colour table, not by eye.
  failureLine: {
    fontSize: 14,
    color: '#b91c1c',
  },
  helpLink: {
    alignSelf: 'flex-start',
  },
});
