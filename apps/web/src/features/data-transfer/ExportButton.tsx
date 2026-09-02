'use client';

import React, { useState } from 'react';
import {
  DataFileFormat,
  type ExportDataset,
  type ExportQuery,
} from '@school-bus-tracking/shared-types';
import { Button, useToast } from '../../components/ui';
import { getApiErrorMessage } from '../../lib/errors';
import { apiClient } from '../../services/api';
import { saveBlob } from './download';

export interface ExportButtonProps {
  dataset: ExportDataset;
  /**
   * The filters currently applied on screen.
   *
   * Passing the live filter state is what makes "Export" mean "export what I am
   * looking at" rather than "export everything" — the server applies exactly
   * the same `where` clause the list did.
   */
  query?: ExportQuery;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
}

/**
 * Downloads the current list as a spreadsheet.
 *
 * Offers `.xlsx` by default with `.csv` behind a small menu: xlsx is what an
 * office actually opens, csv is what another system ingests.
 */
export const ExportButton: React.FC<ExportButtonProps> = ({
  dataset,
  query = {},
  label = 'Export',
  variant = 'secondary',
  disabled = false,
}) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const download = async (format: DataFileFormat) => {
    setOpen(false);
    setBusy(true);
    try {
      const file = await apiClient.downloadExport(dataset, { ...query, format });
      if (file.totalRecords === 0) {
        // The file is still saved (an empty sheet with headers is a valid
        // answer), but the admin should know why it looks bare.
        toast.push(
          'No records matched the current filters. The file contains headers only.',
          'info',
        );
      }
      saveBlob(file);
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="export-menu">
      <Button
        variant={variant}
        disabled={disabled || busy}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {busy ? 'Preparing…' : label}
      </Button>
      {open ? (
        <div className="export-menu-list" role="menu">
          <button type="button" role="menuitem" onClick={() => void download(DataFileFormat.XLSX)}>
            Excel (.xlsx)
          </button>
          <button type="button" role="menuitem" onClick={() => void download(DataFileFormat.CSV)}>
            CSV (.csv)
          </button>
        </div>
      ) : null}
    </div>
  );
};
