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
/** Device-token repository token (injected behind a token, like the others). */
export const NOTIFICATIONS_DEVICE_TOKENS_REPOSITORY = 'NOTIFICATIONS_DEVICE_TOKENS_REPOSITORY';
/** Active push provider (NoOp or FCM), selected by the Firebase env. */
export const NOTIFICATIONS_PUSH_PROVIDER = 'NOTIFICATIONS_PUSH_PROVIDER';

/** FCM/APNs token length cap (fits the STRING(1024) column with margin). */
export const DEVICE_TOKEN_MAX_LENGTH = 1024;

/** Provider name of the local no-op implementation (selection marker). */
export const NOOP_PUSH_PROVIDER_NAME = 'noop-push';

/** Delivery status written when the NoOp provider is active. */
export const PUSH_STATUS_NOT_CONFIGURED = 'not_configured';
/** Delivery status written when a real provider attempt succeeded. */
export const PUSH_STATUS_SENT = 'sent';
/** Delivery status written when a real provider attempt failed. */
export const PUSH_STATUS_FAILED = 'failed';

/** Reason recorded when no active device is registered for the recipient. */
export const PUSH_NO_DEVICE_REASON = 'No active device tokens registered';
/** Reason recorded when the push provider is the local no-op. */
export const PUSH_NOT_CONFIGURED_REASON = 'Push provider is not configured (NoOp active)';

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
