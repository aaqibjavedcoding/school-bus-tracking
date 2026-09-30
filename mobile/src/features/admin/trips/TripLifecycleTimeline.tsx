import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TripStatus, type TripResponse } from '@school-bus-tracking/shared-types';
import {
  buildTripLifecycleSteps,
  tripLifecycleCancellation,
} from '@school-bus-tracking/validation';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';
import { Card } from '../../../components';
import { TripStatusActions } from '../../crew';
import { formatTime, tripStatusLabel } from '../../../lib/format';

/** The one sentence a dispatcher must read before overriding the crew. */
export const DISPATCHER_OVERRIDE_NOTE =
  'Use only when the crew device cannot act — this is recorded in the audit log';

/**
 * Admin trip lifecycle: a **read-only** timeline plus a collapsed dispatcher
 * override.
 *
 * Dispatchers used to get the crew's Boarding/Start buttons the moment they
 * scheduled a trip and pressed them by accident. The API still allows a
 * SCHOOL_ADMIN status PATCH (a deliberate product decision), so the buttons
 * still exist — behind a disclosure, with a confirm step.
 */
export const TripLifecycleTimeline: React.FC<{
  trip: TripResponse;
  onApplied: () => void;
}> = ({ trip, onApplied }) => {
  const [open, setOpen] = useState(false);
  const steps = buildTripLifecycleSteps(trip);
  const cancellation = tripLifecycleCancellation(trip);

  return (
    <Card title="Lifecycle">
      <View accessibilityRole="list">
        {steps.map((step) => (
          <View key={step.status} style={styles.row} accessibilityRole="text">
            <View
              style={[
                styles.dot,
                step.reached ? styles.dotReached : null,
                step.current ? styles.dotCurrent : null,
              ]}
            />
            <Text
              style={[
                styles.label,
                step.reached ? styles.labelReached : null,
                step.current ? styles.labelCurrent : null,
              ]}
            >
              {tripStatusLabel(step.status)}
            </Text>
            <Text style={styles.time}>{step.at ? formatTime(step.at) : '—'}</Text>
          </View>
        ))}
        {cancellation ? (
          <View style={[styles.row, styles.cancelledRow]}>
            <View style={[styles.dot, styles.dotCancelled]} />
            <Text style={[styles.label, styles.labelReached]}>
              {tripStatusLabel(TripStatus.CANCELLED)}
            </Text>
            <Text style={styles.time}>
              {cancellation.at ? formatTime(cancellation.at) : '—'}
              {cancellation.reason ? ` · ${cancellation.reason}` : ''}
            </Text>
          </View>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dispatcher override"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.disclosure}
      >
        <Text style={styles.disclosureText}>{open ? '▾ ' : '▸ '}Dispatcher override</Text>
      </Pressable>

      {open ? (
        <View style={styles.overrideBody}>
          <Text style={styles.note}>{DISPATCHER_OVERRIDE_NOTE}</Text>
          <TripStatusActions
            trip={trip}
            allowCancel
            confirm={{
              title: 'Apply dispatcher override?',
              message:
                'This changes the trip on behalf of the crew and is recorded in the audit log.',
              confirmLabel: 'Apply override',
              cancelLabel: 'Keep as is',
            }}
            onApplied={onApplied}
          />
        </View>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  cancelledRow: {
    paddingLeft: spacing.md,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.neutral[300],
  },
  dotReached: {
    backgroundColor: colors.primary[500],
    borderColor: colors.primary[500],
  },
  dotCurrent: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  dotCancelled: {
    backgroundColor: colors.status.danger,
    borderColor: colors.status.danger,
  },
  label: {
    flex: 1,
    fontSize: 15,
    color: colors.neutral[500],
  },
  labelReached: {
    color: colors.neutral[900],
  },
  labelCurrent: {
    fontWeight: '700',
  },
  time: {
    fontSize: 13,
    color: colors.neutral[600],
  },
  disclosure: {
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
  disclosureText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary[600],
  },
  overrideBody: {
    marginTop: spacing.sm,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.neutral[50],
  },
  note: {
    fontSize: 13,
    color: colors.neutral[700],
  },
});
