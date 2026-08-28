import { Module } from '@nestjs/common';
import { Stop, Student, StudentGuardian } from '../../database/models';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import {
  STUDENTS_GUARDIANS_REPOSITORY,
  STUDENTS_REPOSITORY,
  STUDENTS_STOPS_REPOSITORY,
} from './students.constants';

/**
 * Student management module.
 *
 * Model classes are provided behind tokens (like AuthModule) so the app still
 * boots with `DB_AUTO_CONNECT=false` and unit tests can inject stubs.
 */
@Module({
  controllers: [StudentsController],
  providers: [
    StudentsService,
    { provide: STUDENTS_REPOSITORY, useValue: Student },
    { provide: STUDENTS_STOPS_REPOSITORY, useValue: Stop },
    { provide: STUDENTS_GUARDIANS_REPOSITORY, useValue: StudentGuardian },
  ],
  exports: [StudentsService],
})
export class StudentsModule {}
