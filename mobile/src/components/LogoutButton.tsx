import React from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../features/auth';

/** Header sign-out button with a confirmation dialog. */
export const LogoutButton: React.FC = () => {
  const { logout } = useAuth();

  const confirm = () => {
    Alert.alert('Sign out', 'End your session on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <Pressable onPress={confirm} hitSlop={10} style={styles.button}>
      <Ionicons name="log-out-outline" size={22} color="#ffffff" />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing.sm,
  },
});

export const logoutButtonColors = colors.status.danger;
