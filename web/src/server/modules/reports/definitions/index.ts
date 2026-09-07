import { NotFoundException } from '../../../framework';
import { ReportType, type ReportDescriptor } from '@school-bus-tracking/shared-types';
import type { ReportDefinition } from '../report.types';
import {
  studentRosterReport,
  studentsByBusReport,
  studentsByRouteReport,
  studentsByStopReport,
  studentsUnassignedReport,
} from './student.reports';
import {
  attendanceReport,
  busUtilizationReport,
  crewAssignmentsReport,
  documentsReport,
  notificationsReport,
  tripsReport,
} from './operations.reports';
import {
  busDayTieringReport,
  crewLoadReport,
  deadheadRunsReport,
  runUtilizationReport,
} from './runs.reports';

/**
 * Registry of every report.
 *
 * The order is the order the reports landing page renders them in, grouped by
 * category: what an admin asks about most often comes first.
 */
export const REPORT_DEFINITIONS: Readonly<Record<ReportType, ReportDefinition>> = Object.freeze({
  [ReportType.STUDENT_ROSTER]: studentRosterReport,
  [ReportType.STUDENTS_BY_ROUTE]: studentsByRouteReport,
  [ReportType.STUDENTS_BY_STOP]: studentsByStopReport,
  [ReportType.STUDENTS_UNASSIGNED]: studentsUnassignedReport,
  [ReportType.STUDENTS_BY_BUS]: studentsByBusReport,
  [ReportType.BUS_UTILIZATION]: busUtilizationReport,
  [ReportType.RUN_UTILIZATION]: runUtilizationReport,
  [ReportType.BUS_DAY_TIERING]: busDayTieringReport,
  [ReportType.CREW_LOAD]: crewLoadReport,
  [ReportType.DEADHEAD_RUNS]: deadheadRunsReport,
  [ReportType.CREW_ASSIGNMENTS]: crewAssignmentsReport,
  [ReportType.TRIPS]: tripsReport,
  [ReportType.ATTENDANCE]: attendanceReport,
  [ReportType.NOTIFICATIONS]: notificationsReport,
  [ReportType.DOCUMENTS]: documentsReport,
});

export const REPORT_ORDER: ReportType[] = [
  ReportType.STUDENT_ROSTER,
  ReportType.STUDENTS_BY_ROUTE,
  ReportType.STUDENTS_BY_STOP,
  ReportType.STUDENTS_UNASSIGNED,
  ReportType.STUDENTS_BY_BUS,
  ReportType.BUS_UTILIZATION,
  ReportType.RUN_UTILIZATION,
  ReportType.BUS_DAY_TIERING,
  ReportType.CREW_LOAD,
  ReportType.DEADHEAD_RUNS,
  ReportType.CREW_ASSIGNMENTS,
  ReportType.TRIPS,
  ReportType.ATTENDANCE,
  ReportType.NOTIFICATIONS,
  ReportType.DOCUMENTS,
];

/**
 * Looks up a report definition.
 *
 * Throws rather than returning `undefined` — see the matching note on
 * `getExportDefinition`.
 */
export function getReportDefinition(report: ReportType): ReportDefinition {
  const definition = REPORT_DEFINITIONS[report];
  if (!definition) {
    throw new NotFoundException(`Unknown report "${report}".`);
  }
  return definition;
}

/** Static catalogue consumed by the reports landing page. */
export function reportCatalogue(): ReportDescriptor[] {
  return REPORT_ORDER.map((report) => {
    const definition = REPORT_DEFINITIONS[report];
    return {
      report: definition.report,
      label: definition.label,
      description: definition.description,
      category: definition.category,
      filters: definition.filters,
    };
  });
}
