import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  TripAttendanceStatus,
  TripStatus,
  type BusListResponse,
  type BusResponse,
  type ReportFilterKey,
  type ReportResultResponse,
  type ReportType,
  type RouteMinimalListResponse,
  type RouteMinimalResponse,
  type ShiftListResponse,
  type ShiftResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../src/services/api';
import { unwrapEnvelope } from '../../../src/lib/errors';
import { attendanceStatusLabel, tripStatusLabel } from '../../../src/lib/format';
import {
  EMPTY_REPORT_FILTERS,
  appliedFilterLabels,
  buildReportQuery,
  reportFiltersActive,
  reportRowEntries,
  type ReportFilterState,
} from '../../../src/lib/reports';
import { shiftLabel } from '../../../src/lib/runs';
import { useLoad } from '../../../src/hooks/useLoad';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FilterSummary,
  FormSheet,
  ListScreen,
  LoadingView,
  Pagination,
  Select,
} from '../../../src/components';
import { StatGrid } from '../../../src/features/admin/reports';

/**
 * A single report — mobile twin of the web console's report page: filter
 * sheet, summary cards, paginated result table, per-row cards.
 *
 * The filter sheet renders only the inputs the report declares support for,
 * so an admin is never offered a control the server would ignore. Applying a
 * filter re-queries from page 1; the entered values are kept in the sheet, so
 * a failed load never wipes what the user typed. Spreadsheet export stays on
 * the web console, which sends the identical query — mobile focuses on
 * reading.
 */

interface PickLookups {
  routes: RouteMinimalResponse[];
  buses: BusResponse[];
  shifts: ShiftResponse[];
}

export default function AdminReportDetailScreen() {
  const { report } = useLocalSearchParams<{ report: string }>();
  const router = useRouter();
  const reportKey = typeof report === 'string' ? (report as ReportType) : undefined;

  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_REPORT_FILTERS);
  const [applied, setApplied] = useState<ReportFilterState>(EMPTY_REPORT_FILTERS);
  const [page, setPage] = useState(1);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const catalogue = useLoad(async () => unwrapEnvelope(await apiClient.listReports()).items, []);
  const descriptor = useMemo(
    () => (catalogue.data ?? []).find((item) => item.report === reportKey) ?? null,
    [catalogue.data, reportKey],
  );
  const supported = useMemo(() => descriptor?.filters ?? [], [descriptor]);

  // Picker data, fetched lazily and only for the filters this report declares.
  const lookups = useLoad(async (): Promise<PickLookups> => {
    if (!descriptor) return { routes: [], buses: [], shifts: [] };
    const [routes, buses, shifts] = await Promise.all([
      supported.includes('route_id')
        ? apiClient.listRoutes({ page: 1, limit: 100, include: 'minimal' })
        : Promise.resolve(null),
      supported.includes('bus_id')
        ? apiClient.listBuses({ page: 1, limit: 100 })
        : Promise.resolve(null),
      supported.includes('shift_id')
        ? apiClient.listShifts({ page: 1, limit: 100 })
        : Promise.resolve(null),
    ]);
    return {
      routes: routes ? unwrapEnvelope<RouteMinimalListResponse>(routes).items : [],
      buses: buses ? unwrapEnvelope<BusListResponse>(buses).items : [],
      shifts: shifts ? unwrapEnvelope<ShiftListResponse>(shifts).items : [],
    };
  }, [descriptor, supported]);

  const result = useLoad(async (): Promise<ReportResultResponse | null> => {
    if (!reportKey || !descriptor) return null;
    return unwrapEnvelope(
      await apiClient.runReport(reportKey, buildReportQuery(applied, supported, page)),
    );
  }, [reportKey, descriptor, applied, page, supported]);

  const applyFilters = () => {
    setPage(1);
    setApplied(filters);
    setFilterSheetOpen(false);
  };

  const clearFilters = () => {
    setFilters(EMPTY_REPORT_FILTERS);
    setApplied(EMPTY_REPORT_FILTERS);
    setPage(1);
    setFilterSheetOpen(false);
  };

  const set = (key: keyof ReportFilterState) => (value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const appliedLabels = appliedFilterLabels(applied, supported, (key, value) =>
    filterLabel(key, value, lookups.data),
  );
  const filtersActive = reportFiltersActive(applied, supported);

  if (catalogue.loading && !catalogue.data) {
    return <LoadingView label="Loading report…" />;
  }
  if (catalogue.error || !catalogue.data) {
    return (
      <View style={styles.center}>
        <ErrorState
          message={catalogue.error ?? 'Could not load the reports catalogue'}
          onRetry={() => void catalogue.reload()}
        />
      </View>
    );
  }
  if (!descriptor) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Report not found"
          description="That report does not exist."
          action={
            <Button
              label="Back to reports"
              variant="secondary"
              onPress={() => router.replace('/reports' as never)}
            />
          }
        />
      </View>
    );
  }

  const rows = result.data?.rows ?? [];
  const columns = result.data?.columns ?? [];

  return (
    <View style={styles.flex}>
      <ListScreen
        data={rows}
        keyExtractor={(_, index) => `${page}:${index}`}
        renderItem={({ item: row }) => {
          const entries = reportRowEntries(row, columns);
          return (
            <View style={styles.rowCard}>
              {entries.map((entry, index) => (
                <View key={entry.key} style={styles.rowEntry}>
                  <Text
                    style={index === 0 ? styles.rowTitle : styles.rowLabel}
                    numberOfLines={index === 0 ? 1 : undefined}
                  >
                    {index === 0 ? entry.value : entry.label}
                  </Text>
                  {index === 0 ? null : <Text style={styles.rowValue}>{entry.value}</Text>}
                </View>
              ))}
            </View>
          );
        }}
        header={
          <>
            <Pressable
              onPress={() => router.back()}
              style={styles.backRow}
              accessibilityRole="button"
            >
              <Text style={styles.backText}>‹ All reports</Text>
            </Pressable>
            <Text style={styles.title}>{descriptor.label}</Text>
            <Text style={styles.subtitle}>{descriptor.description}</Text>

            {supported.length > 0 ? (
              <View style={styles.filterBar}>
                <Button
                  label="Filters"
                  variant="secondary"
                  onPress={() => setFilterSheetOpen(true)}
                />
                {filtersActive ? (
                  <FilterSummary label={appliedLabels.join(' · ')} onClear={clearFilters} />
                ) : null}
              </View>
            ) : null}

            {result.loading && !result.data ? (
              <LoadingView label="Running report…" />
            ) : result.error ? (
              <ErrorState message={result.error} onRetry={() => void result.reload()} />
            ) : result.data ? (
              <>
                {result.data.summary.length > 0 ? (
                  <View style={styles.summary}>
                    <StatGrid cards={result.data.summary} />
                  </View>
                ) : null}
                {rows.length > 0 ? (
                  <Text style={styles.count}>
                    {result.data.meta.total} record{result.data.meta.total === 1 ? '' : 's'}
                  </Text>
                ) : null}
              </>
            ) : null}
          </>
        }
        footer={
          result.data && rows.length > 0 ? (
            <Pagination meta={result.data.meta} onPage={setPage} />
          ) : null
        }
        empty={
          result.loading || result.error || !result.data ? null : (
            <EmptyState
              title="Nothing matched"
              description="No records match these filters. Widen the date range or clear a filter."
              action={
                filtersActive ? (
                  <Button label="Clear filters" variant="secondary" onPress={clearFilters} />
                ) : null
              }
            />
          )
        }
        refresh={result.data ? () => void result.refresh() : null}
        refreshing={result.refreshing}
      />

      <FormSheet
        open={filterSheetOpen}
        title="Report filters"
        onClose={() => setFilterSheetOpen(false)}
        footer={
          <>
            <Button label="Clear" variant="secondary" onPress={clearFilters} style={styles.flex} />
            <Button label="Apply" onPress={applyFilters} style={styles.flex} />
          </>
        }
      >
        {supported.includes('search') ? (
          <Field
            label="Search"
            value={filters.search}
            onChangeText={set('search')}
            placeholder="Name or reference"
            autoCapitalize="none"
          />
        ) : null}
        {supported.includes('status') ? (
          <Select
            label="Status"
            value={filters.status}
            onChange={set('status')}
            options={[
              { value: '', label: 'Any status' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            placeholder="Any status"
          />
        ) : null}
        {supported.includes('trip_status') ? (
          <Select
            label="Trip status"
            value={filters.trip_status}
            onChange={set('trip_status')}
            options={[
              { value: '', label: 'Any status' },
              ...Object.values(TripStatus).map((value) => ({
                value,
                label: tripStatusLabel(value),
              })),
            ]}
            placeholder="Any status"
          />
        ) : null}
        {supported.includes('attendance_status') ? (
          <Select
            label="Attendance"
            value={filters.attendance_status}
            onChange={set('attendance_status')}
            options={[
              { value: '', label: 'Any status' },
              ...Object.values(TripAttendanceStatus).map((value) => ({
                value,
                label: attendanceStatusLabel(value),
              })),
            ]}
            placeholder="Any"
          />
        ) : null}
        {supported.includes('route_id') ? (
          <Select
            label="Route"
            value={filters.route_id}
            onChange={set('route_id')}
            options={[
              { value: '', label: 'All routes' },
              ...(lookups.data?.routes ?? []).map((route) => ({
                value: route.id,
                label: `${route.code} — ${route.name}`,
              })),
            ]}
            placeholder="All routes"
          />
        ) : null}
        {supported.includes('bus_id') ? (
          <Select
            label="Bus"
            value={filters.bus_id}
            onChange={set('bus_id')}
            options={[
              { value: '', label: 'All buses' },
              ...(lookups.data?.buses ?? []).map((bus) => ({
                value: bus.id,
                label: bus.registration_number,
              })),
            ]}
            placeholder="All buses"
          />
        ) : null}
        {supported.includes('shift_id') ? (
          <Select
            label="Shift"
            value={filters.shift_id}
            onChange={set('shift_id')}
            options={[
              { value: '', label: 'All shifts' },
              ...(lookups.data?.shifts ?? []).map((shift) => ({
                value: shift.id,
                label: shiftLabel(shift),
              })),
            ]}
            placeholder="All shifts"
          />
        ) : null}
        {supported.includes('date_from') ? (
          <Field
            label="From (YYYY-MM-DD)"
            value={filters.date_from}
            onChangeText={set('date_from')}
            placeholder="2026-01-01"
            autoCapitalize="none"
          />
        ) : null}
        {supported.includes('date_to') ? (
          <Field
            label="To (YYYY-MM-DD)"
            value={filters.date_to}
            onChangeText={set('date_to')}
            placeholder="2026-12-31"
            autoCapitalize="none"
          />
        ) : null}
      </FormSheet>
    </View>
  );
}

/** Human label of an applied filter, resolved against the loaded pickers. */
function filterLabel(key: ReportFilterKey, value: string, lookups: PickLookups | null): string {
  switch (key) {
    case 'route_id':
      return lookups?.routes.find((route) => route.id === value)?.name ?? 'Route';
    case 'bus_id':
      return lookups?.buses.find((bus) => bus.id === value)?.registration_number ?? 'Bus';
    case 'shift_id':
      return lookups?.shifts.find((shift) => shift.id === value)?.name ?? 'Shift';
    case 'trip_status':
      return tripStatusLabel(value as TripStatus);
    case 'attendance_status':
      return attendanceStatusLabel(value as TripAttendanceStatus);
    case 'status':
      return value === 'active' ? 'Active' : value === 'inactive' ? 'Inactive' : value;
    default:
      return value;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', padding: spacing.md },
  backRow: { alignSelf: 'flex-start', marginBottom: spacing.sm },
  backText: { color: colors.primary[700], fontSize: 15, fontWeight: '600' },
  title: {
    fontSize: typography.fontSizes.xl,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  subtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
    marginTop: 2,
    marginBottom: spacing.md,
  },
  filterBar: {
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  summary: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  count: {
    color: colors.neutral[500],
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  rowCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  rowEntry: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
    marginBottom: 2,
  },
  rowLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    flexShrink: 1,
  },
  rowValue: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[800],
    flexShrink: 0,
  },
});
