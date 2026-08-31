import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type {
  DocumentComplianceSummary,
  DocumentOverviewItem,
  DocumentOwnerType,
} from '@school-bus-tracking/shared-types';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../src/services/api';
import { unwrapEnvelope } from '../../../src/lib/errors';
import { usePagedResource } from '../../../src/hooks/usePagedResource';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FilterSummary,
  ListCard,
  LoadingView,
  Pagination,
  Screen,
  SearchBar,
  SegmentedControl,
} from '../../../src/components';
import { documentOwnerRoute } from '../../../src/features/admin/documents/helpers';

/**
 * School-wide compliance overview (Task 44).
 *
 * Every bus and every driver in one list with the counts the API derived from
 * the real expiry dates, so the office can see at a glance which vehicle or
 * crew member has something missing, expiring or already expired. Tapping a row
 * opens that owner's documents, where the record can be added or corrected.
 *
 * Nothing here can set a status — the badges are computed server-side from the
 * dates and the school's own warning window.
 */

type OwnerFilter = 'ALL' | DocumentOwnerType;
type ComplianceFilter = 'all' | 'attention';

const OWNER_OPTIONS = [
  { value: 'ALL' as OwnerFilter, label: 'All' },
  { value: 'BUS' as OwnerFilter, label: 'Buses' },
  { value: 'DRIVER' as OwnerFilter, label: 'Drivers' },
];

const COMPLIANCE_OPTIONS = [
  { value: 'all' as ComplianceFilter, label: 'All' },
  { value: 'attention' as ComplianceFilter, label: 'Needs attention' },
];

export default function ManageDocumentsScreen() {
  const [owner, setOwner] = useState<OwnerFilter>('ALL');
  const [compliance, setCompliance] = useState<ComplianceFilter>('all');
  /**
   * School-wide totals. The overview returns them alongside the page, so they
   * are lifted out of the loader: they describe the whole school, not the
   * visible rows.
   */
  const [aggregate, setAggregate] = useState<DocumentComplianceSummary | null>(null);

  const list = usePagedResource<DocumentOverviewItem>(
    async (page, search) => {
      const data = unwrapEnvelope(
        await apiClient.getDocumentOverview({
          page,
          limit: 20,
          search: search || undefined,
          owner_type: owner === 'ALL' ? undefined : owner,
          compliance: compliance === 'attention' ? 'attention' : undefined,
        }),
      );
      setAggregate(data.summary);
      return { items: data.items, meta: data.meta };
    },
    [owner, compliance],
  );

  const filtersActive = Boolean(list.activeSearch) || owner !== 'ALL' || compliance !== 'all';
  const resetFilters = () => {
    list.clearSearch();
    setOwner('ALL');
    setCompliance('all');
  };

  return (
    <Screen refresh={() => void list.reload()} refreshing={list.loading}>
      <SegmentedControl<OwnerFilter> value={owner} onChange={setOwner} options={OWNER_OPTIONS} />
      <SegmentedControl<ComplianceFilter>
        value={compliance}
        onChange={setCompliance}
        options={COMPLIANCE_OPTIONS}
      />

      <SearchBar
        value={list.search}
        onChangeText={list.setSearch}
        onClear={list.clearSearch}
        searching={list.searching}
        placeholder="Search bus or driver…"
      />

      {filtersActive ? (
        <FilterSummary
          label={[
            list.activeSearch ? `“${list.activeSearch}”` : null,
            owner !== 'ALL' ? (owner === 'BUS' ? 'Buses' : 'Drivers') : null,
            compliance === 'attention' ? 'Needs attention' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          onClear={resetFilters}
        />
      ) : null}

      {list.loading && list.items.length === 0 ? (
        <LoadingView label="Loading compliance…" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={filtersActive ? 'No matches' : 'Nothing to track yet'}
          description={
            filtersActive
              ? 'No bus or driver matches the current filters.'
              : 'Add buses and drivers first — their documents are tracked here.'
          }
          action={
            filtersActive ? (
              <Button label="Clear filters" variant="secondary" onPress={resetFilters} />
            ) : null
          }
        />
      ) : (
        <>
          <Card title="School compliance" description="Totals across every bus and driver.">
            <SummaryRow summary={aggregate} />
            <Text style={styles.count}>
              {filtersActive
                ? `${list.items.length} of ${list.meta.total} records`
                : `${list.meta.total} records`}
            </Text>
          </Card>

          {list.items.map((item) => (
            <ListCard
              key={`${item.owner_type}-${item.owner_id}`}
              title={item.owner_label}
              subtitle={
                item.issues.length > 0
                  ? item.issues
                      .slice(0, 3)
                      .map(
                        (issue) =>
                          `${issue.document_type_label}${
                            issue.state === 'MISSING'
                              ? ' · missing'
                              : issue.state === 'EXPIRED'
                                ? ' · expired'
                                : ' · expiring soon'
                          }`,
                      )
                      .join('\n')
                  : null
              }
              meta={ownerTypeLabelOf(item.owner_type)}
              right={
                <Badge
                  label={item.summary.is_compliant ? 'Compliant' : 'Action needed'}
                  tone={item.summary.is_compliant ? 'success' : 'danger'}
                />
              }
              onPress={() => router.push(documentOwnerRoute(item.owner_type, item.owner_id))}
            />
          ))}
          <Pagination meta={list.meta} onPage={list.setPage} />
        </>
      )}

      <Button
        label="Document requirements"
        variant="secondary"
        onPress={() => router.push('/manage/documents/requirements')}
        style={styles.requirements}
      />
    </Screen>
  );
}

function ownerTypeLabelOf(ownerType: DocumentOwnerType): string {
  return ownerType === 'BUS' ? 'Bus' : 'Driver';
}

const SummaryRow: React.FC<{ summary: DocumentComplianceSummary | null }> = ({ summary }) => {
  if (!summary) return null;
  return (
    <View style={styles.badges}>
      <Badge label={`${summary.valid} valid`} tone="success" />
      <Badge label={`${summary.expiring_soon} expiring`} tone="warning" />
      <Badge label={`${summary.expired} expired`} tone="danger" />
      <Badge label={`${summary.missing} missing`} tone="neutral" />
    </View>
  );
};

const styles = StyleSheet.create({
  count: {
    color: colors.neutral[500],
    fontSize: 12,
    marginTop: spacing.sm,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  requirements: { marginBottom: spacing.xl },
});
