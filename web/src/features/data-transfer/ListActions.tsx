'use client';

import Link from 'next/link';
import React from 'react';
import type { ExportDataset, ExportQuery, ImportModule } from '@school-bus-tracking/shared-types';
import { ExportButton } from './ExportButton';

export interface ListActionsProps {
  /** Dataset to export; the current filters are forwarded verbatim. */
  dataset: ExportDataset;
  /** Live filter state of the list, so "Export" matches what is on screen. */
  query?: ExportQuery;
  /** Import module to deep-link to, when this list can be bulk-loaded. */
  importModule?: ImportModule;
  /** The page's own "+ Add" control, rendered first. */
  children?: React.ReactNode;
}

/**
 * The standard `[+ Add] [Import] [Export]` cluster for a list screen.
 *
 * Keeping it in one component means every list offers the same three actions in
 * the same order, and that "Export" is always wired to the filters actually in
 * effect rather than to a bare dataset name.
 */
export const ListActions: React.FC<ListActionsProps> = ({
  dataset,
  query,
  importModule,
  children,
}) => (
  <>
    {children}
    {importModule ? (
      <Link className="btn btn-secondary" href={`/imports?module=${importModule}`}>
        Import
      </Link>
    ) : null}
    <ExportButton dataset={dataset} query={query} />
  </>
);
