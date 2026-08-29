import type { Model, ModelCtor } from 'sequelize-typescript';
import { School } from './school.model';
import { User } from './user.model';
import { Bus } from './bus.model';
import { Route } from './route.model';
import { Stop } from './stop.model';
import { Student } from './student.model';
import { RouteAssignment } from './route-assignment.model';
import { Trip } from './trip.model';
import { RefreshToken } from './refresh-token.model';
import { StudentGuardian } from './student-guardian.model';
import { TripStudentAttendance } from './trip-student-attendance.model';
import { TripLocation } from './trip-location.model';
import { TripStopArrival } from './trip-stop-arrival.model';
import { Notification } from './notification.model';

export { BaseModel } from './base.model';
export type { BaseModelAttributes, BaseModelManagedFields } from './base.model';

export {
  ROUTE_ASSIGNMENT_ROLE_VALUES,
  STUDENT_GENDER_VALUES,
  TRIP_ATTENDANCE_STATUS_VALUES,
  TRIP_STATUS_VALUES,
  USER_ROLE_VALUES,
  RouteAssignmentRole,
  StudentGender,
  TripAttendanceStatus,
  TripStatus,
  UserRole,
} from './enums';

export { School } from './school.model';
export type { SchoolAttributes, SchoolCreationAttributes } from './school.model';
export { User } from './user.model';
export type { UserAttributes, UserCreationAttributes } from './user.model';
export { Bus } from './bus.model';
export type { BusAttributes, BusCreationAttributes } from './bus.model';
export { Route } from './route.model';
export type { RouteAttributes, RouteCreationAttributes } from './route.model';
export { Stop } from './stop.model';
export type { StopAttributes, StopCreationAttributes } from './stop.model';
export { Student } from './student.model';
export type { StudentAttributes, StudentCreationAttributes } from './student.model';
export { RouteAssignment } from './route-assignment.model';
export type {
  RouteAssignmentAttributes,
  RouteAssignmentCreationAttributes,
} from './route-assignment.model';
export { Trip } from './trip.model';
export type { TripAttributes, TripCreationAttributes } from './trip.model';
export { RefreshToken } from './refresh-token.model';
export type { RefreshTokenAttributes, RefreshTokenCreationAttributes } from './refresh-token.model';
export { StudentGuardian } from './student-guardian.model';
export type {
  StudentGuardianAttributes,
  StudentGuardianCreationAttributes,
} from './student-guardian.model';
export { TripStudentAttendance } from './trip-student-attendance.model';
export type {
  TripStudentAttendanceAttributes,
  TripStudentAttendanceCreationAttributes,
} from './trip-student-attendance.model';
export { TripLocation } from './trip-location.model';
export type { TripLocationAttributes, TripLocationCreationAttributes } from './trip-location.model';
export { TripStopArrival } from './trip-stop-arrival.model';
export type {
  TripStopArrivalAttributes,
  TripStopArrivalCreationAttributes,
} from './trip-stop-arrival.model';
export { Notification } from './notification.model';
export type { NotificationAttributes, NotificationCreationAttributes } from './notification.model';

/**
 * Concrete Sequelize model registry.
 *
 * Every model is listed here (and only here) so the NestJS `DatabaseModule`
 * and any tooling have a single source of truth. The physical schema is
 * migration-driven — these models are never synced.
 *
 * Models reference each other through lazy association thunks
 * (`@BelongsTo(() => School)`), which is what makes the mutual imports safe:
 * the target class is only resolved once the whole graph is registered. The
 * imports above are still ordered by dependency (tenant → users/fleet/routes →
 * stops → students → assignments → trips → refresh tokens → student guardians
 * → trip attendance → trip locations) to keep the graph easy to read.
 */
export const models: ModelCtor<Model>[] = [
  School,
  User,
  Bus,
  Route,
  Stop,
  Student,
  RouteAssignment,
  Trip,
  RefreshToken,
  StudentGuardian,
  TripStudentAttendance,
  TripLocation,
  TripStopArrival,
  Notification,
];
