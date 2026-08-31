import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  DocumentStatus,
  type BusDocumentCreateRequest,
  type BusDocumentResponse,
  type BusDocumentUpdateRequest,
  type DocumentComplianceResponse,
  type DocumentListQuery,
  type DocumentOwnerType,
  type DriverDocumentCreateRequest,
  type DriverDocumentResponse,
  type DriverDocumentUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../services/api';
import { getApiErrorMessage, fieldErrorsFromUnknown, unwrapEnvelope } from '../../../lib/errors';
import { useLoad } from '../../../hooks/useLoad';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Fab,
  LoadingView,
  Screen,
  useToast,
} from '../../../components';
import { ComplianceSummaryCard } from './ComplianceSummaryCard';
import { DocumentFormSheet } from './DocumentFormSheet';
import {
  EMPTY_DOCUMENT_FORM,
  buildDocumentRequest,
  toFormValues,
  type DocumentFormValues,
} from './documentForm';
import { describeExpiry, documentStatusLabel, documentStatusTone, ownerTypeLabel } from './helpers';

/**
 * Compliance documents of one bus or one driver (Task 44).
 *
 * One implementation behind both routes (`/manage/documents/bus/:id` and
 * `/manage/documents/driver/:id`) because the two resources carry identical
 * fields and only differ in their document catalogue — the same reasoning the
 * API uses for its two controllers.
 *
 * The screen never lets an operator set a status: validity is derived by the
 * API from the real expiry date, so what is shown here is what the dates say.
 */

type AnyDocument = BusDocumentResponse | DriverDocumentResponse;

export interface DocumentOwnerScreenProps {
  ownerType: DocumentOwnerType;
  ownerId: string;
}

export const DocumentOwnerScreen: React.FC<DocumentOwnerScreenProps> = ({ ownerType, ownerId }) => {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AnyDocument | null>(null);
  const [form, setForm] = useState<DocumentFormValues>(EMPTY_DOCUMENT_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AnyDocument | null>(null);

  const isBus = ownerType === 'BUS';
  const noun = ownerTypeLabel(ownerType).toLowerCase();

  const load = useCallback(async () => {
    const query: DocumentListQuery = { page: 1, limit: 100 };
    const [documents, compliance] = await Promise.all([
      isBus
        ? unwrapEnvelope(await apiClient.listBusDocuments(ownerId, query))
        : unwrapEnvelope(await apiClient.listDriverDocuments(ownerId, query)),
      isBus
        ? unwrapEnvelope(await apiClient.getBusDocumentCompliance(ownerId))
        : unwrapEnvelope(await apiClient.getDriverDocumentCompliance(ownerId)),
    ]);
    return {
      documents: documents.items as AnyDocument[],
      compliance: compliance as DocumentComplianceResponse,
    };
  }, [isBus, ownerId]);

  const { data, loading, error, reload } = useLoad(load, [load]);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_DOCUMENT_FORM);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (document: AnyDocument) => {
    setEditing(document);
    setForm(toFormValues(document));
    setFieldErrors({});
    setOpen(true);
  };

  const submit = async () => {
    if (!form.document_type) {
      setFieldErrors({ document_type: 'Choose a document type.' });
      return;
    }
    const built = buildDocumentRequest(ownerType, form, Boolean(editing));
    if (!built.ok) {
      setFieldErrors(built.errors);
      return;
    }
    setBusy(true);
    try {
      if (isBus) {
        const body = built.body as BusDocumentCreateRequest | BusDocumentUpdateRequest;
        if (editing) {
          unwrapEnvelope(await apiClient.updateBusDocument(ownerId, editing.id, body));
        } else {
          unwrapEnvelope(
            await apiClient.createBusDocument(ownerId, body as BusDocumentCreateRequest),
          );
        }
      } else {
        const body = built.body as DriverDocumentCreateRequest | DriverDocumentUpdateRequest;
        if (editing) {
          unwrapEnvelope(await apiClient.updateDriverDocument(ownerId, editing.id, body));
        } else {
          unwrapEnvelope(
            await apiClient.createDriverDocument(ownerId, body as DriverDocumentCreateRequest),
          );
        }
      }
      toast.push(editing ? 'Document updated.' : 'Document added.', 'success');
      setOpen(false);
      await reload();
    } catch (caught) {
      setFieldErrors(fieldErrorsFromUnknown(caught));
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      if (isBus) {
        await apiClient.deleteBusDocument(ownerId, pendingDelete.id);
      } else {
        await apiClient.deleteDriverDocument(ownerId, pendingDelete.id);
      }
      toast.push('Document removed.', 'success');
      setPendingDelete(null);
      await reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const documents = data?.documents ?? [];
  const visible = statusFilter ? documents.filter((d) => d.status === statusFilter) : documents;

  if (loading && !data) {
    return <LoadingView label="Loading documents…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load documents'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  return (
    <View style={styles.flex}>
      <Screen refresh={() => void reload()} refreshing={loading} extraBottomSpace={88}>
        {data.compliance.owner_label ? (
          <Text style={styles.owner}>{data.compliance.owner_label}</Text>
        ) : null}

        <ComplianceSummaryCard
          title="Compliance"
          summary={data.compliance.summary}
          requirements={data.compliance.requirements}
        />

        <Card title="Documents" description={`${documents.length} on file for this ${noun}.`}>
          <View style={styles.chips}>
            <StatusChip
              label="All"
              active={statusFilter === null}
              onPress={() => setStatusFilter(null)}
            />
            <StatusChip
              label="Valid"
              active={statusFilter === DocumentStatus.VALID}
              onPress={() => setStatusFilter(DocumentStatus.VALID)}
            />
            <StatusChip
              label="Expiring"
              active={statusFilter === DocumentStatus.EXPIRING_SOON}
              onPress={() => setStatusFilter(DocumentStatus.EXPIRING_SOON)}
            />
            <StatusChip
              label="Expired"
              active={statusFilter === DocumentStatus.EXPIRED}
              onPress={() => setStatusFilter(DocumentStatus.EXPIRED)}
            />
          </View>

          {visible.length === 0 ? (
            <EmptyState
              title={documents.length === 0 ? 'No documents yet' : 'Nothing with this status'}
              description={
                documents.length === 0
                  ? `Add the ${noun}'s certificates to keep the compliance view accurate.`
                  : 'Change the filter to see the rest.'
              }
            />
          ) : (
            visible.map((document) => (
              <View key={document.id} style={styles.document}>
                <View style={styles.documentTop}>
                  <Text style={styles.documentName}>{document.document_type_label}</Text>
                  <Badge
                    label={documentStatusLabel(document.status)}
                    tone={documentStatusTone(document.status)}
                  />
                </View>
                <Text style={styles.documentMeta}>
                  {[
                    document.document_number,
                    describeExpiry(document.expiry_date, document.days_remaining),
                    document.is_required ? 'Required' : 'Optional',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {document.notes ? <Text style={styles.notes}>{document.notes}</Text> : null}
                {document.file_url ? (
                  <Text style={styles.notes}>
                    {document.file_name ? `${document.file_name} — ` : ''}
                    {document.file_url}
                  </Text>
                ) : null}
                <View style={styles.documentActions}>
                  <Button
                    label="Edit"
                    variant="secondary"
                    small
                    onPress={() => startEdit(document)}
                    style={styles.smallButton}
                  />
                  <Button
                    label="Delete"
                    variant="secondary"
                    small
                    onPress={() => setPendingDelete(document)}
                    style={styles.smallButton}
                  />
                </View>
              </View>
            ))
          )}
        </Card>
      </Screen>

      <Fab onPress={startCreate} label="Add document" />

      <DocumentFormSheet
        ownerType={ownerType}
        open={open}
        editing={editing}
        form={form}
        fieldErrors={fieldErrors}
        busy={busy}
        onChange={setForm}
        onClose={() => setOpen(false)}
        onSubmit={() => void submit()}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete document?"
        message={
          pendingDelete
            ? `${pendingDelete.document_type_label} will be removed from this ${noun}'s record. The compliance view will show it as missing again.`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
};

const StatusChip: React.FC<{ label: string; active: boolean; onPress: () => void }> = ({
  label,
  active,
  onPress,
}) => (
  <Button
    label={label}
    small
    variant={active ? 'primary' : 'secondary'}
    onPress={onPress}
    style={styles.chip}
  />
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  owner: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '800',
    color: colors.neutral[900],
    marginBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  chip: { marginRight: spacing.xs },
  document: {
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
    paddingVertical: spacing.sm,
  },
  documentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  documentName: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  documentMeta: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    marginTop: 2,
  },
  notes: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
    marginTop: 4,
  },
  documentActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  smallButton: { paddingHorizontal: spacing.md },
});
