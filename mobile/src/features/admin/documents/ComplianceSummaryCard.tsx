import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  DocumentComplianceSummary,
  DocumentRequirementStatus,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { Badge, Card } from '../../../components';
import type { Tone } from '../../../lib/format';
import {
  complianceStateLabel,
  complianceStateTone,
  complianceSummaryLine,
  describeExpiry,
  sortRequirements,
} from './helpers';

/**
 * Compliance summary + requirement checklist (Task 44).
 *
 * Every state shown here is computed by the API from the real issue/expiry
 * dates against the school's own warning window; the screen has no control of
 * its own over validity. MISSING is listed only for document types the school
 * has marked required, so an optional blank is never reported as a problem.
 */

export const ComplianceSummaryCard: React.FC<{
  summary: DocumentComplianceSummary;
  requirements: DocumentRequirementStatus[];
  /** Collapses the checklist to the entries that need action. */
  issuesOnly?: boolean;
  title?: string;
}> = ({ summary, requirements, issuesOnly = false, title = 'Compliance' }) => {
  const sorted = sortRequirements(requirements);
  const shown = issuesOnly ? sorted.filter((item) => item.state !== 'VALID') : sorted;
  const clean = summary.is_compliant && summary.expiring_soon === 0;

  return (
    <Card
      title={title}
      description={`${summary.required_total} required document${
        summary.required_total === 1 ? '' : 's'
      } for this record.`}
    >
      <View style={styles.toneRow}>
        <Ionicons
          name={clean ? 'shield-checkmark' : 'warning'}
          size={18}
          color={clean ? colors.secondary[700] : colors.status.warning}
        />
        <Text style={styles.toneText}>{complianceSummaryLine(summary)}</Text>
      </View>

      <View style={styles.counts}>
        <Count label="Valid" value={summary.valid} tone="success" />
        <Count label="Expiring" value={summary.expiring_soon} tone="warning" />
        <Count label="Expired" value={summary.expired} tone="danger" />
        <Count label="Missing" value={summary.missing} tone="neutral" />
      </View>

      {shown.length === 0 ? (
        <Text style={styles.empty}>
          {issuesOnly ? 'Nothing needs attention right now.' : 'No documents configured.'}
        </Text>
      ) : (
        shown.map((item) => (
          <View key={item.document_type} style={styles.requirement}>
            <View style={styles.requirementTop}>
              <Text style={styles.requirementName}>{item.document_type_label}</Text>
              <Badge
                label={complianceStateLabel(item.state)}
                tone={complianceStateTone(item.state)}
              />
            </View>
            <Text style={styles.requirementMeta}>
              {item.is_required ? 'Required' : 'Optional'} ·{' '}
              {item.state === 'MISSING'
                ? 'No document on file'
                : describeExpiry(item.expiry_date, item.days_remaining)}
            </Text>
          </View>
        ))
      )}
    </Card>
  );
};

const Count: React.FC<{ label: string; value: number; tone: Tone }> = ({ label, value, tone }) => (
  <View style={styles.count}>
    <Badge label={`${value} ${label}`} tone={value > 0 ? tone : 'neutral'} />
  </View>
);

const styles = StyleSheet.create({
  toneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  toneText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[700],
  },
  counts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  count: { marginRight: spacing.xs },
  empty: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    paddingVertical: spacing.xs,
  },
  requirement: {
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
    paddingVertical: spacing.sm,
  },
  requirementTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  requirementName: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    fontWeight: '600',
    color: colors.neutral[900],
  },
  requirementMeta: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    marginTop: 2,
  },
});
