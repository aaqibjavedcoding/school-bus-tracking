import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  TripAttendanceStatus,
  type TripStudentAttendanceResponse,
  type TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Badge,
  Button,
  EmptyState,
  FilterChips,
  SearchBar,
  screenRefreshControl,
} from '../../components';
import { crewCopy } from './crew-copy';
import {
  MANIFEST_ROW_MIN_HEIGHT,
  ROW_ACTION_GLYPH_SIZE,
  ROW_FLASH_GREEN,
  confirmationLine,
  rowActionFor,
  rowA11yLabel,
  rowActionGlyph,
  settledSymbol,
  successAnnouncement,
} from './manifest-row';

/**
 * Student manifest with board/drop actions — the shared crew surface.
 *
 * Phase 2 makes the row itself the button (one job, one screen):
 *
 * - **the whole card is the tap target** — the current action (board for a
 *   waiting student, drop for an on-board one) fires from anywhere on the
 *   row, no precisce 60px button to hit in a moving bus;
 * - a **big ✓/✕ glyph zone (60px)** on the right names the action, green in
 *   / grey out (the shared `crew-action-meta` vocabulary);
 * - success is confirmed three ways: the **row flashes green**, an inline
 *   "**Ramesh ✓ 7:42 AM**" line appears (server timestamps only), and the
 *   screen reader announces the boarding — colour never the only cue;
 * - offline is honest: a queued action shows "⏳ saved offline" until the
 *   server confirms it (queue itself untouched).
 *
 * All state still comes from `GET /trips/:tripId/students` and the
 * body-less `board` / `drop` endpoints; grouping, filtering, search and the
 * offline queue are exactly the Phase-1 logic with new presentation.
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
  /** Students whose board/drop is sitting in the offline queue right now. */
  queuedStudentIds?: ReadonlySet<string>;
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
  queuedStudentIds,
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
          queued={queuedStudentIds?.has(item.student_id) ?? false}
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
  queued: boolean;
  onBoard: () => void;
  onDrop: () => void;
}> = ({ student, canAct, busy, queued, onBoard, onDrop }) => {
  const action = rowActionFor(student.status, canAct);
  const glyph = rowActionGlyph(action);
  const confirmation = confirmationLine(
    student,
    queued && student.status === TripAttendanceStatus.PENDING ? 'queued' : 'recorded',
  );

  // Success feedback: flash the row green + announce it to screen readers
  // when the row's recorded state advances (pending → boarded → dropped).
  const flash = useRef(new Animated.Value(0)).current;
  const previousStatus = useRef<TripAttendanceStatus | null>(null);
  useEffect(() => {
    const before = previousStatus.current;
    previousStatus.current = student.status;
    const advanced =
      (before === TripAttendanceStatus.PENDING &&
        student.status === TripAttendanceStatus.BOARDED) ||
      (before === TripAttendanceStatus.BOARDED && student.status === TripAttendanceStatus.DROPPED);
    if (!advanced) return;
    Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 180, useNativeDriver: false }),
      Animated.timing(flash, { toValue: 0, duration: 400, useNativeDriver: false }),
    ]).start();
    AccessibilityInfo.announceForAccessibility(
      successAnnouncement(
        `${student.first_name} ${student.last_name}`.trim(),
        before === TripAttendanceStatus.PENDING ? 'board' : 'drop',
      ),
    );
  }, [flash, student.status, student.first_name, student.last_name]);

  const backgroundColor = flash.interpolate({
    inputRange: [0, 1],
    outputRange: ['#ffffff', ROW_FLASH_GREEN],
  });

  const press = () => {
    if (busy) return;
    if (action === 'board') onBoard();
    if (action === 'drop') onDrop();
  };

  return (
    <Pressable
      onPress={press}
      disabled={!action || busy}
      accessibilityRole={action ? 'button' : undefined}
      accessibilityLabel={rowA11yLabel(student, action)}
      accessibilityHint={
        action === 'board'
          ? crewCopy.manifest.boardHint
          : action === 'drop'
            ? crewCopy.manifest.dropHint
            : undefined
      }
      accessibilityState={{ disabled: busy, busy }}
      style={styles.rowWrap}
    >
      {({ pressed }) => (
        <Animated.View style={[styles.row, { backgroundColor }, pressed && action ? styles.rowPressed : null]}>
          <View style={styles.rowMain}>
            <Text style={styles.rowName}>
              {student.first_name} {student.last_name}
            </Text>
            <Text style={styles.rowMeta}>
              {student.admission_number}
              {student.grade_level ? ` · ${student.grade_level}` : ''}
            </Text>
            {confirmation ? (
              <Text
                style={[
                  styles.confirmation,
                  student.status === TripAttendanceStatus.DROPPED ? styles.confirmationDropped : null,
                ]}
              >
                {confirmation}
              </Text>
            ) : (
              <Text style={styles.waiting}>{crewCopy.manifest.waitingLabel}</Text>
            )}
          </View>
          <View style={styles.glyphZone} accessible={false}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.neutral[500]} />
            ) : glyph ? (
              <View
                style={[
                  styles.glyphCircle,
                  glyph.tone === 'success' ? styles.glyphSuccess : styles.glyphNeutral,
                ]}
              >
                <Ionicons
                  name={glyph.icon}
                  size={34}
                  color={glyph.tone === 'success' ? '#ffffff' : colors.neutral[700]}
                />
              </View>
            ) : (
              <Text style={styles.settledSymbol}>{settledSymbol(student.status)}</Text>
            )}
          </View>
        </Animated.View>
      )}
    </Pressable>
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
  rowWrap: {
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MANIFEST_ROW_MIN_HEIGHT,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
  },
  rowPressed: {
    borderColor: colors.neutral[400],
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
  confirmation: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.secondary[800],
  },
  confirmationDropped: {
    color: colors.neutral[700],
  },
  waiting: {
    fontSize: 16,
    color: colors.neutral[600],
  },
  glyphZone: {
    width: ROW_ACTION_GLYPH_SIZE,
    height: ROW_ACTION_GLYPH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphCircle: {
    width: ROW_ACTION_GLYPH_SIZE,
    height: ROW_ACTION_GLYPH_SIZE,
    borderRadius: ROW_ACTION_GLYPH_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphSuccess: {
    backgroundColor: colors.secondary[700],
  },
  glyphNeutral: {
    backgroundColor: colors.neutral[200],
  },
  settledSymbol: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.neutral[500],
  },
});
