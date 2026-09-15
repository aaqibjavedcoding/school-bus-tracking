import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { fontScaleCaps, surface, touch } from '../theme';
import { SUPPORTED_LOCALES, setLocale, type Locale } from '../lib/i18n';
import { useLocale, useTranslation } from '../lib/i18n-provider';
import { Card } from './Card';

/**
 * The "अंग्रेज़ी / English" switch (Phase 3), on the Help & support screen.
 *
 * Three deliberate choices:
 *
 * - **Each language names itself** (`English`, `हिन्दी`) rather than being
 *   translated into the current one — a crew member who cannot read English
 *   must be able to find हिन्दी while the app is still showing English. That
 *   is why those two labels are the same in both dictionaries and are listed
 *   in `LOCALE_INVARIANT_KEYS`.
 * - **Icon + label on both options**, and a 64px target — the Phase-1/2 rule
 *   that every actionable element carries both cues.
 * - **Switching is instant and persisted.** `setLocale` notifies subscribers
 *   (every screen re-renders in place, no restart, navigation state intact)
 *   and writes the preference to AsyncStorage, so the next cold start opens in
 *   the same language.
 */
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
        {locale === 'hi' ? t('settings.language.nameHi') : t('settings.language.nameEn')}
      </Text>
    </Card>
  );
};

/** One 64px option: globe icon + the language's own name. */
const LanguageOption: React.FC<{ value: Locale; selected: boolean }> = ({ value, selected }) => {
  const t = useTranslation();
  const label = value === 'hi' ? t('settings.language.nameHi') : t('settings.language.nameEn');

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

const styles = StyleSheet.create({
  hint: {
    fontSize: 16,
    color: colors.neutral[600],
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  option: {
    flex: 1,
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
    backgroundColor: colors.primary[50],
  },
  optionLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[700],
  },
  optionLabelSelected: {
    color: surface.actionPrimary,
  },
  current: {
    fontSize: 16,
    color: colors.neutral[600],
    marginTop: spacing.xs,
  },
});
