import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../../src/features/auth';
import { ProfilePhotoCard } from '../../src/features/profile';
import { Screen } from '../../src/components';
import { useTranslation } from '../../src/lib/i18n-provider';
import { crewRoleLabel } from '../../src/lib/roles';

/**
 * "My Profile" for the crew (DRIVER + CONDUCTOR).
 *
 * **Why this screen exists.** The photo card used to live only on Help, and
 * Help is reached from a link the trip screen renders *after* today's trip
 * has loaded — so on a day off, before the first dispatch, or in the first
 * seconds after signing in, there was no way to reach it at all. The card
 * now has its own route, opened by the avatar in the header of every crew
 * screen, so it is reachable with no active trip and immediately after
 * login. The tab bar is untouched: this route is hidden (`href: null`) and
 * the four driving actions stay exactly as they were.
 *
 * Nothing was deleted: the card is the same component (now shared with the
 * admin app, hence `features/profile`), and Help keeps the GPS telemetry,
 * the language switch and the sound settings.
 *
 * Identity is shown read-only and carries **no new copy**: the name comes
 * from the session and the role from the existing `role.*` strings. Crew
 * accounts are created by the school, and this screen must not become a
 * second way to edit them.
 */
export default function CrewProfileScreen() {
  const { user } = useAuth();
  // Subscribes the screen to the locale so the role line re-reads on a switch.
  useTranslation();

  return (
    <Screen>
      {user ? (
        <View style={styles.identity}>
          <Text style={styles.name}>{`${user.first_name} ${user.last_name}`.trim()}</Text>
          <Text style={styles.role}>{crewRoleLabel(user.role)}</Text>
        </View>
      ) : null}
      <ProfilePhotoCard />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  role: {
    fontSize: 15,
    color: colors.neutral[600],
    marginTop: 2,
  },
});
