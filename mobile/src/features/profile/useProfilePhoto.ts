import { useEffect, useState } from 'react';
import { apiClient } from '../../services/api';
import { loadCachedPhoto, saveCachedPhoto } from './profile-photo-storage.ts';
import { photoDataUri, resolvePhoto } from './profile-photo-source.ts';

/**
 * The bytes behind one profile photo, fetched from the server and cached on
 * the device.
 *
 * Why not simply hand the URL to `<Image source={{ uri }}>`: the photo route
 * is **authenticated**, and an `Authorization` header passed through
 * `<Image source>` is unreliable on iOS and ignored by parts of the image
 * cache (that is exactly what left the parent screen showing a grey icon).
 * So the bytes are fetched with the shared API client — which attaches the
 * bearer token and handles a 401 refresh — turned into a data URI, and
 * rendered from memory. No new native dependency is involved, which the
 * SDK 57 lockstep rule (`docs/mobile-expo-sdk.md`) requires.
 *
 * Offline behaviour: a cached copy (keyed by storage key) paints first and a
 * failed fetch leaves it on screen. A key the cache does not know shows the
 * placeholder rather than another account's face.
 *
 * `null` means "show the fallback" for every reason — no key, still
 * fetching, a network failure, or the server's generic 404. The API
 * deliberately does not say which, so neither does this.
 */
export function useProfilePhoto(
  storageKey: string | null | undefined,
  version?: string | null,
): string | null {
  const key = storageKey?.trim() || null;
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setUri(null);
      return;
    }

    let cancelled = false;
    setUri(null);

    void (async () => {
      // 1. Whatever this device already has for *this* key, immediately.
      const cached = await loadCachedPhoto(key);
      if (cancelled) return;
      const fromCache = resolvePhoto({
        storageKey: key,
        cachedForKey: cached ? { key, uri: cached } : null,
      });
      if (fromCache.kind !== 'none') setUri(fromCache.uri);

      // 2. The server, which is the source of truth.
      try {
        const blob = await apiClient.fetchProfilePhoto(key, version ?? null);
        if (cancelled) return;
        if (!blob) {
          // A generic 404: the photo is gone (or was never ours to see).
          setUri(null);
          return;
        }
        const dataUri = await blobToDataUri(blob);
        if (cancelled || !dataUri) return;
        setUri(dataUri);
        void saveCachedPhoto(key, dataUri);
      } catch {
        // Offline or a transient failure: keep whatever the cache gave us.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, version]);

  return uri;
}

/**
 * Reads image bytes into a data URI.
 *
 * `FileReader` is part of React Native's standard runtime (no dependency),
 * and `readAsDataURL` already produces exactly the `data:image/…;base64,…`
 * form `<Image>` renders. The content type is re-derived from the blob so a
 * PNG never claims to be a JPEG.
 */
async function blobToDataUri(blob: Blob): Promise<string | null> {
  if (typeof FileReader === 'undefined') return null;
  const base64 = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : null;
      resolve(result ? (result.split(',')[1] ?? null) : null);
    };
    reader.readAsDataURL(blob);
  });
  return base64 ? photoDataUri(base64, blob.type || 'image/jpeg') : null;
}
