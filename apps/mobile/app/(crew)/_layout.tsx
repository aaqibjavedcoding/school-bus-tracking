import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@school-bus-tracking/design-tokens';
import { RoleGate, useAuth } from '../../src/features/auth';
import { LogoutButton } from '../../src/components/LogoutButton';
import { crewRoleLabel } from '../../src/lib/roles';
import { useBottomBarMetrics } from '../../src/theme/layout';

/**
 * Shared crew tab navigator (DRIVER + CONDUCTOR).
 *
 * One architecture for both roles: today's trip (status, GPS, ETA),
 * the student manifest (board/drop) and the route stops with live ETA.
 * The API scopes every request to the caller's own trips, so the screens
 * never need to know which crew role is signed in beyond a label.
 */
function CrewTabs() {
  const { user } = useAuth();
  const bar = useBottomBarMetrics();

  return (
    <Tabs
      safeAreaInsets={{ bottom: 0 }}
      screenOptions={{
        headerStyle: { backgroundColor: colors.neutral[900] },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: 'bold' },
        tabBarActiveTintColor: colors.primary[600],
        tabBarInactiveTintColor: colors.neutral[400],
        // Safe-area aware bar: never overlaps the device navigation area.
        tabBarStyle: {
          height: bar.tabBarHeight,
          paddingTop: bar.tabBarPaddingTop,
          paddingBottom: bar.tabBarPaddingBottom,
          borderTopColor: colors.neutral[200],
        },
        tabBarItemStyle: { paddingVertical: 0 },
        tabBarLabelStyle: { fontSize: bar.labelFontSize, fontWeight: '600', marginBottom: 0 },
        tabBarHideOnKeyboard: true,
        headerRight: () => <LogoutButton />,
      }}
    >
      <Tabs.Screen
        name="trip"
        options={{
          title: user ? `${crewRoleLabel(user.role)} · Today` : "Today's trip",
          tabBarLabel: 'Trip',
          tabBarIcon: ({ color }) => <Ionicons name="bus" size={bar.iconSize} color={color} />,
        }}
      />
      <Tabs.Screen
        name="manifest"
        options={{
          title: 'Student manifest',
          tabBarLabel: 'Manifest',
          tabBarIcon: ({ color }) => <Ionicons name="people" size={bar.iconSize} color={color} />,
        }}
      />
      <Tabs.Screen
        name="stops"
        options={{
          title: 'Stops & ETA',
          tabBarLabel: 'Stops',
          tabBarIcon: ({ color }) => <Ionicons name="location" size={bar.iconSize} color={color} />,
        }}
      />
    </Tabs>
  );
}

export default function CrewLayout() {
  return (
    <RoleGate group="crew">
      <CrewTabs />
    </RoleGate>
  );
}
