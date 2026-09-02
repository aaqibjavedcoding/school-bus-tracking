'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  DataFileFormat,
  ImportMode,
  ImportRowStatus,
  type ImportCommitResponse,
  type ImportModule,
  type ImportPreviewRow,
  type ImportTemplateDescriptor,
  type ImportValidationResponse,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Select,
  Skeleton,
  useToast,
} from '../../components/ui';
import { getApiErrorMessage } from '../../lib/errors';
import { apiClient } from '../../services/api';
import {
  ACCEPTED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  formatBytes,
  isAcceptedSpreadsheet,
  saveBlob,
} from './download';

/**
 * Five-step bulk import wizard.
 *
 * 1. **Choose** what to import.
 * 2. **Download** the template for it.
 * 3. **Upload** the filled file.
 * 4. **Review** exactly what will happen to every row.
 * 5. **Import** the valid rows — or download the error file and start again.
 *
 * The review step is not decorative: nothing is written until the admin
 * confirms, and the confirmation re-sends the file so the server re-validates
 * against the database as it is at that moment.
 */

type Step = 1 | 2 | 3 | 4 | 5;

const STEP_LABELS: Record<Step, string> = {
  1: 'Choose data',
  2: 'Get template',
  3: 'Upload file',
  4: 'Review',
  5: 'Result',
};

/** Tone of the badge shown against each preview row. */
function statusTone(status: ImportRowStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case ImportRowStatus.VALID:
    case ImportRowStatus.CREATED:
    case ImportRowStatus.UPDATED:
      return 'success';
    case ImportRowStatus.WILL_UPDATE:
      return 'warning';
    case ImportRowStatus.INVALID:
      return 'danger';
    default:
      return 'neutral';
  }
}

const STATUS_LABELS: Record<ImportRowStatus, string> = {
  [ImportRowStatus.VALID]: 'Will be created',
  [ImportRowStatus.INVALID]: 'Invalid',
  [ImportRowStatus.DUPLICATE_IN_FILE]: 'Duplicate in file',
  [ImportRowStatus.EXISTS]: 'Already exists',
  [ImportRowStatus.WILL_UPDATE]: 'Will be updated',
  [ImportRowStatus.CREATED]: 'Created',
  [ImportRowStatus.UPDATED]: 'Updated',
  [ImportRowStatus.SKIPPED]: 'Skipped',
};

export interface ImportWizardProps {
  modules: ImportTemplateDescriptor[];
  /** Pre-selects a module when the wizard is opened from a list screen. */
  initialModule?: ImportModule;
  /** Called after a successful commit so the caller can refresh its data. */
  onImported?: () => void;
}

export const ImportWizard: React.FC<ImportWizardProps> = ({
  modules,
  initialModule,
  onImported,
}) => {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(initialModule ? 2 : 1);
  const [moduleKey, setModuleKey] = useState<ImportModule | ''>(initialModule ?? '');
  const [mode, setMode] = useState<ImportMode>(ImportMode.CREATE);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<ImportValidationResponse | null>(null);
  const [result, setResult] = useState<ImportCommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const descriptor = useMemo(
    () => modules.find((item) => item.module === moduleKey) ?? null,
    [modules, moduleKey],
  );

  const reset = (nextModule: ImportModule | '' = moduleKey) => {
    setStep(nextModule ? 2 : 1);
    setModuleKey(nextModule);
    setFile(null);
    setFileError(null);
    setValidation(null);
    setResult(null);
    setError(null);
    if (fileInput.current) {
      fileInput.current.value = '';
    }
  };

  const downloadTemplate = async (format: DataFileFormat) => {
    if (!descriptor) return;
    setBusy(true);
    try {
      saveBlob(await apiClient.downloadImportTemplate(descriptor.module, format));
      toast.push('Template downloaded.', 'success');
    } catch (downloadError) {
      toast.push(getApiErrorMessage(downloadError), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (picked: File | null) => {
    setFileError(null);
    setValidation(null);
    if (!picked) {
      setFile(null);
      return;
    }
    // Both checks are mirrored server-side; failing fast here just saves the
    // admin a round trip.
    if (!isAcceptedSpreadsheet(picked)) {
      setFileError(`Choose a ${ACCEPTED_UPLOAD_EXTENSIONS.join(' or ')} file.`);
      setFile(null);
      return;
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setFileError(
        `That file is ${formatBytes(picked.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      );
      setFile(null);
      return;
    }
    setFile(picked);
  };

  const validate = async () => {
    if (!descriptor || !file) return;
    setBusy(true);
    setError(null);
    try {
      const envelope = await apiClient.validateImport(descriptor.module, file, mode, file.name);
      const data = envelope.data;
      if (!data) {
        throw new Error('The server did not return a validation result.');
      }
      setValidation(data);
      setStep(4);
    } catch (validationError) {
      setError(getApiErrorMessage(validationError));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!descriptor || !file) return;
    setBusy(true);
    setError(null);
    try {
      const envelope = await apiClient.commitImport(descriptor.module, file, mode, file.name);
      const data = envelope.data;
      if (!data) {
        throw new Error('The server did not return an import result.');
      }
      setResult(data);
      setStep(5);
      toast.push(
        `Imported ${data.created_count} new and updated ${data.updated_count} record(s).`,
        'success',
      );
      onImported?.();
    } catch (commitError) {
      setError(getApiErrorMessage(commitError));
    } finally {
      setBusy(false);
    }
  };

  const downloadErrorFile = async (jobId: string) => {
    setBusy(true);
    try {
      saveBlob(await apiClient.downloadImportErrorFile(jobId));
    } catch (downloadError) {
      toast.push(getApiErrorMessage(downloadError), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const active = result ?? validation;

  return (
    <div className="import-wizard">
      <ol className="wizard-steps" aria-label="Import steps">
        {([1, 2, 3, 4, 5] as Step[]).map((value) => (
          <li
            key={value}
            className={value === step ? 'current' : value < step ? 'done' : ''}
            aria-current={value === step ? 'step' : undefined}
          >
            <span className="wizard-step-number">{value}</span>
            <span>{STEP_LABELS[value]}</span>
          </li>
        ))}
      </ol>

      {error ? <ErrorState message={error} /> : null}

      {step === 1 ? (
        <Card
          title="What would you like to import?"
          description="Each option maps to a spreadsheet template with only the fields that record actually has."
        >
          <div className="module-grid">
            {modules.map((item) => (
              <button
                key={item.module}
                type="button"
                className="module-choice"
                onClick={() => {
                  setModuleKey(item.module);
                  setStep(2);
                }}
              >
                <strong>{item.label}</strong>
                <span className="muted">{item.description}</span>
                <span className="muted small">
                  Matched on {item.natural_key.toLowerCase()} · up to{' '}
                  {item.max_rows.toLocaleString()} rows
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {step === 2 && descriptor ? (
        <Card
          title={`Download the ${descriptor.label} template`}
          description="The template carries the exact headers the importer expects, a notes row explaining every column, and one example row. Delete the notes and example rows before you upload."
        >
          <div className="row wrap">
            <Button onClick={() => void downloadTemplate(DataFileFormat.XLSX)} disabled={busy}>
              Download .xlsx template
            </Button>
            <Button
              variant="secondary"
              onClick={() => void downloadTemplate(DataFileFormat.CSV)}
              disabled={busy}
            >
              Download .csv template
            </Button>
          </div>

          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Required</th>
                  <th>What to enter</th>
                </tr>
              </thead>
              <tbody>
                {descriptor.columns.map((column) => (
                  <tr key={column.header}>
                    <td>{column.header}</td>
                    <td>
                      <Badge tone={column.required ? 'warning' : 'neutral'}>
                        {column.required ? 'Required' : 'Optional'}
                      </Badge>
                    </td>
                    <td>
                      {column.description}
                      {column.allowed_values?.length ? (
                        <span className="muted"> One of: {column.allowed_values.join(', ')}.</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="modal-actions">
            <Button variant="ghost" onClick={() => reset('')}>
              Back
            </Button>
            <Button onClick={() => setStep(3)}>I have my file ready</Button>
          </div>
        </Card>
      ) : null}

      {step === 3 && descriptor ? (
        <Card
          title="Upload your file"
          description={`Accepted formats: ${ACCEPTED_UPLOAD_EXTENSIONS.join(', ')} · maximum ${formatBytes(MAX_UPLOAD_BYTES)}. Nothing is saved until you confirm on the next screen.`}
        >
          <Field id="import-file" label="Spreadsheet" error={fileError ?? undefined}>
            <input
              id="import-file"
              ref={fileInput}
              type="file"
              accept={ACCEPTED_UPLOAD_EXTENSIONS.join(',')}
              onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
            />
          </Field>

          {descriptor.supports_upsert ? (
            <Field
              id="import-mode"
              label="Existing records"
              hint={`Rows are matched on ${descriptor.natural_key.toLowerCase()}.`}
            >
              <Select
                id="import-mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as ImportMode)}
                options={[
                  { value: ImportMode.CREATE, label: 'Skip rows that already exist' },
                  { value: ImportMode.UPSERT, label: 'Update rows that already exist' },
                ]}
              />
            </Field>
          ) : null}

          {file ? (
            <p className="muted">
              Selected: <strong>{file.name}</strong> ({formatBytes(file.size)})
            </p>
          ) : null}

          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>
              Back
            </Button>
            <Button onClick={() => void validate()} disabled={!file || busy}>
              {busy ? 'Checking…' : 'Check my file'}
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 4 && validation ? (
        <>
          <ImportSummaryCards summary={validation.summary} />

          {validation.unknown_columns.length > 0 ? (
            <p className="notice warning">
              These columns are not part of the template and will be ignored:{' '}
              <strong>{validation.unknown_columns.join(', ')}</strong>
            </p>
          ) : null}

          <Card
            title="Review"
            description={
              validation.can_import
                ? 'Rows with a problem are listed first. Only the valid rows will be written.'
                : 'No row in this file can be imported yet. Download the error file, fix the highlighted rows and upload again.'
            }
          >
            <PreviewTable rows={validation.preview} truncated={validation.preview_truncated} />

            <div className="modal-actions">
              <Button variant="ghost" onClick={() => reset()} disabled={busy}>
                Cancel
              </Button>
              {validation.has_error_file && validation.job_id ? (
                <Button
                  variant="secondary"
                  onClick={() => void downloadErrorFile(validation.job_id)}
                  disabled={busy}
                >
                  Download error file
                </Button>
              ) : null}
              <Button onClick={() => void commit()} disabled={!validation.can_import || busy}>
                {busy
                  ? 'Importing…'
                  : `Import ${validation.summary.rows_to_create + validation.summary.rows_to_update} valid record(s)`}
              </Button>
            </div>
          </Card>
        </>
      ) : null}

      {step === 5 && result ? (
        <>
          <ImportSummaryCards summary={result.summary} />
          <Card
            title="Import complete"
            description={`${result.created_count} created, ${result.updated_count} updated, ${result.skipped_count} skipped.`}
          >
            {result.skipped_count > 0 ? (
              <p className="muted">
                Skipped rows were not silently dropped — every one of them is listed in the error
                file with the reason it could not be imported.
              </p>
            ) : null}
            <PreviewTable rows={result.preview} truncated={result.preview_truncated} />
            <div className="modal-actions">
              {result.has_error_file && result.job_id ? (
                <Button
                  variant="secondary"
                  onClick={() => void downloadErrorFile(result.job_id)}
                  disabled={busy}
                >
                  Download error file
                </Button>
              ) : null}
              <Button onClick={() => reset('')}>Import something else</Button>
            </div>
          </Card>
        </>
      ) : null}

      {!descriptor && step !== 1 ? <Skeleton lines={4} /> : null}
      {active === null && busy ? <Skeleton lines={4} /> : null}
    </div>
  );
};

/** The six counters that make an import run auditable at a glance. */
const ImportSummaryCards: React.FC<{ summary: ImportValidationResponse['summary'] }> = ({
  summary,
}) => (
  <div className="stat-grid">
    <Stat label="Rows in file" value={summary.total_rows} />
    <Stat label="Valid" value={summary.valid_rows} tone="success" />
    <Stat label="Invalid" value={summary.invalid_rows} tone="danger" />
    <Stat label="Duplicates in file" value={summary.duplicate_rows_in_file} tone="warning" />
    <Stat label="To create" value={summary.rows_to_create} />
    <Stat label="To update" value={summary.rows_to_update} />
    <Stat label="Skipped" value={summary.rows_to_skip} tone="warning" />
  </div>
);

const Stat: React.FC<{
  label: string;
  value: number;
  tone?: 'success' | 'danger' | 'warning';
}> = ({ label, value, tone }) => (
  <div className={`stat ${tone ?? ''}`.trim()}>
    <span className="stat-value">{value.toLocaleString()}</span>
    <span className="stat-label">{label}</span>
  </div>
);

const PreviewTable: React.FC<{ rows: ImportPreviewRow[]; truncated: boolean }> = ({
  rows,
  truncated,
}) => {
  if (rows.length === 0) {
    return <p className="muted">Nothing to preview.</p>;
  }
  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: '5rem' }}>Row</th>
              <th>Record</th>
              <th>Status</th>
              <th>Problems</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.row_number}>
                <td>{row.row_number}</td>
                <td>{row.label}</td>
                <td>
                  <Badge tone={statusTone(row.status)}>{STATUS_LABELS[row.status]}</Badge>
                </td>
                <td>
                  {row.issues.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <ul className="issue-list">
                      {row.issues.map((issue, index) => (
                        <li key={`${row.row_number}-${index}`}>
                          {issue.column ? <strong>{issue.column}: </strong> : null}
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated ? (
        <p className="muted">
          Only the first {rows.length} rows are previewed. The error file lists every problem row.
        </p>
      ) : null}
    </>
  );
};
