import { NotFoundException } from '@nestjs/common';
import { ExportDataset } from '@school-bus-tracking/shared-types';
import type { ExportDefinition } from '../export.types';
import {
  conductorsExport,
  driversExport,
  parentsExport,
  studentGuardiansExport,
  studentsExport,
} from './people.export';
import { busesExport, routeAssignmentsExport, routesExport, stopsExport } from './fleet.export';
import {
  attendanceExport,
  busDocumentsExport,
  driverDocumentsExport,
  notificationsExport,
  tripsExport,
} from './operations.export';

/**
 * Registry of every exportable dataset.
 *
 * The list mirrors the screens a school admin actually works from — each entry
 * exists because someone needs that data in a spreadsheet (a roster for the
 * office, a compliance list for an inspection, an attendance sheet for a
 * parent meeting), not because the table happens to exist.
 */
export const EXPORT_DEFINITIONS: Readonly<Record<ExportDataset, ExportDefinition>> = Object.freeze({
  [ExportDataset.STUDENTS]: studentsExport,
  [ExportDataset.PARENTS]: parentsExport,
  [ExportDataset.STUDENT_GUARDIANS]: studentGuardiansExport,
  [ExportDataset.BUSES]: busesExport,
  [ExportDataset.ROUTES]: routesExport,
  [ExportDataset.STOPS]: stopsExport,
  [ExportDataset.DRIVERS]: driversExport,
  [ExportDataset.CONDUCTORS]: conductorsExport,
  [ExportDataset.ROUTE_ASSIGNMENTS]: routeAssignmentsExport,
  [ExportDataset.TRIPS]: tripsExport,
  [ExportDataset.ATTENDANCE]: attendanceExport,
  [ExportDataset.NOTIFICATIONS]: notificationsExport,
  [ExportDataset.BUS_DOCUMENTS]: busDocumentsExport,
  [ExportDataset.DRIVER_DOCUMENTS]: driverDocumentsExport,
});

/**
 * Looks up a dataset definition.
 *
 * Throws rather than returning `undefined`: the route parameter is already
 * validated against the enum, so an unknown value here means the registry and
 * the enum have drifted apart — a bug that should surface immediately instead
 * of becoming a confusing `cannot read property of undefined` mid-stream.
 */
export function getExportDefinition(dataset: ExportDataset): ExportDefinition {
  const definition = EXPORT_DEFINITIONS[dataset];
  if (!definition) {
    throw new NotFoundException(`Unknown export dataset "${dataset}".`);
  }
  return definition;
}
