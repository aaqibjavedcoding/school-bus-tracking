import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { fontScaleCaps, surface, touch } from '../theme';
import { SUPPORTED_LOCALES, setLocale, type Locale } from '../lib/i18n';
import { useLocale, useTranslation } from '../lib/i18n-provider';
import { Card } from './Card';

/**
 * The "English / हिन्दी / मराठी" switch (Phase 3a + regional rollout).
 *
 * Three deliberate choices:
 *
 * - **Each language names itself** (`English`, `हिन्दी`, `मराठी`) rather than
 *   being translated into the current one — a driver who cannot read English
 *   must be able to find मराठी while the app is still showing English. That
 *   is why those labels are the same in every dictionary and are listed in
 *   `LOCALE_INVARIANT_KEYS`.
 * - **Icon + label on both options**, and 64px targets — the Phase-1/2 rule
 *   that every actionable element carries both cues. The row wraps, so a
 *   fourth locale (batch 2: Gujarati, Punjabi, …) costs no layout work.
 * - **Switching is instant and persisted.** `setLocale` notifies subscribers
 *   (every screen re-renders in place, no restart, navigation state intact)
 *   and writes the preference to AsyncStorage, so the next cold start opens
 *   in the same language.
 */

/**
 * Each locale's self-designation key — added per locale, checked by parity.
 * Typed as the narrow parameter-free union so `t(key)` needs no params.
 */
const SELF_NAME_KEY: Record<
  Locale,
  'settings.language.nameEn' | 'settings.language.nameHi' | 'settings.language.nameMr'
> = {
  en: 'settings.language.nameEn',
  hi: 'settings.language.nameHi',
  mr: 'settings.language.nameMr',
};

export const LanguageSwitcher: React.FC = () => {
  const locale = useLocale();
  const t = useTranslation();

  return (
    <Card legible title={t('help.languageTitle')}>
      <Text style={styles.hint}>{t('help.languageHint')}</Text>
      <View
        style={styles.row}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('settings.language.a11y')}
      >
        {SUPPORTED_LOCALES.map((option) => (
          <LanguageOption key={option} value={option} selected={option === locale} />
        ))}
      </View>
      <Text style={styles.current}>
        {t('help.languageCurrent')}:{' '}
        {t(SELF_NAME_KEY[locale] ?? 'settings.language.nameEn')}
      </Text>
    </Card>
  );
};

/** One 64px option: globe icon + the language's own name. */
const LanguageOption: React.FC<{ value: Locale; selected: boolean }> = ({ value, selected }) => {
  const t = useTranslation();
  const label = t(SELF_NAME_KEY[value]);

  return (
    <Pressable
      onPress={() => setLocale(value)}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={label}
      accessibilityHint={t('settings.language.a11yHint')}
      style={[styles.option, selected ? styles.optionSelected : null]}
    >
      <Ionicons
        name="language"
        size={22}
        color={selected ? surface.actionPrimary : colors.neutral[600]}
      />
      <Text
        {...fontScaleCaps.label}
        style={[styles.optionLabel, selected ? styles.optionLabelSelected : null]}
      >
        {label}
      </Text>
    </Pressable>
  );
};

/**
 * The compact switch for the **login screen** — a row of self-naming pills
 * above the sign-in card, on the dark hero background.
 *
 * Same behaviour as the Help-screen switcher (instant, persisted,
 * self-naming), smaller chrome: no card, no hint — the login screen is the
 * first screen a driver sees, and the default is English until they pick
 * otherwise (product rule — see `CREW_DEFAULT_LOCALE` in `lib/i18n.ts`).
 */
export const LanguagePillRow: React.FC = () => {
  const locale = useLocale();
  const t = useTranslation();

  return (
    <View
      style={pillStyles.row}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('settings.language.a11y')}
    >
      {SUPPORTED_LOCALES.map((option) => (
        <LanguagePill key={option} value={option} selected={option === locale} />
      ))}
    </View>
  );
};

/** One 44dp pill on the dark login hero. */
const LanguagePill: React.FC<{ value: Locale; selected: boolean }> = ({ value, selected }) => {
  const t = useTranslation();
  const label = t(SELF_NAME_KEY[value]);

  return (
    <Pressable
      onPress={() => setLocale(value)}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={label}
      accessibilityHint={t('settings.language.a11yHint')}
      style={[pillStyles.pill, selected ? pillStyles.pillSelected : null]}
    >
      <Ionicons
        name="language"
        size={16}
        color={selected ? '#ffffff' : colors.neutral[400]}
      />
      <Text {...fontScaleCaps.label} style={[pillStyles.pillLabel, selected ? pillStyles.pillLabelSelected : null]}>
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  hint: {
    fontSize: 14,
    color: colors.neutral[600],
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  option: {
    flex: 1,
    minWidth: 96,
    minHeight: touch.field,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: colors.neutral[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
  },
  optionSelected: {
    borderColor: surface.actionPrimary,
    backgroundColor: colors.secondary[50],
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.neutral[700],
  },
  optionLabelSelected: {
    color: surface.actionPrimary,
  },
  current: {
    fontSize: 14,
    color: colors.neutral[600],
    marginTop: spacing.xs,
  },
});

const pillStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  pill: {
    minHeight: touch.compact,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1.5,
    borderColor: colors.neutral[600],
    borderRadius: borderRadius.full,
  },
  pillSelected: {
    backgroundColor: surface.actionPrimary,
    borderColor: surface.actionPrimary,
  },
  pillLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.neutral[200],
  },
  pillLabelSelected: {
    color: '#ffffff',
  },
});
