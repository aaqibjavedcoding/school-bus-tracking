import type { Ionicons } from '@expo/vector-icons';
import { TripStatus } from '@school-bus-tracking/shared-types';

/**
 * Presentation metadata for the crew's primary actions — *how an action
 * looks*, never what it does.
 *
 * The crews this app serves often read slowly, so every field action carries
 * the same three cues: a stable icon, a colour that means the same thing
 * everywhere (green = good to go, amber = care, grey = done/neutral) and the
 * 64px field size from the theme's touch scale. Keeping the mapping here —
 * pure, React-free, unit-tested — means the trip screen and the manifest can
 * never disagree about what "board" looks like, and Phase 2's one-tap rows
 * inherit the same vocabulary.
 */

/** Icon names are exactly the `Ionicons` glyph set (type-only import: this
 *  module stays loadable under plain `node --test`). */
export type CrewActionIcon = keyof typeof Ionicons.glyphMap;

/** Matches the filled `ButtonTone` palette in `components/ui.tsx`. */
export type CrewActionTone = 'primary' | 'success' | 'danger' | 'neutral';

export interface CrewActionMeta {
  icon: CrewActionIcon;
  tone: CrewActionTone;
}

/** Icon + colour of a forward trip-lifecycle button ("Start boarding"…). */
export function transitionActionMeta(next: TripStatus): CrewActionMeta {
  switch (next) {
    case TripStatus.BOARDING:
      return { icon: 'people', tone: 'success' };
    case TripStatus.IN_PROGRESS:
      return { icon: 'navigate', tone: 'primary' };
    case TripStatus.COMPLETED:
      return { icon: 'checkmark-done', tone: 'neutral' };
    default:
      return { icon: 'arrow-forward', tone: 'primary' };
  }
}

/** Icon + colour of a manifest attendance action. */
export function attendanceActionMeta(action: 'board' | 'drop'): CrewActionMeta {
  return action === 'board'
    ? { icon: 'log-in', tone: 'success' }
    : { icon: 'log-out', tone: 'neutral' };
}
