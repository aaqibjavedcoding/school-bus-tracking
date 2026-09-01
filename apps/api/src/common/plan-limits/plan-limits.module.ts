import { Global, Module } from '@nestjs/common';
import {
  Bus,
  Plan,
  Route,
  SchoolSubscription,
  Stop,
  Student,
  Trip,
  User,
} from '../../database/models';
import {
  PLAN_LIMITS_BUSES_REPOSITORY,
  PLAN_LIMITS_PLANS_REPOSITORY,
  PLAN_LIMITS_ROUTES_REPOSITORY,
  PLAN_LIMITS_STOPS_REPOSITORY,
  PLAN_LIMITS_STUDENTS_REPOSITORY,
  PLAN_LIMITS_SUBSCRIPTIONS_REPOSITORY,
  PLAN_LIMITS_TRIPS_REPOSITORY,
  PLAN_LIMITS_USERS_REPOSITORY,
} from './plan-limits.constants';
import { PlanLimitsService } from './plan-limits.service';

@Global()
@Module({
  providers: [
    PlanLimitsService,
    { provide: PLAN_LIMITS_SUBSCRIPTIONS_REPOSITORY, useValue: SchoolSubscription },
    { provide: PLAN_LIMITS_PLANS_REPOSITORY, useValue: Plan },
    { provide: PLAN_LIMITS_STUDENTS_REPOSITORY, useValue: Student },
    { provide: PLAN_LIMITS_BUSES_REPOSITORY, useValue: Bus },
    { provide: PLAN_LIMITS_ROUTES_REPOSITORY, useValue: Route },
    { provide: PLAN_LIMITS_STOPS_REPOSITORY, useValue: Stop },
    { provide: PLAN_LIMITS_USERS_REPOSITORY, useValue: User },
    { provide: PLAN_LIMITS_TRIPS_REPOSITORY, useValue: Trip },
  ],
  exports: [PlanLimitsService],
})
export class PlanLimitsModule {}
