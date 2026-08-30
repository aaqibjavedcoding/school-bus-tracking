import { Module } from '@nestjs/common';
import { Bus, Route, RouteAssignment, Stop, Student, StudentGuardian } from '../../database/models';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import {
  STUDENTS_BUSES_REPOSITORY,
  STUDENTS_GUARDIANS_REPOSITORY,
  STUDENTS_REPOSITORY,
  STUDENTS_ROUTE_ASSIGNMENTS_REPOSITORY,
  STUDENTS_ROUTES_REPOSITORY,
  STUDENTS_STOPS_REPOSITORY,
} from './students.constants';

/**
 * Student management module.
 *
 * Model classes are provided behind tokens (like AuthModule) so the app still
 * boots with `DB_AUTO_CONNECT=false` and unit tests can inject stubs. The
 * route / assignment / bus repositories power the human-readable home-stop,
 * route and bus enrichment on list and detail responses.
 */
@Module({
  controllers: [StudentsController],
  providers: [
    StudentsService,
    { provide: STUDENTS_REPOSITORY, useValue: Student },
    { provide: STUDENTS_STOPS_REPOSITORY, useValue: Stop },
    { provide: STUDENTS_GUARDIANS_REPOSITORY, useValue: StudentGuardian },
    { provide: STUDENTS_ROUTES_REPOSITORY, useValue: Route },
    { provide: STUDENTS_ROUTE_ASSIGNMENTS_REPOSITORY, useValue: RouteAssignment },
    { provide: STUDENTS_BUSES_REPOSITORY, useValue: Bus },
  ],
  exports: [StudentsService],
})
export class StudentsModule {}
