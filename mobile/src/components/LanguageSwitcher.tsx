import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { fontScaleCaps, loginText, loginTouch, surface, touch } from '../theme';
import { SUPPORTED_LOCALES, setLocale, type Locale } from '../lib/i18n';
import { useLocale, useTranslation } from '../lib/i18n-provider';
import { Card } from './Card';

/**
 * The "English / हिन्दी / मराठी" switch (Phase 3a + regional rollout).
 *
 * Two surfaces share it: {@link LanguageSwitcher} is the full card on the Help
 * screen, {@link LanguageMenu} is the single dropdown on the login screen.
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
 * The compact switch for the **login screen** — ONE dropdown control above the
 * sign-in card, on the dark hero background.
 *
 * Replaces the earlier row of three identical pills. Same behaviour (instant,
 * persisted, each language names itself), far less chrome: a closed control
 * shows a globe, the current language and a caret; opening it lists
 * `English / हिंदी / मराठी` with a tick on the active one.
 *
 * Implementation notes, because they are constraints rather than preferences:
 *
 * - **No new dependency.** `docs/mobile-expo-sdk.md` pins the Expo SDK line and
 *   every new native module is a risk, so this is a `Pressable` plus an
 *   absolutely-positioned menu inside a `View` that owns its own stacking —
 *   not a picker library. The backdrop `Pressable` is what closes it on an
 *   outside tap.
 * - **The menu renders *after* the chip in the same relatively-positioned
 *   wrapper**, so it paints on top of the sign-in card below without a `Modal`
 *   (a `Modal` would also swallow the Android back button and re-mount the
 *   screen's focus state).
 * - **Persistence is the provider's**, via `setLocale` — the same call the Help
 *   screen's switcher makes, so both stay in step and the choice survives a
 *   cold start.
 */
export const LanguageMenu: React.FC = () => {
  const locale = useLocale();
  const t = useTranslation();
  const [open, setOpen] = React.useState(false);

  const currentLabel = t(SELF_NAME_KEY[locale] ?? 'settings.language.nameEn');

  return (
    <View style={menuStyles.wrap}>
      <Pressable
        onPress={() => setOpen((wasOpen) => !wasOpen)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('settings.language.a11y')}
        accessibilityHint={t('settings.language.a11yHint')}
        style={({ pressed }) => [menuStyles.chip, pressed ? menuStyles.chipPressed : null]}
      >
        <Ionicons name="language" size={18} color="#ffffff" />
        <Text {...fontScaleCaps.label} style={menuStyles.chipLabel} numberOfLines={1}>
          {currentLabel}
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.neutral[300]}
        />
      </Pressable>

      {open ? (
        <>
          {/* Closes on an outside tap; covers the card underneath so a tap
              there cannot fall through to a field. */}
          <Pressable
            style={menuStyles.backdrop}
            onPress={() => setOpen(false)}
            accessibilityRole="none"
          />
          <View style={menuStyles.list} accessibilityRole="menu">
            {SUPPORTED_LOCALES.map((option) => {
              const selected = option === locale;
              return (
                <Pressable
                  key={option}
                  onPress={() => {
                    setLocale(option);
                    setOpen(false);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected, checked: selected }}
                  accessibilityLabel={t(SELF_NAME_KEY[option])}
                  style={({ pressed }) => [
                    menuStyles.item,
                    pressed ? menuStyles.itemPressed : null,
                  ]}
                >
                  <Ionicons
                    name={selected ? 'checkmark' : 'language'}
                    size={18}
                    color={selected ? surface.actionPrimary : colors.neutral[500]}
                  />
                  <Text
                    {...fontScaleCaps.label}
                    style={[menuStyles.itemLabel, selected ? menuStyles.itemLabelSelected : null]}
                  >
                    {t(SELF_NAME_KEY[option])}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
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

/** Login-screen dropdown. Colours are for the dark hero background. */
const menuStyles = StyleSheet.create({
  // `zIndex` + a self-stretching wrapper are what let the menu paint over the
  // sign-in card that follows it in the same scroll view.
  wrap: {
    alignSelf: 'center',
    zIndex: 10,
  },
  chip: {
    minHeight: loginTouch.chip,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1.5,
    borderColor: colors.neutral[500],
    borderRadius: borderRadius.full,
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipLabel: {
    fontSize: loginText.label,
    fontWeight: '700',
    color: '#ffffff',
  },
  backdrop: {
    position: 'absolute',
    // Stretches well past the chip in every direction so an outside tap closes
    // the menu instead of hitting the form underneath.
    top: -2000,
    bottom: -2000,
    left: -2000,
    right: -2000,
  },
  list: {
    position: 'absolute',
    top: loginTouch.chip + spacing.xs,
    alignSelf: 'center',
    minWidth: 180,
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    paddingVertical: spacing.xs,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  item: {
    minHeight: loginTouch.menuRow,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemPressed: {
    backgroundColor: colors.neutral[100],
  },
  itemLabel: {
    fontSize: loginText.label,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  itemLabelSelected: {
    color: surface.actionPrimary,
    fontWeight: '700',
  },
});
