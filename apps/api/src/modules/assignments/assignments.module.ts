import { Module } from '@nestjs/common';
import { Bus, Route, RouteAssignment, User } from '../../database/models';
import { AssignmentsController, RouteAssignmentsController } from './assignments.controller';
import { RouteAssignmentsService } from './assignments.service';
import {
  ROUTE_ASSIGNMENTS_BUSES_REPOSITORY,
  ROUTE_ASSIGNMENTS_REPOSITORY,
  ROUTE_ASSIGNMENTS_ROUTES_REPOSITORY,
  ROUTE_ASSIGNMENTS_USERS_REPOSITORY,
} from './assignments.constants';

/**
 * Route assignment management module.
 *
 * The four model repositories are token-backed so this feature follows the
 * existing migration-driven Sequelize pattern and remains unit-testable while
 * `DB_AUTO_CONNECT=false`.
 */
@Module({
  controllers: [RouteAssignmentsController, AssignmentsController],
  providers: [
    RouteAssignmentsService,
    { provide: ROUTE_ASSIGNMENTS_REPOSITORY, useValue: RouteAssignment },
    { provide: ROUTE_ASSIGNMENTS_ROUTES_REPOSITORY, useValue: Route },
    { provide: ROUTE_ASSIGNMENTS_BUSES_REPOSITORY, useValue: Bus },
    { provide: ROUTE_ASSIGNMENTS_USERS_REPOSITORY, useValue: User },
  ],
  exports: [RouteAssignmentsService],
})
export class RouteAssignmentsModule {}

/** Alias matching the shorter feature name used by some consumers. */
export { RouteAssignmentsModule as AssignmentsModule };
