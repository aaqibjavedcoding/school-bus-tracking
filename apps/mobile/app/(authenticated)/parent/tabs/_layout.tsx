import React from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { colors } from '@school-bus-tracking/design-tokens';

const icon = (emoji: string) => () => <Text style={styles.icon}>{emoji}</Text>;

export default function ParentTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary[700],
        tabBarInactiveTintColor: colors.neutral[500],
        tabBarStyle: styles.tabBar,
        headerStyle: { backgroundColor: colors.neutral[900] },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('🏠') }} />
      <Tabs.Screen name="tracking" options={{ title: 'Live bus', tabBarIcon: icon('🚌') }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts', tabBarIcon: icon('🔔') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontSize: 20,
  },
  tabBar: {
    borderTopColor: colors.neutral[200],
  },
});
