import React, { useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import {
  TripAttendanceStatus,
  type TripStudentAttendanceResponse,
  type TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AttendanceBadge, Badge, Button, EmptyState, FilterChips, SearchBar } from '../../components';

/**
 * Student manifest with board/drop actions — the shared crew surface.
 *
 * All state comes from `GET /trips/:tripId/students` and the body-less
 * `board` / `drop` endpoints: who recorded an event and when is decided by
 * the server. The list is grouped by stop (the API already orders entries by
 * stop sequence), and a status filter lets the crew focus on who is still
 * waiting at the current stop.
 *
 * Rendered as a `SectionList` (one section per stop) so a full bus of
 * students stays smooth; the summary, search and filter strip live in the
 * list header and anything the caller wants above the manifest goes through
 * `header`, mirroring `<ListScreen />`.
 */

type ManifestFilter = 'ALL' | TripAttendanceStatus;

const FILTERS: { key: ManifestFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: TripAttendanceStatus.PENDING, label: 'Waiting' },
  { key: TripAttendanceStatus.BOARDED, label: 'On board' },
  { key: TripAttendanceStatus.DROPPED, label: 'Dropped' },
];

interface ManifestSection {
  stop_id: string;
  title: string;
  sequence: number;
  data: TripStudentAttendanceResponse[];
}

/**
 * See `ListScreen` — `react-native`'s list types resolve a hoisted
 * `@react-native/virtualized-lists` against React 18 in this monorepo, so the
 * boundary is narrowed to avoid the incompatible `SectionListProps`.
 */
const SectionListView = SectionList as unknown as React.ComponentType<
  Record<string, unknown>
>;

export const ManifestList: React.FC<{
  manifest: TripStudentManifestResponse;
  canAct: boolean;
  busyStudentId: string | null;
  onBoard: (studentId: string) => void;
  onDrop: (studentId: string) => void;
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
  refresh?: (() => void) | null;
  refreshing?: boolean;
}> = ({
  manifest,
  canAct,
  busyStudentId,
  onBoard,
  onDrop,
  header = null,
  footer = null,
  refresh = null,
  refreshing = false,
}) => {
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

  const sections = useMemo<ManifestSection[]>(
    () => groupByStop(visible),
    [visible],
  );
  const { summary } = manifest;
  const insets = useSafeAreaInsets();

  return (
    <SectionListView
      sections={sections}
      keyExtractor={(student: TripStudentAttendanceResponse) => student.student_id}
      renderItem={({ item }: { item: TripStudentAttendanceResponse }) => (
        <ManifestRow
          student={item}
          canAct={canAct}
          busy={busyStudentId === item.student_id}
          onBoard={() => onBoard(item.student_id)}
          onDrop={() => onDrop(item.student_id)}
        />
      )}
      renderSectionHeader={({ section }: { section: ManifestSection }) => (
        <Text style={styles.groupTitle}>
          {section.sequence}. {section.title}
        </Text>
      )}
      ListHeaderComponent={
        <>
          {header}
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
        </>
      }
      ListEmptyComponent={
        <EmptyState
          title="No students match"
          description="No students match the current search or filter."
          action={
            filtersActive ? (
              <Button label="Clear filters" variant="secondary" onPress={resetFilters} />
            ) : null
          }
        />
      }
      ListFooterComponent={footer}
      stickySectionHeadersEnabled={false}
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: spacing.xl + insets.bottom },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        refresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.primary[600]}
          />
        ) : null
      }
    />
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

function groupByStop(items: TripStudentAttendanceResponse[]): ManifestSection[] {
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
  return groups.map((group) => ({
    stop_id: group.stop_id,
    title: group.stop_name,
    sequence: group.stop_sequence_number,
    data: group.students,
  }));
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  content: {
    padding: spacing.md,
    flexGrow: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  groupTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[800],
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
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
