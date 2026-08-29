/**
 * DI tokens and user-facing messages for the notifications feature.
 *
 * Repository classes are injected behind tokens instead of using
 * `SequelizeModule.forFeature`, matching every other feature module. This
 * keeps the API bootable with `DB_AUTO_CONNECT=false` and makes the service
 * straightforward to unit test with in-memory repositories.
 */
export const NOTIFICATIONS_REPOSITORY = 'NOTIFICATIONS_REPOSITORY';
export const NOTIFICATIONS_USERS_REPOSITORY = 'NOTIFICATIONS_USERS_REPOSITORY';
export const NOTIFICATIONS_GUARDIANS_REPOSITORY = 'NOTIFICATIONS_GUARDIANS_REPOSITORY';
export const NOTIFICATIONS_STUDENTS_REPOSITORY = 'NOTIFICATIONS_STUDENTS_REPOSITORY';
export const NOTIFICATIONS_STOPS_REPOSITORY = 'NOTIFICATIONS_STOPS_REPOSITORY';
export const NOTIFICATIONS_TRIPS_REPOSITORY = 'NOTIFICATIONS_TRIPS_REPOSITORY';

/** Default page size of the parent notification list. */
export const DEFAULT_NOTIFICATION_LIMIT = 20;

/** Hard upper bound of the parent notification list page size. */
export const MAX_NOTIFICATION_LIMIT = 100;

/**
 * Generic not-found message for a notification.
 *
 * Deliberately identical for an unknown id, a notification of another parent
 * and a notification of another school, so probing ids can never confirm that
 * a notification exists.
 */
export const NOTIFICATION_NOT_FOUND_MESSAGE = 'Notification not found';

/** Title/message copy of the student attendance notifications. */
export const STUDENT_BOARDED_TITLE = (firstName: string): string => `${firstName} boarded`;
export const STUDENT_BOARDED_MESSAGE = (studentName: string): string =>
  `${studentName} boarded the school bus.`;
export const STUDENT_DROPPED_TITLE = (firstName: string): string => `${firstName} dropped off`;
export const STUDENT_DROPPED_MESSAGE = (studentName: string): string =>
  `${studentName} has been dropped off safely.`;

/** Title/message copy of the trip lifecycle notifications. */
export const TRIP_STATUS_TITLES: Record<string, string> = {
  TRIP_BOARDING: 'Bus is boarding',
  TRIP_IN_PROGRESS: 'Trip started',
  TRIP_COMPLETED: 'Trip completed',
  TRIP_CANCELLED: 'Trip cancelled',
};

/** Title/message copy of the Task 22 stop-arrival notification. */
export const STOP_ARRIVED_TITLE = 'Bus arrived';
export const STOP_ARRIVED_MESSAGE = (stopName: string): string => `Bus arrived at ${stopName}.`;

export const TRIP_STATUS_MESSAGES: Record<string, string> = {
  TRIP_BOARDING: "Your child's bus is now boarding.",
  TRIP_IN_PROGRESS: "Your child's bus has started the trip.",
  TRIP_COMPLETED: "Your child's bus trip has been completed.",
  TRIP_CANCELLED: "Your child's bus trip has been cancelled.",
};
