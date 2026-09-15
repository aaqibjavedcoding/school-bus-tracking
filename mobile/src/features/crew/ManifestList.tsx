import React, { useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  TripAttendanceStatus,
  type TripStudentAttendanceResponse,
  type TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AttendanceBadge,
  Badge,
  Button,
  EmptyState,
  FilterChips,
  SearchBar,
  screenRefreshControl,
} from '../../components';
import { attendanceActionMeta } from './crew-action-meta';

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

const FILTERS: { key: ManifestFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'ALL', label: 'All', icon: 'people' },
  { key: TripAttendanceStatus.PENDING, label: 'Waiting', icon: 'time' },
  { key: TripAttendanceStatus.BOARDED, label: 'On board', icon: 'bus' },
  { key: TripAttendanceStatus.DROPPED, label: 'Dropped', icon: 'checkmark-done' },
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
const SectionListView = SectionList as unknown as React.ComponentType<Record<string, unknown>>;

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

  const sections = useMemo<ManifestSection[]>(() => groupByStop(visible), [visible]);
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
            <Badge size="lg" label={`${summary.total} students`} />
            <Badge size="lg" label={`${summary.pending} waiting`} tone="warning" />
            <Badge size="lg" label={`${summary.boarded} on board`} tone="info" />
            <Badge size="lg" label={`${summary.dropped} dropped`} tone="success" />
          </View>

          <SearchBar
            size="field"
            value={search}
            onChangeText={setSearch}
            onClear={() => setSearch('')}
            placeholder="Search student, admission no. or stop…"
          />

          <FilterChips<ManifestFilter>
            size="field"
            options={FILTERS.map((entry) => ({
              value: entry.key,
              icon: entry.icon,
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
          icon="search"
          title="No students match"
          description="No students match the current search or filter."
          action={
            filtersActive ? (
              <Button label="Clear filters" variant="secondary" size="lg" onPress={resetFilters} />
            ) : null
          }
        />
      }
      ListFooterComponent={footer}
      stickySectionHeadersEnabled={false}
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={screenRefreshControl(refresh, refreshing) ?? null}
    />
  );
};

const ManifestRow: React.FC<{
  student: TripStudentAttendanceResponse;
  canAct: boolean;
  busy: boolean;
  onBoard: () => void;
  onDrop: () => void;
}> = ({ student, canAct, busy, onBoard, onDrop }) => {
  // The row actions keep one vocabulary everywhere (green in, grey out) — see
  // `crew-action-meta.ts` — at the 60px `lg` size, thumb-friendly in a moving bus.
  const board = attendanceActionMeta('board');
  const drop = attendanceActionMeta('drop');
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.rowName}>
          {student.first_name} {student.last_name}
        </Text>
        <Text style={styles.rowMeta}>
          {student.admission_number}
          {student.grade_level ? ` · ${student.grade_level}` : ''}
        </Text>
        <AttendanceBadge size="lg" status={student.status} />
      </View>
      {canAct && student.status === TripAttendanceStatus.PENDING ? (
        <Button
          label="Board"
          icon={board.icon}
          tone={board.tone}
          size="lg"
          onPress={onBoard}
          disabled={busy}
          busy={busy}
        />
      ) : null}
      {canAct && student.status === TripAttendanceStatus.BOARDED ? (
        <Button
          label="Drop"
          icon={drop.icon}
          variant="secondary"
          size="lg"
          onPress={onDrop}
          disabled={busy}
          busy={busy}
        />
      ) : null}
    </View>
  );
};

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
    fontSize: 17,
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
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  rowMeta: {
    fontSize: 16,
    color: colors.neutral[600],
  },
});
