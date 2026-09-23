# 04 — Client Feature Brief (what you are actually selling)

> **Media lives outside this repository.** The finished MP4s, narration MP3s, scene plates and
> cover thumbnails are kept in the standalone *KidBus marketing pack* (git-ignored by design: they
> are ~90 MB of binaries). Paths such as `videos/`, `videos/9x16/`, `social/srt/`, `social/thumbs/`,
> `assets/ai/` and `tools/` in this folder refer to that pack. This folder is the source of truth for
> the *text*: scripts, prompts, captions and the client brief. Nothing here affects the product build.

One page to paste into a proposal, or to read out on a sales call. Every line is verified against the
shipped product in the `school-bus-tracking` repository — nothing here is roadmap, everything is
live.

**Product:** KidBus · **Company:** ZeroMileSystems.com · **Contact:** zeromilesystems@gmail.com

**One-line pitch:** *KidBus makes every school journey visible — to the parent, the driver, the
conductor and the school office — from the first boarding in the morning to the last drop at the gate.*

---

## The problem KidBus removes

| Who | Today | The cost |
| --- | --- | --- |
| Parent | Calls the school to ask where the bus is | Anxiety, 40 calls a day to the office |
| School office | Answers those calls, maintains paper registers | Wasted staff time, no audit trail, disputes it cannot win |
| Driver / conductor | Paper list, no way to signal a problem | Boarding errors, emergencies handled by phone trees |
| Principal / owner | No single view of the fleet, documents expire unnoticed | Compliance risk, reputational risk, no data to improve operations |

---

## What the platform does — by persona

### 1. For parents (mobile app)
- **Live bus location** on a real map, with the bus moving in real time and the direction it is heading.
- **ETA for every remaining stop**, recalculated from the bus's actual speed — not a fixed timetable.
- **Boarding and drop alerts**: a push notification the moment the conductor marks their child on or off.
- **"Stop is next" alert** fired automatically when the bus enters the stop's geofence.
- **Notification centre** with an unread badge, so nothing is missed even while the phone was locked.
- **Privacy by design**: a parent sees only their own children, their own bus, their own stop.

### 2. For school admins (web console + mobile app)
- **One live map** for the entire fleet: every active trip, every bus, right now.
- **Trip cockpit**: start boarding → depart → complete, with stop arrivals and manifest on one screen.
- **Fleet & network**: buses (registration, capacity, model, status), routes, ordered stops with
  geofence radius, shifts and runs — including a **conflict engine** that refuses to put one driver,
  one bus or one crew on two overlapping runs.
- **People & rosters**: students with class/section and assigned stop, guardians with pickup
  authorisation, drivers and conductors with their own document sets.
- **Attendance you can defend**: every boarding and drop is a timestamped record, with per-trip
  summaries (total / pending / boarded / dropped).
- **Compliance**: bus documents (RC, insurance, fitness, permit, pollution) and staff documents
  (licence, medical, police verification, training) with **status derived from the expiry date** —
  valid / expiring soon (30 days) / expired — plus a school-wide compliance overview.
- **Emergencies**: an SOS from the road raises an alarm on **every admin screen, with sound**, carries
  the bus, trip and live location, and moves through open → acknowledged → resolved with a full trail.
- **Import / export / reports**: bulk import from Excel with a **validation dry run before anything is
  written** (up to 5,000 rows, all-or-nothing transaction), export of any dataset to `.xlsx` / `.csv`,
  and **15 built-in reports** (by route, by bus, by stop, unassigned students, bus utilisation, crew
  load, deadhead runs, and more) — each exportable with exactly the filters shown on screen.
- **Subscriptions**: students / buses / routes / staff / trips are all counted against the school's
  plan, so a school only pays for what it uses and can upgrade in place.

### 3. For drivers and conductors (mobile app)
- **The app speaks and buzzes** — built for a phone on a cradle in a loud bus, where nobody is reading
  the screen. A confirmed tap arrives on four channels at once: the row flashes green, the text
  updates, the screen reader announces it, and the phone *says it and vibrates*. Real lines:
  *"Ramesh ka boarding ho gaya, 7:42 subah"*, *"Priya utar gayi, 3:10 dopahar"*,
  *"Trip shuru, dhyan se chalaiye"*, *"Emergency alert school ko chala gaya"*.
- **Fully Hindi UI** — the whole crew app is localised (Hindi/English dictionary with 314 keys,
  language switch in settings), not just a few labels. Voice lines use Hinglish in Latin script on
  purpose, so they work on budget Android phones that have no Hindi TTS voice installed.
- A **two-tap trip flow** ("Start boarding" → "Depart & drive") that also starts GPS sharing — no
  separate step to remember.
- **Manifest ordered by stop**, so the conductor knows exactly who is next and where.
- **One-tap board / drop** per child, working even on a slow connection (idempotent — a double tap
  can never create a double record).
- **SOS** with six emergency types (accident, breakdown, medical, student incident, security, other).
- GPS keeps running with the app in the background and stops automatically when the trip ends or the
  user signs out — the driver never has to think about it.

### 4. For the operator / platform owner (super admin console)
- Onboard a school **and its first admin in one action**; suspend or reactivate a tenant without
  deleting anything.
- Define subscription **plans** (monthly/yearly, price, feature flags, limits), assign, extend or
  cancel per school; a **revenue dashboard** with plan distribution and subscription health.
- **Audit log** of privileged actions, plus an assisted "manage data" session inside a tenant when a
  school needs hand-holding.
- Real aggregate KPIs (schools, users, subscription status) with dependency-free charts.

---

## Technical facts a school's IT reviewer will ask about

| Question | Answer |
| --- | --- |
| Where is the data hosted? | Your own server / private deployment — Docker Compose + PostgreSQL 16 + PostGIS. Not a third-party SaaS in the middle. |
| Is one school's data reachable from another? | No. Every tenant row is bound to a `school_id` and composite foreign keys make cross-school references impossible at database level. Tenant is taken from the signed token, never from user input. |
| Who can see a live bus? | Only users with a verified relationship to that specific trip; the server authorises every map subscription and rejects the rest. |
| How is location tracked? | Socket.IO realtime with a validated GPS contract; malformed or stale fixes are dropped, never queued or invented. |
| What if the network drops? | Trip actions are idempotent and retried; a boarding can never be double-counted, and a delivery failure can never roll back a boarding or an SOS. |
| Maps licence | OpenStreetMap data via open-source MapLibre — no per-view billing, no vendor lock-in. |
| Reporting | Business columns only; medical notes are excluded from exports and audit payloads by design. |
| Mobile | One app, four role experiences (Expo / React Native), Android + iOS; push via FCM. |
| Third-party running cost | Essentially zero beyond hosting: no paid map SDK, no paid push, no paid gateway in the current phase. |

---

## Suggested pilot structure (use this on the sales call)

| Week | What happens | Success measure |
| --- | --- | --- |
| 0 | Import the school's students, buses, routes and staff from its existing Excel | Import completes with zero errors |
| 1 | Crew training (drivers + conductors), 30 minutes, one route | 5 clean trips completed |
| 2 | Parents onboarded on the app (one route, one bell window) | 60 %+ parents active |
| 3 | Live on all routes; office stops taking "where is the bus?" calls | Call volume to the office measurably down |
| 4 | Review the reports (attendance, bus utilisation, crew load) | School renews, or extends to more routes |

**Commercial shape:** per-school subscription, priced on `buses × routes × months`, with plan limits
enforced by the platform. Free 30-day pilot with a written feedback commitment, then an annual plan.
Contact **zeromilesystems@gmail.com** to start.

---

## Objection handling (short answers for the call)

- **"Our teachers already manage it on WhatsApp."** — WhatsApp cannot prove a child boarded, cannot
  raise a timed alarm, and cannot produce a report the school can hand to an inspector. KidBus does all
  three from the same tap.
- **"Parents will not install an app."** — They install the school's app to know when to leave the
  house. The alert that matters ("your stop is next") arrives as a normal push notification, and the
  in-app centre keeps a history.
- **"Drivers will not use anything new."** — The whole crew flow is two taps and one button. GPS
  sharing starts by itself when the driver starts the trip; there is nothing extra to remember.
- **"What if the GPS fails?"** — Boarding and drop records need no GPS at all. Tracking degrades
  gracefully and simply resumes when fixes return; nothing is fabricated.
- **"We already have CCTV."** — CCTV answers "what happened inside". KidBus answers "where is the bus
  right now, who is on it, and what did the school do about it" — live, with an audit trail.
