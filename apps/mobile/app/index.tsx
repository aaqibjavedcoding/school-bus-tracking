import React from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../src/auth/auth-context';
import { homeRouteForUser } from '../src/auth/role-routing';

/**
 * The root index never *renders* — it routes:
 * loading → splash, anonymous → login, authenticated → the role home.
 * The role comes from the verified session, and each `(authenticated)`
 * sub-layout re-checks it, so a deep link to another role's area is bounced.
 */
export default function Index() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.splash}>
        <Text style={styles.mark}>SBT</Text>
        <ActivityIndicator color={colors.primary[500]} />
        <Text style={styles.caption}>School Bus Tracking</Text>
      </View>
    );
  }

  if (status === 'anonymous') {
    return <Redirect href="/login" />;
  }

  const home = homeRouteForUser(user);
  return <Redirect href={home ?? '/login'} />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral[900],
    gap: spacing.md,
  },
  mark: {
    fontSize: 34,
    fontWeight: '900',
    color: colors.primary[500],
    letterSpacing: 2,
  },
  caption: {
    color: colors.neutral[300],
    fontSize: 14,
  },
});
