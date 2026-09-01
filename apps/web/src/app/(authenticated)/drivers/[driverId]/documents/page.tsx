'use client';

import Link from 'next/link';
import React, { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import type {
  DocumentComplianceResponse,
  DocumentOwnerType,
  DriverDocumentCreateRequest,
  DriverDocumentResponse,
  DriverDocumentUpdateRequest,
  StaffResponse,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Skeleton,
  useToast,
} from '../../../../../components/ui';
import { CompliancePanel } from '../../../../../features/documents/CompliancePanel';
import {
  DocumentFormModal,
  EMPTY_DOCUMENT_FORM,
  buildDocumentRequest,
  toFormValues,
  type DocumentFormValues,
} from '../../../../../features/documents/DocumentFormModal';
import {
  describeExpiry,
  documentStatusLabel,
  documentStatusTone,
} from '../../../../../features/documents/helpers';
import { useLoad } from '../../../../../hooks/useLoad';
import {
  fieldErrorsFromUnknown,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../../../lib/errors';
import { fullName } from '../../../../../lib/format';
import { apiClient } from '../../../../../services/api';

const OWNER_TYPE: DocumentOwnerType = 'DRIVER';

/**
 * Driver compliance documents (Task 44).
 *
 * The driving licence is the headline document — with its licence number,
 * issue date and expiry date — and the same screen carries whatever else the
 * school requires (medical certificate, police verification, training, ID).
 */
export default function DriverDocumentsPage() {
  const params = useParams<{ driverId: string }>();
  const driverId = typeof params?.driverId === 'string' ? params.driverId : '';
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DriverDocumentResponse | null>(null);
  const [form, setForm] = useState<DocumentFormValues>(EMPTY_DOCUMENT_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DriverDocumentResponse | null>(null);

  const load = useCallback(async () => {
    // The screen serves both crew roles: the id is looked up as a driver
    // first and as a conductor when that misses, so the "Documents" action
    // works from either tab of the staff list.
    const loadCrewMember = async () => {
      try {
        return unwrapEnvelope(await apiClient.getDriver(driverId));
      } catch {
        return unwrapEnvelope(await apiClient.getConductor(driverId));
      }
    };
    const [driver, documents, compliance] = await Promise.all([
      loadCrewMember(),
      apiClient.listDriverDocuments(driverId, { page, limit: 20 }),
      apiClient.getDriverDocumentCompliance(driverId).catch(() => null),
    ]);
    return {
      driver,
      documents: unwrapEnvelope(documents),
      compliance: compliance ? unwrapEnvelope(compliance) : null,
    };
  }, [driverId, page]);

  const { data, loading, error, reload } = useLoad(load, [load]);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_DOCUMENT_FORM);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (document: DriverDocumentResponse) => {
    setEditing(document);
    setForm(toFormValues(OWNER_TYPE, document));
    setFieldErrors({});
    setOpen(true);
  };

  const save = () => {
    const result = buildDocumentRequest(OWNER_TYPE, form, Boolean(editing));
    if (!result.ok) {
      setFieldErrors(result.errors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    const request = editing
      ? apiClient.updateDriverDocument(
          driverId,
          editing.id,
          result.body as unknown as DriverDocumentUpdateRequest,
        )
      : apiClient.createDriverDocument(
          driverId,
          result.body as unknown as DriverDocumentCreateRequest,
        );
    void (async () => {
      try {
        unwrapEnvelope(await request);
        toast.push(editing ? 'Document updated.' : 'Document added.', 'success');
        setOpen(false);
        await reload();
      } catch (caught) {
        setFieldErrors(fieldErrorsFromUnknown(caught));
        toast.push(getApiErrorMessage(caught), 'danger');
      } finally {
        setBusy(false);
      }
    })();
  };

  const remove = () => {
    if (!pendingDelete) return;
    setBusy(true);
    void (async () => {
      try {
        unwrapEnvelope(await apiClient.deleteDriverDocument(driverId, pendingDelete.id));
        toast.push('Document removed.', 'success');
        setPendingDelete(null);
        await reload();
      } catch (caught) {
        toast.push(getApiErrorMessage(caught), 'danger');
      } finally {
        setBusy(false);
      }
    })();
  };

  if (loading && !data) {
    return (
      <div className="page">
        <Skeleton lines={10} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <ErrorState message={error || 'Could not load this crew member'} onRetry={() => void reload()} />
      </div>
    );
  }

  const driver = data.driver as StaffResponse;
  const compliance = data.compliance as DocumentComplianceResponse | null;

  return (
    <div className="page">
      <PageHeader
        title={`Documents — ${fullName(driver)}`}
        description="Licence and compliance paperwork for this crew member. Validity is always calculated from the expiry date on file."
        actions={
          <>
            <Link href="/staff">
              <Button variant="secondary">Back to staff</Button>
            </Link>
            <Button onClick={startCreate}>Add document</Button>
          </>
        }
      />

      <CompliancePanel compliance={compliance} loading={loading} />

      <Card
        title="Documents on file"
        description={`${data.documents.meta.total} record${
          data.documents.meta.total === 1 ? '' : 's'
        }, including historic renewals.`}
      >
        {data.documents.items.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Add the driving licence to see this crew member's compliance."
            action={<Button onClick={startCreate}>Add document</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Number</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  <th>File</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.documents.items.map((document) => (
                  <tr key={document.id}>
                    <td>
                      <strong>{document.document_type_label}</strong>
                      {document.is_required ? null : <span className="muted"> · optional</span>}
                    </td>
                    <td>{document.document_number || '—'}</td>
                    <td>{describeExpiry(document.expiry_date, document.days_remaining)}</td>
                    <td>
                      <Badge tone={documentStatusTone(document.status)}>
                        {documentStatusLabel(document.status)}
                      </Badge>
                    </td>
                    <td>
                      {document.file_url ? (
                        <a href={document.file_url} target="_blank" rel="noreferrer">
                          {document.file_name || 'Open'}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <div className="row">
                        <Button variant="ghost" onClick={() => startEdit(document)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => setPendingDelete(document)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={data.documents.meta.page}
          totalPages={data.documents.meta.totalPages}
          hasNextPage={data.documents.meta.hasNextPage}
          hasPreviousPage={data.documents.meta.hasPreviousPage}
          onPage={setPage}
        />
      </Card>

      <DocumentFormModal
        ownerType={OWNER_TYPE}
        open={open}
        editing={editing}
        form={form}
        fieldErrors={fieldErrors}
        busy={busy}
        onChange={setForm}
        onClose={() => setOpen(false)}
        onSubmit={save}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete document?"
        message={
          pendingDelete
            ? `${pendingDelete.document_type_label} will be removed from this crew member.`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
}
