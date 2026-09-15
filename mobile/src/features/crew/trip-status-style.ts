import { colors } from '@school-bus-tracking/design-tokens';
import { TripStatus } from '@school-bus-tracking/shared-types';
import { crewCopy } from './crew-copy.ts';
import { contrastRatio } from '../../theme/contrast.ts';

/**
 * The giant crew status card: **the background colour *is* the state.**
 *
 * Pure, React-free mapping so the trip screen can never disagree with its
 * own guard spec (`trip-status-style.spec.ts` pins every ratio and the
 * pairwise colour distances). The palette is aliased from the *existing*
 * measured action surfaces — nothing here invents a new hex; shared
 * `design-tokens` values are untouched (Phase-1 rule).
 *
 * Accessibility note: colour is deliberately never the only cue — every
 * state also differs in its word (`crewCopy.statusWord`) and its icon, so a
 * colour-vision-deficient driver reads the same state from text + glyph.
 */

export interface TripStatusStyle {
  /** Solid card background (state colour). */
  background: string;
  /** Text/icon colour on that background — always ≥4.5:1, pinned in spec. */
  foreground: string;
  /** Uppercase state word, 28px bold on the card. */
  word: string;
  /** Ionicons glyph repeating the state next to the word. */
  icon: string;
}

/** BOARDING = green ("good to go" vocabulary from `crew-action-meta.ts`). */
const GREEN = colors.secondary[700];
/** IN_PROGRESS = amber (the brand's "moving" colour, AA surface from Phase 1). */
const AMBER = colors.primary[700];
/** COMPLETED / CANCELLED / SCHEDULED = grey (done / not yet moving). */
const GREY = colors.neutral[600];
/** Foreground on every state background: white, pinned ≥4.5:1 in the spec. */
const ON_STATE = '#ffffff';

const STYLE_BY_STATUS: Record<TripStatus, TripStatusStyle> = {
  [TripStatus.SCHEDULED]: {
    background: GREY,
    foreground: ON_STATE,
    word: crewCopy.statusWord.scheduled,
    icon: 'time',
  },
  [TripStatus.BOARDING]: {
    background: GREEN,
    foreground: ON_STATE,
    word: crewCopy.statusWord.boarding,
    icon: 'people',
  },
  [TripStatus.IN_PROGRESS]: {
    background: AMBER,
    foreground: ON_STATE,
    word: crewCopy.statusWord.inProgress,
    icon: 'navigate',
  },
  [TripStatus.COMPLETED]: {
    background: GREY,
    foreground: ON_STATE,
    word: crewCopy.statusWord.completed,
    icon: 'checkmark-done',
  },
  [TripStatus.CANCELLED]: {
    background: GREY,
    foreground: ON_STATE,
    word: crewCopy.statusWord.cancelled,
    icon: 'close-circle',
  },
};

/** Style of the giant status card for a trip status. */
export function tripStatusStyle(status: TripStatus): TripStatusStyle {
  return STYLE_BY_STATUS[status];
}

/**
 * The three *distinct* state colours a driver must tell apart from a metre
 * away (green/amber/grey). Spec pins the pairwise distance below.
 */
export const STATE_COLOURS: string[] = [GREEN, AMBER, GREY];

/** Euclidean distance in RGB — a plain, testable proxy for "tells apart". */
export function rgbDistance(a: string, b: string): number {
  const parse = (hex: string): [number, number, number] => {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) throw new Error(`rgbDistance expects a #rrggbb colour, got "${hex}"`);
    return [
      parseInt(match[1]!.slice(0, 2), 16),
      parseInt(match[1]!.slice(2, 4), 16),
      parseInt(match[1]!.slice(4, 6), 16),
    ];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** Minimum pairwise RGB distance two state colours must keep (see spec). */
export const MIN_STATE_COLOUR_DISTANCE = 60;

/** Contrast of the state word on each state background (spec asserts ≥4.5). */
export function stateWordContrast(status: TripStatus): number {
  const style = STYLE_BY_STATUS[status];
  return contrastRatio(style.foreground, style.background);
}

export interface PrimaryTripAction {
  /** The one forward transition available from this state. */
  next: TripStatus;
  label: string;
  icon: string;
}

/**
 * The single primary action visible on the trip screen *before any tap*.
 * Pure mirror of `nextCrewTransitions` (which the API-facing
 * `TRIP_STATUS_TRANSITIONS` already caps at one forward step) — the spec
 * asserts "exactly one or zero" for every status, so a second action can
 * never sneak onto the card unnoticed.
 */
export function primaryTripAction(status: TripStatus): PrimaryTripAction | null {
  switch (status) {
    case TripStatus.SCHEDULED:
      return { next: TripStatus.BOARDING, label: 'Start boarding', icon: 'people' };
    case TripStatus.BOARDING:
      return { next: TripStatus.IN_PROGRESS, label: 'Depart & drive', icon: 'navigate' };
    case TripStatus.IN_PROGRESS:
      return { next: TripStatus.COMPLETED, label: 'Complete trip', icon: 'checkmark-done' };
    default:
      // Terminal states have no forward action — the card shows none.
      return null;
  }
}
