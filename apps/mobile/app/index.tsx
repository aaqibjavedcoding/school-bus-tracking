import React from 'react';
import { StyleSheet, View, Text, ScrollView, SafeAreaView } from 'react-native';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { Card } from '../src/components/Card';
import { StatusBadge } from '../src/components/StatusBadge';
import { APP_CONFIG } from '@school-bus-tracking/config';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Hero Section */}
        <View style={styles.hero}>
          <View style={styles.badgeRow}>
            <StatusBadge status="operational" label="Mobile Ready" />
            <Text style={styles.version}>v{APP_CONFIG.version}</Text>
          </View>
          <Text style={styles.heroTitle}>School Bus Tracking</Text>
          <Text style={styles.heroSubtitle}>
            Unified mobile application for Drivers, Conductors, and Parents.
          </Text>
        </View>

        {/* Personas Section */}
        <Text style={styles.sectionTitle}>Supported Personas</Text>

        <Card
          title="Driver Portal"
          description="GPS telemetry broadcast, route navigation, and stop check-ins."
        >
          <StatusBadge status="ready" label="Architecture Ready (Phase 2)" />
        </Card>

        <Card
          title="Conductor Portal"
          description="Student roster scanning, boarding confirmation, and attendance tracking."
        >
          <StatusBadge status="ready" label="Architecture Ready (Phase 2)" />
        </Card>

        <Card
          title="Parent Portal"
          description="Real-time map tracking, ETA notifications, and child boarding alerts."
        >
          <StatusBadge status="ready" label="Architecture Ready (Phase 2)" />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  container: {
    padding: spacing.md,
  },
  hero: {
    backgroundColor: colors.neutral[900],
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderLeftWidth: 5,
    borderLeftColor: colors.primary[500],
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  version: {
    fontSize: 12,
    color: colors.neutral[400],
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: spacing.xs,
  },
  heroSubtitle: {
    fontSize: 14,
    color: colors.neutral[300],
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[900],
    marginBottom: spacing.md,
  },
});
