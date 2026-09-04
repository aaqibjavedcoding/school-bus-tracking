import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { STUDENT_GENDER_VALUES, StudentGender } from './enums';
import { School } from './school.model';
import { Stop } from './stop.model';
import { StudentGuardian } from './student-guardian.model';

export interface StudentAttributes extends BaseModelAttributes {
  school_id: string;
  /**
   * Stop the student boards/deboards at. Nullable: a pupil may be enrolled
   * before the transport office allocates a stop. Pinned by the composite
   * foreign key `(school_id, home_stop_id) → stops(school_id, id)`, so a
   * student can never be attached to a stop of another tenant.
   */
  home_stop_id: string | null;
  /** School issued enrolment number — unique inside a tenant. */
  admission_number: string;
  first_name: string;
  last_name: string;
  date_of_birth: Date | null;
  gender: StudentGender | null;
  /** Free-form class label, e.g. "Grade 5" / "Year 9 — B". */
  grade_level: string | null;
  /** Contact used when no guardian is reachable. */
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  /** Allergies, medication, mobility notes the crew must see on the manifest. */
  medical_notes: string | null;
  is_active: boolean;
}

export type StudentCreationAttributes = Optional<
  StudentAttributes,
  | BaseModelManagedFields
  | 'home_stop_id'
  | 'date_of_birth'
  | 'gender'
  | 'grade_level'
  | 'emergency_contact_name'
  | 'emergency_contact_phone'
  | 'medical_notes'
  | 'is_active'
>;

/**
 * Pupil transported by the school.
 *
 * Parent/guardian linkage is intentionally **not** a column here. A student can
 * have several guardians and a guardian can have several children, so the
 * relationship is modelled by the dedicated `student_guardians` join table
 * (student_id + user_id + relationship + pickup rights). The emergency contact
 * fields below remain the interim contact information printed on crew manifests
 * and are not user accounts.
 */
@Table({
  tableName: 'students',
  modelName: 'Student',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Referenced by tenant-pinned foreign keys from student_guardians and
    // trip_student_attendance. This must be a non-partial unique index;
    // soft-delete indexes cannot be used as foreign-key targets in PostgreSQL.
    { name: 'uq_students_school_id', unique: true, fields: ['school_id', 'id'] },
    {
      name: 'uq_students_school_admission',
      unique: true,
      fields: ['school_id', 'admission_number'],
      where: { deleted_at: null },
    },
    // Stop manifest lookup. Its leftmost prefix covers plain tenant-scoped
    // lookups.
    { name: 'idx_students_school_stop', fields: ['school_id', 'home_stop_id'] },
    { name: 'idx_students_school_name', fields: ['school_id', 'last_name', 'first_name'] },
  ],
})
export class Student extends BaseModel<StudentAttributes, StudentCreationAttributes> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Stop)
  @Column({ type: DataType.UUID, allowNull: true })
  declare home_stop_id: string | null;

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare admission_number: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare first_name: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare last_name: string;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare date_of_birth: Date | null;

  @Column({ type: DataType.ENUM(...STUDENT_GENDER_VALUES), allowNull: true })
  declare gender: StudentGender | null;

  @Column({ type: DataType.STRING(32), allowNull: true })
  declare grade_level: string | null;

  @Column({ type: DataType.STRING(150), allowNull: true })
  declare emergency_contact_name: string | null;

  @Column({ type: DataType.STRING(32), allowNull: true })
  declare emergency_contact_phone: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare medical_notes: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Stop, { foreignKey: 'home_stop_id', as: 'homeStop' })
  declare homeStop?: Stop;

  @HasMany(() => StudentGuardian, { foreignKey: 'student_id', as: 'guardians' })
  declare guardians?: StudentGuardian[];
}
