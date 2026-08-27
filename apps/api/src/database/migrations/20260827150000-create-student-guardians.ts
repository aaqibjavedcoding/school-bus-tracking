'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the tenant-scoped student ↔ parent account join table.
 *
 * A student may have multiple parent/guardian accounts and one account may be
 * responsible for multiple students, so neither side belongs as a foreign-key
 * column on the other entity. The join row carries relationship metadata and
 * pickup authorisation.
 *
 * Both entity references are composite foreign keys. A plain `student_id` or
 * `user_id` foreign key would permit an application bug to connect records from
 * different schools; `(school_id, id)` pins each reference to this tenant.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'student_guardians',
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
        student_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        user_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        relationship: {
          type: DataTypes.STRING(50),
          allowNull: false,
        },
        can_pick_up: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        is_primary: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
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
    // Sequelize v6 describes `addConstraint` references as one column, while
    // PostgreSQL needs both columns to enforce tenant ownership.
    await queryInterface.sequelize.query(
      `ALTER TABLE "student_guardians"
         ADD CONSTRAINT "fk_student_guardians_student"
         FOREIGN KEY ("school_id", "student_id")
         REFERENCES "students" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "student_guardians"
         ADD CONSTRAINT "fk_student_guardians_user"
         FOREIGN KEY ("school_id", "user_id")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "student_guardians"
         ADD CONSTRAINT "ck_student_guardians_relationship_nonempty"
         CHECK (length(btrim("relationship")) > 0);`,
      { transaction },
    );

    // One active link per student/account pair. Soft-deleted links can be
    // recreated without losing the historical row.
    await queryInterface.addIndex('student_guardians', ['school_id', 'student_id', 'user_id'], {
      name: 'uq_student_guardians_school_student_user',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    await queryInterface.addIndex('student_guardians', ['school_id', 'student_id'], {
      name: 'idx_student_guardians_school_student',
      transaction,
    });

    await queryInterface.addIndex('student_guardians', ['school_id', 'user_id'], {
      name: 'idx_student_guardians_school_user',
      transaction,
    });

    await queryInterface.addIndex('student_guardians', ['school_id', 'is_active'], {
      name: 'idx_student_guardians_school_active',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('student_guardians');
}
