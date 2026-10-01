'use client';

import { useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import { hasProfilePhoto } from './profile-photo';

/**
 * The signed-in user's own photo, as an object URL.
 *
 * A browser `<img src>` cannot carry an `Authorization` header, and the
 * access token lives in memory only (`services/session.ts`) — so the bytes
 * are fetched through the API client (bearer attached, 401 refresh handled)
 * and turned into an object URL that is revoked on every change. There is no
 * localStorage copy anywhere: the **server** is the source of truth, which is
 * what makes the photo survive a sign-out, a different browser and a
 * different device.
 *
 * The fetch is keyed on `profile_photo_key` + `profile_photo_updated_at`, so
 * an upload that updates the session payload re-fetches immediately (that is
 * the "nothing changes after I upload" symptom, fixed), and a replaced photo
 * can never be served from a cache.
 *
 * `null` covers every "nothing to show" case identically — no key, still
 * loading, or the server's generic 404 — and the caller renders initials.
 */
export function useProfilePhoto(user: AuthenticatedUser | null): string | null {
  const key = user?.profile_photo_key ?? null;
  const version = user?.profile_photo_updated_at ?? null;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hasProfilePhoto({ profile_photo_key: key })) {
      setObjectUrl(null);
      return;
    }

    let cancelled = false;
    let created: string | null = null;

    void (async () => {
      try {
        const blob = await apiClient.fetchProfilePhoto(key, version);
        if (cancelled || !blob) {
          if (!cancelled) setObjectUrl(null);
          return;
        }
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        // An avatar is never worth an error banner: fall back to initials.
        if (!cancelled) setObjectUrl(null);
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [key, version]);

  return objectUrl;
}
