import { EMERGENCY_STATUS_LABELS, EmergencyStatus } from '@school-bus-tracking/shared-types';
import type { Tone } from '../../../lib/format';

/**
 * Emergency lifecycle helpers shared by the admin console and the crew panel
 * (Task 44).
 *
 * The transitions mirror `EMERGENCY_STATUS_TRANSITIONS` in shared-types and the
 * service layer's own guard: OPEN and ACKNOWLEDGED are the only states with
 * actions, and RESOLVED / CANCELLED are terminal — a closed incident is
 * history and can never be reopened, so the audit trail stays truthful.
 *
 * Pure on purpose: testable with the Node runner, with no React Native import.
 */

/** Statuses a school admin can move an event into, in the order shown. */
export function nextEmergencyActions(status: EmergencyStatus): EmergencyStatus[] {
  switch (status) {
    case EmergencyStatus.OPEN:
      return [EmergencyStatus.ACKNOWLEDGED, EmergencyStatus.RESOLVED, EmergencyStatus.CANCELLED];
    case EmergencyStatus.ACKNOWLEDGED:
      return [EmergencyStatus.RESOLVED, EmergencyStatus.CANCELLED];
    default:
      return [];
  }
}

/** Button / dialog label of one transition. */
export function emergencyActionLabel(status: EmergencyStatus): string {
  switch (status) {
    case EmergencyStatus.ACKNOWLEDGED:
      return 'Acknowledge';
    case EmergencyStatus.RESOLVED:
      return 'Resolve';
    case EmergencyStatus.CANCELLED:
      return 'Cancel alert';
    default:
      return EMERGENCY_STATUS_LABELS[status];
  }
}

/** Badge tone of one lifecycle status. */
export function emergencyStatusTone(status: EmergencyStatus): Tone {
  switch (status) {
    case EmergencyStatus.OPEN:
      return 'danger';
    case EmergencyStatus.ACKNOWLEDGED:
      return 'warning';
    case EmergencyStatus.RESOLVED:
    case EmergencyStatus.CANCELLED:
      return 'success';
    default:
      return 'neutral';
  }
}

/** True while the school still has to do something about the event. */
export function isEmergencyActive(status: EmergencyStatus): boolean {
  return status === EmergencyStatus.OPEN || status === EmergencyStatus.ACKNOWLEDGED;
}
