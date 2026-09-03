import {
  EMERGENCY_EVENTS,
  EMERGENCY_STATUS_VALUES,
  EMERGENCY_TYPE_LABELS,
  EmergencyStatus,
  EmergencyType,
  type EmergencyEventResponse,
} from '@school-bus-tracking/shared-types';

/**
 * Pure policy of the school-admin emergency alarm.
 *
 * Deliberately free of React, of the Web Audio API and of *runtime* relative
 * imports so the Node test runner (`npm --prefix apps/web test`) can execute it
 * directly — the same convention as `features/documents/helpers.ts` and
 * `features/admin/subscriptions/helpers.ts`.
 *
 * The rule encoded here is the one the product requires: **only an emergency
 * notification may sound the alarm.** Every other realtime frame the shell
 * receives — a parent `notification:new`, a live-tracking position, an
 * `emergency:updated` status change, anything unknown or malformed — is
 * classified `ignore`, so no sound is ever attached to a normal notification.
 *
 * Tenant isolation is not re-decided here on purpose. The `/emergencies`
 * gateway places each socket into `emergency:school:<schoolId>` from the
 * verified JWT and there is no client-side subscribe, so a browser can only
 * ever be handed its own school's events; these helpers merely interpret a
 * payload the server already scoped.
 */

/** The emergency an alarm is raised for, reduced to what the shell renders. */
export interface EmergencyAlarmEvent {
  /** Emergency event id — also the de-duplication key of the alarm. */
  id: string;
  status: EmergencyStatus;
  type: EmergencyType | null;
  /** Human label of the type, from the shared catalogue. */
  typeLabel: string;
  raisedByName: string | null;
  raisedByRole: EmergencyEventResponse['raised_by_role'];
  triggeredAt: string | null;
  schoolId: string | null;
}

/**
 * What one realtime frame means for the alarm.
 *
 * - `sound` — a crew member raised a new, still-`OPEN` SOS: start the siren.
 * - `silence` — that SOS left `OPEN` (acknowledged / resolved / cancelled):
 *   stop the siren for it.
 * - `ignore` — anything else, including every normal notification.
 */
export type EmergencyAlarmDecision =
  | { action: 'ignore' }
  | { action: 'sound'; event: EmergencyAlarmEvent }
  | { action: 'silence'; id: string };

/** Why the alarm is (not) audible — drives the top-bar control's copy. */
export type EmergencyAlarmStatus = 'idle' | 'sounding' | 'blocked' | 'muted' | 'unavailable';

/** What the alarm does with a decision (structurally `EmergencyAlarmPlayer`). */
export interface EmergencyAlarmSink {
  raise(event: EmergencyAlarmEvent): void;
  silence(id: string): void;
  silenceAll(): void;
}

/** The slice of a Socket.IO socket the alarm uses (structural, as elsewhere). */
export interface AlarmSocket {
  on(event: string, handler: (payload: unknown) => void): unknown;
  off(event: string, handler: (payload: unknown) => void): unknown;
}

const IGNORE: EmergencyAlarmDecision = { action: 'ignore' };

/**
 * Reads an `emergency:new` / `emergency:updated` payload defensively.
 *
 * Returns `null` for anything that is not an emergency event — a parent
 * `notification:new`, a tracking position, `undefined`, a primitive. The socket
 * is the only source, but a malformed frame must never be able to start an
 * alarm, and never to throw inside somebody else's notification handler.
 */
export function normalizeEmergencyEvent(payload: unknown): EmergencyAlarmEvent | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const raw = payload as Partial<EmergencyEventResponse> & Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return null;
  }
  if (!isEmergencyStatus(raw.status)) {
    return null;
  }
  const type = isEmergencyType(raw.type) ? raw.type : null;
  return {
    id: raw.id,
    status: raw.status,
    type,
    typeLabel: type ? (EMERGENCY_TYPE_LABELS[type] ?? type) : 'Emergency',
    raisedByName: typeof raw.raised_by_name === 'string' ? raw.raised_by_name : null,
    raisedByRole:
      raw.raised_by_role === 'DRIVER' || raw.raised_by_role === 'CONDUCTOR'
        ? raw.raised_by_role
        : null,
    triggeredAt: typeof raw.triggered_at === 'string' ? raw.triggered_at : null,
    schoolId: typeof raw.school_id === 'string' ? raw.school_id : null,
  };
}

/**
 * Classifies one realtime frame for the school-admin alarm.
 *
 * Only `emergency:new` carrying a still-`OPEN` event can ever return `sound`.
 * A status change away from `OPEN` returns `silence`, so the siren stops the
 * moment the school acknowledges, resolves or cancels the incident; a change
 * that keeps it `OPEN` returns `ignore`, leaving the siren running.
 */
export function alarmDecisionFor(eventName: unknown, payload: unknown): EmergencyAlarmDecision {
  if (eventName !== EMERGENCY_EVENTS.new && eventName !== EMERGENCY_EVENTS.updated) {
    // Every normal notification lands here. None of them may sound the alarm.
    return IGNORE;
  }

  const event = normalizeEmergencyEvent(payload);
  if (!event) {
    return IGNORE;
  }

  if (eventName === EMERGENCY_EVENTS.new) {
    // A brand-new SOS is always OPEN; anything else is a stale replay and is
    // not worth waking the school for.
    return event.status === EmergencyStatus.OPEN ? { action: 'sound', event } : IGNORE;
  }

  return event.status === EmergencyStatus.OPEN ? IGNORE : { action: 'silence', id: event.id };
}

/** Convenience guard: does this frame start the emergency alarm? */
export function isEmergencyAlarmTrigger(eventName: unknown, payload: unknown): boolean {
  return alarmDecisionFor(eventName, payload).action === 'sound';
}

/**
 * Routes the tenant's emergency feed into an alarm sink.
 *
 * It subscribes to the two events the existing `/emergencies` gateway already
 * broadcasts — nothing new is listened for, no room is named by the client, so
 * the server-owned tenant isolation is untouched. The returned detach function
 * removes exactly these handlers (never a bare `socket.off(event)`, which would
 * also drop the emergency console's own refresh listeners) and silences the
 * siren, because leaving the shell — sign-out, role change — must not leave an
 * alarm ringing behind.
 */
export function attachEmergencyAlarm(socket: AlarmSocket, sink: EmergencyAlarmSink): () => void {
  const handle =
    (eventName: string) =>
    (payload: unknown): void => {
      const decision = alarmDecisionFor(eventName, payload);
      if (decision.action === 'sound') {
        sink.raise(decision.event);
      } else if (decision.action === 'silence') {
        sink.silence(decision.id);
      }
    };

  const onNew = handle(EMERGENCY_EVENTS.new);
  const onUpdated = handle(EMERGENCY_EVENTS.updated);

  socket.on(EMERGENCY_EVENTS.new, onNew);
  socket.on(EMERGENCY_EVENTS.updated, onUpdated);

  return () => {
    socket.off(EMERGENCY_EVENTS.new, onNew);
    socket.off(EMERGENCY_EVENTS.updated, onUpdated);
    sink.silenceAll();
  };
}

/** "Accident raised by Asha Rane" — the line the shell announces and toasts. */
export function describeEmergencyAlarm(event: EmergencyAlarmEvent): string {
  return `${event.typeLabel} raised by ${event.raisedByName ?? 'a crew member'}`;
}

/** Plural-safe count copy for the top-bar alarm control. */
export function activeAlarmCountLabel(count: number): string {
  return `${count} active ${count === 1 ? 'emergency' : 'emergencies'}`;
}

/** Short user-facing text for each alarm state (tooltip / button label). */
export function alarmStatusHint(status: EmergencyAlarmStatus): string {
  switch (status) {
    case 'sounding':
      return 'Emergency alarm sounding';
    case 'blocked':
      return 'Enable alarm sound';
    case 'muted':
      return 'Alarm sound muted';
    case 'unavailable':
      return 'Alarm sound unavailable in this browser';
    default:
      return 'Emergency alarm armed';
  }
}

function isEmergencyStatus(value: unknown): value is EmergencyStatus {
  return typeof value === 'string' && (EMERGENCY_STATUS_VALUES as string[]).includes(value);
}

function isEmergencyType(value: unknown): value is EmergencyType {
  return typeof value === 'string' && value in EMERGENCY_TYPE_LABELS;
}
