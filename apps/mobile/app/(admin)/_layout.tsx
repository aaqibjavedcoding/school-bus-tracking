import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@school-bus-tracking/design-tokens';
import { RoleGate } from '../../src/features/auth';
import { LogoutButton } from '../../src/components/LogoutButton';
import { useBottomBarMetrics } from '../../src/theme/layout';

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
  const bar = useBottomBarMetrics();

  return (
    <Tabs
      safeAreaInsets={{ bottom: 0 }}
      // Detail routes (trips/[id], manage/students/[id], …) live inside this
      // tab navigator as hidden routes pushed from the list screens. The
      // bottom-tab default `backBehavior` is `firstRoute`, so `router.back()`
      // from a detail route jumps to the *first* tab (Dashboard). `history`
      // makes back return to the screen actually visited before — the list the
      // user opened the detail from.
      backBehavior="history"
      screenOptions={{
        headerStyle: { backgroundColor: colors.neutral[900] },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: 'bold' },
        tabBarActiveTintColor: colors.primary[600],
        tabBarInactiveTintColor: colors.neutral[400],
        // Height + padding derive from the live safe-area insets so the bar
        // never sits under the Android nav bar / iOS home indicator, on any
        // screen size or orientation.
        tabBarStyle: {
          height: bar.tabBarHeight,
          paddingTop: bar.tabBarPaddingTop,
          paddingBottom: bar.tabBarPaddingBottom,
          borderTopColor: colors.neutral[200],
        },
        tabBarItemStyle: { paddingVertical: 0 },
        tabBarLabelStyle: {
          fontSize: bar.labelFontSize,
          fontWeight: '600',
          marginBottom: 0,
        },
        tabBarHideOnKeyboard: true,
        headerRight: () => <LogoutButton />,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ color }) => <Ionicons name="grid" size={bar.iconSize} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          tabBarLabel: 'Trips',
          tabBarIcon: ({ color }) => <Ionicons name="bus" size={bar.iconSize} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tracking"
        options={{
          title: 'Live tracking',
          tabBarLabel: 'Tracking',
          tabBarIcon: ({ color }) => <Ionicons name="location" size={bar.iconSize} color={color} />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          tabBarLabel: 'Attendance',
          tabBarIcon: ({ color }) => (
            <Ionicons name="checkbox" size={bar.iconSize} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="manage"
        options={{
          title: 'Manage',
          tabBarLabel: 'Manage',
          tabBarIcon: ({ color }) => <Ionicons name="settings" size={bar.iconSize} color={color} />,
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

      {/* Task 44 — compliance documents: overview, per-owner records and the
          required/optional configuration, all pushed from the Manage hub. */}
      <Tabs.Screen name="manage/documents" options={{ title: 'Documents', href: null }} />
      <Tabs.Screen
        name="manage/documents/requirements"
        options={{ title: 'Document requirements', href: null }}
      />
      <Tabs.Screen
        name="manage/documents/bus/[id]"
        options={{ title: 'Bus documents', href: null }}
      />
      <Tabs.Screen
        name="manage/documents/driver/[id]"
        options={{ title: 'Driver documents', href: null }}
      />

      {/* Task 44 — the school's end of the crew SOS feed. */}
      <Tabs.Screen name="emergencies" options={{ title: 'Emergencies', href: null }} />
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
