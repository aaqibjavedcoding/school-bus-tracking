import {
  TripAttendanceStatus,
  type TripStudentAttendanceResponse,
} from '@school-bus-tracking/shared-types';
import { crewCopy } from './crew-copy.ts';
import { fullName } from '../../lib/format.ts';

/**
 * Presentation contract of one manifest board/drop row (Phase 2) — pure,
 * React-free, pinned by `manifest-row.spec.ts`.
 *
 * The row itself is the button: the whole card is the tap target, the
 * current action's ✓/✕ glyph sits on the right at ≥60px, and success is
 * confirmed inline ("Ramesh ✓ 7:42 AM") plus a green flash. Everything the
 * spec asserts (heights, glyphs, confirmation text, a11y labels) is decided
 * here so the component stays thin and CI catches regressions.
 */

/** Row floor — compact but still tappable. */
export const MANIFEST_ROW_MIN_HEIGHT = 52;
/** The ✓/✕ glyph zone on the right. */
export const ROW_ACTION_GLYPH_SIZE = 48;
/** Student name size. */
export const ROW_NAME_SIZE = 15;

/** Green flash on success: tinted surface from the measured badge-success pair. */
export const ROW_FLASH_GREEN = '#dcfce7';
/** How long the flash stays before settling (ms). */
export const ROW_FLASH_MS = 450;

/** The row's single contextual action, from the student's attendance state. */
export type RowAction = 'board' | 'drop' | null;

export function rowActionFor(status: TripAttendanceStatus, canAct: boolean): RowAction {
  if (!canAct) return null;
  if (status === TripAttendanceStatus.PENDING) return 'board';
  if (status === TripAttendanceStatus.BOARDED) return 'drop';
  return null;
}

export interface RowGlyph {
  /** Ionicons glyph: ✓ for board, ✕ for drop. */
  icon: 'checkmark-circle' | 'close-circle';
  /** Matches the shared action vocabulary (green in, grey out). */
  tone: 'success' | 'neutral';
}

export function rowActionGlyph(action: RowAction): RowGlyph | null {
  if (action === 'board') return { icon: 'checkmark-circle', tone: 'success' };
  if (action === 'drop') return { icon: 'close-circle', tone: 'neutral' };
  return null;
}

/** Status chip text of a row that is not actionable (closed trip / done). */
export function settledSymbol(status: TripAttendanceStatus): string {
  if (status === TripAttendanceStatus.BOARDED) return '✓';
  if (status === TripAttendanceStatus.DROPPED) return '✕';
  return '…';
}

/**
 * Inline confirmation line: "Ramesh ✓ 7:42 AM" once the server (or the
 * offline queue) recorded the event. `queued` renders the offline note.
 */
export function confirmationLine(
  item: Pick<TripStudentAttendanceResponse, 'first_name' | 'last_name' | 'status' | 'boarded_at' | 'dropped_at'>,
  mode: 'recorded' | 'queued',
): string | null {
  const name = fullName(item);
  if (mode === 'queued') {
    return item.status === TripAttendanceStatus.BOARDED
      ? crewCopy.manifest.queuedBoard(name)
      : crewCopy.manifest.queuedDrop(name);
  }
  if (item.status === TripAttendanceStatus.BOARDED && item.boarded_at) {
    return crewCopy.manifest.confirmBoard(name, formatClock(item.boarded_at));
  }
  if (item.status === TripAttendanceStatus.DROPPED && item.dropped_at) {
    return crewCopy.manifest.confirmDrop(name, formatClock(item.dropped_at));
  }
  return null;
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(date.getMinutes()).padStart(2, '0')} ${hours24 < 12 ? 'AM' : 'PM'}`;
}

/** What a screen reader should announce for the row (role="button" row). */
export function rowA11yLabel(
  item: Pick<
    TripStudentAttendanceResponse,
    'first_name' | 'last_name' | 'status' | 'boarded_at' | 'dropped_at'
  >,
  action: RowAction,
): string {
  const name = fullName(item);
  if (action === 'board') return crewCopy.manifest.rowA11y.waiting(name);
  if (action === 'drop') {
    return crewCopy.manifest.rowA11y.onBoard(
      name,
      item.boarded_at ? formatClock(item.boarded_at) : 'now',
    );
  }
  if (item.status === TripAttendanceStatus.DROPPED) {
    return crewCopy.manifest.rowA11y.droppedRow(
      name,
      item.dropped_at ? formatClock(item.dropped_at) : 'earlier',
    );
  }
  return crewCopy.manifest.rowA11y.waiting(name);
}

/** What `AccessibilityInfo.announceForAccessibility` says after success. */
export function successAnnouncement(name: string, action: 'board' | 'drop'): string {
  return action === 'board'
    ? crewCopy.manifest.announceBoard(name)
    : crewCopy.manifest.announceDrop(name);
}
