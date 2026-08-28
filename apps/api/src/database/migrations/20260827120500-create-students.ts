'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `students` table.
 *
 * `home_stop_id` is nullable (a pupil can be enrolled before transport is
 * allocated) and pinned by the composite foreign key
 * `(school_id, home_stop_id) → stops(school_id, id)`:
 * - PostgreSQL skips the check while any referencing column is NULL, so an
 *   unallocated student stays valid;
 * - once set, the stop is guaranteed to belong to the same school;
 * - deleting a stop clears the reference instead of breaking the row.
 *
 * The `(school_id, id)` unique index is created here, alongside the students
 * table, because it is the target key for every later tenant-pinned student
 * reference (`student_guardians` and `trip_student_attendance`). A primary key
 * on `id` alone is not sufficient for a composite foreign key.
 *
 * Guardian/parent linkage intentionally stays out of this table: it is a
 * many-to-many relationship with relationship + pickup rights, persisted by
 * the later `student_guardians` migration.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'students',
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
        home_stop_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        admission_number: {
          type: DataTypes.STRING(64),
          allowNull: false,
        },
        first_name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        last_name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        date_of_birth: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        gender: {
          type: DataTypes.ENUM('MALE', 'FEMALE', 'OTHER'),
          allowNull: true,
        },
        grade_level: {
          type: DataTypes.STRING(32),
          allowNull: true,
        },
        emergency_contact_name: {
          type: DataTypes.STRING(150),
          allowNull: true,
        },
        emergency_contact_phone: {
          type: DataTypes.STRING(32),
          allowNull: true,
        },
        medical_notes: {
          type: DataTypes.TEXT,
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
      `ALTER TABLE "students"
         ADD CONSTRAINT "fk_students_home_stop"
         FOREIGN KEY ("school_id", "home_stop_id")
         REFERENCES "stops" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    // This is the referenced key for tenant-pinned student foreign keys. It
    // must be non-partial: PostgreSQL cannot use the soft-delete admission
    // index above as the target of a foreign key.
    await queryInterface.addIndex('students', ['school_id', 'id'], {
      name: 'uq_students_school_id',
      unique: true,
      transaction,
    });

    await queryInterface.addIndex('students', ['school_id', 'admission_number'], {
      name: 'uq_students_school_admission',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    await queryInterface.addIndex('students', ['school_id', 'home_stop_id'], {
      name: 'idx_students_school_stop',
      transaction,
    });

    await queryInterface.addIndex('students', ['school_id', 'last_name', 'first_name'], {
      name: 'idx_students_school_name',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('students');
  await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_students_gender";');
}
