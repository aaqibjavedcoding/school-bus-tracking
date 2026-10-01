'use strict';

import type { QueryInterface } from 'sequelize';
import { Op } from 'sequelize';

/**
 * Product default introduced with this migration. It is intentionally pinned
 * rather than reading process env: a migration must produce the same schema
 * data on every deployment and on every later replay.
 */
export const STOP_GEOFENCE_BACKFILL_RADIUS_METERS = 20;

/**
 * Shrinks legacy oversized stop circles to the new product default. Coordinates,
 * ordering, and every radius already at or below the default are preserved.
 * Runtime detection still applies its configured effective-radius floor, and
 * clients draw that exact server-returned effective radius.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.bulkUpdate(
    'stops',
    { geofence_radius_meters: STOP_GEOFENCE_BACKFILL_RADIUS_METERS },
    { geofence_radius_meters: { [Op.gt]: STOP_GEOFENCE_BACKFILL_RADIUS_METERS } },
  );
}

/** Data shrink is deliberately non-reversible: the previous per-stop values are unknowable. */
export async function down(_queryInterface: QueryInterface): Promise<void> {}
