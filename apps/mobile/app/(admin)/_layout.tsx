import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@school-bus-tracking/design-tokens';
import { RoleGate } from '../../src/features/auth';
import { LogoutButton } from '../../src/components/LogoutButton';

/**
 * School-admin mobile experience — deliberately mobile-first, not a copy of
 * the web console: today's operations board (trips + live status), a pocket
 * student directory, and dispatch/operations (assignments, fleet, routes).
 * Full CRUD management stays on the web.
 */
function AdminTabs() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.neutral[900] },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: 'bold' },
        tabBarActiveTintColor: colors.primary[600],
        tabBarInactiveTintColor: colors.neutral[400],
        headerRight: () => <LogoutButton />,
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarLabel: 'Today',
          tabBarIcon: ({ color, size }) => <Ionicons name="today" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: 'Students',
          tabBarLabel: 'Students',
          tabBarIcon: ({ color, size }) => <Ionicons name="school" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="operations"
        options={{
          title: 'Operations',
          tabBarLabel: 'Operations',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

export default function AdminLayout() {
  return (
    <RoleGate group="admin">
      <AdminTabs />
    </RoleGate>
  );
}
