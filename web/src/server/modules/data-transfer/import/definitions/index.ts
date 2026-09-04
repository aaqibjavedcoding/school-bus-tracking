import { NotFoundException } from '../../../../framework';
import { ImportModule } from '@school-bus-tracking/shared-types';
import type { ImportDefinition } from '../import.types';
import { studentsImportDefinition } from './students.definition';
import {
  conductorsImportDefinition,
  driversImportDefinition,
  parentsImportDefinition,
} from './accounts.definition';
import {
  busesImportDefinition,
  routesImportDefinition,
  stopsImportDefinition,
} from './fleet.definition';
import {
  routeAssignmentsImportDefinition,
  studentGuardiansImportDefinition,
} from './relationships.definition';

/**
 * Registry of every importable module.
 *
 * Adding a module is a one-file change plus one line here: the controller,
 * template builder, validator, error workbook and history all read from this
 * map, so nothing else needs to learn about the new module.
 *
 * Deliberately absent: trips, attendance, notifications, emergencies and
 * documents. Those are event streams produced by the system itself (or by file
 * uploads), and letting a spreadsheet backfill them would corrupt the audit
 * trail rather than save anyone time.
 */
export const IMPORT_DEFINITIONS: Readonly<Record<ImportModule, ImportDefinition>> = Object.freeze({
  [ImportModule.STUDENTS]: studentsImportDefinition,
  [ImportModule.PARENTS]: parentsImportDefinition,
  [ImportModule.STUDENT_GUARDIANS]: studentGuardiansImportDefinition,
  [ImportModule.BUSES]: busesImportDefinition,
  [ImportModule.ROUTES]: routesImportDefinition,
  [ImportModule.STOPS]: stopsImportDefinition,
  [ImportModule.DRIVERS]: driversImportDefinition,
  [ImportModule.CONDUCTORS]: conductorsImportDefinition,
  [ImportModule.ROUTE_ASSIGNMENTS]: routeAssignmentsImportDefinition,
});

/** Ordered list used by the "which imports exist?" endpoint and the web wizard. */
export const IMPORT_MODULE_ORDER: ImportModule[] = [
  ImportModule.STUDENTS,
  ImportModule.PARENTS,
  ImportModule.STUDENT_GUARDIANS,
  ImportModule.DRIVERS,
  ImportModule.CONDUCTORS,
  ImportModule.BUSES,
  ImportModule.ROUTES,
  ImportModule.STOPS,
  ImportModule.ROUTE_ASSIGNMENTS,
];

/**
 * Looks up an import definition.
 *
 * Throws rather than returning `undefined` — see the matching note on
 * `getExportDefinition`.
 */
export function getImportDefinition(module: ImportModule): ImportDefinition {
  const definition = IMPORT_DEFINITIONS[module];
  if (!definition) {
    throw new NotFoundException(`Unknown import module "${module}".`);
  }
  return definition;
}

export {
  busesImportDefinition,
  conductorsImportDefinition,
  driversImportDefinition,
  parentsImportDefinition,
  routeAssignmentsImportDefinition,
  routesImportDefinition,
  stopsImportDefinition,
  studentGuardiansImportDefinition,
  studentsImportDefinition,
};
