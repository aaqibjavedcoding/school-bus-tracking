import type { DownloadedFile } from '@school-bus-tracking/api-client';

/**
 * Saves a downloaded blob to the user's disk.
 *
 * The API returns spreadsheets over an authenticated `fetch` (the session is a
 * bearer token plus a same-site cookie), so a plain `<a href>` cannot be used —
 * it would issue an unauthenticated navigation. Instead the response body is
 * turned into a short-lived object URL, clicked programmatically and revoked
 * immediately: the blob never outlives the download.
 */
export function saveBlob(file: DownloadedFile): void {
  const url = URL.createObjectURL(file.blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoking on the next tick keeps Safari happy: it reads the URL
    // asynchronously after the click handler returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Human file size for the upload step ("2.4 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Upload limit the API enforces, mirrored so the UI can reject early. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Extensions the import endpoints accept. */
export const ACCEPTED_UPLOAD_EXTENSIONS = ['.xlsx', '.csv'];

/** True when a picked file looks like something the API will accept. */
export function isAcceptedSpreadsheet(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_UPLOAD_EXTENSIONS.some((extension) => name.endsWith(extension));
}
