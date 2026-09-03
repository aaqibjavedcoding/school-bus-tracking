# Mobile Operations

## Overview

This document describes mobile-specific operational features for drivers, conductors, and admins.

## Mobile vs Web Scope

| Capability                                                                                                  | Mobile | Web |
| ----------------------------------------------------------------------------------------------------------- | :----: | :-: |
| Crew trip lifecycle, manifest board/drop, GPS sharing                                                       |   ✅   | ✅  |
| Parent live tracking, ETA, notifications                                                                    |   ✅   | ✅  |
| School-admin dashboard, trips, live tracking, attendance, emergencies                                       |   ✅   | ✅  |
| School-admin CRUD: students, buses, routes & stops, drivers & conductors, guardians, assignments, documents |   ✅   | ✅  |
| Bulk Excel import / export and import-job history                                                           |   ❌   | ✅  |
| Reports                                                                                                     |   ❌   | ✅  |
| `SUPER_ADMIN` platform console                                                                              |   ❌   | ✅  |

Mobile admin CRUD lives under the `(admin)/manage` route group and calls the same
API endpoints and shared Zod schemas as the web console. Bulk import/export and
reporting are deliberately web-only back-office workflows
(see `docs/import-export-reports.md`).

## Offline Attendance

### Problem

When a driver/conductor loses internet during a trip, boarding/drop operations must not silently disappear.

### Solution

A durable local queue stores attendance events when offline:

- Each queued operation has: local event ID, idempotency key, captured timestamp, student ID, trip ID, event type
- States: pending → syncing → success/failed
- When network returns: retry with exponential backoff
- 409 conflicts (already boarded/dropped) treated as success
- Queue persists across app restarts

### Important

Attendance and GPS are different systems. The offline queue only handles attendance events, never replays GPS data.

## Background GPS

### Location Task

- Uses expo-location for foreground/background location tracking
- Fixes are validated client-side with the same Zod schema as the API
- Fixes are never queued or replayed (honesty about network state)
- Active trip ID persisted for headless background task

### GPS States

- **GPS sharing active**: Location is being sent to server
- **GPS permission missing**: User needs to grant permission
- **Location services disabled**: Device location is off
- **Network disconnected**: No internet connection
- **Socket disconnected**: WebSocket not connected
- **Last successful location time**: When the server last received a fix

### GPS Permission Recovery

Handles:
- Permission denied (can request again)
- Permission permanently denied (must go to settings)
- Location services disabled (must go to settings)
- Background permission unavailable
- Battery optimization issues

Provides:
- Clear explanation
- Retry/recheck button
- Settings link where supported
- Current GPS status
- Last successful update time

## Session / Network UX

### Handled Scenarios

- Expired access token → automatic refresh attempt
- Refresh failure → redirect to login
- Logout → clear local state
- Network unavailable → show offline indicator
- Reconnect → resume operations
- 401 → session expired message
- 403 → access denied message
- 409 → conflict message (already boarded/dropped)
- 429 → rate limited message
- 500 → server error message

### Critical Attendance Actions

For Driver/Conductor, attendance actions survive temporary network errors:
- Queued locally when offline
- Synced when network returns
- User sees sync state (pending count)
- Never silently lost

## List / Search / Pagination

All major management screens support:
- Server-side search
- Debouncing (300ms)
- Pagination (page-based)
- Pull-to-refresh
- Loading state
- Empty state
- Error state with retry
- FlatList/virtualization
- Stable keys
- No unnecessary full-list rerender
