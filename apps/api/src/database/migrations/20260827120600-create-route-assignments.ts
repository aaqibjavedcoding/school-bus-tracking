'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op, col } from 'sequelize';

/**
 * Creates the `route_assignments` table (crew + vehicle rostered on a route).
 *
 * One row = one person in one role for one period, which covers:
 * - driver *and* conductor on the same route (two rows),
 * - crew rotation over time (`effective_from` / `effective_to`),
 * - the same person serving several routes.
 *
 * All three references (`route_id`, `bus_id`, `user_id`) are tenant-pinned
 * composite foreign keys on `(school_id, <entity>_id)`, so a roster entry can
 * never combine resources from different schools.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'route_assignments',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        school_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'schools', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        route_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        bus_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        user_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        role: {
          type: DataTypes.ENUM('DRIVER', 'CONDUCTOR'),
          allowNull: false,
        },
        effective_from: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        effective_to: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        deleted_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    // Composite (tenant-pinned) foreign keys are written as explicit SQL:
    // Sequelize v6 types describe `addConstraint` references as a single
    // column, whereas the runtime supports a column list. The statement is
    // exactly what `addConstraint` emits for a composite key.
    await queryInterface.sequelize.query(
      `ALTER TABLE "route_assignments"
         ADD CONSTRAINT "fk_route_assignments_route"
         FOREIGN KEY ("school_id", "route_id")
         REFERENCES "routes" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "route_assignments"
         ADD CONSTRAINT "fk_route_assignments_bus"
         FOREIGN KEY ("school_id", "bus_id")
         REFERENCES "buses" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "route_assignments"
         ADD CONSTRAINT "fk_route_assignments_user"
         FOREIGN KEY ("school_id", "user_id")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.addConstraint('route_assignments', {
      type: 'check',
      name: 'ck_route_assignments_effective_range',
      fields: ['effective_to'],
      where: {
        [Op.or]: [
          { effective_to: { [Op.eq]: null } },
          { effective_to: { [Op.gte]: col('effective_from') } },
        ],
      },
      transaction,
    });

    await queryInterface.addIndex(
      'route_assignments',
      ['route_id', 'user_id', 'role', 'effective_from'],
      {
        name: 'uq_route_assignments_route_user_role',
        unique: true,
        where: { deleted_at: null },
        transaction,
      },
    );

    await queryInterface.addIndex('route_assignments', ['route_id', 'role'], {
      name: 'idx_route_assignments_route_role',
      transaction,
    });

    await queryInterface.addIndex('route_assignments', ['school_id', 'route_id'], {
      name: 'idx_route_assignments_school_route',
      transaction,
    });

    await queryInterface.addIndex('route_assignments', ['school_id', 'user_id'], {
      name: 'idx_route_assignments_school_user',
      transaction,
    });

    await queryInterface.addIndex('route_assignments', ['school_id', 'bus_id'], {
      name: 'idx_route_assignments_school_bus',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('route_assignments');
  await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_route_assignments_role";');
}
