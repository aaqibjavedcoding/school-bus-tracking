import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { UserRole } from '@school-bus-tracking/shared-types';
import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../src/features/auth';
import { Button, EmptyState, LoadingView } from '../src/components';

/**
 * Landing screen for the platform SUPER_ADMIN.
 *
 * The platform console (multi-tenant school lifecycle, per-school admins,
 * subscriptions) is deliberately not rebuilt on mobile — that is a
 * desktop workflow. This screen says so honestly and offers sign-out.
 */
export default function PlatformScreen() {
  const { status, user, logout } = useAuth();

  if (status === 'loading') {
    return <LoadingView />;
  }
  if (status !== 'authenticated' || !user || user.role !== UserRole.SUPER_ADMIN) {
    return <Redirect href="/login" />;
  }

  return (
    <View style={styles.container}>
      <EmptyState
        title="Platform console is on the web"
        description={`Signed in as ${user.first_name} ${user.last_name} (platform admin). Multi-school management, tenant lifecycle and admin accounts are desktop workflows — open the web console to continue there.`}
      />
      <Button
        label="Sign out"
        variant="secondary"
        onPress={() => void logout()}
        style={styles.button}
      />
      <Text style={styles.note}>School admins, crew and parents get the full app here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.neutral[50],
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.md,
  },
  button: {
    minWidth: 200,
  },
  note: {
    textAlign: 'center',
    color: colors.neutral[500],
    fontSize: typography.fontSizes.xs,
  },
});
