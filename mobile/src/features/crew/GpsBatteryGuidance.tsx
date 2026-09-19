import React, { useCallback } from 'react';
import { Platform, StyleSheet, Text, View, Linking } from 'react-native';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { Button } from '../../components';
import { t } from '../../lib/i18n.ts';
import {
  BATTERY_HONESTY_COPY_KEY,
  batteryGuidanceFor,
  shouldShowBatteryGuidance,
} from './battery-guidance.ts';
import type { CrewLocationSharing } from './useCrewLocationSharing.ts';

/**
 * Battery / background-restriction guidance for the Help screen.
 *
 * Deliberately **guidance, not detection**: no supported Expo API reports
 * Android's battery-optimisation bucket, an OEM power saver, or iOS Low Power
 * Mode, so this card never claims to know whether the phone is restricted
 * (`battery-guidance.ts` returns `detected: null` by contract). It tells the
 * crew member which setting to check, offers the supported way to open it, and
 * states plainly that the app cannot promise uninterrupted GPS and will not
 * bypass a restriction the user or the OS set.
 *
 * Shown only while background tracking is expected to run — a foreground-only
 * session ends with the screen either way, and advice that cannot help is noise.
 */
export const GpsBatteryGuidance: React.FC<{ sharing: CrewLocationSharing }> = ({ sharing }) => {
  const guidance = batteryGuidanceFor(Platform.OS);

  const openSettings = useCallback(() => {
    if (guidance.settingsAction === 'battery-optimisation-intent' && guidance.androidIntentAction) {
      // Navigation to the system list — the user still decides, the OS still
      // enforces. Failure (an OEM without this screen) falls back to the app's
      // own settings page rather than dead-ending.
      void Linking.sendIntent(guidance.androidIntentAction).catch(() => {
        void Linking.openSettings().catch(() => undefined);
      });
      return;
    }
    if (guidance.settingsAction === 'app-settings') {
      void Linking.openSettings().catch(() => undefined);
    }
  }, [guidance]);

  if (
    !shouldShowBatteryGuidance({
      platform: Platform.OS,
      backgroundActive: sharing.backgroundActive,
      backgroundConsent: sharing.backgroundConsent,
    })
  ) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t(guidance.copy.title)}</Text>
      <Text style={styles.body}>{t(guidance.copy.body)}</Text>
      <Text style={styles.honesty}>{t(BATTERY_HONESTY_COPY_KEY)}</Text>
      {guidance.settingsAction === 'none' ? null : (
        <Button
          label={t(guidance.copy.action)}
          icon="battery-full"
          variant="secondary"
          size="md"
          onPress={openSettings}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  body: {
    fontSize: 14,
    color: colors.neutral[700],
    lineHeight: 20,
  },
  honesty: {
    fontSize: 14,
    color: colors.neutral[600],
    lineHeight: 20,
  },
});
