import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@school-bus-tracking/design-tokens';
import { RoleGate } from '../../src/features/auth';
import { useParentNotifications } from '../../src/features/parent/NotificationsProvider';
import { LogoutButton } from '../../src/components/LogoutButton';
import { Banner } from '../../src/components';
import { notificationTypeLabel } from '../../src/features/parent/notifications-state';
import { useBottomBarMetrics } from '../../src/theme/layout';

/**
 * Parent tab navigator: dashboard/children, live bus tracking and the
 * notification centre. The alerts tab carries the live unread badge fed by
 * the `/notifications` socket, and the newest push surfaces as a dismissable
 * banner above the tabs.
 */
function ParentTabs() {
  const { state, latestEvent, dismissLatest } = useParentNotifications();
  const unread = state.unreadCount;
  const bar = useBottomBarMetrics();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.flex}>
      {latestEvent ? (
        <View style={[styles.bannerWrap, { paddingTop: insets.top + 8 }]}>
          <Banner
            tone="info"
            message={`${notificationTypeLabel(latestEvent.type)} — ${latestEvent.message}`}
            onClose={dismissLatest}
          />
        </View>
      ) : null}
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
          name="home"
          options={{
            title: 'My children',
            tabBarLabel: 'Home',
            tabBarIcon: ({ color }) => <Ionicons name="home" size={bar.iconSize} color={color} />,
          }}
        />
        <Tabs.Screen
          name="tracking"
          options={{
            title: 'Track the bus',
            tabBarLabel: 'Track',
            tabBarIcon: ({ color }) => <Ionicons name="map" size={bar.iconSize} color={color} />,
          }}
        />
        <Tabs.Screen
          name="notifications"
          options={{
            title: 'Notifications',
            tabBarLabel: 'Alerts',
            tabBarBadge: unread > 0 ? Math.min(unread, 99) : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.status.danger },
            tabBarIcon: ({ color }) => (
              <Ionicons name="notifications" size={bar.iconSize} color={color} />
            ),
          }}
        />
        {/*
          Detail route pushed from the home screen (`/children/:id`). It must
          be declared with `href: null` so expo-router does NOT auto-add it to
          the tab bar — a visible `children/[id]` tab navigates without an id,
          hits the children *list* endpoint and crashes the detail screen.
        */}
        <Tabs.Screen name="children/[id]" options={{ title: 'Child', href: null }} />
      </Tabs>
    </View>
  );
}

export default function ParentLayout() {
  return (
    <RoleGate group="parent">
      <ParentTabs />
    </RoleGate>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  bannerWrap: {
    backgroundColor: colors.neutral[900],
    paddingHorizontal: 12,
    paddingTop: 8,
  },
});
