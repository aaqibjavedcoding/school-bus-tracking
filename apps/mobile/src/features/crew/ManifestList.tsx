import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  TripAttendanceStatus,
  type TripStudentAttendanceResponse,
  type TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { AttendanceBadge, Badge, Button, EmptyState, FilterChips, SearchBar } from '../../components';

/**
 * Student manifest with board/drop actions — the shared crew surface.
 *
 * All state comes from `GET /trips/:tripId/students` and the body-less
 * `board` / `drop` endpoints: who recorded an event and when is decided by
 * the server. The list is grouped by stop (the API already orders entries by
 * stop sequence), and a status filter lets the crew focus on who is still
 * waiting at the current stop.
 */
type ManifestFilter = 'ALL' | TripAttendanceStatus;

const FILTERS: { key: ManifestFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: TripAttendanceStatus.PENDING, label: 'Waiting' },
  { key: TripAttendanceStatus.BOARDED, label: 'On board' },
  { key: TripAttendanceStatus.DROPPED, label: 'Dropped' },
];

export const ManifestList: React.FC<{
  manifest: TripStudentManifestResponse;
  canAct: boolean;
  busyStudentId: string | null;
  onBoard: (studentId: string) => void;
  onDrop: (studentId: string) => void;
}> = ({ manifest, canAct, busyStudentId, onBoard, onDrop }) => {
  const [filter, setFilter] = useState<ManifestFilter>('ALL');
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();

  const visible = useMemo(() => {
    let rows =
      filter === 'ALL' ? manifest.items : manifest.items.filter((item) => item.status === filter);
    if (term) {
      rows = rows.filter((item) =>
        [
          `${item.first_name} ${item.last_name}`,
          item.admission_number,
          item.stop_name,
          item.grade_level,
        ]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(term)),
      );
    }
    return rows;
  }, [manifest.items, filter, term]);

  const filtersActive = filter !== 'ALL' || term.length > 0;
  const resetFilters = () => {
    setFilter('ALL');
    setSearch('');
  };
  const groups = useMemo(() => groupByStop(visible), [visible]);
  const { summary } = manifest;

  return (
    <View>
      <View style={styles.summaryRow}>
        <Badge label={`${summary.total} students`} />
        <Badge label={`${summary.pending} waiting`} tone="warning" />
        <Badge label={`${summary.boarded} on board`} tone="info" />
        <Badge label={`${summary.dropped} dropped`} tone="success" />
      </View>

      <SearchBar
        value={search}
        onChangeText={setSearch}
        onClear={() => setSearch('')}
        placeholder="Search student, admission no. or stop…"
      />

      <FilterChips<ManifestFilter>
        options={FILTERS.map((entry) => ({
          value: entry.key,
          label: `${entry.label} · ${
            entry.key === 'ALL'
              ? manifest.items.length
              : manifest.items.filter((item) => item.status === entry.key).length
          }`,
        }))}
        value={filter}
        onChange={setFilter}
      />

      {visible.length === 0 ? (
        <EmptyState
          title="No students match"
          description="No students match the current search or filter."
          action={
            filtersActive ? (
              <Button label="Clear filters" variant="secondary" onPress={resetFilters} />
            ) : null
          }
        />
      ) : null}

      {groups.map((group) => (
        <View key={group.stop_id} style={styles.group}>
          <Text style={styles.groupTitle}>
            {group.stop_sequence_number}. {group.stop_name}
          </Text>
          {group.students.map((student) => (
            <ManifestRow
              key={student.student_id}
              student={student}
              canAct={canAct}
              busy={busyStudentId === student.student_id}
              onBoard={() => onBoard(student.student_id)}
              onDrop={() => onDrop(student.student_id)}
            />
          ))}
        </View>
      ))}
    </View>
  );
};

const ManifestRow: React.FC<{
  student: TripStudentAttendanceResponse;
  canAct: boolean;
  busy: boolean;
  onBoard: () => void;
  onDrop: () => void;
}> = ({ student, canAct, busy, onBoard, onDrop }) => (
  <View style={styles.row}>
    <View style={styles.rowMain}>
      <Text style={styles.rowName}>
        {student.first_name} {student.last_name}
      </Text>
      <Text style={styles.rowMeta}>
        {student.admission_number}
        {student.grade_level ? ` · ${student.grade_level}` : ''}
      </Text>
      <AttendanceBadge status={student.status} />
    </View>
    {canAct && student.status === TripAttendanceStatus.PENDING ? (
      <Button label="Board" small onPress={onBoard} disabled={busy} busy={busy} />
    ) : null}
    {canAct && student.status === TripAttendanceStatus.BOARDED ? (
      <Button
        label="Drop off"
        small
        variant="secondary"
        onPress={onDrop}
        disabled={busy}
        busy={busy}
      />
    ) : null}
  </View>
);

interface StopGroup {
  stop_id: string;
  stop_name: string;
  stop_sequence_number: number;
  students: TripStudentAttendanceResponse[];
}

function groupByStop(items: TripStudentAttendanceResponse[]): StopGroup[] {
  const groups: StopGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.stop_id === item.stop_id) {
      last.students.push(item);
      continue;
    }
    groups.push({
      stop_id: item.stop_id,
      stop_name: item.stop_name,
      stop_sequence_number: item.stop_sequence_number,
      students: [item],
    });
  }
  return groups;
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  group: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  groupTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.neutral[900],
  },
  rowMeta: {
    fontSize: 12,
    color: colors.neutral[500],
  },
});
