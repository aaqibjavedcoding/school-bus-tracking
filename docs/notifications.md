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
- Emergency notifications: `emergency:school:<schoolId>`

## Configuration

No external configuration needed for in-app notifications.

For future external providers:

```
PUSH_PROVIDER=noop|firebase|apns
EMAIL_PROVIDER=noop|sendgrid|ses
SMS_PROVIDER=noop|twilio
```
