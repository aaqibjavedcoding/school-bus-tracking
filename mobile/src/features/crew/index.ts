/**
 * Shared crew feature (DRIVER + CONDUCTOR).
 *
 * Both roles run exactly these screens on one architecture: the API scopes
 * `GET /trips` to the caller's own runs and authorizes both crew roles for
 * attendance, status transitions and GPS emission, so nothing here branches
 * on the role except small labels.
 *
 * Task 44 adds the two role-flavoured panels — `SosPanel` (identical for
 * both: an emergency is an emergency) and `TripNavigationCard` (driver-only,
 * because it is about driving) — plus the pure stop-selection helpers they
 * rest on.
 */
export {
  pickCrewTrip,
  nextCrewTransitions,
  transitionLabel,
  manifestCounts,
  groupManifestByStop,
  isTripOpen,
} from './crew-trip';
export type { ManifestStopGroup } from './crew-trip';
export { useCrewToday } from './useCrewToday';
export type { CrewTodayData } from './useCrewToday';
export { useCrewLocationSharing, isTripShareable } from './useCrewLocationSharing';
export type { CrewLocationSharing, PermissionState } from './useCrewLocationSharing';
export { transitionActionMeta, attendanceActionMeta } from './crew-action-meta';
export type { CrewActionMeta, CrewActionTone, CrewActionIcon } from './crew-action-meta';
export { TripStatusActions } from './TripStatusActions';
export { ManifestList } from './ManifestList';
export { StatusCard } from './StatusCard';
export { GpsShareStrip } from './GpsShareStrip';
export { GpsSharePanel } from './GpsSharePanel';
export { HoldToConfirmButton } from './HoldToConfirmButton';
export { SosPanel, SosQuickPanel, SosStatusLine, useCrewSos } from './SosPanel';
export type { SosPanelProps } from './SosPanel';
export { TripNavigationCard } from './TripNavigationCard';
export type { TripNavigationCardProps } from './TripNavigationCard';
export { navigationTargetOf, pickNextStop } from './navigation-stop';
export { tripStatusStyle, primaryTripAction } from './trip-status-style';
export { crewCopy } from './crew-copy';
// Phase 3b — voice + haptics. `crew-feedback` is the only event→feedback
// mapping; `crew-voice` / `crew-haptics` are the pure per-channel rules;
// `crew-feedback.native` (imported for its side effects by the root layout) is
// the only file that touches expo-speech / expo-haptics / AsyncStorage.
export {
  CrewFeedback,
  FEEDBACK_STORAGE_KEY,
  INITIAL_FEEDBACK_PREFERENCES,
  MAX_ANNOUNCEMENTS_PER_BURST,
  configureFeedbackAdapters,
  configureFeedbackStore,
  feedback,
  feedbackDefaultsForRole,
  parsePreferences,
} from './crew-feedback';
export type {
  CrewFeedbackEvent,
  FeedbackAdapters,
  FeedbackDispatch,
  FeedbackPreferences,
  FeedbackStore,
  HapticsAdapter,
  VoiceAdapter,
} from './crew-feedback';
export {
  VOICE_LANGUAGE_TAGS,
  VOICE_MAX_ANNOUNCEMENTS_PER_BURST,
  VOICE_MIN_GAP_MS,
  VOICE_PITCH,
  VOICE_RATE,
  VOICE_SUMMARY_THRESHOLD,
  VoiceGate,
  isSpeakable,
  voiceLanguageFor,
  voicePhraseFor,
  voicePrivacyViolations,
  voiceStudentEvent,
} from './crew-voice';
export type {
  VoiceCountPayload,
  VoiceDecision,
  VoiceEventKind,
  VoicePayload,
  VoiceStudentPayload,
} from './crew-voice';
export { HAPTICS_PATTERNS, hapticsFor } from './crew-haptics';
export type { HapticsEventKind, HapticsPattern } from './crew-haptics';
export { FeedbackSettings, useCrewFeedbackDefaults } from './FeedbackSettings';
