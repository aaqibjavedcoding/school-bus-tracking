import { Op, type Transaction } from 'sequelize';
import { ImportModule, PlanLimitResource } from '@school-bus-tracking/shared-types';
import {
  busImportRowSchema,
  routeImportRowSchema,
  stopImportRowSchema,
  type BusImportRow,
  type RouteImportRow,
  type StopImportRow,
} from '@school-bus-tracking/validation';
import {
  IMPORT_INSERT_CHUNK_SIZE,
  chunk,
  issue,
  type ImportAcceptedRow,
  type ImportDefinition,
  type ImportPersistResult,
  type ImportRepositories,
  type ImportRowResolution,
  type PreparedImport,
} from '../import.types';

/** Buses, routes and stops — the transport network an admin sets up on day one. */

export const busesImportDefinition: ImportDefinition = {
  module: ImportModule.BUSES,
  label: 'Buses',
  description: 'One row per vehicle in your fleet.',
  naturalKeyLabel: 'Registration number',
  maxRows: 5000,
  supportsUpsert: true,
  schema: busImportRowSchema,
  columns: [
    {
      field: 'registration_number',
      header: 'Registration Number',
      required: true,
      description: 'Licence plate / government registration. Unique inside your school.',
      example: 'KA-01-AB-1234',
    },
    {
      field: 'bus_number',
      header: 'Bus Number',
      required: false,
      description: 'Fleet number painted on the vehicle. Unique when supplied.',
      example: '12',
    },
    {
      field: 'capacity',
      header: 'Capacity',
      required: true,
      description: 'Seats including the conductor. Whole number, at least 1.',
      example: '42',
    },
    {
      field: 'is_active',
      header: 'Active',
      required: false,
      description: 'TRUE or FALSE. Defaults to TRUE.',
      example: 'TRUE',
      allowed_values: ['TRUE', 'FALSE'],
    },
  ],

  naturalKey(parsed) {
    return (parsed as BusImportRow).registration_number.toLowerCase();
  },

  rowLabel(parsed) {
    const row = parsed as BusImportRow;
    return row.bus_number
      ? `${row.registration_number} (bus ${row.bus_number})`
      : row.registration_number;
  },

  async prepare(repositories: ImportRepositories, schoolId, parsedRows): Promise<PreparedImport> {
    const rows = parsedRows as BusImportRow[];
    const registrations = unique(rows.map((row) => row.registration_number));
    const busNumbers = unique(rows.map((row) => row.bus_number));

    const [existingBuses, busesWithNumber] = await Promise.all([
      registrations.length
        ? repositories.buses.findAll({
            where: { school_id: schoolId, registration_number: { [Op.in]: registrations } },
          })
        : Promise.resolve([]),
      busNumbers.length
        ? repositories.buses.findAll({
            where: { school_id: schoolId, bus_number: { [Op.in]: busNumbers } },
          })
        : Promise.resolve([]),
    ]);

    const byRegistration = new Map(
      existingBuses.map((bus) => [bus.registration_number.toLowerCase(), bus]),
    );
    const byBusNumber = new Map(
      busesWithNumber
        .filter((bus) => bus.bus_number)
        .map((bus) => [(bus.bus_number as string).toLowerCase(), bus]),
    );

    return {
      planResources: [PlanLimitResource.BUSES],

      resolve(parsed): ImportRowResolution {
        const row = parsed as BusImportRow;
        const existing = byRegistration.get(row.registration_number.toLowerCase());

        // The fleet number carries its own unique index; a collision with a
        // *different* vehicle must be reported, not left to the database.
        if (row.bus_number) {
          const clash = byBusNumber.get(row.bus_number.toLowerCase());
          if (clash && clash.id !== existing?.id) {
            return {
              issues: [
                issue(
                  'Bus Number',
                  `Bus number "${row.bus_number}" is already used by ${clash.registration_number}`,
                ),
              ],
              existingId: existing?.id ?? null,
            };
          }
        }

        return {
          issues: [],
          existingId: existing?.id ?? null,
          payload: {
            registration_number: row.registration_number,
            bus_number: row.bus_number ?? null,
            capacity: row.capacity,
            is_active: row.is_active ?? true,
          },
        };
      },

      async persist(accepted, transaction): Promise<ImportPersistResult> {
        return simplePersist(repositories.buses, schoolId, accepted, transaction);
      },
    };
  },
};

export const routesImportDefinition: ImportDefinition = {
  module: ImportModule.ROUTES,
  label: 'Routes',
  description: 'One row per route. Add its stops with the stop import afterwards.',
  naturalKeyLabel: 'Route code',
  maxRows: 5000,
  supportsUpsert: true,
  schema: routeImportRowSchema,
  columns: [
    {
      field: 'code',
      header: 'Route Code',
      required: true,
      description: 'Short stable code shown on the bus sign. Unique inside your school.',
      example: 'NORTH-AM',
    },
    {
      field: 'name',
      header: 'Route Name',
      required: true,
      description: 'Human readable label.',
      example: 'North Loop — Morning',
    },
    {
      field: 'description',
      header: 'Description',
      required: false,
      description: 'Optional notes about the route.',
      example: 'Covers the northern residential blocks',
    },
    {
      field: 'is_active',
      header: 'Active',
      required: false,
      description: 'TRUE or FALSE. Defaults to TRUE.',
      example: 'TRUE',
      allowed_values: ['TRUE', 'FALSE'],
    },
  ],

  naturalKey(parsed) {
    return (parsed as RouteImportRow).code.toLowerCase();
  },

  rowLabel(parsed) {
    const row = parsed as RouteImportRow;
    return `${row.name} (${row.code})`;
  },

  async prepare(repositories: ImportRepositories, schoolId, parsedRows): Promise<PreparedImport> {
    const rows = parsedRows as RouteImportRow[];
    const codes = unique(rows.map((row) => row.code));
    const existing = codes.length
      ? await repositories.routes.findAll({
          where: { school_id: schoolId, code: { [Op.in]: codes } },
        })
      : [];
    const byCode = new Map(existing.map((route) => [route.code.toLowerCase(), route]));

    return {
      planResources: [PlanLimitResource.ROUTES],

      resolve(parsed): ImportRowResolution {
        const row = parsed as RouteImportRow;
        return {
          issues: [],
          existingId: byCode.get(row.code.toLowerCase())?.id ?? null,
          payload: {
            code: row.code,
            name: row.name,
            description: row.description ?? null,
            is_active: row.is_active ?? true,
          },
        };
      },

      async persist(accepted, transaction): Promise<ImportPersistResult> {
        return simplePersist(repositories.routes, schoolId, accepted, transaction);
      },
    };
  },
};

export const stopsImportDefinition: ImportDefinition = {
  module: ImportModule.STOPS,
  label: 'Stops',
  description:
    'One row per boarding point. The route must already exist; leave the sequence ' +
    'number blank to append the stop to the end of its route.',
  naturalKeyLabel: 'Route code + stop name',
  maxRows: 5000,
  supportsUpsert: true,
  schema: stopImportRowSchema,
  columns: [
    {
      field: 'route_code',
      header: 'Route Code',
      required: true,
      description: 'Code of an existing route.',
      example: 'NORTH-AM',
    },
    {
      field: 'name',
      header: 'Stop Name',
      required: true,
      description: 'Label shown to drivers and parents.',
      example: 'Maple St & 5th Ave',
    },
    {
      field: 'sequence_number',
      header: 'Sequence Number',
      required: false,
      description: 'Position on the route (1 = first). Left blank, the stop is appended.',
      example: '1',
    },
    {
      field: 'address',
      header: 'Address',
      required: false,
      description: 'Optional postal address.',
      example: '5th Ave, Springfield',
    },
    {
      field: 'latitude',
      header: 'Latitude',
      required: false,
      description: 'WGS-84 latitude between -90 and 90. Must be paired with longitude.',
      example: '12.9716',
    },
    {
      field: 'longitude',
      header: 'Longitude',
      required: false,
      description: 'WGS-84 longitude between -180 and 180. Must be paired with latitude.',
      example: '77.5946',
    },
    {
      field: 'geofence_radius_meters',
      header: 'Geofence Radius (m)',
      required: false,
      description: 'Arrival radius, 10 to 2000 metres. Defaults to 100.',
      example: '100',
    },
    {
      field: 'estimated_arrival_time',
      header: 'Estimated Arrival Time',
      required: false,
      description: 'Local wall-clock time as HH:MM or HH:MM:SS.',
      example: '07:35',
    },
    {
      field: 'is_active',
      header: 'Active',
      required: false,
      description: 'TRUE or FALSE. Defaults to TRUE.',
      example: 'TRUE',
      allowed_values: ['TRUE', 'FALSE'],
    },
  ],

  naturalKey(parsed) {
    const row = parsed as StopImportRow;
    return `${row.route_code.toLowerCase()}::${row.name.trim().toLowerCase()}`;
  },

  rowLabel(parsed) {
    const row = parsed as StopImportRow;
    return `${row.name} (${row.route_code})`;
  },

  async prepare(repositories: ImportRepositories, schoolId, parsedRows): Promise<PreparedImport> {
    const rows = parsedRows as StopImportRow[];
    const routeCodes = unique(rows.map((row) => row.route_code));

    const routes = routeCodes.length
      ? await repositories.routes.findAll({
          where: { school_id: schoolId, code: { [Op.in]: routeCodes } },
        })
      : [];
    const routeByCode = new Map(routes.map((route) => [route.code.toLowerCase(), route]));

    const stops = routes.length
      ? await repositories.stops.findAll({
          where: { school_id: schoolId, route_id: { [Op.in]: routes.map((route) => route.id) } },
        })
      : [];
    const stopByRouteAndName = new Map(
      stops.map((stop) => [`${stop.route_id}::${stop.name.trim().toLowerCase()}`, stop]),
    );

    // Highest sequence number currently used per route, so blank sequences can
    // be appended deterministically without colliding with existing rows.
    const nextSequenceByRoute = new Map<string, number>();
    for (const stop of stops) {
      const current = nextSequenceByRoute.get(stop.route_id) ?? 0;
      nextSequenceByRoute.set(stop.route_id, Math.max(current, stop.sequence_number));
    }

    // Sequence numbers claimed by this file, to catch in-file collisions.
    const claimed = new Map<string, Set<number>>();
    for (const stop of stops) {
      const set = claimed.get(stop.route_id) ?? new Set<number>();
      set.add(stop.sequence_number);
      claimed.set(stop.route_id, set);
    }

    return {
      planResources: [PlanLimitResource.STOPS],

      resolve(parsed): ImportRowResolution {
        const row = parsed as StopImportRow;
        const route = routeByCode.get(row.route_code.toLowerCase());
        if (!route) {
          return {
            issues: [issue('Route Code', `Route "${row.route_code}" was not found`)],
            existingId: null,
          };
        }

        const existing = stopByRouteAndName.get(`${route.id}::${row.name.trim().toLowerCase()}`);
        const routeClaims = claimed.get(route.id) ?? new Set<number>();

        let sequence = row.sequence_number ?? undefined;
        if (sequence === undefined) {
          if (existing) {
            sequence = existing.sequence_number;
          } else {
            const next = (nextSequenceByRoute.get(route.id) ?? 0) + 1;
            nextSequenceByRoute.set(route.id, next);
            sequence = next;
          }
        } else if (routeClaims.has(sequence) && existing?.sequence_number !== sequence) {
          return {
            issues: [
              issue(
                'Sequence Number',
                `Sequence ${sequence} is already used on route ${row.route_code}`,
              ),
            ],
            existingId: existing?.id ?? null,
          };
        }
        routeClaims.add(sequence);
        claimed.set(route.id, routeClaims);

        return {
          issues: [],
          existingId: existing?.id ?? null,
          payload: {
            route_id: route.id,
            name: row.name,
            sequence_number: sequence,
            address: row.address ?? null,
            latitude: row.latitude ?? null,
            longitude: row.longitude ?? null,
            geofence_radius_meters: row.geofence_radius_meters ?? 100,
            estimated_arrival_time: row.estimated_arrival_time ?? null,
            is_active: row.is_active ?? true,
          },
        };
      },

      async persist(accepted, transaction): Promise<ImportPersistResult> {
        return simplePersist(repositories.stops, schoolId, accepted, transaction);
      },
    };
  },
};

/**
 * The slice of a Sequelize model `simplePersist` actually needs.
 *
 * Declaring it structurally keeps the helper usable for buses, routes and
 * stops alike without widening anything to `any`.
 */
interface BulkWritableModel {
  bulkCreate(
    records: Array<Record<string, unknown>>,
    options: { transaction: Transaction; validate: boolean },
  ): Promise<unknown>;
  update(
    values: Record<string, unknown>,
    options: {
      where: Record<string, unknown>;
      transaction: Transaction;
      individualHooks: boolean;
    },
  ): Promise<unknown>;
}

/**
 * Shared bulk writer for the simple, self-contained entities.
 *
 * `school_id` is applied here — never read from the file — and Sequelize model
 * validation stays enabled so an import cannot write a row a form could not.
 */
async function simplePersist(
  model: BulkWritableModel,
  schoolId: string,
  accepted: ImportAcceptedRow[],
  transaction: Transaction,
): Promise<ImportPersistResult> {
  const inserts = accepted.filter((row) => !row.existingId);
  const updates = accepted.filter((row) => row.existingId);

  for (const page of chunk(inserts, IMPORT_INSERT_CHUNK_SIZE)) {
    await model.bulkCreate(
      page.map((row) => ({ school_id: schoolId, ...row.payload })),
      { transaction, validate: true },
    );
  }

  for (const row of updates) {
    await model.update(row.payload, {
      where: { id: row.existingId as string, school_id: schoolId },
      transaction,
      individualHooks: true,
    });
  }

  return { created: inserts.length, updated: updates.length };
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
