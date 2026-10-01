import React, { useCallback } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../auth';
import { useProfilePhoto } from './useProfilePhoto.ts';

/**
 * The header entry point to "My Profile" — the account's own photo, next to
 * the sign-out button, on every screen of a role's navigator.
 *
 * ### Why the header and not a tab
 *
 * The card used to be reachable only from Help, which a crew member reaches
 * from the trip screen — and the trip screen's link only renders once
 * today's trip has loaded. On a day off, before the first dispatch, or in
 * the first seconds after login there was simply no path to it. A header
 * action is present on every screen of the group from the moment the
 * navigator mounts, so the photo is always two taps away, and the crew tab
 * bar still carries exactly the four driving actions it was designed around
 * (`profile-photo-wiring.spec.ts`).
 *
 * The button shows the photo itself once it is loaded, which doubles as the
 * confirmation that an upload worked — it changes as soon as the session
 * carries the new key.
 */
export const ProfileHeaderButton: React.FC<{
  /** Route of the group's profile screen (crew and admin have their own). */
  href: string;
  /** Spoken label — localised by the caller where the group has a dictionary. */
  accessibilityLabel: string;
}> = ({ href, accessibilityLabel }) => {
  const router = useRouter();
  const { user } = useAuth();
  const photoUri = useProfilePhoto(user?.profile_photo_key, user?.profile_photo_updated_at);

  const open = useCallback(() => {
    router.push(href as never);
  }, [href, router]);

  return (
    <Pressable
      onPress={open}
      hitSlop={10}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={styles.photo} accessibilityIgnoresInvertColors />
      ) : (
        <View style={styles.placeholder}>
          <Ionicons name="person" size={16} color="#ffffff" />
        </View>
      )}
    </Pressable>
  );
};

const AVATAR = 28;

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing.sm,
  },
  photo: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 1,
    borderColor: colors.neutral[400],
  },
  placeholder: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral[700],
    borderWidth: 1,
    borderColor: colors.neutral[500],
  },
});
