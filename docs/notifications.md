# Notifications

## Overview

The notification system delivers real-time and persistent notifications to parents, drivers, conductors, and school admins.

**No paid service/provider is included in this phase.**

## Architecture

### In-App Delivery (Implemented)

- **Technology**: Socket.IO + PostgreSQL
- **Delivery**: Real-time via WebSocket, persistent in database
- **Status**: Fully functional

### External Delivery (Provider Abstractions Only)

- **Push**: `PushNotificationProvider` interface + `NoOpPushProvider`
- **Email**: `EmailNotificationProvider` interface + `NoOpEmailProvider`
- **SMS**: `SmsNotificationProvider` interface + `NoOpSmsProvider`

External push provider integration is intentionally deferred because paid services are prohibited in the current phase.

## Notification Events

### Parent Notifications

- Child boarded
- Child dropped
- Trip started (boarding)
- Trip in progress
- Trip completed
- Trip cancelled
- Bus arrived at stop

### Driver/Conductor Notifications

- Trip assignment
- Trip change
- Important admin notification
- Emergency notification

### School Admin Notifications

- SOS raised
- Important trip incident
- Document expiry
- Operational alerts

## Emergency Alarm Sound (web, school admin)

A driver's or conductor's SOS is the one notification that must be **heard**, not just seen.
The web console therefore plays a prominent alarm sound for a school admin whenever a new
emergency arrives — on any screen, not only on `/emergencies`.

- **Trigger** — `emergency:new` on the `/emergencies` namespace, carrying `status = OPEN`.
- **Sound** — a Web Audio-synthesised two-tone siren (988 Hz / 740 Hz sawtooth): 6 beeps per
  burst ≈ 1.7 s, repeated every ≈ 1.85 s, peak gain 0.6 through a headroom compressor. No
  audio file to ship and no new dependency.
- **Stops when** — the event leaves `OPEN` (`emergency:updated` → acknowledged / resolved /
  cancelled), the admin mutes it, or after 60 bursts (≈ 2 min safety cap, so an unattended
  console does not drone on; the red badge and the live list keep showing the open event
  until it is handled).
- **Never sounds for** — any other frame: above all a parent `notification:new` (every
  `NotificationType`), live-tracking positions, `emergency:updated`, and unknown or
  malformed payloads.
- **Audience** — `SCHOOL_ADMIN` only. The gateway also joins crew sockets to the room, but
  the crew member who raised an SOS already knows about it, so their tab stays silent.
- **Location** — `apps/web/src/features/emergencies/`: `helpers.ts` (policy + socket
  wiring), `emergency-alarm.ts` (synthesiser + state machine), `useEmergencyAlarm.ts`,
  `EmergencyAlarmBell.tsx` (top-bar control, mounted in `AppShell`).

### Browser autoplay policy

Browsers keep an `AudioContext` suspended until a user gesture. The shell handles this
explicitly instead of failing silently:

1. The first `pointerdown` / `keydown` / `touchstart` anywhere in the tab unlocks the audio
   context; the listeners are removed once it succeeds.
2. An SOS that arrives **before** any gesture is queued (`status: 'blocked'`,
   `pendingCount > 0`) and plays the instant the unlock succeeds — it is never dropped.
3. While an alarm is queued, the top bar shows a visible, pulsing **"Enable alarm sound"**
   button; that click _is_ the gesture, so it both unlocks the audio and starts the siren.
4. Audio failures never break a notification: without a usable Web Audio API the state
   becomes `unavailable` with the reason in `lastError`, while the red count badge, the
   `aria-live="assertive"` announcement, the toast and the live list refresh keep working.

The mute switch is held **in memory only** — a reload re-arms the alarm, because a
permanently muted emergency console is the more dangerous failure mode.

### Security and tenant isolation

Unchanged. The alarm is a pure consumer of the existing feed: it subscribes to the two
events the `/emergencies` gateway already broadcasts, on the existing shared socket
(`services/emergencies-socket.ts`, authenticated with the same in-memory JWT). Room
membership is still assigned server-side from the verified JWT
(`emergency:school:<schoolId>`), the client never names a room, and the alarm adds no
endpoint, no payload field and no way to observe another tenant.

### Mobile

The mobile school-admin app receives the same `emergency:new` broadcast on the same
namespace and reacts **visually**: the dashboard shows an "active emergencies" alert card
and the emergency console refreshes live. It plays **no sound** today, because the Expo app
has no audio module (`expo-audio` / `expo-av` are not dependencies) and — with the push
provider still `NoOpPushProvider` — there is no OS-level notification channel that could
carry a sound either. Adding one is a deliberate follow-up: it needs a new native dependency
(and a rebuild), which is why the alarm was implemented on the web console, where it needs
neither.

## Notification Model

```typescript
{
  id: string;
  school_id: string;
  user_id: string;
  type: NotificationType;
  trip_id: string | null;
  student_id: string | null;
  stop_id: string | null;
  title: string;
  message: string;
  payload: Record<string, unknown> | null;
  is_read: boolean;
  read_at: Date | null;
  // Delivery status (Phase 2)
  push_status: 'pending' | 'sent' | 'failed' | 'not_configured';
  email_status: 'pending' | 'sent' | 'failed' | 'not_configured';
  sms_status: 'pending' | 'sent' | 'failed' | 'not_configured';
  delivery_retry_count: number;
  last_delivery_attempt_at: Date | null;
  delivery_failure_reason: string | null;
}
```

## Delivery Status

- **pending**: Waiting to be sent
- **sent**: Successfully delivered
- **failed**: Delivery failed (will be retried)
- **not_configured**: Provider not configured (no-op)

## Reliability

- Notifications are created AFTER the underlying operation succeeds
- Notification failures never break the operation
- Duplicate protection: same event never notifies the same parent twice
- Retry with exponential backoff for failed deliveries

## Socket.IO Rooms

- Parent notifications: `notification:user:<userId>`
- Emergency notifications: `emergency:school:<schoolId>` (also drives the school-admin
  alarm sound on the web console)

## Configuration

No external configuration needed for in-app notifications.

For future external providers:

```
PUSH_PROVIDER=noop|firebase|apns
EMAIL_PROVIDER=noop|sendgrid|ses
SMS_PROVIDER=noop|twilio
```
