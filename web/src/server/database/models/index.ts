import type { Model, ModelCtor } from 'sequelize-typescript';
import { School } from './school.model';
import { User } from './user.model';
import { Bus } from './bus.model';
import { Route } from './route.model';
import { Stop } from './stop.model';
import { Student } from './student.model';
import { RouteAssignment } from './route-assignment.model';
import { Shift } from './shift.model';
import { Run } from './run.model';
import { RunCrew } from './run-crew.model';
import { Trip } from './trip.model';
import { RefreshToken } from './refresh-token.model';
import { CrewPairingToken } from './crew-pairing-token.model';
import { PasswordResetToken } from './password-reset-token.model';
import { StudentGuardian } from './student-guardian.model';
import { TripStudentAttendance } from './trip-student-attendance.model';
import { TripLocation } from './trip-location.model';
import { TripStopArrival } from './trip-stop-arrival.model';
import { Notification } from './notification.model';
import { DeviceToken } from './device-token.model';
import { Plan } from './plan.model';
import { SchoolSubscription } from './school-subscription.model';
import { BusDocument } from './bus-document.model';
import { DriverDocument } from './driver-document.model';
import { DocumentRequirement } from './document-requirement.model';
import { EmergencyEvent } from './emergency-event.model';
import { AuditLog } from './audit-log.model';
import { IdempotencyKey } from './idempotency-key.model';
import { ImportJob } from './import-job.model';
import { AssistedManagementSession } from './assisted-management-session.model';
import { EmailTemplate } from './marketing-template.model';
import { EmailTemplateVersion } from './marketing-template-version.model';
import { EmailCampaign } from './marketing-campaign.model';
import { EmailCampaignRecipient } from './marketing-campaign-recipient.model';
import { EmailEvent } from './marketing-event.model';
import { MarketingSuppression } from './marketing-suppression.model';
import { MarketingLead } from './marketing-lead.model';
import { MarketingLeadEvent } from './marketing-lead-event.model';

export { BaseModel } from './base.model';
export type { BaseModelAttributes, BaseModelManagedFields } from './base.model';

export {
  BUS_DOCUMENT_TYPE_VALUES,
  DOCUMENT_OWNER_TYPE_VALUES,
  DRIVER_DOCUMENT_TYPE_VALUES,
  EMERGENCY_STATUS_VALUES,
  EMERGENCY_TYPE_VALUES,
  MARKETING_TEMPLATE_STATUS_VALUES,
  MARKETING_CAMPAIGN_STATUS_VALUES,
  MARKETING_RECIPIENT_STATUS_VALUES,
  MARKETING_EVENT_TYPE_VALUES,
  MARKETING_ERROR_CATEGORY_VALUES,
  MARKETING_RECIPIENT_SOURCE_VALUES,
  MARKETING_SUPPRESSION_REASON_VALUES,
  MARKETING_SUPPRESSION_SOURCE_VALUES,
  MARKETING_LEAD_STATUS_VALUES,
  MARKETING_LEAD_SOURCE_VALUES,
  MARKETING_LEAD_EVENT_TYPE_VALUES,
  ROUTE_ASSIGNMENT_ROLE_VALUES,
  RUN_CREW_ROLE_VALUES,
  STUDENT_GENDER_VALUES,
  TRIP_ATTENDANCE_STATUS_VALUES,
  TRIP_STATUS_VALUES,
  USER_ROLE_VALUES,
  BusDocumentType,
  DriverDocumentType,
  EmergencyStatus,
  EmergencyType,
  RouteAssignmentRole,
  StudentGender,
  TripAttendanceStatus,
  TripStatus,
  UserRole,
} from './enums';
export type {
  DocumentOwnerType,
  MarketingCampaignStatus,
  MarketingErrorCategory,
  MarketingEventType,
  MarketingLeadEventActor,
  MarketingLeadEventType,
  MarketingLeadSource,
  MarketingLeadStatus,
  MarketingRecipientSource,
  MarketingRecipientStatus,
  MarketingSuppressionReason,
  MarketingSuppressionSource,
  MarketingTemplateStatus,
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
export { Shift } from './shift.model';
export type { ShiftAttributes, ShiftCreationAttributes } from './shift.model';
export { Run } from './run.model';
export type { RunAttributes, RunCreationAttributes } from './run.model';
export { RunCrew } from './run-crew.model';
export type { RunCrewAttributes, RunCrewCreationAttributes } from './run-crew.model';
export { Trip } from './trip.model';
export type { TripAttributes, TripCreationAttributes } from './trip.model';
export { RefreshToken } from './refresh-token.model';
export type { RefreshTokenAttributes, RefreshTokenCreationAttributes } from './refresh-token.model';
export { CrewPairingToken } from './crew-pairing-token.model';
export type {
  CrewPairingTokenAttributes,
  CrewPairingTokenCreationAttributes,
} from './crew-pairing-token.model';
export { PasswordResetToken } from './password-reset-token.model';
export type {
  PasswordResetTokenAttributes,
  PasswordResetTokenCreationAttributes,
} from './password-reset-token.model';
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
export { DeviceToken } from './device-token.model';
export type { DeviceTokenAttributes, DeviceTokenCreationAttributes } from './device-token.model';
export { Plan } from './plan.model';
export type { PlanAttributes, PlanCreationAttributes } from './plan.model';
export { SchoolSubscription } from './school-subscription.model';
export type {
  SchoolSubscriptionAttributes,
  SchoolSubscriptionCreationAttributes,
} from './school-subscription.model';
export { BusDocument } from './bus-document.model';
export type { BusDocumentAttributes, BusDocumentCreationAttributes } from './bus-document.model';
export { DriverDocument } from './driver-document.model';
export type {
  DriverDocumentAttributes,
  DriverDocumentCreationAttributes,
} from './driver-document.model';
export { DocumentRequirement } from './document-requirement.model';
export type {
  DocumentRequirementAttributes,
  DocumentRequirementCreationAttributes,
} from './document-requirement.model';
export { EmergencyEvent } from './emergency-event.model';
export type {
  EmergencyEventAttributes,
  EmergencyEventCreationAttributes,
} from './emergency-event.model';
export { AuditLog } from './audit-log.model';
export type { AuditLogAttributes, AuditLogCreationAttributes } from './audit-log.model';
export { IdempotencyKey } from './idempotency-key.model';
export type {
  IdempotencyKeyAttributes,
  IdempotencyKeyCreationAttributes,
} from './idempotency-key.model';
export { ImportJob } from './import-job.model';
export type { ImportJobAttributes, ImportJobCreationAttributes } from './import-job.model';
export {
  AssistedManagementSession,
  ASSISTED_SESSION_END_REASONS,
} from './assisted-management-session.model';
export type {
  AssistedManagementSessionAttributes,
  AssistedManagementSessionCreationAttributes,
  AssistedSessionEndReasonValue,
} from './assisted-management-session.model';
export { EmailTemplate } from './marketing-template.model';
export type {
  EmailTemplateAttributes,
  EmailTemplateCreationAttributes,
} from './marketing-template.model';
export { EmailTemplateVersion } from './marketing-template-version.model';
export type {
  EmailTemplateVersionAttributes,
  EmailTemplateVersionCreationAttributes,
} from './marketing-template-version.model';
export { EmailCampaign } from './marketing-campaign.model';
export type {
  EmailCampaignAttributes,
  EmailCampaignCreationAttributes,
} from './marketing-campaign.model';
export { EmailCampaignRecipient } from './marketing-campaign-recipient.model';
export type {
  EmailCampaignRecipientAttributes,
  EmailCampaignRecipientCreationAttributes,
} from './marketing-campaign-recipient.model';
export { EmailEvent } from './marketing-event.model';
export type { EmailEventAttributes, EmailEventCreationAttributes } from './marketing-event.model';
export { MarketingSuppression } from './marketing-suppression.model';
export type {
  MarketingSuppressionAttributes,
  MarketingSuppressionCreationAttributes,
} from './marketing-suppression.model';
export { MarketingLead } from './marketing-lead.model';
export type {
  MarketingLeadAttributes,
  MarketingLeadCreationAttributes,
} from './marketing-lead.model';
export { MarketingLeadEvent } from './marketing-lead-event.model';
export type {
  MarketingLeadEventAttributes,
  MarketingLeadEventCreationAttributes,
} from './marketing-lead-event.model';

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
 * stops → students → assignments → shifts → runs → run crew → trips → refresh
 * tokens → student guardians → trip attendance → trip locations) to keep the
 * graph easy to read.
 */
export const models: ModelCtor<Model>[] = [
  School,
  User,
  Bus,
  Route,
  Stop,
  Student,
  RouteAssignment,
  Shift,
  Run,
  RunCrew,
  Trip,
  RefreshToken,
  CrewPairingToken,
  PasswordResetToken,
  StudentGuardian,
  TripStudentAttendance,
  TripLocation,
  TripStopArrival,
  Notification,
  DeviceToken,
  Plan,
  SchoolSubscription,
  BusDocument,
  DriverDocument,
  DocumentRequirement,
  EmergencyEvent,
  AuditLog,
  IdempotencyKey,
  ImportJob,
  AssistedManagementSession,
  EmailTemplate,
  EmailTemplateVersion,
  EmailCampaign,
  EmailCampaignRecipient,
  EmailEvent,
  MarketingSuppression,
  MarketingLead,
  MarketingLeadEvent,
];
