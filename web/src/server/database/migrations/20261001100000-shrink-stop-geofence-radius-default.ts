import type { QueryInterface, Transaction } from 'sequelize';
import { DataTypes } from 'sequelize';
import { STOP_DEFAULT_GEOFENCE_RADIUS_METERS } from '../../config/eta.config';

/** Previous oversized default kept only for reversible schema metadata. */
export const PREVIOUS_STOP_DEFAULT_GEOFENCE_RADIUS_METERS = 100;

/**
 * Backfill existing stop radii to the new small default.
 *
 * Field reports showed the old 100–120 m stored radii drawing rings large
 * enough to cover several neighbouring stops. New stop creation now defaults
 * to `STOP_DEFAULT_GEOFENCE_RADIUS_METERS` (20 m), while detection and display
 * still use the server-computed `effective_radius_meters` floor (25 m by
 * default). This migration aligns existing data by shrinking only rows larger
 * than the new default; already-small legacy rows are left untouched.
 *
 * The `down` migration restores only the database default. It intentionally
 * does not expand rows back to 100 m because the original per-stop radii are
 * not recoverable after the backfill and guessing would be more destructive
 * than leaving the safer small radius in place.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction: Transaction) => {
    await queryInterface.changeColumn(
      'stops',
      'geofence_radius_meters',
      {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: STOP_DEFAULT_GEOFENCE_RADIUS_METERS,
      },
      { transaction },
    );

    await queryInterface.sequelize.query(
      `UPDATE "stops"
          SET "geofence_radius_meters" = :radius,
              "updated_at" = CURRENT_TIMESTAMP
        WHERE "geofence_radius_meters" > :radius;`,
      {
        replacements: { radius: STOP_DEFAULT_GEOFENCE_RADIUS_METERS },
        transaction,
      },
    );
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction: Transaction) => {
    await queryInterface.changeColumn(
      'stops',
      'geofence_radius_meters',
      {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: PREVIOUS_STOP_DEFAULT_GEOFENCE_RADIUS_METERS,
      },
      { transaction },
    );
  });
}
