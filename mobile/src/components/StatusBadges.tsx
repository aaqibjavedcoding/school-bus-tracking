import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  TripAttendanceStatus,
  TripStatus,
  type TripTrackingState,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import {
  attendanceStatusLabel,
  attendanceTone,
  boardingStatusLabel,
  trackingStateLabel,
  tripStatusLabel,
  tripStatusTone,
} from '../lib/format';
import { Badge } from './ui';

/** Trip lifecycle badge (SCHEDULED / BOARDING / IN_PROGRESS / …). */
export const TripStatusBadge: React.FC<{ status: TripStatus }> = ({ status }) => (
  <Badge tone={tripStatusTone(status)} label={tripStatusLabel(status)} />
);

/** Manifest attendance badge (PENDING / BOARDED / DROPPED). */
export const AttendanceBadge: React.FC<{ status: TripAttendanceStatus | null | undefined }> = ({
  status,
}) => (
  <Badge
    tone={attendanceTone(status ?? TripAttendanceStatus.PENDING)}
    label={attendanceStatusLabel(status ?? TripAttendanceStatus.PENDING)}
  />
);

/** Parent-facing boarding badge ("Not boarded" while still pending). */
export const BoardingBadge: React.FC<{ status: TripAttendanceStatus | null | undefined }> = ({
  status,
}) => <Badge tone={attendanceTone(status)} label={boardingStatusLabel(status)} />;

/** Live-tracking stream state chip (active / stopped / unavailable). */
export const TrackingStateBadge: React.FC<{ state: TripTrackingState | null | undefined }> = ({
  state,
}) => (
  <View style={styles.wrapper}>
    <View
      style={[
        styles.pill,
        {
          backgroundColor:
            state === 'active' ? '#dcfce7' : state === 'stopped' ? '#fee2e2' : colors.neutral[100],
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color:
              state === 'active'
                ? colors.secondary[800]
                : state === 'stopped'
                  ? '#b91c1c'
                  : colors.neutral[600],
          },
        ]}
      >
        {trackingStateLabel(state)}
      </Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'flex-start',
  },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  text: {
    fontSize: typography.fontSizes.xs,
    fontWeight: '600',
  },
});
