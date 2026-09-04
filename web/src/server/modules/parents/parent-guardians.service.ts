import { ConflictException, NotFoundException } from '../../framework';
import { UniqueConstraintError } from 'sequelize';
import {
  StudentGuardianDeleteResponse,
  StudentGuardianListResponse,
  StudentGuardianResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { Student, StudentGuardian, User } from '../../database/models';
import {
  PARENT_NOT_FOUND_MESSAGE,
  PARENTS_REPOSITORY,
  PARENTS_STUDENTS_REPOSITORY,
  STUDENT_GUARDIAN_ALREADY_EXISTS_MESSAGE,
  STUDENT_GUARDIAN_DELETED_MESSAGE,
  STUDENT_GUARDIAN_NOT_FOUND_MESSAGE,
  STUDENT_GUARDIANS_REPOSITORY,
} from './parents.constants';
import { CreateParentStudentRelationshipDto } from './dto/create-parent-student-relationship.dto';
import { CreateStudentGuardianDto } from './dto/create-student-guardian.dto';
import { UpdateParentStudentRelationshipDto } from './dto/update-parent-student-relationship.dto';

/**
 * Application service for the tenant-scoped `student_guardians` join table.
 *
 * Every entity lookup includes the school id from the verified JWT claims, and
 * the database migration repeats that guarantee with composite foreign keys.
 * The service never accepts or derives a tenant from a request body, path, or
 * `X-Tenant-ID` header.
 */
export class ParentGuardiansService {
  constructor(
    private readonly parents: typeof User,
    private readonly students: typeof Student,
    private readonly relationships: typeof StudentGuardian,
  ) {}

  /** Creates a link from the parent-centred route. */
  async createForParent(
    schoolId: string,
    parentId: string,
    dto: CreateParentStudentRelationshipDto,
  ): Promise<StudentGuardianResponse> {
    await this.assertParentInSchool(schoolId, parentId);
    await this.assertStudentInSchool(schoolId, dto.student_id);
    return this.createRelationship(schoolId, dto.student_id, parentId, dto);
  }

  /** Creates a link from the student-centred route. */
  async createForStudent(
    schoolId: string,
    studentId: string,
    dto: CreateStudentGuardianDto,
  ): Promise<StudentGuardianResponse> {
    await this.assertStudentInSchool(schoolId, studentId);
    await this.assertParentInSchool(schoolId, dto.parent_id);
    return this.createRelationship(schoolId, studentId, dto.parent_id, dto);
  }

  /** Lists all links for one parent inside the authenticated tenant. */
  async listForParent(schoolId: string, parentId: string): Promise<StudentGuardianListResponse> {
    await this.assertParentInSchool(schoolId, parentId);
    const rows = await this.relationships.findAll({
      where: { school_id: schoolId, user_id: parentId },
      order: [['created_at', 'ASC']],
    });
    return { items: rows.map((row) => this.toResponse(row)) };
  }

  /** Lists all links for one student inside the authenticated tenant. */
  async listForStudent(schoolId: string, studentId: string): Promise<StudentGuardianListResponse> {
    await this.assertStudentInSchool(schoolId, studentId);
    const rows = await this.relationships.findAll({
      where: { school_id: schoolId, student_id: studentId },
      order: [['created_at', 'ASC']],
    });
    return { items: rows.map((row) => this.toResponse(row)) };
  }

  /** Reads the relationships for the authenticated PARENT subject only. */
  async listForCurrentParent(
    schoolId: string,
    parentId: string,
  ): Promise<StudentGuardianListResponse> {
    return this.listForParent(schoolId, parentId);
  }

  /** Updates relationship metadata without changing either endpoint owner. */
  async updateForParent(
    schoolId: string,
    parentId: string,
    studentId: string,
    dto: UpdateParentStudentRelationshipDto,
  ): Promise<StudentGuardianResponse> {
    await this.assertParentInSchool(schoolId, parentId);
    const relationship = await this.findRelationshipOrThrow(schoolId, parentId, studentId);
    await this.updateRelationship(relationship, dto);
    return this.toResponse(relationship);
  }

  /** Updates relationship metadata from the student-centred route. */
  async updateForStudent(
    schoolId: string,
    studentId: string,
    parentId: string,
    dto: UpdateParentStudentRelationshipDto,
  ): Promise<StudentGuardianResponse> {
    await this.assertStudentInSchool(schoolId, studentId);
    await this.assertParentInSchool(schoolId, parentId);
    const relationship = await this.findRelationshipOrThrow(schoolId, parentId, studentId);
    await this.updateRelationship(relationship, dto);
    return this.toResponse(relationship);
  }

  /** Soft-deletes a parent ↔ student link, retaining its audit row. */
  async removeForParent(
    schoolId: string,
    parentId: string,
    studentId: string,
  ): Promise<StudentGuardianDeleteResponse> {
    await this.assertParentInSchool(schoolId, parentId);
    const relationship = await this.findRelationshipOrThrow(schoolId, parentId, studentId);
    await relationship.destroy();
    return { id: relationship.id, message: STUDENT_GUARDIAN_DELETED_MESSAGE };
  }

  /** Soft-deletes a link from the student-centred route. */
  async removeForStudent(
    schoolId: string,
    studentId: string,
    parentId: string,
  ): Promise<StudentGuardianDeleteResponse> {
    await this.assertStudentInSchool(schoolId, studentId);
    await this.assertParentInSchool(schoolId, parentId);
    const relationship = await this.findRelationshipOrThrow(schoolId, parentId, studentId);
    await relationship.destroy();
    return { id: relationship.id, message: STUDENT_GUARDIAN_DELETED_MESSAGE };
  }
  private async createRelationship(
    schoolId: string,
    studentId: string,
    parentId: string,
    dto: CreateParentStudentRelationshipDto | CreateStudentGuardianDto,
  ): Promise<StudentGuardianResponse> {
    const existing = await this.relationships.findOne({
      where: { school_id: schoolId, student_id: studentId, user_id: parentId },
    });
    if (existing) {
      throw new ConflictException(STUDENT_GUARDIAN_ALREADY_EXISTS_MESSAGE);
    }

    try {
      const relationship = await this.relationships.create({
        school_id: schoolId,
        student_id: studentId,
        user_id: parentId,
        relationship: dto.relationship.trim(),
        can_pick_up: dto.can_pick_up ?? false,
        is_primary: dto.is_primary ?? false,
        is_active: true,
      });
      return this.toResponse(relationship);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(STUDENT_GUARDIAN_ALREADY_EXISTS_MESSAGE);
      }
      throw error;
    }
  }
  private async updateRelationship(
    relationship: StudentGuardian,
    dto: UpdateParentStudentRelationshipDto,
  ): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (dto.relationship !== undefined) updates.relationship = dto.relationship.trim();
    if (dto.can_pick_up !== undefined) updates.can_pick_up = dto.can_pick_up;
    if (dto.is_primary !== undefined) updates.is_primary = dto.is_primary;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    await relationship.update(updates);
  }
  private async findRelationshipOrThrow(
    schoolId: string,
    parentId: string,
    studentId: string,
  ): Promise<StudentGuardian> {
    const relationship = await this.relationships.findOne({
      where: { school_id: schoolId, user_id: parentId, student_id: studentId },
    });
    if (!relationship) {
      // Unknown, deleted, and cross-tenant links deliberately share one 404.
      throw new NotFoundException(STUDENT_GUARDIAN_NOT_FOUND_MESSAGE);
    }
    return relationship;
  }
  private async assertParentInSchool(schoolId: string, parentId: string): Promise<User> {
    const parent = await this.parents.findOne({
      where: { id: parentId, school_id: schoolId, role: UserRole.PARENT },
    });
    if (!parent) {
      throw new NotFoundException(PARENT_NOT_FOUND_MESSAGE);
    }
    return parent;
  }
  private async assertStudentInSchool(schoolId: string, studentId: string): Promise<Student> {
    const student = await this.students.findOne({
      where: { id: studentId, school_id: schoolId },
    });
    if (!student) {
      // Do not reveal whether the student exists in a different school.
      throw new NotFoundException(STUDENT_GUARDIAN_NOT_FOUND_MESSAGE);
    }
    return student;
  }
  private toResponse(relationship: StudentGuardian): StudentGuardianResponse {
    return {
      id: relationship.id,
      school_id: relationship.school_id,
      student_id: relationship.student_id,
      user_id: relationship.user_id,
      parent_id: relationship.user_id,
      relationship: relationship.relationship,
      can_pick_up: relationship.can_pick_up,
      is_primary: relationship.is_primary,
      is_active: relationship.is_active,
      created_at: relationship.created_at.toISOString(),
      updated_at: relationship.updated_at.toISOString(),
    };
  }
}
