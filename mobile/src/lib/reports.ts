import type {
  ReportCategory,
  ReportColumn,
  ReportFilterKey,
  ReportQuery,
} from '@school-bus-tracking/shared-types';

/**
 * Pure helpers for the school-admin reports screens — the mobile port of the
 * web reports page logic: category grouping, the filter-state → query mapping
 * and deterministic cell / figure formatting.
 *
 * Deterministic formatting matters on Hermes/JSC: `Number#toLocaleString`
 * silently falls back to an ungrouped number when the app ships without full
 * ICU (a common Android configuration), so thousands separators are folded by
 * hand here and the whole module is unit-spec'd under `node --test`.
 */

/** Landing-page grouping, presented in this order — same as the web console. */
export const REPORT_CATEGORY_ORDER: ReportCategory[] = [
  'students',
  'transport',
  'trips',
  'attendance',
  'compliance',
];

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  students: 'Students',
  transport: 'Transport',
  trips: 'Trips & communication',
  attendance: 'Attendance',
  compliance: 'Compliance',
};

/** Raw string state of the report filter sheet ('' = not filtered). */
export interface ReportFilterState {
  search: string;
  status: string;
  route_id: string;
  bus_id: string;
  stop_id: string;
  shift_id: string;
  driver_id: string;
  student_id: string;
  trip_status: string;
  attendance_status: string;
  date_from: string;
  date_to: string;
}

export const EMPTY_REPORT_FILTERS: ReportFilterState = {
  search: '',
  status: '',
  route_id: '',
  bus_id: '',
  stop_id: '',
  shift_id: '',
  driver_id: '',
  student_id: '',
  trip_status: '',
  attendance_status: '',
  date_from: '',
  date_to: '',
};

/**
 * Turns the form state into the query the API accepts: only keys the report
 * declares, and only when they carry a value — the exact web rule, so the
 * on-screen table and the (web) spreadsheet download agree.
 */
export function buildReportQuery(
  filters: ReportFilterState,
  supported: readonly ReportFilterKey[],
  page: number,
  limit = 20,
): ReportQuery {
  const query: ReportQuery = { page, limit };
  for (const key of supported) {
    const value = filters[key as keyof ReportFilterState];
    if (value) {
      (query as Record<string, unknown>)[key] = value;
    }
  }
  return query;
}

/** Labels of the filters currently set — the "applied filters" summary row. */
export function appliedFilterLabels(
  filters: ReportFilterState,
  supported: readonly ReportFilterKey[],
  optionLabel?: (key: ReportFilterKey, value: string) => string,
): string[] {
  const labels: string[] = [];
  for (const key of supported) {
    const value = filters[key as keyof ReportFilterState];
    if (!value) continue;
    labels.push(optionLabel ? optionLabel(key, value) : value);
  }
  return labels;
}

/** True when any declared filter carries a value (drives the summary + Clear). */
export function reportFiltersActive(
  filters: ReportFilterState,
  supported: readonly ReportFilterKey[],
): boolean {
  return appliedFilterLabels(filters, supported).length > 0;
}

/** 1234567 → "1,234,567" without relying on ICU. Idempotent sign handling. */
export function groupThousands(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const negative = value < 0;
  const absolute = Math.abs(value);
  const [integer, fraction] = String(absolute).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/** Summary-card figure with grouping (e.g. "1,248"). */
export function formatReportCount(value: number): string {
  return groupThousands(value);
}

/** One table cell, formatted per its column type with the web em-dash fallback. */
export function formatReportCell(
  value: string | number | null | undefined,
  column: Pick<ReportColumn, 'type'>,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (column.type === 'number') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(numeric) ? String(value) : groupThousands(numeric);
  }
  return String(value);
}

/** Mobile table: the leading column value doubles as the row title. */
export function reportRowTitle(
  row: Record<string, string | number | null>,
  columns: readonly ReportColumn[],
): string {
  const first = columns[0];
  if (!first) return '';
  return formatReportCell(row[first.key], first);
}

/** Column → rendered label/value pairs for one row card. */
export function reportRowEntries(
  row: Record<string, string | number | null>,
  columns: readonly ReportColumn[],
): Array<{ key: string; label: string; value: string }> {
  return columns.map((column) => ({
    key: column.key,
    label: column.label,
    value: formatReportCell(row[column.key], column),
  }));
}
