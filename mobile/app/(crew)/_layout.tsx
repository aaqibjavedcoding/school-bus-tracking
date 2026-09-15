import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { flushPendingRoute } from '../../src/features/notifications';
import { Ionicons } from '@expo/vector-icons';
import { UserRole } from '@school-bus-tracking/shared-types';
import { colors } from '@school-bus-tracking/design-tokens';
import { RoleGate, useAuth } from '../../src/features/auth';
import { LogoutButton } from '../../src/components/LogoutButton';
import { crewRoleLabel } from '../../src/lib/roles';
import { useBottomBarMetrics } from '../../src/theme/layout';
import { startSyncManager, stopSyncManager } from '../../src/features/crew/offline';
import { FeedbackProvider } from '../../src/features/crew/FeedbackProvider';
import { useRoleLocaleDefault, useTranslation } from '../../src/lib/i18n-provider';

/**
 * Shared crew tab navigator (DRIVER + CONDUCTOR).
 *
 * One architecture for both roles: today's trip (status, GPS, ETA),
 * the student manifest (board/drop) and the route stops with live ETA.
 * The API scopes every request to the caller's own trips, so the screens
 * never need to know which crew role is signed in beyond a label.
 *
 * Task 44 splits the *experience* without duplicating the plumbing:
 * the driver's Trip tab leads with navigation and GPS sharing, the
 * conductor's leads with the manifest, and both keep a dedicated
 * Emergency tab for the SOS panel.
 */
function CrewTabs() {
  const { user } = useAuth();
  const bar = useBottomBarMetrics();
  // Subscribes this navigator to the locale so tab labels re-read on a switch,
  // and applies the crew default (Hindi) once the signed-in role is known.
  const t = useTranslation();
  useRoleLocaleDefault(user?.role ?? null);
  // A notification tapped before this navigator existed (cold start) lands
  // on its screen as soon as the role tabs are mounted.
  useEffect(() => {
    flushPendingRoute();
  }, []);
  const isDriver = user?.role === UserRole.DRIVER;

  // Offline queue replay lives for exactly as long as a crew member is signed
  // in: it is bound to this user's id so another account on the same phone
  // never submits their pending actions.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    startSyncManager(userId);
    return () => stopSyncManager();
  }, [userId]);

  return (
    <Tabs
      safeAreaInsets={{ bottom: 0 }}
      // Keep back-navigation inside the tab history: with the default
      // `firstRoute` behaviour, back from any tab returns to the first tab.
      backBehavior="history"
      screenOptions={{
        headerStyle: { backgroundColor: colors.neutral[900] },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: 'bold' },
        tabBarActiveTintColor: colors.primary[700],
        tabBarInactiveTintColor: colors.neutral[500],
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
          title: user
            ? t('nav.trip.title', { role: crewRoleLabel(user.role) })
            : t('nav.trip.titleFallback'),
          tabBarLabel: isDriver ? t('nav.tab.drive') : t('nav.tab.trip'),
          tabBarIcon: ({ color }) => <Ionicons name="bus" size={bar.iconSize} color={color} />,
        }}
      />
      <Tabs.Screen
        name="manifest"
        options={{
          // Conductors own the children on board; the driver sees the same
          // list but the emphasis in the trip screen is the other way round.
          title: isDriver ? t('nav.manifest.titleDriver') : t('nav.manifest.titleConductor'),
          tabBarLabel: isDriver ? t('nav.tab.manifest') : t('nav.tab.students'),
          tabBarIcon: ({ color }) => <Ionicons name="people" size={bar.iconSize} color={color} />,
        }}
      />
      <Tabs.Screen
        name="stops"
        options={{
          title: t('nav.stops.title'),
          tabBarLabel: t('nav.tab.stops'),
          tabBarIcon: ({ color }) => <Ionicons name="location" size={bar.iconSize} color={color} />,
        }}
      />
      {/**
       * Emergency (Task 44). A parent-free, always-present tab: both crew
       * roles raise an SOS from here, the backend records it and pushes it to
       * the school admin's live dashboards over the self-hosted Socket.IO
       * gateway — no paid SMS/WhatsApp gateway involved.
       */}
      <Tabs.Screen
        name="sos"
        options={{
          title: t('nav.sos.title'),
          tabBarLabel: t('nav.tab.sos'),
          tabBarIcon: ({ color }) => <Ionicons name="warning" size={bar.iconSize} color={color} />,
        }}
      />
      {/**
       * Phase 2: Help/Support — hidden from the tab bar (`href: null`), the
       * bar stays four crew actions; the screen is reached from the trip
       * screen ("Help & support") and hosts the moved GPS telemetry.
       */}
      <Tabs.Screen
        name="help"
        options={{
          title: t('nav.help.title'),
          href: null,
        }}
      />
    </Tabs>
  );
}

export default function CrewLayout() {
  return (
    <RoleGate group="crew">
      <CrewFeedback>
        <CrewTabs />
      </CrewFeedback>
    </RoleGate>
  );
}

/**
 * Phase 3b: voice + haptics for the crew group.
 *
 * Mounted here rather than at the app root so the role is already known —
 * the default ("crew = voice on") is a role decision, exactly like the
 * Hindi locale default, and a saved preference still wins over both.
 * Admin/parent groups never mount it, so their dispatcher keeps the quiet
 * office default with nothing to configure.
 */
function CrewFeedback({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <FeedbackProvider role={user?.role ?? null}>{children}</FeedbackProvider>;
}
