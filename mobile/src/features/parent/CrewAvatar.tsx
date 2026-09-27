import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ParentCrewSummary } from '@school-bus-tracking/shared-types';
import { colors } from '@school-bus-tracking/design-tokens';
import { API_BASE_URL } from '../../services/api';
import { getAccessToken } from '../../services/session';
import { crewAvatarPresentation } from './crew-photo';

/**
 * A crew member's profile photo next to their name, with the neutral
 * fallback icon whenever no photo has been set — the usual state until crew
 * members upload one. The resolution itself is a pure function in
 * `./crew-photo` covered by the unit spec; this component only translates it
 * into an `<Image>` (or the icon) and attaches the bearer token the
 * authenticated photo route will require.
 */
export const CrewAvatar: React.FC<{
  crew: Pick<ParentCrewSummary, 'profile_photo_key'> | null | undefined;
  size?: number;
}> = ({ crew, size = 36 }) => {
  const presentation = crewAvatarPresentation(crew, API_BASE_URL);

  if (presentation.kind === 'photo') {
    const token = getAccessToken();
    return (
      <Image
        source={{
          uri: presentation.uri,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        }}
        accessibilityLabel="Crew member profile photo"
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
