import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../../src/auth/auth-context';
import { Button } from '../../src/components/Button';
import { StatusBadge } from '../../src/components/StatusBadge';

/**
 * SUPER_ADMIN has no mobile workflow by design: the platform console is a web
 * surface, and mobile must not invent a second admin product. The session is
 * real (verified JWT) — this screen just says so and offers sign-out.
 */
export default function PlatformUnsupportedScreen() {
  const { user, logout } = useAuth();
  return (
    <View style={styles.wrap}>
      <StatusBadge tone="info" label="PLATFORM ACCOUNT" />
      <Text style={styles.title}>This account signs in on the web</Text>
      <Text style={styles.body}>
        Platform administration (school provisioning, cross-tenant operations) is only available on
        the School Bus Tracking web console. Your school users — admins, drivers, conductors and
        parents — get the full mobile experience.
      </Text>
      <Text style={styles.email}>{user?.email ?? ''}</Text>
      <Button
        label="Sign out"
        variant="secondary"
        onPress={() => void logout()}
        style={styles.signOut}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: '#ffffff',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  body: {
    fontSize: 14,
    color: colors.neutral[600],
    lineHeight: 21,
  },
  email: {
    fontSize: 13,
    color: colors.neutral[500],
  },
  signOut: {
    alignSelf: 'stretch',
  },
});
