import { Module } from '@nestjs/common';
import { Student, StudentGuardian, User } from '../../database/models';
import { ParentGuardiansService } from './parent-guardians.service';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';
import {
  PARENTS_REPOSITORY,
  PARENTS_STUDENTS_REPOSITORY,
  STUDENT_GUARDIANS_REPOSITORY,
} from './parents.constants';
import { StudentGuardiansController } from './student-guardians.controller';

/** Parent accounts and tenant-scoped student ↔ parent relationships. */
@Module({
  controllers: [ParentsController, StudentGuardiansController],
  providers: [
    ParentsService,
    ParentGuardiansService,
    { provide: PARENTS_REPOSITORY, useValue: User },
    { provide: PARENTS_STUDENTS_REPOSITORY, useValue: Student },
    { provide: STUDENT_GUARDIANS_REPOSITORY, useValue: StudentGuardian },
  ],
  exports: [ParentsService, ParentGuardiansService],
})
export class ParentsModule {}
