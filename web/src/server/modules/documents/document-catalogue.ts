import {
  BUS_DOCUMENT_TYPE_LABELS,
  BUS_DOCUMENT_TYPE_VALUES,
  BusDocumentType,
  DEFAULT_BUS_DOCUMENT_REQUIREMENTS,
  DEFAULT_DRIVER_DOCUMENT_REQUIREMENTS,
  DRIVER_DOCUMENT_TYPE_LABELS,
  DRIVER_DOCUMENT_TYPE_VALUES,
  DriverDocumentType,
  type DocumentOwnerType,
} from '@school-bus-tracking/shared-types';

/**
 * The built-in compliance catalogue (Task 44).
 *
 * One helper drives both resources — a bus and a driver carry different
 * documents, but the requirement engine, the API and both clients must agree
 * on *which* types exist, what they are called and which of them are
 * mandatory out of the box. Everything here is derived from the shared types,
 * so adding a document type is a one-line change in
 * `@school-bus-tracking/shared-types` (plus the DB enum migration).
 */

export interface DocumentCatalogueEntry {
  document_type: string;
  label: string;
  /** Mandatory unless the school explicitly relaxes it. */
  is_required: boolean;
}

/** The bus catalogue, in the order operators expect to see it. */
const BUS_CATALOGUE: readonly DocumentCatalogueEntry[] = BUS_DOCUMENT_TYPE_VALUES.map(
  (document_type) => ({
    document_type,
    label: BUS_DOCUMENT_TYPE_LABELS[document_type],
    is_required: DEFAULT_BUS_DOCUMENT_REQUIREMENTS[document_type],
  }),
);

/** The driver catalogue, driving licence first. */
const DRIVER_CATALOGUE: readonly DocumentCatalogueEntry[] = DRIVER_DOCUMENT_TYPE_VALUES.map(
  (document_type) => ({
    document_type,
    label: DRIVER_DOCUMENT_TYPE_LABELS[document_type],
    is_required: DEFAULT_DRIVER_DOCUMENT_REQUIREMENTS[document_type],
  }),
);

/** Every document type of a resource kind, in catalogue order. */
export function documentCatalogue(ownerType: DocumentOwnerType): readonly DocumentCatalogueEntry[] {
  return ownerType === 'BUS' ? BUS_CATALOGUE : DRIVER_CATALOGUE;
}

/** True when `documentType` belongs to the catalogue of `ownerType`. */
export function isDocumentTypeValid(ownerType: DocumentOwnerType, documentType: string): boolean {
  const values: readonly string[] =
    ownerType === 'BUS' ? BUS_DOCUMENT_TYPE_VALUES : DRIVER_DOCUMENT_TYPE_VALUES;
  return values.includes(documentType);
}

/** Human label of a document type; falls back to the raw value. */
export function documentTypeLabel(ownerType: DocumentOwnerType, documentType: string): string {
  if (ownerType === 'BUS') {
    return BUS_DOCUMENT_TYPE_LABELS[documentType as BusDocumentType] ?? documentType;
  }
  return DRIVER_DOCUMENT_TYPE_LABELS[documentType as DriverDocumentType] ?? documentType;
}
