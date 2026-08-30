import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@school-bus-tracking/design-tokens';
import { RoleGate } from '../../src/features/auth';
import { LogoutButton } from '../../src/components/LogoutButton';

/**
 * School-admin mobile experience — the mobile slice of the web console's
 * sidebar: today's operations board (live trips), the full trip schedule,
 * the student directory, fleet (buses + routes), staff (drivers +
 * conductors) and operations (assignments + dispatch).
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
          title: "Today's operations",
          tabBarLabel: 'Today',
          tabBarIcon: ({ color, size }) => <Ionicons name="today" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Trip schedule',
          tabBarLabel: 'Trips',
          tabBarIcon: ({ color, size }) => <Ionicons name="bus" size={size} color={color} />,
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
        name="fleet"
        options={{
          title: 'Fleet — buses & routes',
          tabBarLabel: 'Fleet',
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="staff"
        options={{
          title: 'Drivers & conductors',
          tabBarLabel: 'Staff',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
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
      {/*
        Detail route pushed from Today/Trips (`/trips/:id`). Declared with
        `href: null` so expo-router does NOT auto-add it to the tab bar — a
        visible `trips/[id]` tab navigates without an id and the API answers
        "uuid is expected". Hidden routes remain pushable programmatically.
      */}
      <Tabs.Screen name="trips/[id]" options={{ title: 'Trip', href: null }} />
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
