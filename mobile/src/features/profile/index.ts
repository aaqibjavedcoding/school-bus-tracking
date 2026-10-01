/**
 * "My Profile" — the signed-in account's own photo.
 *
 * Shared by more than one role, which is why it is a feature of its own
 * rather than part of `features/crew`: the API lets a driver, a conductor
 * **and** a school admin own a photo ([DECISION 1]), and both navigators
 * mount the same card.
 *
 * The split is the usual one: `profile-photo.ts` and `profile-photo-source.ts`
 * are pure and spec'd, `profile-photo-storage.ts` is the only file that
 * touches AsyncStorage (an offline cache, never the source of truth), and
 * the two components are the React glue.
 */
export { ProfilePhotoCard } from './ProfilePhotoCard';
export { ProfileHeaderButton } from './ProfileHeaderButton';
export { useProfilePhoto } from './useProfilePhoto';
export {
  initialProfilePhotoState,
  isProfilePhotoBusy,
  pickPictureSize,
  profileAvatarPresentation,
  profilePhotoMessage,
  profilePhotoReducer,
  profilePhotoUploadPart,
  retryAttempt,
} from './profile-photo';
export type {
  ProfileAvatarPresentation,
  ProfilePhotoAttempt,
  ProfilePhotoEvent,
  ProfilePhotoState,
  ProfilePhotoStatus,
} from './profile-photo';
export {
  isRenderablePhotoUri,
  photoCacheKey,
  photoDataUri,
  resolvePhoto,
} from './profile-photo-source';
export type { PhotoResolution } from './profile-photo-source';
