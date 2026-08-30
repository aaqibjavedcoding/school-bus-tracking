import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  TripStatus,
  type RouteAssignmentListResponse,
  type RouteAssignmentResponse,
  type TripResponse,
} from '@school-bus-tracking/shared-types';
import { tripCreateSchema } from '@school-bus-tracking/validation';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../src/lib/errors';
import {
  formatDate,
  formatTime,
  fromDateTimeLocalValue,
  tripStatusLabel,
  utcDateOnly,
} from '../../src/lib/format';
import {
  LIVE_FILTER,
  LIVE_STATUSES,
  uniqueTripsById,
  visibleTrips,
  type TripStatusFilter,
} from '../../src/lib/trips-list';
import { useLoad } from '../../src/hooks/useLoad';
import { usePagedResource } from '../../src/hooks/usePagedResource';
import {
  Badge,
  Button,
  ConfirmDialog,
  DateTimeField,
  EmptyState,
  ErrorState,
  Fab,
  FilterChips,
  FilterSummary,
  FormSheet,
  LoadingView,
  Pagination,
  Screen,
  SearchBar,
  Select,
  TripStatusBadge,
  useToast,
} from '../../src/components';

/**
 * School-admin trip schedule — the mobile view of the web Trips page.
 *
 * Filters mirror the web toolbar exactly (free-text search + day + status)
 * and run against the same `GET /trips` query parameters. On top of the
 * server-side narrowing, the rendered rows are shaped client-side
 * (`src/lib/trips-list.ts`): unique by trip id — the "Live" chip merges two
 * parallel responses and a trip that changes status between them must render
 * once — inside the selected status chip, and matched against the active
 * search over route, bus and crew. The "Schedule trip" sheet mirrors the web
 * modal field-for-field — assignment, scheduled start and optional scheduled
 * end — validated with the shared `tripCreateSchema`.
 */

/**
 * `LIVE` is a mobile-only convenience filter (boarding + in progress) used by
 * the dashboard's "Live trips" card. It is resolved client-side over the same
 * `GET /trips` responses — no new API surface. The merged pages are
 * de-duplicated by trip id (see `trips-list.ts`): a trip that changes status
 * between the two parallel requests, or any response overlap, must never
 * render — and key — twice.
 */
type StatusFilter = TripStatusFilter;

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: LIVE_FILTER, label: 'Live' },
  ...Object.values(TripStatus).map((status) => ({
    value: status as StatusFilter,
    label: tripStatusLabel(status),
  })),
];

function statusFilterLabel(value: StatusFilter): string {
  if (value === '') return 'All statuses';
  if (value === LIVE_FILTER) return 'Live';
  return tripStatusLabel(value);
}

const EMPTY_FORM = {
  route_assignment_id: '',
  scheduled_start_at: '',
  scheduled_end_at: '',
};

function shiftDay(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function dayLabel(day: string): string {
  return day ? formatDate(new Date(`${day}T12:00:00.000Z`)) : 'All days';
}

/**
 * Web-identical assignment option label. Crucially the list is one row per
 * *assignment* (a single crew member in a single role) — never a merged
 * "driver + conductor" entry — and the role is shown so the two are
 * distinguishable.
 */
function assignmentLabel(assignment: RouteAssignmentResponse): string {
  const route = `${assignment.route_code ?? 'Route'} — ${assignment.route_name ?? ''}`.trim();
  const bus = assignment.bus_number ?? assignment.bus_registration_number ?? 'No bus';
  const role = assignment.role.toLowerCase();
  return `${route} · ${bus} · ${role}`;
}

export default function AdminTripsScreen() {
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ status?: string }>();
  const today = utcDateOnly();

  // Deep link from the dashboard "Live trips" card: /trips?status=IN_PROGRESS
  const initialStatus: StatusFilter =
    typeof params.status === 'string' &&
    ([...Object.values(TripStatus), LIVE_FILTER] as string[]).includes(params.status)
      ? (params.status as StatusFilter)
      : '';

  const [day, setDay] = useState(today);
  const [status, setStatus] = useState<StatusFilter>(initialStatus);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TripResponse | null>(null);

  const list = usePagedResource<TripResponse>(
    async (page, search) => {
      const query = {
        page,
        limit: 20,
        search: search || undefined,
        date: day || undefined,
      };
      if (status !== LIVE_FILTER) {
        return unwrapEnvelope(await apiClient.listTrips({ ...query, status: status || undefined }));
      }
      // "Live" = boarding + in progress: two scoped queries merged in order.
      // The merge is de-duplicated by id — a trip transitioning between the two
      // statuses while both queries are in flight arrives in both pages and must
      // render (and key) exactly once.
      const pages = await Promise.all(
        LIVE_STATUSES.map(async (liveStatus) =>
          unwrapEnvelope(await apiClient.listTrips({ ...query, status: liveStatus })),
        ),
      );
      const items = uniqueTripsById(pages.flatMap((entry) => entry.items)).sort((a, b) =>
        a.scheduled_start_at.localeCompare(b.scheduled_start_at),
      );
      const total = pages.reduce((sum, entry) => sum + entry.meta.total, 0);
      return {
        items,
        meta: {
          page: 1,
          limit: items.length,
          total,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    },
    [status, day],
  );

  // Active assignments feed the schedule form — same lookup the web page uses.
  const lookups = useLoad(async (): Promise<{ assignments: RouteAssignmentResponse[] }> => {
    const assignments = await apiClient.listRouteAssignments({
      page: 1,
      limit: 100,
      is_active: true,
    });
    return { assignments: unwrapEnvelope<RouteAssignmentListResponse>(assignments).items };
  }, []);

  const isToday = day === today;
  const filtersActive = Boolean(list.activeSearch) || Boolean(status) || !isToday;

  // Rows actually rendered: unique by id, inside the selected status chip and
  // matching the active search (case-insensitive over route, bus and crew —
  // including full crew names, which the server predicate cannot match). This
  // narrows the page that was actually loaded, the same approach as the
  // active/inactive chips on the other admin lists.
  const rows = useMemo(
    () => visibleTrips(list.items, status, list.activeSearch),
    [list.items, status, list.activeSearch],
  );

  // While filtering, the visible rows are the source of truth; the unfiltered
  // list keeps the server total (which spans all pages).
  const shownCount = filtersActive ? rows.length : list.meta.total;

  const summary = useMemo(() => {
    const byStatus = new Map<TripStatus, number>();
    for (const trip of uniqueTripsById(list.items)) {
      byStatus.set(trip.status, (byStatus.get(trip.status) ?? 0) + 1);
    }
    return byStatus;
  }, [list.items]);

  const resetFilters = () => {
    list.clearSearch();
    setStatus('');
    setDay(today);
  };

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setOpen(true);
  };

  const save = async () => {
    // Same payload shaping as the web form: local datetime → ISO instant,
    // empty optional end → null, then the shared Zod schema.
    const payload = {
      route_assignment_id: form.route_assignment_id,
      scheduled_start_at: form.scheduled_start_at
        ? fromDateTimeLocalValue(form.scheduled_start_at)
        : '',
      scheduled_end_at: form.scheduled_end_at
        ? fromDateTimeLocalValue(form.scheduled_end_at)
        : null,
    };
    const parsed = tripCreateSchema.safeParse({
      ...payload,
      scheduled_end_at: emptyToNull(payload.scheduled_end_at ?? ''),
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    setFieldErrors({});
    try {
      const trip = unwrapEnvelope(await apiClient.createTrip(parsed.data));
      toast.push('Trip scheduled.', 'success');
      setOpen(false);
      await list.reload();
      router.push(`/trips/${trip.id}`);
    } catch (caught) {
      setFieldErrors(fieldErrorsFromUnknown(caught));
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await apiClient.deleteTrip(pendingDelete.id);
      toast.push('Trip deleted.', 'success');
      setPendingDelete(null);
      await list.reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const routeLabel = (trip: TripResponse): string =>
    trip.route_code
      ? `${trip.route_code} · ${trip.route_name ?? ''}`.trim()
      : (trip.route_name ?? 'Route');
  const busLabel = (trip: TripResponse): string =>
    trip.registration_number ?? trip.bus_number ?? '—';

  const assignmentOptions = (lookups.data?.assignments ?? []).map((assignment) => ({
    value: assignment.id,
    label: assignmentLabel(assignment),
  }));

  const statusOptions = STATUS_OPTIONS.map((option) => {
    if (option.value === '') return { value: option.value, label: `All · ${list.meta.total}` };
    if (option.value === LIVE_FILTER) {
      const live = LIVE_STATUSES.reduce((sum, entry) => sum + (summary.get(entry) ?? 0), 0);
      return { value: option.value, label: `Live · ${live}` };
    }
    return {
      value: option.value,
      label: `${option.label} · ${summary.get(option.value as TripStatus) ?? 0}`,
    };
  });

  return (
    <View style={styles.flex}>
      <Screen refresh={() => void list.reload()} refreshing={list.loading} extraBottomSpace={72}>
        <SearchBar
          value={list.search}
          onChangeText={list.setSearch}
          onClear={list.clearSearch}
          searching={list.searching}
          placeholder="Search route, bus or crew…"
        />

        <View style={styles.dayRow}>
          <Pressable
            onPress={() => setDay((current) => shiftDay(current, -1))}
            style={styles.dayButton}
            accessibilityLabel="Previous day"
            hitSlop={6}
          >
            <Text style={styles.dayButtonText}>‹</Text>
          </Pressable>
          <View style={styles.dayLabel}>
            <Text style={styles.dayLabelText}>{dayLabel(day)}</Text>
            {isToday ? <Badge label="Today" tone="info" /> : null}
          </View>
          <Pressable
            onPress={() => setDay((current) => shiftDay(current, 1))}
            style={styles.dayButton}
            accessibilityLabel="Next day"
            hitSlop={6}
          >
            <Text style={styles.dayButtonText}>›</Text>
          </Pressable>
        </View>

        <FilterChips<StatusFilter> options={statusOptions} value={status} onChange={setStatus} />

        {filtersActive ? (
          <FilterSummary
            label={[
              list.activeSearch ? `“${list.activeSearch}”` : null,
              status ? statusFilterLabel(status) : null,
              !isToday ? dayLabel(day) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            onClear={resetFilters}
          />
        ) : null}

        {list.loading && rows.length === 0 ? (
          <LoadingView label="Loading the schedule…" />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={() => void list.reload()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtersActive ? 'No matching trips' : 'No trips for this day'}
            description={
              filtersActive
                ? 'No trips match the current filters.'
                : 'Nothing is scheduled. Tap Schedule to dispatch a trip from an active assignment.'
            }
            action={
              filtersActive ? (
                <Button label="Clear filters" variant="secondary" onPress={resetFilters} />
              ) : (
                <Button label="Schedule trip" onPress={startCreate} />
              )
            }
          />
        ) : (
          <>
            <Text style={styles.count}>
              {shownCount} {shownCount === 1 ? 'trip' : 'trips'}
            </Text>
            {rows.map((trip) => (
              <Pressable
                key={trip.id}
                onPress={() => router.push(`/trips/${trip.id}`)}
                onLongPress={() => setPendingDelete(trip)}
                style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
              >
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {routeLabel(trip)}
                    </Text>
                    <Text style={styles.cardMeta}>
                      {formatTime(trip.scheduled_start_at)} · Bus {busLabel(trip)}
                    </Text>
                    {trip.driver_name || trip.conductor_name ? (
                      <Text style={styles.cardMeta} numberOfLines={1}>
                        {trip.driver_name ? `Driver ${trip.driver_name}` : ''}
                        {trip.driver_name && trip.conductor_name ? ' · ' : ''}
                        {trip.conductor_name ? `Conductor ${trip.conductor_name}` : ''}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </View>
                <View style={styles.badgeRow}>
                  <TripStatusBadge status={trip.status} />
                  {trip.status === TripStatus.BOARDING || trip.status === TripStatus.IN_PROGRESS ? (
                    <Badge label="● Live" tone="success" />
                  ) : null}
                </View>
              </Pressable>
            ))}
            <Pagination meta={list.meta} onPage={list.setPage} />
            <Text style={styles.hint}>Tip: long-press a trip to delete it.</Text>
          </>
        )}
      </Screen>

      <Fab onPress={startCreate} label="Schedule" />

      <FormSheet
        open={open}
        title="Schedule trip"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setOpen(false)}
              style={styles.flex}
            />
            <Button label="Schedule" onPress={() => void save()} busy={busy} style={styles.flex} />
          </>
        }
      >
        <Select
          label="Assignment"
          value={form.route_assignment_id}
          onChange={(value) => setForm({ ...form, route_assignment_id: value })}
          options={assignmentOptions}
          placeholder="Select assignment"
          error={fieldErrors.route_assignment_id}
        />
        <DateTimeField
          label="Scheduled start"
          value={form.scheduled_start_at}
          onChange={(value) => setForm({ ...form, scheduled_start_at: value })}
          error={fieldErrors.scheduled_start_at}
          hint="Device-local time — sent to the API as a UTC instant."
        />
        <DateTimeField
          label="Scheduled end"
          optional
          value={form.scheduled_end_at}
          onChange={(value) => setForm({ ...form, scheduled_end_at: value })}
          error={fieldErrors.scheduled_end_at}
        />
        {lookups.loading ? (
          <Text style={styles.warn}>Loading active assignments…</Text>
        ) : assignmentOptions.length === 0 ? (
          <Text style={styles.warn}>
            No active assignments yet. Create one under Manage → Assignments first.
          </Text>
        ) : null}
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete trip?"
        message="Open trips are cancelled first, then removed from the active list."
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  dayButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  dayButtonText: {
    fontSize: 26,
    color: colors.primary[700],
    fontWeight: '700',
    marginTop: -4,
  },
  dayLabel: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  dayLabelText: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  count: {
    color: colors.neutral[500],
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  cardMeta: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    color: colors.neutral[300],
    fontWeight: '700',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  hint: {
    textAlign: 'center',
    color: colors.neutral[400],
    fontSize: typography.fontSizes.xs,
    marginTop: spacing.sm,
  },
  warn: {
    color: colors.status.warning,
    fontSize: typography.fontSizes.xs,
    marginTop: spacing.xs,
  },
});
