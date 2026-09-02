'use client';

import { useSearchParams } from 'next/navigation';
import React, { useState } from 'react';
import {
  ImportJobStatus,
  ImportModule,
  IMPORT_MODULE_LABELS,
  type ImportJobResponse,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  useToast,
} from '../../../components/ui';
import { ImportWizard, saveBlob } from '../../../features/data-transfer';
import { useLoad } from '../../../hooks/useLoad';
import { getApiErrorMessage, unwrapEnvelope } from '../../../lib/errors';
import { apiClient } from '../../../services/api';

/**
 * Import workspace: the wizard, plus the audit trail of every run.
 *
 * The history is deliberately on the same screen as the wizard. An import is a
 * bulk write to a school's core records, and the first question after one goes
 * wrong is "what exactly did that upload do?" — which should never require
 * hunting through a separate audit page.
 */

const STATUS_TONE: Record<ImportJobStatus, 'success' | 'warning' | 'danger'> = {
  [ImportJobStatus.COMPLETED]: 'success',
  [ImportJobStatus.VALIDATED]: 'warning',
  [ImportJobStatus.FAILED]: 'danger',
};

const STATUS_LABEL: Record<ImportJobStatus, string> = {
  [ImportJobStatus.COMPLETED]: 'Imported',
  [ImportJobStatus.VALIDATED]: 'Checked only',
  [ImportJobStatus.FAILED]: 'Failed',
};

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function ImportsPage() {
  const toast = useToast();
  const searchParams = useSearchParams();
  // List screens deep-link here as `/imports?module=students`, so the wizard
  // opens on the right template instead of making the admin pick again.
  const requested = searchParams?.get('module') ?? '';
  const initialModule = (Object.values(ImportModule) as string[]).includes(requested)
    ? (requested as ImportModule)
    : undefined;

  const modules = useLoad(
    async () => unwrapEnvelope(await apiClient.listImportModules()).items,
    [],
  );

  const [page, setPage] = useState(1);
  const [moduleFilter, setModuleFilter] = useState<ImportModule | ''>('');
  const [statusFilter, setStatusFilter] = useState<ImportJobStatus | ''>('');
  const [reloadKey, setReloadKey] = useState(0);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const history = useLoad(
    async () =>
      unwrapEnvelope(
        await apiClient.listImportJobs({
          page,
          limit: 20,
          module: moduleFilter || undefined,
          status: statusFilter || undefined,
        }),
      ),
    [page, moduleFilter, statusFilter, reloadKey],
  );

  const detail = useLoad(
    async () => (expanded ? unwrapEnvelope(await apiClient.getImportJob(expanded)) : null),
    [expanded],
  );

  const refreshHistory = () => {
    setPage(1);
    setReloadKey((value) => value + 1);
  };

  const downloadErrors = async (job: ImportJobResponse) => {
    setBusyJob(job.id);
    try {
      saveBlob(await apiClient.downloadImportErrorFile(job.id));
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setBusyJob(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Import data"
        description="Bulk-load students, parents, crew, vehicles and routes from a spreadsheet. Nothing is written until you review and confirm."
      />

      {modules.loading ? (
        <Skeleton lines={6} />
      ) : modules.error ? (
        <ErrorState message={modules.error} onRetry={() => void modules.reload()} />
      ) : (
        <ImportWizard
          modules={modules.data ?? []}
          initialModule={initialModule}
          onImported={refreshHistory}
        />
      )}

      <Card
        title="Import history"
        description="Every upload — including checks that were never committed — with who ran it and what it changed."
      >
        <div className="toolbar">
          <Field id="history-module" label="Data type">
            <Select
              id="history-module"
              value={moduleFilter}
              onChange={(event) => {
                setModuleFilter(event.target.value as ImportModule | '');
                setPage(1);
              }}
              placeholder="All types"
              options={Object.values(ImportModule).map((value) => ({
                value,
                label: IMPORT_MODULE_LABELS[value],
              }))}
            />
          </Field>
          <Field id="history-status" label="Outcome">
            <Select
              id="history-status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as ImportJobStatus | '');
                setPage(1);
              }}
              placeholder="All outcomes"
              options={Object.values(ImportJobStatus).map((value) => ({
                value,
                label: STATUS_LABEL[value],
              }))}
            />
          </Field>
        </div>

        {history.loading ? (
          <Skeleton lines={6} />
        ) : history.error ? (
          <ErrorState message={history.error} onRetry={() => void history.reload()} />
        ) : (history.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="No imports yet"
            description="Once you upload a file, every run is recorded here with its full result."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Data type</th>
                    <th>Outcome</th>
                    <th>Rows</th>
                    <th>Created</th>
                    <th>Updated</th>
                    <th>Skipped</th>
                    <th>By</th>
                    <th>When</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(history.data?.items ?? []).map((job) => (
                    <React.Fragment key={job.id}>
                      <tr>
                        <td>{job.file_name}</td>
                        <td>{job.module_label}</td>
                        <td>
                          <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
                          {job.dry_run ? <span className="muted small"> (dry run)</span> : null}
                        </td>
                        <td>{job.total_rows}</td>
                        <td>{job.created_count}</td>
                        <td>{job.updated_count}</td>
                        <td>{job.skipped_count}</td>
                        <td>{job.imported_by_name ?? '—'}</td>
                        <td>{formatTimestamp(job.started_at)}</td>
                        <td>
                          <div className="table-actions">
                            <Button
                              variant="ghost"
                              onClick={() => setExpanded(expanded === job.id ? null : job.id)}
                            >
                              {expanded === job.id ? 'Hide' : 'Details'}
                            </Button>
                            {job.has_error_file ? (
                              <Button
                                variant="secondary"
                                disabled={busyJob === job.id}
                                onClick={() => void downloadErrors(job)}
                              >
                                Error file
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {expanded === job.id ? (
                        <tr>
                          <td colSpan={10}>
                            {detail.loading ? (
                              <Skeleton lines={4} />
                            ) : detail.error ? (
                              <ErrorState message={detail.error} />
                            ) : detail.data ? (
                              <div className="import-detail">
                                {detail.data.failure_reason ? (
                                  <p className="notice danger">{detail.data.failure_reason}</p>
                                ) : null}
                                <p className="muted">
                                  Finished {formatTimestamp(detail.data.completed_at)} ·{' '}
                                  {detail.data.summary.valid_rows} valid ·{' '}
                                  {detail.data.summary.invalid_rows} invalid ·{' '}
                                  {detail.data.summary.duplicate_rows_in_file} duplicates in file ·{' '}
                                  {detail.data.summary.existing_records} already existed
                                </p>
                                {detail.data.unknown_columns.length > 0 ? (
                                  <p className="muted">
                                    Ignored columns: {detail.data.unknown_columns.join(', ')}
                                  </p>
                                ) : null}
                                {detail.data.errors.length === 0 ? (
                                  <p className="muted">Every row in this file was accepted.</p>
                                ) : (
                                  <div className="table-wrap">
                                    <table className="data compact">
                                      <thead>
                                        <tr>
                                          <th style={{ width: '5rem' }}>Row</th>
                                          <th>Problems</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {detail.data.errors.slice(0, 50).map((row) => (
                                          <tr key={row.row_number}>
                                            <td>{row.row_number}</td>
                                            <td>
                                              <ul className="issue-list">
                                                {row.issues.map((issue, index) => (
                                                  <li key={`${row.row_number}-${index}`}>
                                                    {issue.column ? (
                                                      <strong>{issue.column}: </strong>
                                                    ) : null}
                                                    {issue.message}
                                                  </li>
                                                ))}
                                              </ul>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    {detail.data.errors.length > 50 ? (
                                      <p className="muted">
                                        Showing the first 50 of {detail.data.errors.length} problem
                                        rows. Download the error file for the full list.
                                      </p>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {history.data ? (
              <Pagination
                page={history.data.meta.page}
                totalPages={history.data.meta.totalPages}
                hasNextPage={history.data.meta.hasNextPage}
                hasPreviousPage={history.data.meta.hasPreviousPage}
                onPage={setPage}
              />
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
