import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ParentCrewSummary } from '@school-bus-tracking/shared-types';
import { colors } from '@school-bus-tracking/design-tokens';
import { API_BASE_URL } from '../../services/api';
import { useProfilePhoto } from '../profile';
import { crewAvatarPresentation } from './crew-photo';

/**
 * A crew member's profile photo next to their name, with the neutral
 * fallback icon whenever there is nothing to show.
 *
 * ### What was broken
 *
 * This component used to pass the authenticated photo URL straight to
 * `<Image source={{ uri, headers: { Authorization } }}>`. React Native's
 * image pipeline does not reliably forward custom headers — on iOS the
 * native loader and its cache routinely drop them — so the request reached
 * the API without a bearer token, the API answered with its generic 404
 * (never a 403, by design), and the parent saw a blank avatar forever. The
 * token also went through a cache key that is shared across accounts, which
 * is not somewhere a credential belongs.
 *
 * ### The fix
 *
 * Download, then render. The bytes come through the shared API client — one
 * place that owns the bearer token and the single-flight 401 refresh — and
 * are rendered from memory as a data URI (`useProfilePhoto`). No signed-URL
 * path exists to use instead: the only storage provider in the deployment is
 * `LocalStorageProvider`, which has no `getSignedUrl`, so the authenticated
 * download is the whole mechanism. No new dependency is involved.
 *
 * The request carries `?v=<profile_photo_updated_at>`, so a replaced photo
 * is a new address and no cache can hold the previous face. Every failure —
 * no key, no token, a cross-tenant key, a deleted photo — lands on the same
 * neutral icon, because the API deliberately does not say which it was.
 */
export const CrewAvatar: React.FC<{
  crew:
    Pick<ParentCrewSummary, 'profile_photo_key' | 'profile_photo_updated_at'> | null | undefined;
  size?: number;
}> = ({ crew, size = 36 }) => {
  const presentation = crewAvatarPresentation(crew, API_BASE_URL);
  const photoUri = useProfilePhoto(
    presentation.kind === 'photo' ? presentation.key : null,
    presentation.kind === 'photo' ? presentation.version : null,
  );

  if (photoUri) {
    return (
      <Image
        source={{ uri: photoUri }}
        accessibilityLabel="Crew member profile photo"
        accessibilityIgnoresInvertColors
        style={[styles.photo, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }

  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Ionicons name="person" size={Math.round(size * 0.6)} color={colors.neutral[500]} />
    </View>
  );
};

const styles = StyleSheet.create({
  photo: {
    backgroundColor: colors.neutral[100],
  },
  fallback: {
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
