# FIX PROMPT (paste into a new session) — Trip scheduled for "today" lands on "yesterday"; driver can't see it

## Context (repo: aaqibjavedcoding/school-bus-tracking, monorepo)
- `web/` — Next.js admin/parent console + NestJS-style API server (`web/src/server/...`).
- `mobile/` — Expo React Native app (school admin / driver / conductor / parent).
- Trips are stored as **UTC instants** (`trips.scheduled_start_at`); every "today" bucket on server is computed in `schools.timezone` via `web/src/server/common/timezone.ts` (`startOfDateInTimeZone`, `dateOnlyInTimeZone`, `buildDayRange` in `web/src/server/modules/trips/trips.service.ts`).

## Field report (what happened)
Admin scheduled a trip on **2 Oct** for 2 Oct (morning trip), but the app shows it as **1 Oct**, and the **driver's "today" screen shows nothing**. Scheduling any trip "for today" is coming out as the previous day.

## Root cause already located (verify, don't re-hunt)
The day a trip belongs to is decided by **`schools.timezone`**, but the create-trip form interprets the picked date/time in the **device** timezone. When the school row's timezone is wrong, every trip slides a day:

1. `schools.timezone` is wrong in the live DB. Two ways it went wrong:
   - Provisioning default was **`'UTC'`** when no timezone was passed — `web/src/server/modules/schools/schools.service.ts` (`params.timezone?.trim() || 'UTC'`), and the Super-Admin "New school" form defaulted to `'UTC'` (`web/src/app/(authenticated)/admin/schools/new/page.tsx`).
   - The demo seed tenant uses **`'America/Chicago'`** (`web/src/server/database/seeders/20260827120800-demo-core-domain-data.ts:119`) — consistent with its fictitious US school, but fatal when an Indian school runs on it or on a copy.
2. With `school.timezone = America/Chicago` and staff in IST, a trip picked as `2 Oct 07:30` IST (`2026-10-02T02:00Z`) buckets to school-local **1 Oct** (21:30 Chicago) — "shows as yesterday". Once the Chicago clock rolls to 2 Oct (10:30 IST), the driver's `GET /trips?date=<school-today>` (mobile `useCrewToday` → `schoolDateOnly(user.school_timezone)`) asks for **2 Oct**, so the trip that sits in the 1 Oct bucket **disappears from the driver's screen**. Reproduced with the repo's own helpers; with `Asia/Kolkata` everything lines up.
3. Second-order hazard: the form converted wall time with `new Date(value)` = **device** timezone (`fromDateTimeLocalValue`). Any device whose clock isn't the school's (misconfigured laptop, admin travelling) reproduces the same bug even on a correctly configured school.
4. Silent fallback: an invalid timezone string persisted on the school silently degraded all trip day-math to UTC (`schoolTimeZone()` catch → `'UTC'`).

## Fix applied in branch (verify + keep green)
1. **School-aware wall-time conversion (web + mobile)** — new `web/src/lib/school-datetime.ts` (`fromSchoolDateTimeLocalValue`, `toSchoolDateTimeLocalValue`, guess-and-refine offset via `Intl`, device fallback) mirrored in `mobile/src/lib/datetime.ts` (+ `shiftDateTimeLocalValue` pure wall-clock arithmetic). Wired into both schedule forms: `web/src/app/(authenticated)/trips/page.tsx`, `mobile/app/(admin)/trips.tsx`, quick actions in `mobile/src/components/DateTimeField.tsx` (new `timeZone` prop, school-clock "Now", school-clock calendar "today"). When device tz == school tz, byte-identical behaviour — only out-of-timezone devices are corrected.
2. **Timezone defaults for an India-focused deployment** — provisioning fallback `'UTC'` → `'Asia/Kolkata'` (`schools.service.ts`), New-school form default `'UTC'` → `'Asia/Kolkata'`, hint text updated.
3. **Invalid IANA names rejected at write time** — `isValidIanaTimeZone` in `web/src/server/common/timezone.ts`; enforced in `SchoolsService.provisionSchool` and `AdminSchoolsService.update` with `SCHOOL_TIMEZONE_INVALID_MESSAGE` ("Please enter a valid IANA timezone, for example Asia/Kolkata") — no more silent UTC degradation.
4. **Tests** — `web/src/lib/school-datetime.spec.ts` (added to `test:web` list in `web/package.json`), mobile `datetime-local.spec.ts` extended (Kolkata same-day invariant, Chicago DST offsets, round-trips, fallbacks, midnight rollover). Verified green: web `test:web` 588/588, mobile suite 1560/1560, server trips/schools/admin/auth suites 150/150, `tsc --noEmit` (web + server + mobile), eslint clean.

## Still TODO in the live environment (code cannot fix stored data)
1. **Set the live school's timezone** to its real IANA value (India ⇒ `Asia/Kolkata`): Super Admin → Schools → open the school → Edit profile → Timezone → save; or SQL: `UPDATE schools SET timezone='Asia/Kolkata' WHERE code='<school-code>';`
2. Trips already created keep correct instants if staff picked times on IST devices — they re-bucket into the right day as soon as step 1 lands, and drivers see them. Only trips created on out-of-timezone devices need their `scheduled_start_at` re-saved.
3. Redeploy API + web + publish the mobile build, then schedule one trip for "today" and confirm it shows under today for admin **and** driver.
