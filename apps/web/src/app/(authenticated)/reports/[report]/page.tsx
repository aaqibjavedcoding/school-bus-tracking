'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import {
  DataFileFormat,
  ReportType,
  TripAttendanceStatus,
  TripStatus,
  type ReportFilterKey,
  type ReportQuery,
} from '@school-bus-tracking/shared-types';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  useToast,
} from '../../../../components/ui';
import { saveBlob } from '../../../../features/data-transfer';
import { useLoad } from '../../../../hooks/useLoad';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../lib/errors';
import { apiClient } from '../../../../services/api';

/**
 * A single report: filter bar, summary cards, result table, download.
 *
 * The filter bar renders only the inputs the report declares support for, so
 * an admin is never offered a control that the server would ignore. The
 * download sends the identical query, which is what guarantees the file and
 * the table agree.
 */

type FilterState = {
  search: string;
  status: string;
  route_id: string;
  bus_id: string;
  stop_id: string;
  driver_id: string;
  student_id: string;
  trip_status: string;
  attendance_status: string;
  date_from: string;
  date_to: string;
};

const EMPTY_FILTERS: FilterState = {
  search: '',
  status: '',
  route_id: '',
  bus_id: '',
  stop_id: '',
  driver_id: '',
  student_id: '',
  trip_status: '',
  attendance_status: '',
  date_from: '',
  date_to: '',
};

/** Turns the form state into the query the API accepts (blank = absent). */
function toQuery(filters: FilterState, supported: ReportFilterKey[], page: number): ReportQuery {
  const query: ReportQuery = { page, limit: 50 };
  for (const key of supported) {
    const value = filters[key as keyof FilterState];
    if (value) {
      (query as Record<string, unknown>)[key] = value;
    }
  }
  return query;
}

export default function ReportDetailPage() {
  const params = useParams<{ report: string }>();
  const reportKey = params?.report as ReportType | undefined;
  const toast = useToast();

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const catalogue = useLoad(async () => unwrapEnvelope(await apiClient.listReports()).items, []);

  const descriptor = useMemo(
    () => (catalogue.data ?? []).find((item) => item.report === reportKey) ?? null,
    [catalogue.data, reportKey],
  );

  const supported = descriptor?.filters ?? [];

  const result = useLoad(async () => {
    if (!reportKey || !descriptor) {
      return null;
    }
    return unwrapEnvelope(
      await apiClient.runReport(reportKey, toQuery(applied, descriptor.filters, page)),
    );
  }, [reportKey, descriptor, applied, page]);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setApplied(filters);
  };

  const clear = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const download = async (format: DataFileFormat) => {
    if (!reportKey || !descriptor) return;
    setBusy(true);
    try {
      saveBlob(
        await apiClient.downloadReport(reportKey, {
          ...toQuery(applied, descriptor.filters, 1),
          format,
        }),
      );
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (catalogue.loading) {
    return (
      <div className="page">
        <Skeleton lines={8} />
      </div>
    );
  }

  if (catalogue.error) {
    return (
      <div className="page">
        <ErrorState message={catalogue.error} onRetry={() => void catalogue.reload()} />
      </div>
    );
  }

  if (!descriptor) {
    return (
      <div className="page">
        <EmptyState
          title="Report not found"
          description="That report does not exist."
          action={
            <Link className="linkish" href="/reports">
              Back to reports
            </Link>
          }
        />
      </div>
    );
  }

  const set = (key: keyof FilterState) => (value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="page">
      <PageHeader
        title={descriptor.label}
        description={descriptor.description}
        actions={
          <>
            <Link className="linkish" href="/reports">
              All reports
            </Link>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void download(DataFileFormat.XLSX)}
            >
              {busy ? 'Preparing…' : 'Download .xlsx'}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void download(DataFileFormat.CSV)}
            >
              .csv
            </Button>
          </>
        }
      />

      {supported.length > 0 ? (
        <Card title="Filters">
          <form className="filter-bar" onSubmit={apply}>
            {supported.includes('search') ? (
              <Field id="filter-search" label="Search">
                <Input
                  id="filter-search"
                  value={filters.search}
                  placeholder="Name or reference"
                  onChange={(event) => set('search')(event.target.value)}
                />
              </Field>
            ) : null}
            {supported.includes('status') ? (
              <Field id="filter-status" label="Status">
                <Input
                  id="filter-status"
                  value={filters.status}
                  placeholder="active / inactive"
                  onChange={(event) => set('status')(event.target.value)}
                />
              </Field>
            ) : null}
            {supported.includes('trip_status') ? (
              <Field id="filter-trip-status" label="Trip status">
                <Select
                  id="filter-trip-status"
                  value={filters.trip_status}
                  onChange={(event) => set('trip_status')(event.target.value)}
                  placeholder="Any status"
                  options={Object.values(TripStatus).map((value) => ({
                    value,
                    label: value.replace(/_/g, ' ').toLowerCase(),
                  }))}
                />
              </Field>
            ) : null}
            {supported.includes('attendance_status') ? (
              <Field id="filter-attendance-status" label="Attendance">
                <Select
                  id="filter-attendance-status"
                  value={filters.attendance_status}
                  onChange={(event) => set('attendance_status')(event.target.value)}
                  placeholder="Any"
                  options={Object.values(TripAttendanceStatus).map((value) => ({
                    value,
                    label: value.toLowerCase(),
                  }))}
                />
              </Field>
            ) : null}
            {supported.includes('route_id') ? (
              <RouteFilter value={filters.route_id} onChange={set('route_id')} />
            ) : null}
            {supported.includes('bus_id') ? (
              <BusFilter value={filters.bus_id} onChange={set('bus_id')} />
            ) : null}
            {supported.includes('date_from') ? (
              <Field id="filter-from" label="From">
                <Input
                  id="filter-from"
                  type="date"
                  value={filters.date_from}
                  onChange={(event) => set('date_from')(event.target.value)}
                />
              </Field>
            ) : null}
            {supported.includes('date_to') ? (
              <Field id="filter-to" label="To">
                <Input
                  id="filter-to"
                  type="date"
                  value={filters.date_to}
                  onChange={(event) => set('date_to')(event.target.value)}
                />
              </Field>
            ) : null}
            <div className="row">
              <Button type="submit">Apply</Button>
              <Button type="button" variant="ghost" onClick={clear}>
                Clear
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {result.loading ? (
        <Skeleton lines={8} />
      ) : result.error ? (
        <ErrorState message={result.error} onRetry={() => void result.reload()} />
      ) : result.data ? (
        <>
          {result.data.summary.length > 0 ? (
            <div className="stat-grid">
              {result.data.summary.map((card) => (
                <div key={card.key} className="stat">
                  <span className="stat-value">{card.value.toLocaleString()}</span>
                  <span className="stat-label">{card.label}</span>
                  {card.hint ? <span className="stat-hint muted small">{card.hint}</span> : null}
                </div>
              ))}
            </div>
          ) : null}

          {result.data.rows.length === 0 ? (
            <EmptyState
              title="Nothing matched"
              description="No records match these filters. Widen the date range or clear a filter."
            />
          ) : (
            <Card>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      {result.data.columns.map((column) => (
                        <th
                          key={column.key}
                          className={column.type === 'number' ? 'numeric' : undefined}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.rows.map((row, index) => (
                      <tr key={index}>
                        {result.data!.columns.map((column) => {
                          const value = row[column.key];
                          return (
                            <td
                              key={column.key}
                              className={column.type === 'number' ? 'numeric' : undefined}
                            >
                              {value === null || value === undefined || value === ''
                                ? '—'
                                : typeof value === 'number'
                                  ? value.toLocaleString()
                                  : value}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={result.data.meta.page}
                totalPages={result.data.meta.totalPages}
                hasNextPage={result.data.meta.hasNextPage}
                hasPreviousPage={result.data.meta.hasPreviousPage}
                onPage={setPage}
              />
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

/** Route picker backed by the tenant's own routes. */
const RouteFilter: React.FC<{ value: string; onChange: (value: string) => void }> = ({
  value,
  onChange,
}) => {
  const routes = useLoad(
    async () => unwrapEnvelope(await apiClient.listRoutes({ page: 1, limit: 100 })).items,
    [],
  );
  return (
    <Field id="filter-route" label="Route">
      <Select
        id="filter-route"
        value={value}
        disabled={routes.loading}
        onChange={(event) => onChange(event.target.value)}
        placeholder="All routes"
        options={(routes.data ?? []).map((route) => ({
          value: route.id,
          label: `${route.code} — ${route.name}`,
        }))}
      />
    </Field>
  );
};

/** Bus picker backed by the tenant's own fleet. */
const BusFilter: React.FC<{ value: string; onChange: (value: string) => void }> = ({
  value,
  onChange,
}) => {
  const buses = useLoad(
    async () => unwrapEnvelope(await apiClient.listBuses({ page: 1, limit: 100 })).items,
    [],
  );
  return (
    <Field id="filter-bus" label="Bus">
      <Select
        id="filter-bus"
        value={value}
        disabled={buses.loading}
        onChange={(event) => onChange(event.target.value)}
        placeholder="All buses"
        options={(buses.data ?? []).map((bus) => ({
          value: bus.id,
          label: bus.registration_number,
        }))}
      />
    </Field>
  );
};
