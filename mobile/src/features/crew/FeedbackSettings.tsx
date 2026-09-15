import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { fontScaleCaps, surface, touch } from '../../theme';
import { Card } from '../../components';
import { useTranslation } from '../../lib/i18n-provider';
import { crewCopy } from './crew-copy.ts';
import { feedback, type FeedbackPreferences } from './crew-feedback.ts';

/**
 * "Sound & vibration" on the Help & support screen (Phase 3b).
 *
 * **Two toggles, not one combined switch** — deliberately. The two channels
 * fail independently and are wanted independently: a budget Android with no
 * TTS engine still has a perfectly good vibrator, a conductor in a quiet
 * school office may want the buzz without the voice, and a driver on a noisy
 * road wants the voice whether or not the phone buzzes. One combined switch
 * would force both off to silence either.
 *
 * The defaults are role-based (`feedbackDefaultsForRole`): crew get both on,
 * `SCHOOL_ADMIN`/`PARENT` get voice **off** — the office screens are used at a
 * desk, where an app announcing "Ramesh boarded" is noise. The role default is
 * applied by {@link useCrewFeedbackDefaults} from the crew layout, the same
 * place `useRoleLocaleDefault` applies the Hindi default; an explicit toggle
 * here always wins and persists.
 *
 * Phase-1/2 rules hold: 64px rows (`touch.field`), icon **and** label on every
 * control, 16px text floor (asserted by `theme/legibility.spec.ts`, which scans
 * this folder), and the switch colours are measured rows in
 * `theme/contrast.ts` ("settings switch ON" / "settings switch OFF border").
 */
export function useCrewFeedbackDefaults(role: string | null | undefined): void {
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !role) return;
    applied.current = true;
    void (async () => {
      // A saved choice (from this screen) outranks the role default; the
      // `crew-feedback.native` import already started this read at boot, and
      // re-reading here is what makes the ordering certain rather than racy.
      await feedback.loadPersisted();
      feedback.applyRoleDefault(role);
    })();
  }, [role]);
}

export const FeedbackSettings: React.FC = () => {
  // Subscribes to the locale: every label here comes from `crewCopy`, which
  // reads `t()` at call time, so a language switch must re-render this card.
  useTranslation();
  const [prefs, setPrefs] = useState<FeedbackPreferences>(() => feedback.preferences);

  useEffect(() => feedback.subscribe(setPrefs), []);

  const toggle = (key: keyof FeedbackPreferences) => {
    // The haptic fires *before* the new value is stored, so turning vibration
    // OFF still buzzes once — the crew member feels the tap they just made.
    if (key === 'vibration' && prefs.vibration) feedback.on('toggle');
    feedback.setPreferences({ [key]: !prefs[key] });
    if (key === 'voice') feedback.on('toggle');
  };

  return (
    <Card legible title={crewCopy.feedback.title}>
      <Text style={styles.hint}>{crewCopy.feedback.hint}</Text>

      <FeedbackToggleRow
        icon="volume-high"
        label={crewCopy.feedback.voice}
        hint={crewCopy.feedback.voiceHint}
        value={prefs.voice}
        onToggle={() => toggle('voice')}
      />
      <FeedbackToggleRow
        icon="pulse"
        label={crewCopy.feedback.vibration}
        hint={crewCopy.feedback.vibrationHint}
        value={prefs.vibration}
        onToggle={() => toggle('vibration')}
      />

      {/**
       * One tap that exercises exactly what is switched on — the diagnostic
       * support asks for when a call comes in as "voice nahi aa rahi". If
       * nothing is heard, the voice row above is the answer, not a bug.
       */}
      <Pressable
        onPress={() => feedback.on('test')}
        accessibilityRole="button"
        accessibilityLabel={crewCopy.feedback.test}
        accessibilityHint={crewCopy.feedback.a11yHint}
        style={({ pressed }) => [styles.testRow, pressed ? styles.testRowPressed : null]}
      >
        <Ionicons name="play" size={22} color={surface.actionPrimary} />
        <Text {...fontScaleCaps.label} style={styles.testLabel}>
          {crewCopy.feedback.test}
        </Text>
      </Pressable>
    </Card>
  );
};

const FeedbackToggleRow: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  value: boolean;
  onToggle: () => void;
}> = ({ icon, label, hint, value, onToggle }) => (
  <Pressable
    onPress={onToggle}
    accessibilityRole="switch"
    accessibilityState={{ checked: value }}
    accessibilityLabel={label}
    accessibilityHint={hint}
    style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
  >
    <Ionicons
      name={icon}
      size={26}
      color={value ? surface.actionSuccess : colors.neutral[500]}
      style={styles.icon}
    />
    <View style={styles.rowText}>
      <Text {...fontScaleCaps.label} style={styles.label}>
        {label}
      </Text>
      <Text {...fontScaleCaps.label} style={styles.rowHint}>
        {hint}
      </Text>
    </View>
    <View style={[styles.track, value ? styles.trackOn : styles.trackOff]} accessible={false}>
      <View style={[styles.thumb, value ? styles.thumbOn : null]} />
    </View>
  </Pressable>
);

const styles = StyleSheet.create({
  hint: {
    fontSize: 16,
    color: colors.neutral[600],
    marginBottom: spacing.sm,
  },
  row: {
    minHeight: touch.field,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
    backgroundColor: '#ffffff',
  },
  rowPressed: {
    borderColor: colors.neutral[400],
    backgroundColor: colors.neutral[50],
  },
  icon: {
    width: 30,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  rowHint: {
    fontSize: 16,
    color: colors.neutral[600],
  },
  track: {
    width: 52,
    height: 32,
    borderRadius: 16,
    padding: 3,
    justifyContent: 'center',
  },
  // neutral-500 border keeps the OFF state ≥3:1 against the white row
  // (measured in `theme/contrast.ts` → "settings switch OFF border").
  trackOff: {
    backgroundColor: colors.neutral[300],
    borderWidth: 2,
    borderColor: colors.neutral[500],
  },
  trackOn: {
    backgroundColor: surface.actionSuccess,
  },
  thumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#ffffff',
  },
  thumbOn: {
    alignSelf: 'flex-end',
  },
  testRow: {
    minHeight: touch.field,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.neutral[50],
  },
  testRowPressed: {
    backgroundColor: colors.neutral[100],
  },
  testLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.neutral[700],
  },
});
