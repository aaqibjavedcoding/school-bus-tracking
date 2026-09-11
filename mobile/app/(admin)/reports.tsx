import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ReportDescriptor, ReportOverviewResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { formatDateTime } from '../../src/lib/format';
import { REPORT_CATEGORY_LABELS, REPORT_CATEGORY_ORDER } from '../../src/lib/reports';
import { useLoad } from '../../src/hooks/useLoad';
import { EmptyState, ErrorState, LoadingView, Screen, SectionTitle } from '../../src/components';
import { StatGrid } from '../../src/features/admin/reports';

/**
 * Reports landing page — mobile twin of the web console's Reports page.
 *
 * Two things, deliberately: the numbers a head teacher wants without tapping
 * anything, and a directory of the reports that answer the follow-up
 * questions. Every figure comes from a live query — no cached or seeded data.
 * Spreadsheet export of a report stays on the web console (same filters); the
 * app focuses on reading the numbers.
 */
export default function AdminReportsScreen() {
  const router = useRouter();
  const overview = useLoad(async () => unwrapEnvelope(await apiClient.getReportOverview()), []);
  const catalogue = useLoad(async () => unwrapEnvelope(await apiClient.listReports()).items, []);

  const reloadAll = () => {
    void overview.reload();
    void catalogue.reload();
  };
  const refreshAll = () => {
    void overview.refresh();
    void catalogue.refresh();
  };

  const grouped = (catalogue.data ?? []).reduce<Record<string, ReportDescriptor[]>>(
    (accumulator, report) => {
      const list = accumulator[report.category] ?? [];
      list.push(report);
      accumulator[report.category] = list;
      return accumulator;
    },
    {},
  );

  if ((overview.loading || catalogue.loading) && !overview.data && !catalogue.data) {
    return <LoadingView label="Loading reports…" />;
  }

  return (
    <Screen refresh={refreshAll} refreshing={overview.refreshing || catalogue.refreshing}>
      <SectionTitle>Reports</SectionTitle>
      <Text style={styles.intro}>
        Live figures from your school's data. Tap a report to filter it and read the full table.
      </Text>

      {overview.error ? (
        <ErrorState message={overview.error} onRetry={() => void overview.reload()} />
      ) : overview.data ? (
        <OverviewSections data={overview.data} />
      ) : null}

      {catalogue.error ? (
        <ErrorState message={catalogue.error} onRetry={() => void catalogue.reload()} />
      ) : catalogue.data ? (
        catalogue.data.length === 0 ? (
          <EmptyState title="No reports available" description="The catalogue is empty." />
        ) : (
          REPORT_CATEGORY_ORDER.filter((category) => (grouped[category] ?? []).length > 0).map(
            (category) => (
              <View key={category} style={styles.category}>
                <Text style={styles.categoryTitle}>{REPORT_CATEGORY_LABELS[category]}</Text>
                {(grouped[category] ?? []).map((report) => (
                  <Pressable
                    key={report.report}
                    onPress={() => router.push(`/reports/${report.report}` as never)}
                    style={({ pressed }) => [styles.reportRow, pressed ? styles.pressed : null]}
                    accessibilityRole="button"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reportLabel}>{report.label}</Text>
                      <Text style={styles.reportDescription}>{report.description}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.neutral[300]} />
                  </Pressable>
                ))}
              </View>
            ),
          )
        )
      ) : null}

      {overview.error && catalogue.error ? (
        <View style={{ marginTop: spacing.sm }}>
          <ErrorState message="Could not load the reports area." onRetry={reloadAll} />
        </View>
      ) : null}
    </Screen>
  );
}

const OverviewSections: React.FC<{ data: ReportOverviewResponse }> = ({ data }) => (
  <>
    <Text style={styles.sectionTitle}>Students</Text>
    <StatGrid cards={data.students} />
    <Text style={styles.sectionTitle}>Transport</Text>
    <StatGrid cards={data.transport} />
    <Text style={styles.sectionTitle}>Operations (last 30 days)</Text>
    <StatGrid cards={data.operations} />
    <Text style={styles.sectionTitle}>Compliance</Text>
    <StatGrid cards={data.compliance} />
    <Text style={styles.generated}>Generated {formatDateTime(data.generated_at)}</Text>
  </>
);

const styles = StyleSheet.create({
  intro: {
    color: colors.neutral[500],
    fontSize: typography.fontSizes.sm,
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[800],
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  generated: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[400],
    marginTop: spacing.sm,
  },
  category: {
    marginTop: spacing.lg,
  },
  categoryTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[800],
    marginBottom: spacing.sm,
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  reportLabel: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  reportDescription: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: 2,
  },
});
