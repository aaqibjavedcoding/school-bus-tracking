import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { Button, Card } from '../../components';
import { apiClient } from '../../services/api';
import { unwrapEnvelope } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n-provider';
import { useAuth } from '../auth';
import { fontScaleCaps, surface } from '../../theme';
import {
  initialProfilePhotoState,
  isProfilePhotoBusy,
  pickPictureSize,
  profileAvatarPresentation,
  profilePhotoMessage,
  profilePhotoReducer,
  profilePhotoUploadPart,
  retryAttempt,
  type ProfilePhotoAttempt,
} from './profile-photo.ts';
import {
  clearStoredProfilePhoto,
  loadProfilePhoto,
  saveProfilePhoto,
} from './profile-photo-storage.ts';

/**
 * "My Profile" — the crew member's own photo, on the Help & support screen.
 *
 * **No new screen, by the same decision Phase 3 made for the language switch
 * and the Sound & vibration card:** Help is the one settings home a crew
 * member is sent to, so their photo lives there too. The card is small on
 * purpose — an avatar and two buttons — because that is the whole feature.
 *
 * **Camera only, no gallery.** The capture runs through `expo-camera`, which
 * the app already ships for the crew login QR path, so this adds no native
 * dependency. There is deliberately no image picker: the point is a photo of
 * the person driving today, and a gallery would also drag in file-access
 * permissions nobody here needs.
 *
 * **Online only.** The attendance queue (`features/crew/offline`) exists
 * because a missed boarding cannot be re-observed; an avatar can wait. A
 * failure therefore shows one error and a manual Retry that repeats exactly
 * what failed ({@link retryAttempt}) — nothing is queued, nothing retries in
 * the background, and the crew member is never told something was saved that
 * was not.
 *
 * All behaviour lives in `profile-photo.ts` (pure, spec'd); this file is the
 * React glue plus the camera modal.
 */
export const ProfilePhotoCard: React.FC = () => {
  const t = useTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [state, dispatch] = useReducer(profilePhotoReducer, initialProfilePhotoState);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView | null>(null);

  // Cold start: show the photo this device set (the API is write-only — see
  // the note in `profile-photo.ts`). A late read never overwrites a newer
  // local truth; the reducer enforces that.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadProfilePhoto(userId).then((stored) => {
      if (!cancelled) dispatch({ type: 'restored', photoUri: stored?.uri ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const busy = isProfilePhotoBusy(state);
  const message = profilePhotoMessage(state);
  const retry = retryAttempt(state);
  const avatar = profileAvatarPresentation(state.photoUri);

  const closeCamera = useCallback(() => {
    setCameraOpen(false);
    setCameraReady(false);
  }, []);

  /** Sends a captured file to the API and mirrors the confirmed result. */
  const upload = useCallback(
    async (uri: string) => {
      const part = profilePhotoUploadPart(uri);
      if (!part || !userId) {
        dispatch({ type: 'started', attempt: { action: 'upload', uri } });
        dispatch({ type: 'failed' });
        return;
      }
      dispatch({ type: 'started', attempt: { action: 'upload', uri } });
      try {
        const result = unwrapEnvelope(await apiClient.setAccountPhoto(part));
        if (!result?.profile_photo_key) {
          dispatch({ type: 'failed' });
          return;
        }
        void saveProfilePhoto(userId, { uri, key: result.profile_photo_key });
        dispatch({ type: 'succeeded' });
      } catch {
        // Online-only: the reason is not actionable for a crew member mid-run,
        // so one error line plus Retry is the whole recovery path.
        dispatch({ type: 'failed' });
      }
    },
    [userId],
  );

  /** Opens the camera, asking for the OS permission the first time. */
  const openCamera = useCallback(async () => {
    dispatch({ type: 'started', attempt: { action: 'capture' } });
    try {
      const granted = permission?.granted ? permission : await requestPermission();
      if (!granted?.granted) {
        dispatch({ type: 'failed' });
        return;
      }
      setCameraOpen(true);
      dispatch({ type: 'succeeded' });
    } catch {
      dispatch({ type: 'failed' });
    }
  }, [permission, requestPermission]);

  /** Takes the picture, closes the camera and uploads it. */
  const capture = useCallback(async () => {
    const instance = camera.current;
    if (!instance || !cameraReady) return;
    try {
      // `quality` plus the pinned capture size keeps the file well inside the
      // API's 2 MB cap without any image-processing dependency.
      const picture = await instance.takePictureAsync({ quality: 0.6 });
      closeCamera();
      if (picture?.uri) {
        await upload(picture.uri);
      }
    } catch {
      closeCamera();
      dispatch({ type: 'started', attempt: { action: 'capture' } });
      dispatch({ type: 'failed' });
    }
  }, [cameraReady, closeCamera, upload]);

  /** Pins the smallest sensible capture size this device offers. */
  const onCameraReady = useCallback(() => {
    setCameraReady(true);
    const instance = camera.current;
    if (!instance) return;
    void instance
      .getAvailablePictureSizesAsync()
      .then((sizes) => setPictureSize(pickPictureSize(sizes)))
      .catch(() => setPictureSize(undefined));
  }, []);

  /** Clears the photo server-side, then forgets the device mirror. */
  const remove = useCallback(async () => {
    dispatch({ type: 'started', attempt: { action: 'remove' } });
    try {
      await apiClient.clearAccountPhoto();
      if (userId) void clearStoredProfilePhoto(userId);
      dispatch({ type: 'succeeded' });
    } catch {
      dispatch({ type: 'failed' });
    }
  }, [userId]);

  /** The manual retry: repeat exactly the attempt that failed. */
  const runRetry = useCallback(
    (attempt: ProfilePhotoAttempt) => {
      if (attempt.action === 'upload') {
        void upload(attempt.uri);
        return;
      }
      if (attempt.action === 'remove') {
        void remove();
        return;
      }
      void openCamera();
    },
    [openCamera, remove, upload],
  );

  return (
    <Card legible title={t('profile.title')}>
      <View style={styles.row}>
        {avatar.kind === 'photo' ? (
          <Image
            source={{ uri: avatar.uri }}
            accessibilityLabel={t('profile.title')}
            style={styles.avatar}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Ionicons name="person" size={32} color={colors.neutral[500]} />
          </View>
        )}
        <View style={styles.actions}>
          <Button
            size="field"
            icon="camera"
            label={t('profile.takePhoto')}
            onPress={() => void openCamera()}
            disabled={busy}
          />
          {/**
           * Always available, never hidden: the server may hold a photo this
           * phone never saw (a re-install, a second device), and the crew
           * member must still be able to take it down. `DELETE` is idempotent.
           */}
          <Button
            size="field"
            variant="secondary"
            icon="trash"
            label={t('profile.removePhoto')}
            onPress={() => void remove()}
            disabled={busy}
          />
        </View>
      </View>

      {message ? (
        <View style={styles.messageRow}>
          <Ionicons
            name={message === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={20}
            color={message === 'success' ? surface.actionSuccess : colors.status.danger}
          />
          <Text
            {...fontScaleCaps.label}
            style={[styles.message, message === 'error' ? styles.messageError : null]}
          >
            {message === 'success' ? t('profile.updated') : t('profile.error')}
          </Text>
          {retry ? (
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              label={t('common.retry')}
              onPress={() => runRetry(retry)}
              disabled={busy}
            />
          ) : null}
        </View>
      ) : null}

      <Modal
        visible={cameraOpen}
        animationType="slide"
        onRequestClose={closeCamera}
        supportedOrientations={['portrait']}
      >
        <View style={styles.cameraRoot}>
          <CameraView
            ref={camera}
            style={styles.camera}
            facing="front"
            pictureSize={pictureSize}
            onCameraReady={onCameraReady}
          />
          <View style={styles.cameraBar}>
            <Pressable
              onPress={closeCamera}
              accessibilityRole="button"
              accessibilityLabel={t('common.dismiss')}
              hitSlop={12}
              style={styles.cameraClose}
            >
              <Ionicons name="close" size={28} color="#ffffff" />
            </Pressable>
            <Button
              size="field"
              icon="camera"
              label={t('profile.takePhoto')}
              onPress={() => void capture()}
              disabled={!cameraReady}
              style={styles.shutter}
            />
          </View>
        </View>
      </Modal>
    </Card>
  );
};

const AVATAR_SIZE = 56;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.neutral[100],
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flex: 1,
    gap: spacing.xs,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  message: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    // neutral[700] on white = 8.59:1 (measured in `theme/contrast.ts`).
    color: colors.neutral[700],
  },
  messageError: {
    color: colors.status.danger,
  },
  cameraRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  cameraBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: '#000000',
  },
  cameraClose: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutter: {
    flex: 1,
  },
});
