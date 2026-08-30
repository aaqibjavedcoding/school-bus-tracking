import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@school-bus-tracking/design-tokens';
import { RoleGate } from '../../src/features/auth';
import { LogoutButton } from '../../src/components/LogoutButton';

/**
 * School-admin mobile experience — full feature parity with the web console.
 *
 * Five primary tabs cover the daily workflow: the operations dashboard, the
 * trip schedule, live tracking, attendance, and a "Manage" hub that opens
 * the complete CRUD surfaces (students, buses, routes & stops, drivers &
 * conductors, guardians and assignments). Detail/management routes are hidden
 * from the tab bar with `href: null` and pushed programmatically.
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
        tabBarStyle: { paddingTop: 4, height: 60, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerRight: () => <LogoutButton />,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          tabBarLabel: 'Trips',
          tabBarIcon: ({ color, size }) => <Ionicons name="bus" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tracking"
        options={{
          title: 'Live tracking',
          tabBarLabel: 'Tracking',
          tabBarIcon: ({ color, size }) => <Ionicons name="location" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          tabBarLabel: 'Attendance',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkbox" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="manage"
        options={{
          title: 'Manage',
          tabBarLabel: 'Manage',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />

      {/* Hidden, programmatically-pushed routes (kept out of the tab bar). */}
      <Tabs.Screen name="trips/[id]" options={{ title: 'Trip', href: null }} />
      <Tabs.Screen name="manage/students" options={{ title: 'Students', href: null }} />
      <Tabs.Screen name="manage/students/[id]" options={{ title: 'Student', href: null }} />
      <Tabs.Screen name="manage/buses" options={{ title: 'Buses', href: null }} />
      <Tabs.Screen name="manage/routes" options={{ title: 'Routes', href: null }} />
      <Tabs.Screen name="manage/routes/[id]" options={{ title: 'Route stops', href: null }} />
      <Tabs.Screen name="manage/staff" options={{ title: 'Drivers & conductors', href: null }} />
      <Tabs.Screen name="manage/assignments" options={{ title: 'Assignments', href: null }} />
      <Tabs.Screen name="manage/guardians" options={{ title: 'Guardians', href: null }} />
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
