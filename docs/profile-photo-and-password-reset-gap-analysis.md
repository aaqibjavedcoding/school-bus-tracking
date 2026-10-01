# Gap analysis — profile photos and mobile password reset

What was actually broken before this branch, why each piece was broken, and
what closed it. Written from the code as it stood at `main@65bb18a`, not
from the tickets.

---

## 1. Profile photos: a write-only feature

### 1.1 The API could store a photo and never hand it back

`PUT /api/v1/account/me/photo` and `DELETE /api/v1/account/me/photo`
existed and worked. Nothing read a photo back:

- the authenticated-user payload (`toAuthenticatedUser`) carried no
  `profile_photo_key`, so no client knew whether a photo existed;
- no route served the bytes — `/api/v1/crew-photos/{key}` was a URL the
  mobile parent screen had been written against and the server had never
  implemented;
- `account.service.ts` had no read path at all, only the two writes.

**Consequence.** Every surface that wanted to show a photo had to guess.
The web console showed initials forever. The parent app showed a grey
person icon forever. The crew card showed whatever _that one phone_ had
uploaded.

### 1.2 The mobile card remembered a path that rots

With no read-back, `features/crew/profile-photo-storage.ts` mirrored the
**raw camera capture URI** (`file:///…/cache/Camera/x.jpg`) in AsyncStorage
under a per-user key. Expo's cache directory is purgeable, so:

- the mirrored path could dangle while the entry still existed;
- a reinstall, a second device or a fresh login showed the placeholder even
  though the server held a photo;
- a photo set on phone A was invisible on phone B.

The card was honest about it (it never claimed a photo it could not show,
and "Remove Photo" stayed unconditional), but the feature was effectively
single-device.

### 1.3 The card was unreachable when it mattered

`ProfilePhotoCard` was rendered only by `app/(crew)/help.tsx`. Help is
reached from a link on the crew trip screen, and that link renders **after**
today's trip has loaded. So:

- on a day off, or before the morning dispatch, there was no path to it;
- in the first seconds after login, there was no path to it;
- `profile-photo-wiring.spec.ts` _asserted_ this arrangement — it required
  the card to be on Help and the crew layout to contain no `profile` route.
  The spec pinned the shipped state as if it were a requirement, which is
  why the gap survived review.

A school admin had no surface at all, even though the API's photo-owner
roles include `SCHOOL_ADMIN`.

### 1.4 The parent avatar could not have worked

`CrewAvatar` passed the authenticated URL to React Native's `<Image>`:

```tsx
<Image source={{ uri, headers: { Authorization: `Bearer ${token}` } }} />
```

Two problems. The route did not exist yet (§1.1), and even once it did,
RN's image pipeline does not reliably forward custom headers — on iOS the
native loader and its cache routinely drop them. The request would arrive
unauthenticated, collect the generic 404, and leave a permanent grey icon.
It also put a bearer token into an image cache key shared across accounts.

### 1.5 There was no `/account` page on the web

The console had no place to see or change your own photo, name, email,
role or school; `navItemsForRole()` and `canAccessPath()` had no entry for
one.

---

## 2. Mobile password reset: a flow that stopped at the browser

The web console has had self-service reset since Phase 2
(`POST /auth/forgot-password` → emailed token → `/reset-password`), scoped
to `SCHOOL_ADMIN` and hardened against enumeration: one byte-identical
response for every outcome, hashed tokens, a 30–60 minute TTL, single-use
rows, session revocation, and a stricter public rate limit.

The mobile app had **no entry point to it**. A school admin who ran the day
from their phone and forgot their password had to find a desktop. The
endpoint, the schema and the api-client method were all already there — the
only thing missing was a screen.

---

## 3. What closed each gap

| Gap                   | Fix                                                                                                                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1.1 read-back        | `GET /crew-photos/{key…}` + `GET /account/me/photo`, authenticated and tenant-pinned, generic 404 for every refusal, ETag from `profile_photo_updated_at`; `profile_photo_key` / `profile_photo_updated_at` added to the session payload; a partial index on `(school_id, profile_photo_key)` for the authorisation lookup |
| §1.2 rotting mirror   | AsyncStorage demoted to an **offline cache keyed by storage key** holding bytes, never a source of truth; the legacy per-user mirror is deleted on first run                                                                                                                                                               |
| §1.3 unreachable card | Its own route in the `(crew)` **and** `(admin)` navigators, opened from the header avatar on every screen; the crew tab bar still has exactly four labels; shared code moved to `src/features/profile`                                                                                                                     |
| §1.4 parent avatar    | Download-then-render through the shared API client, with `?v=<profile_photo_updated_at>`; no header is ever handed to `<Image>` (no signed-URL option exists — the deployment only has `LocalStorageProvider`)                                                                                                             |
| §1.5 no web page      | `/account` with the photo, a client pre-check mirroring the server's copy, and read-only identity; wired into `navItemsForRole()` + `canAccessPath()`; the sidebar chip shows the same photo and updates immediately after an upload                                                                                       |
| §2 mobile reset       | `app/forgot-password.tsx`, reusing the shared `forgotPasswordSchema` and the existing endpoint — no backend or api-client change. Request-link only; the emailed link opens the web reset page                                                                                                                             |

## 4. Decisions taken

1. **Photo owners** are `DRIVER`, `CONDUCTOR` and `SCHOOL_ADMIN`.
   `SUPER_ADMIN` has no `school_id` (so a tenant-pinned read cannot be
   expressed for them) and `PARENT` photos are not a product requirement.
2. **Mobile reset scope** is the request screen only. The emailed link
   opens the web console's reset page, so no `reset-password.tsx`, no App
   Links and no associated domains.
3. **"Forgot password?" is visible to everyone** on the email sign-in path,
   with an explicit "school administrators only" note telling crew and
   parents to ask their school office. Per-role hiding is impossible before
   sign-in, and a hidden link is its own hint.

See `docs/security.md` for the full control table on the photo route and
the mobile-specific notes on the reset flow, and `docs/mobile-ux.md`
("The read-back gap — closed") for the mobile surface.
