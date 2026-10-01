import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../../src/features/auth';
import { ProfilePhotoCard } from '../../src/features/profile';
import { Screen } from '../../src/components';

/**
 * "My Profile" for the school admin.
 *
 * The API lets a school admin own a profile photo exactly like a driver or
 * a conductor ([DECISION 1]), but the mobile console had no surface for it —
 * an admin could see crew photos and never set their own. This is that
 * surface, and it is deliberately the *same* card: one component, one state
 * machine, one set of rules, mounted in two navigators. That is why the
 * feature moved from `features/crew` to `features/profile`.
 *
 * Reached from the avatar in the header of every admin screen (hidden from
 * the tab bar with `href: null`, like the other pushed admin routes), so it
 * is available with no trip running and straight after login.
 *
 * Identity is read-only here too: an admin edits accounts in the Manage hub,
 * never through their own profile screen.
 */
export default function AdminProfileScreen() {
  const { user } = useAuth();

  return (
    <Screen>
      {user ? (
        <View style={styles.identity}>
          <Text style={styles.name}>{`${user.first_name} ${user.last_name}`.trim()}</Text>
          <Text style={styles.role}>{user.email}</Text>
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
