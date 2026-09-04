import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  DocumentOwnerType,
  DocumentRequirement,
  DocumentRequirementsUpdateRequest,
} from '@school-bus-tracking/shared-types';
import {
  MAX_DOCUMENT_WARNING_DAYS,
  MIN_DOCUMENT_WARNING_DAYS,
  documentRequirementsUpdateSchema,
} from '@school-bus-tracking/validation';
import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../../src/services/api';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../src/lib/errors';
import { useLoad } from '../../../../src/hooks/useLoad';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  LoadingView,
  Screen,
  SegmentedControl,
  SwitchRow,
  useToast,
} from '../../../../src/components';

/**
 * Required-vs-optional document configuration (Task 44).
 *
 * Schools differ: some treat a medical certificate as mandatory, others only
 * ask for the driving licence. This screen is where that decision lives, per
 * owner type, along with the lead time used for the "expiring soon" flag.
 *
 * Types a school never touches keep the built-in catalogue default — the API
 * stores overrides only, so a default that improves later is inherited
 * automatically. The whole configuration is saved as one atomic PUT.
 */

type OwnerTab = Extract<DocumentOwnerType, 'BUS' | 'DRIVER'>;

const OWNER_TABS = [
  { value: 'BUS' as OwnerTab, label: 'Buses' },
  { value: 'DRIVER' as OwnerTab, label: 'Drivers' },
];

/** Local editable copy of one requirement row. */
interface Row extends DocumentRequirement {
  warningDays: string;
}

export default function DocumentRequirementsScreen() {
  const toast = useToast();
  const [ownerType, setOwnerType] = useState<OwnerTab>('BUS');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useLoad(async () => {
    const data = unwrapEnvelope(await apiClient.getDocumentRequirements({ owner_type: ownerType }));
    return data.items;
  }, [ownerType]);

  // Seed the editable copy whenever the server config (or the tab) changes.
  useEffect(() => {
    setRows(
      (load.data ?? []).map((item) => ({ ...item, warningDays: String(item.expiry_warning_days) })),
    );
  }, [load.data]);

  const patch = (documentType: string, next: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.document_type === documentType ? { ...row, ...next } : row)),
    );

  const save = async () => {
    const payload: DocumentRequirementsUpdateRequest = {
      owner_type: ownerType,
      items: rows.map((row) => ({
        document_type: row.document_type,
        is_required: row.is_required,
        expiry_warning_days: Number(row.warningDays),
      })),
    };
    const parsed = documentRequirementsUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid configuration';
      setError(message);
      toast.push(message, 'danger');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = unwrapEnvelope(await apiClient.updateDocumentRequirements(parsed.data));
      setRows(saved.items.map((item) => ({ ...item, warningDays: String(item.expiry_warning_days) })));
      toast.push('Requirements saved.', 'success');
      await load.reload();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (load.loading && !load.data) {
    return <LoadingView label="Loading requirements…" />;
  }
  if (load.error && rows.length === 0) {
    return (
      <Screen>
        <ErrorState message={load.error} onRetry={() => void load.reload()} />
      </Screen>
    );
  }

  return (
    <Screen refresh={() => void load.reload()} refreshing={load.loading}>
      <SegmentedControl<OwnerTab> value={ownerType} onChange={setOwnerType} options={OWNER_TABS} />

      <Card
        title={ownerType === 'BUS' ? 'Bus documents' : 'Driver documents'}
        description="Switch a document on to make it required; set the lead time used for the “expiring soon” warning."
      >
        {rows.map((row) => (
          <View key={row.document_type} style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowName}>{row.document_type_label}</Text>
              {row.is_customized ? <Badge label="Customised" tone="info" /> : <Badge label="Default" tone="neutral" />}
            </View>

            <SwitchRow
              label="Required"
              value={row.is_required}
              onChange={(value) => patch(row.document_type, { is_required: value })}
            />

            <Field
              label={`Warn before expiry (days)`}
              value={row.warningDays}
              onChangeText={(text) => patch(row.document_type, { warningDays: text })}
              keyboardType="number-pad"
              hint={`Between ${MIN_DOCUMENT_WARNING_DAYS} and ${MAX_DOCUMENT_WARNING_DAYS} days.`}
              style={styles.daysInput}
            />
          </View>
        ))}
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="Save requirements" onPress={() => void save()} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
    paddingVertical: spacing.sm,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  rowName: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  daysInput: { marginTop: spacing.xs },
  error: {
    color: colors.status.danger,
    fontSize: typography.fontSizes.sm,
    marginBottom: spacing.sm,
  },
});
