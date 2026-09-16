import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/ui';
import { useTranslation } from '../../lib/i18n-provider';
import { borderRadius, colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { buildCrewQrPayload } from './crew-login-flow.ts';

/**
 * Crew pairing-QR scanner (Mobile-UX Phase 4b).
 *
 * What this component owns:
 *
 * - the camera viewfinder (one `CameraView` from `expo-camera`, scoped to
 *   the QR code type — we never decode a barcode we are not asking for);
 * - the permission handshake (granted / denied / undetermined), with a
 *   visible fallback path the user can take without ever leaving the
 *   screen;
 * - a paste-the-code fallback that bypasses the camera entirely when
 *   permission was denied, the camera is broken, or the user prefers to
 *   type — the same payload parser is shared between the two paths;
 * - de-duplication of identical frames: the camera fires `onBarcodeScanned`
 *   many times per second while a code is on screen, so the *first* hit
 *   forwards to the parent and every subsequent hit is dropped until the
 *   parent dismisses this component.
 *
 * What this component does NOT own:
 *
 * - the network call. The parent hands `onPayload({ method, pairing_token })`
 *   the prepared request body — `buildCrewQrPayload` already validated the
 *   prefix and built the shape `apiClient.crewLogin` expects;
 * - navigation. The parent listens for `onPayload` and calls
 *   `useAuth().crewLogin(...)` itself.
 * - feedback (haptic / voice). The login screen owns the success / failure
 *   paths through `feedback.on({ type: 'action.rejected' })` and similar,
 *   because feedback is only meaningful once the network call has resolved.
 */

export interface CrewQrScannerProps {
  /** The user pressed Cancel / scanned a code / pasted a code. */
  onClose: () => void;
  /**
   * A QR payload was successfully decoded (from the camera *or* pasted).
   * The parent is responsible for the network call.
   */
  onPayload: (body: { method: 'qr'; pairing_token: string }) => void;
}

/**
 * Status of the camera permission handshake.
 *
 * `'idle'` covers the brief window before `useCameraPermissions` returns the
 * OS-reported state; we don't show the "open settings" branch before we know
 * the answer.
 */
type PermissionState = 'idle' | 'undetermined' | 'granted' | 'denied' | 'restricted';

export const CrewQrScanner: React.FC<CrewQrScannerProps> = ({ onClose, onPayload }) => {
  const t = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [showPaste, setShowPaste] = useState(false);
  const forwardedRef = useRef(false);

  /**
   * The OS-reported permission collapses to the small union this component
   * needs. `null` (the first render of `useCameraPermissions`) is treated
   * as `'undetermined'` so we can render the "request" branch.
   */
  const state: PermissionState = (() => {
    if (!permission) return 'idle';
    if (permission.granted) return 'granted';
    if (permission.canAskAgain === false) return 'denied';
    return 'undetermined';
  })();

  const forwardOnce = useCallback(
    (rawPayload: string | null | undefined) => {
      if (forwardedRef.current) return;
      const parsed = buildCrewQrPayload(rawPayload);
      if (!parsed.ok) return;
      forwardedRef.current = true;
      onPayload(parsed.body);
    },
    [onPayload],
  );

  /**
   * Normalizes a barcode event to a plain payload string.
   *
   * `expo-camera` changed the shape of the value passed to
   * `onBarcodeScanned` between SDKs: older SDKs wrap the result in
   * `nativeEvent` (`{ nativeEvent: { data, type } }`), newer SDKs pass the
   * result object itself (`{ data, type }`). Reading
   * `event.nativeEvent.data` directly crashed on the new shape
   * (`TypeError: Cannot read property 'data' of undefined` on every scan
   * frame), so both shapes are accepted here.
   */
  const handleBarcodeScanned = useCallback(
    (event: unknown) => {
      let data: string | null = null;
      if (typeof event === 'string') {
        data = event;
      } else if (event !== null && typeof event === 'object') {
        const candidate = event as { data?: unknown; nativeEvent?: { data?: unknown } };
        const wrapped = candidate.nativeEvent?.data;
        if (typeof wrapped === 'string') {
          data = wrapped;
        } else if (typeof candidate.data === 'string') {
          data = candidate.data;
        }
      }
      forwardOnce(data);
    },
    [forwardOnce],
  );

  /**
   * Cancel = dismiss the camera (so it is not running in the background while
   * the parent navigates away) and notify the parent.
   */
  useEffect(() => {
    return () => {
      // The CameraView component itself releases the camera when unmounted;
      // this effect exists to be the documented hook for any future "stop
      // preview" call without changing the call sites again.
    };
  }, []);

  // ── Permission denied: paste path + "open settings" ─────────────────────
  if (state === 'denied') {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{t('login.crewPath.qr.permission.title')}</Text>
        <Text style={styles.body}>{t('login.crewPath.qr.permission.body')}</Text>
        <View style={styles.row}>
          <Button
            variant="secondary"
            label={t('login.crewPath.qr.permission.openSettings')}
            onPress={() => void Linking.openSettings()}
          />
          <Button
            variant="secondary"
            label={t('login.crewPath.qr.useTypeInstead')}
            onPress={() => setShowPaste(true)}
          />
        </View>
        <Button variant="ghost" label={t('login.crewPath.qr.cancelScan')} onPress={onClose} />
        {showPaste ? <PasteForm onSubmit={forwardOnce} onCancel={onClose} /> : null}
      </View>
    );
  }

  // ── Permission undetermined: one-tap request ───────────────────────────
  if (state !== 'granted') {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{t('login.crewPath.qr.title')}</Text>
        <Text style={styles.body}>{t('login.crewPath.qr.subtitle')}</Text>
        <View style={styles.row}>
          <Button
            label={t('login.crewPath.qr.openScanner')}
            onPress={async () => {
              await requestPermission();
            }}
            disabled={state === 'idle'}
          />
          <Button
            variant="secondary"
            label={t('login.crewPath.qr.useTypeInstead')}
            onPress={() => setShowPaste(true)}
          />
        </View>
        <Button variant="ghost" label={t('login.crewPath.qr.cancelScan')} onPress={onClose} />
        {showPaste ? <PasteForm onSubmit={forwardOnce} onCancel={onClose} /> : null}
      </View>
    );
  }

  // ── Granted: live camera + paste fallback ───────────────────────────────
  return (
    <View style={styles.root}>
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
          onBarcodeScanned={handleBarcodeScanned}
        />
        <View style={styles.overlay} pointerEvents="none">
          <Ionicons name="scan-circle-outline" size={56} color="#ffffff" />
        </View>
      </View>
      <Text style={styles.hint}>{t('login.crewPath.qr.subtitle')}</Text>
      <View style={styles.row}>
        <Button
          variant="secondary"
          label={t('login.crewPath.qr.useTypeInstead')}
          onPress={() => setShowPaste(true)}
        />
        <Button variant="ghost" label={t('login.crewPath.qr.cancelScan')} onPress={onClose} />
      </View>
      {showPaste ? <PasteForm onSubmit={forwardOnce} onCancel={onClose} /> : null}
    </View>
  );
};

/**
 * Paste fallback — one text input, one submit. Lives inside the scanner so
 * the camera permission state is irrelevant to it (a denied camera and an
 * undetermined camera both reach this branch). Validates through
 * `buildCrewQrPayload` so the wire format and the camera path cannot drift.
 */
const PasteForm: React.FC<{
  onSubmit: (payload: string) => void;
  onCancel: () => void;
}> = ({ onSubmit, onCancel }) => {
  const t = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = React.useRef<TextInput | null>(null);

  const submit = () => {
    const parsed = buildCrewQrPayload(value);
    if (!parsed.ok) {
      setError(t('login.crewPath.qr.pastePlaceholder'));
      return;
    }
    onSubmit(value);
  };

  return (
    <View style={styles.pasteCard}>
      <Text style={styles.title}>{t('login.crewPath.qr.pasteTitle')}</Text>
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={value}
        onChangeText={(next) => {
          setValue(next);
          setError(null);
        }}
        placeholder={t('login.crewPath.qr.pastePlaceholder')}
        placeholderTextColor={colors.neutral[400]}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      {error ? (
        <Text style={styles.error} role="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Button
          variant="secondary"
          label={t('login.crewPath.qr.cancelScan')}
          onPress={onCancel}
        />
        <Button
          label={t('login.crewPath.qr.pasteSubmit')}
          onPress={submit}
          disabled={value.trim().length === 0}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.neutral[900],
    flex: 1,
  },
  title: {
    color: '#ffffff',
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
  },
  body: {
    color: colors.neutral[300],
    fontSize: typography.fontSizes.base,
    lineHeight: 22,
  },
  hint: {
    color: colors.neutral[300],
    fontSize: typography.fontSizes.base,
    textAlign: 'center',
  },
  cameraWrap: {
    aspectRatio: 1,
    width: '100%',
    overflow: 'hidden',
    borderRadius: borderRadius.lg,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pasteCard: {
    backgroundColor: '#ffffff',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    color: colors.neutral[900],
    fontFamily: 'monospace',
    minHeight: 48,
  },
  error: {
    color: colors.status.danger,
    fontSize: typography.fontSizes.base,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
});
