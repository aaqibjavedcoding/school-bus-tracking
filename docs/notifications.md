# Notifications

## Overview

The notification system delivers real-time and persistent notifications to parents,
drivers, conductors, and school admins across three surfaces:

1. **Persistent in-app notifications** — stored in PostgreSQL (`notifications`),
   read through the parent REST endpoint.
2. **Real-time in-app delivery** — Socket.IO (`/notifications` namespace) pushes
   `notification:new` to the recipient's private room while the app is open.
3. **OS-level push (new)** — Firebase Cloud Messaging (FCM) via `firebase-admin`.
   FCM is free; **no paid service is used anywhere** in the flow.

## Architecture

### 1. Creation (always after the domain operation succeeds)

`NotificationsService` is called by the attendance / trip / stop-arrival flows
**only after** their own transactions committed. A failed boarding, an invalid
trip transition or a delivery outage can never affect the underlying operation.

### 2. In-app delivery (implemented, unchanged)

- **Storage**: one row per recipient per event (`notifications`).
- **Real-time**: Socket.IO namespace `/notifications`, room
  `notification:user:<userId>`. Room membership is assigned server-side from the
  verified JWT — a client never names a room.
- **Reads**: `GET /api/v1/parent/notifications` (parent only), scoped strictly
  to the JWT's `(school_id, user_id)`.

### 3. OS-level push (Firebase Cloud Messaging)

- **Provider abstraction**: `PushNotificationProvider` (`providers/`).
- **Selection by env** (module factory, never per-request):
  - `FIREBASE_SERVICE_ACCOUNT_JSON` set **and** valid → `FcmPushProvider`
    (`firebase-admin`, `sendEachForMulticast`).
  - Otherwise → `NoOpPushProvider` (local dev / CI stay green without
    credentials). The no-op logs that it "would send" and records
    `push_status = 'not_configured'`.
- **Message type**: a **notification message** (`notification.title` /
  `notification.body`), so the OS shows it in the tray/notification shade even
  when the app is killed. It also carries a string-only `data` payload:
  `school_id`, `user_id`, `type`, `id`, plus `trip_id` / `student_id` /
  `stop_id` when present — for future deep-linking. Android targets channel
  `notifications` with high priority and the default sound; iOS sets
  `aps.sound = default`.
- **Delivery recording**: after the row is created and the in-app broadcast is
  sent, `NotificationsService.deliverPush` resolves the recipient's active
  device tokens and attempts the push, then writes:

  | Column                     | Meaning                                          |
  | -------------------------- | ------------------------------------------------ |
  | `push_status`              | `pending` → `sent` / `failed` / `not_configured` |
  | `delivery_retry_count`     | incremented on failure, reset on success         |
  | `last_delivery_attempt_at` | server time of the attempt                       |
  | `delivery_failure_reason`  | short reason (or `null`)                         |

  A push failure is logged and **never** re-thrown: `notifyStudentAttendance`,
  `notifyTripStatusChange` and `notifyStopArrival` always complete.

- **Invalid token handling**: FCM `UNREGISTERED` / `INVALID_REGISTRATION`
  (and the Admin-SDK spellings `messaging/registration-token-not-registered` /
  `messaging/invalid-registration-token`) deactivate the offending
  `device_tokens` rows, so a stale device is never targeted again.

## Device registration

`device_tokens` stores one row per push-capable device, pinned to the tenant:

| Column                 | Notes                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| `school_id`, `user_id` | both derived from the **verified JWT**; composite FK to `users`  |
| `platform`             | `android` \| `ios`                                               |
| `token`                | native FCM / APNs token; unique (soft-delete aware)              |
| `is_active`            | delivery switch; false after logout / invalidation / user change |
| `last_seen_at`         | last register/refresh                                            |

### Endpoints (any school role — parent **and** crew)

- `POST /api/v1/notifications/devices` — register/refresh
  `{ "token": "<native token>", "platform": "android" | "ios" }`.
  Idempotent upsert: a re-login, app start or token refresh updates the row
  (and moves ownership if the device signed in as a different user).
- `DELETE /api/v1/notifications/devices/:token` — logout unregister.
  Scoped to the caller's own `(school_id, user_id)`; idempotent.

Both are JWT-protected (`JwtAuthGuard` + `RolesGuard`) and rate-limited by the
`device_register` policy (`RATE_LIMIT_DEVICE_REGISTER_LIMIT`,
default 30/minute). The platform `SUPER_ADMIN` (no tenant) is rejected.

## Mobile wiring (Expo SDK 54)

`mobile/src/features/notifications/`:

- `push-registration.ts` — pure, unit-tested decisions (platform mapping,
  permission handling incl. Android 13+ `POST_NOTIFICATIONS` and iOS
  `PROVISIONAL`/`EPHEMERAL`, request shaping).
- `push-notifications.ts` — native wiring:
  - `setNotificationHandler` → foreground banner (`shouldShowBanner` /
    `shouldShowList`, sound on); background/killed pushes are rendered by the
    OS automatically.
  - after login / restored session (any role): create the Android channel
    `notifications`, request permission, `getDevicePushTokenAsync()`, register
    the token, and attach `addPushTokenListener` so refreshed tokens are
    re-registered.
  - logout: `unregisterPushDevice()` fire-and-forget — never blocks logout.

`AuthProvider` calls setup on login, on session restore, and unregisters in
`clearSession`.

## Firebase project & credentials

The Firebase project is already created by the user. To wire the API:

1. In the Firebase console open **Project settings → Service accounts** and
   generate a **new private key**. This downloads a service-account JSON.
2. In `web/.env` set:
   - `FIREBASE_PROJECT_ID=<project id>`
   - `FIREBASE_SERVICE_ACCOUNT_JSON=<entire JSON on ONE line>`
3. Restart the API. Check the logs: watch for FCM sends (or
   `push_status = 'sent'` in the database); **the API never logs the
   credential**. `FIREBASE_SERVICE_ACCOUNT_JSON=` empty / absent keeps the
   no-op provider.
4. Keep real values out of Git — `.env` is git-ignored and `.env.example`
   holds placeholders only.

Security notes:

- The service-account JSON is a **credential**. Never commit, print, log or
  paste it into chats/tickets. Rotate/revoke it in the Firebase console if it
  ever leaks.
- The API reads the exact env names `FIREBASE_PROJECT_ID` and
  `FIREBASE_SERVICE_ACCOUNT_JSON` (no other names are supported).

## Building the mobile app for push (required — not Expo Go)

**Remote push does NOT work in Expo Go on SDK 54.** You must build a
development or production build with EAS:

1. `npm install` in the repo (adds `expo-notifications`).
2. Android:
   - Download `google-services.json` from Firebase (**Project settings →
     Your apps → Add app → Android**, package `com.schoolbustracking.app`) and
     place it at `mobile/google-services.json`.
   - Build: `cd mobile && npx eas build --profile development --platform android`
     (or `npx expo run:android` for a local dev build).
3. iOS (can be deferred — Android FCM works alone):
   - Add an iOS app in Firebase and place `GoogleService-Info.plist` in
     `mobile`.
   - In the Apple Developer portal configure **APNs** and upload the APNs key
     (or certificate) to Firebase (Project settings → Cloud Messaging).
   - Build with EAS (`--platform ios`); push has no effect on iOS without APNs
     configured.
4. The `expo-notifications` config plugin is already in
   `mobile/app.json` (notification color). A native rebuild is required
   after changing `app.json` or adding `google-services.json`.

Test on a physical device (or an Android emulator with Google Play services).
In a dev build, register/login, then trigger an event (e.g. a boarding) and
check the lock screen/tray with the app killed.

## Delivery Status

- **pending** — row created, delivery not attempted yet
- **sent** — provider accepted the message (FCM multicast, ≥ 1 success)
- **failed** — provider rejected it or no active device token exists
- **not_configured** — NoOp provider active (no Firebase env)

Retries are left to the next matching event; a worker-based retry loop is a
deliberate follow-up. `email_status` / `sms_status` remain `not_configured`.

## Notification Events

### Parent Notifications

- Child boarded
- Child dropped
- Trip started (boarding)
- Trip in progress
- Trip completed
- Trip cancelled
- Bus arrived at stop (100 m geofence, Task 22)

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
- **Location** — `web/src/features/emergencies/`: `helpers.ts` (policy + socket
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

## Configuration

```text
# Push (FCM, free) — empty = NoOp provider
FIREBASE_PROJECT_ID=
FIREBASE_SERVICE_ACCOUNT_JSON=

# Rate limit for device register/unregister
RATE_LIMIT_DEVICE_REGISTER_LIMIT=30
RATE_LIMIT_DEVICE_REGISTER_WINDOW_MS=60000
```

Email (`EMAIL_PROVIDER`) and SMS (`SMS_PROVIDER`) providers remain no-op
placeholders; web push is out of scope.

## Reliability

- Notifications are created AFTER the underlying operation succeeds
- Notification failures never break the operation
- Duplicate protection: same event never notifies the same parent twice
- Push failures are logged and swallowed; FCM invalid tokens are deactivated
- Logout never blocks on the unregister call (fire-and-forget, client side)
