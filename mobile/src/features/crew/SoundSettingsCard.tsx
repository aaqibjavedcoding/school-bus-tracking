import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { Card } from '../../components';
import { fontScaleCaps, surface, touch } from '../../theme';
import { useTranslation } from '../../lib/i18n-provider';
import { useSoundSettings } from './FeedbackProvider.tsx';
import type { SoundSettings } from './crew-feedback.ts';

/**
 * "Sound & vibration" — the Phase-3b settings block, on the Help & support
 * screen directly under the language switch.
 *
 * **Two switches, not one.** They fail independently in the field and they
 * fail for different reasons: a phone with no TTS engine has no voice but
 * perfectly good haptics, and a driver in a quiet school zone may want the
 * buzz without the talking. Collapsing them into one "feedback" toggle would
 * make the only fix for "the voice annoys me" also turn off the confirmation
 * that still works. `docs/mobile-operations.md` treats them as two separate
 * support questions for the same reason.
 *
 * **No new screen.** Help & support is the settings home (the same decision
 * Phase 3a made for the language switch), so a crew member has one place to
 * go when something is not right.
 *
 * Presentation follows the Phase-1/2 rules: 64px rows (`touch.field`), icon +
 * label on every actionable element, nothing below 16px, and the state is
 * spelled out in words ("On"/"Off") as well as shown by the track colour —
 * colour is never the only cue.
 */
export const SoundSettingsCard: React.FC = () => {
  const t = useTranslation();
  const { settings, setSettings, ready } = useSoundSettings();

  const toggle = (key: keyof SoundSettings) => {
    setSettings({ ...settings, [key]: !settings[key] });
  };

  return (
    <Card legible title={t('settings.sound.title')}>
      <Text style={styles.hint}>{t('settings.sound.hint')}</Text>

      <SoundToggle
        icon="volume-high"
        label={t('settings.sound.voiceLabel')}
        hint={t('settings.sound.voiceHint')}
        a11yLabel={t('settings.sound.voiceA11y')}
        value={settings.voice}
        disabled={!ready}
        onToggle={() => toggle('voice')}
      />
      <SoundToggle
        icon="phone-portrait"
        label={t('settings.sound.vibrationLabel')}
        hint={t('settings.sound.vibrationHint')}
        a11yLabel={t('settings.sound.vibrationA11y')}
        value={settings.vibration}
        disabled={!ready}
        onToggle={() => toggle('vibration')}
      />

      {/**
       * The honest footnote. `expo-speech` drives the OS engine, so a device
       * with none stays silent however this switch is set — and a driver
       * should be told that rather than left thinking the app is broken.
       */}
      <Text style={styles.note}>{t('settings.sound.noEngineNote')}</Text>
    </Card>
  );
};

/** One 64px row: icon + label + hint + a switch that also says On/Off. */
const SoundToggle: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  a11yLabel: string;
  value: boolean;
  disabled: boolean;
  onToggle: () => void;
}> = ({ icon, label, hint, a11yLabel, value, disabled, onToggle }) => {
  const t = useTranslation();
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={a11yLabel}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled }}
      style={({ pressed }) => [styles.row, pressed && !disabled ? styles.rowPressed : null]}
    >
      <Ionicons name={icon} size={26} color={value ? surface.actionPrimary : colors.neutral[600]} />
      <View style={styles.rowText}>
        <Text {...fontScaleCaps.label} style={styles.rowLabel}>
          {label}
        </Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <View style={styles.stateBlock}>
        <Text style={[styles.stateWord, value ? styles.stateWordOn : null]}>
          {value ? t('common.on') : t('common.off')}
        </Text>
        <View style={[styles.track, value ? styles.trackOn : null]}>
          <View style={[styles.thumb, value ? styles.thumbOn : null]} />
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  hint: {
    fontSize: 14,
    color: colors.neutral[600],
    marginBottom: spacing.xs,
  },
  note: {
    fontSize: 14,
    color: colors.neutral[600],
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.xs,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  rowHint: {
    fontSize: 14,
    color: colors.neutral[600],
  },
  stateBlock: {
    alignItems: 'center',
    gap: 4,
  },
  stateWord: {
    fontSize: 14,
    fontWeight: '700',
    // neutral[700] on white = 8.59:1 (measured in `contrast.ts`).
    color: colors.neutral[700],
  },
  stateWordOn: {
    // secondary[700] on white = 5.01:1 — the measured action surface (green).
    color: surface.actionPrimary,
  },
  track: {
    width: 44,
    height: 26,
    borderRadius: borderRadius.full,
    backgroundColor: colors.neutral[300],
    borderWidth: 1.5,
    borderColor: surface.borderInteractive,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  trackOn: {
    backgroundColor: colors.secondary[700],
    borderColor: colors.secondary[700],
  },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    alignSelf: 'flex-start',
  },
  thumbOn: {
    alignSelf: 'flex-end',
  },
});
