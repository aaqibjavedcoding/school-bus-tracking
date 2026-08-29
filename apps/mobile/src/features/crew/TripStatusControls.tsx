import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { TripStatus } from '@school-bus-tracking/shared-types';
import { Button } from '../../components/Button';
import { confirmAction } from '../../components/Confirm';
import { TRANSCTION_LABELS, TRANSITION_CONFIRMATIONS } from '../shared/trip-lifecycle';
import { useToast } from '../../components/Toast';

/**
 * Renders the transitions the shared table says are legal from the current
 * state — display only. The API re-validates crew authorisation and the
 * transition itself on every call; a rejection refreshes the screen.
 */
export const TripStatusControls: React.FC<{
  status: TripStatus;
  allowed: TripStatus[];
  disabled?: boolean;
  onTransition: (next: TripStatus, cancellationReason?: string | null) => Promise<boolean>;
}> = ({ status, allowed, disabled = false, onTransition }) => {
  const toast = useToast();
  const [busy, setBusy] = useState<TripStatus | null>(null);

  if (allowed.length === 0) {
    return (
      <Text style={styles.terminalNote}>
        This trip is {status === TripStatus.COMPLETED ? 'completed' : 'closed'} — no further actions
        are available.
      </Text>
    );
  }

  const run = async (next: TripStatus): Promise<void> => {
    const confirmation = TRANSITION_CONFIRMATIONS[next];
    let reason: string | null = null;
    if (next === TripStatus.CANCELLED) {
      // Native prompt is unavailable in RN; use a short canned set — the
      // reason is optional server-side, so we keep the flow reliable.
      reason = 'Cancelled from driver mobile';
    }
    const okToProceed = await confirmAction(confirmation.title, confirmation.message, {
      confirmLabel: TRANSCTION_LABELS[next],
      destructive: next === TripStatus.COMPLETED || next === TripStatus.CANCELLED,
    });
    if (!okToProceed) {
      return;
    }
    setBusy(next);
    try {
      const success = await onTransition(next, reason);
      if (success) {
        toast.show(`${TRANSCTION_LABELS[next]} — confirmed by the server.`, 'success');
      } else {
        toast.show('The server rejected that transition. State refreshed.', 'danger');
      }
    } finally {
      setBusy(null);
    }
  };

  const primary = allowed[0];
  const secondary = allowed.filter((s) => s !== primary);

  return (
    <View style={styles.row}>
      <Button
        label={TRANSCTION_LABELS[primary]}
        onPress={() => void run(primary)}
        busy={busy === primary}
        disabled={disabled}
        fullWidth
        testID={`trip-action-${primary}`}
      />
      {secondary.map((next) => (
        <Button
          key={next}
          label={TRANSCTION_LABELS[next]}
          variant={next === TripStatus.CANCELLED ? 'danger' : 'secondary'}
          onPress={() => void run(next)}
          busy={busy === next}
          disabled={disabled}
          small
          fullWidth
          testID={`trip-action-${next}`}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
  },
  terminalNote: {
    color: colors.neutral[500],
    fontSize: 13,
  },
});
