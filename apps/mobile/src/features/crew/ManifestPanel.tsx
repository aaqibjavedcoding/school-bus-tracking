import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import {
  TripAttendanceStatus,
  TripStatus,
  type TripStudentAttendanceResponse,
  type TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { ListRow } from '../../components/ListRow';
import { EmptyState } from '../../components/Feedback';
import { groupManifestByStop } from './attendance';
import { ATTENDANCE_STATUS_LABELS, attendanceStatusTone, formatTime } from '../../utils/format';
import { confirmAction } from '../../components/Confirm';

/**
 * Stop-grouped manifest with BOARD / DROP actions (Task 23 §D).
 *
 * - Actions are enabled only while the trip is open and `canRecord`; the
 *   server still rejects out-of-order or duplicate events (409 → toast +
 *   refresh). The row that comes back from the API replaces the local copy.
 * - Each button is disabled for the individual student while their request is
 *   in flight, and a drop is always confirmed — protecting against a slip on
 *   a moving bus.
 */
export const ManifestPanel: React.FC<{
  manifest: TripStudentManifestResponse | null;
  tripStatus: TripStatus | null;
  canRecord: boolean;
  busyStudentId: string | null;
  onAction: (studentId: string, action: 'board' | 'drop') => Promise<void>;
}> = ({ manifest, tripStatus, canRecord, busyStudentId, onAction }) => {
  if (!manifest || manifest.items.length === 0) {
    return (
      <EmptyState
        title="No students on this trip"
        message="The manifest is built from students whose home stop belongs to the trip route."
        icon="🧾"
      />
    );
  }

  const groups = groupManifestByStop(manifest.items);
  const open =
    tripStatus === TripStatus.SCHEDULED ||
    tripStatus === TripStatus.BOARDING ||
    tripStatus === TripStatus.IN_PROGRESS;

  const act = async (
    row: TripStudentAttendanceResponse,
    action: 'board' | 'drop',
  ): Promise<void> => {
    if (action === 'drop') {
      const ok = await confirmAction(
        `Drop off ${row.first_name} ${row.last_name}?`,
        `They will be marked as dropped at ${row.stop_name}.`,
        { confirmLabel: 'Drop off' },
      );
      if (!ok) {
        return;
      }
    }
    await onAction(row.student_id, action);
  };

  return (
    <View>
      <View style={styles.summaryRow}>
        <Text style={styles.summary}>
          On board: <Text style={styles.summaryStrong}>{manifest.summary.boarded}</Text> · Waiting:{' '}
          <Text style={styles.summaryStrong}>{manifest.summary.pending}</Text> · Dropped:{' '}
          <Text style={styles.summaryStrong}>{manifest.summary.dropped}</Text>
        </Text>
      </View>
      {!open ? (
        <Text style={styles.closedNote}>
          Attendance is read-only: this trip is not open for changes.
        </Text>
      ) : null}
      {groups.map((group) => (
        <View key={group.stop_id} style={styles.group}>
          <Text style={styles.stopHeader}>
            #{group.sequence} · {group.stop_name}
          </Text>
          {group.items.map((row) => (
            <ListRow
              key={row.student_id}
              title={`${row.first_name} ${row.last_name}`}
              subtitle={`${row.admission_number}${row.grade_level ? ` · ${row.grade_level}` : ''}`}
              meta={
                row.boarded_at
                  ? `Boarded ${formatTime(row.boarded_at)}${row.dropped_at ? ` · Dropped ${formatTime(row.dropped_at)}` : ''}`
                  : 'Not boarded yet'
              }
              right={
                <StatusBadge
                  tone={attendanceStatusTone(row.status)}
                  label={ATTENDANCE_STATUS_LABELS[row.status]}
                  compact
                />
              }
            >
              {canRecord && open ? (
                <View style={styles.actions}>
                  {row.status === TripAttendanceStatus.PENDING ? (
                    <Button
                      label="BOARD"
                      small
                      busy={busyStudentId === row.student_id}
                      disabled={busyStudentId !== null && busyStudentId !== row.student_id}
                      onPress={() => void act(row, 'board')}
                      testID={`board-${row.student_id}`}
                    />
                  ) : null}
                  {row.status === TripAttendanceStatus.BOARDED ? (
                    <Button
                      label="DROP"
                      small
                      variant="secondary"
                      busy={busyStudentId === row.student_id}
                      disabled={busyStudentId !== null && busyStudentId !== row.student_id}
                      onPress={() => void act(row, 'drop')}
                      testID={`drop-${row.student_id}`}
                    />
                  ) : null}
                </View>
              ) : null}
            </ListRow>
          ))}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  summaryRow: {
    marginBottom: spacing.sm,
  },
  summary: {
    color: colors.neutral[600],
    fontSize: 13,
  },
  summaryStrong: {
    color: colors.neutral[900],
    fontWeight: '800',
  },
  closedNote: {
    color: colors.primary[800],
    backgroundColor: colors.primary[50],
    fontSize: 12,
    borderRadius: spacing.xs,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  group: {
    marginBottom: spacing.md,
  },
  stopHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.neutral[500],
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    justifyContent: 'flex-end',
  },
});
