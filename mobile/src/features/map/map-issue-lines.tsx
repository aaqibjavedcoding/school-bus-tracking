import React, { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '@school-bus-tracking/design-tokens';
import { useTranslation } from '../../lib/i18n-provider';
import { t } from '../../lib/i18n.ts';
import { getMapIssues, runMapRetry, subscribeMapIssues } from './map-diagnostics.ts';

/**
 * The always-visible "something is up with the map" lines, rendered by both
 * map panels (the crew driver map and the school bus map).
 *
 * ### Red is not the default any more
 *
 * A red "Map failed to load — check your network connection and map tiles."
 * used to appear the moment the bundled offline base style took over. But the
 * offline fallback is a **working map**: the stops, the bus, the accuracy ring
 * and the status panel are React Native overlays that draw over it perfectly
 * well. Calling that a failure was the app lying about its own health, and it
 * trained drivers to ignore the line that matters.
 *
 * So there are two weights now:
 *
 * - `styleOffline` → a **neutral chip with a Retry affordance** ("Offline map
 *   — tap to retry"). Tapping re-runs the whole style pipeline
 *   (`map-diagnostics.ts` → `runMapRetry`); the network coming back does the
 *   same thing on its own.
 * - `styleLoad` / `glyphs` → the red line, kept for the terminal states: the
 *   engine cannot render even a zero-network style, or the fonts endpoint is
 *   verifiably gone.
 *
 * Each line still ends with its machine-readable issue **code** in muted text
 * — `Offline map — tap to retry (styleOffline)`. The code carries no
 * translation on purpose: it is the token a field screenshot can quote
 * verbatim, and Help → Diagnostics repeats it for the same reason.
 */
const ISSUE_KEYS = {
  styleLoad: 'map.issue.styleLoad',
  styleOffline: 'map.issue.styleOffline',
  glyphs: 'map.issue.glyphs',
} as const;

/** Codes that mean "degraded but working": neutral, and offer the retry. */
const RETRYABLE = new Set<keyof typeof ISSUE_KEYS>(['styleOffline']);

export const MapIssueLines: React.FC = () => {
  useTranslation();
  const issues = useSyncExternalStore(subscribeMapIssues, getMapIssues);
  if (issues.length === 0) return null;
  return (
    <>
      {issues.map((code) => {
        const label = t(ISSUE_KEYS[code]);
        // The diagnostic code, visually quiet, never translated.
        const body = (
          <>
            {label}
            <Text style={styles.issueCode}>{` (${code})`}</Text>
          </>
        );
        if (!RETRYABLE.has(code)) {
          return (
            <Text key={code} style={styles.issue}>
              {body}
            </Text>
          );
        }
        return (
          <Pressable
            key={code}
            onPress={runMapRetry}
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={8}
            style={({ pressed }) => [styles.retryChip, pressed ? styles.retryChipPressed : null]}
          >
            <Text style={styles.issueNeutral}>{body}</Text>
          </Pressable>
        );
      })}
    </>
  );
};
MapIssueLines.displayName = 'MapIssueLines';

const styles = StyleSheet.create({
  issue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.status.danger,
  },
  issueNeutral: {
    // Same 13 px floor and weight as the red line — only the colour changes,
    // because the news is different, not less important.
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[700],
  },
  issueCode: {
    // Same 13 px floor as the line itself (the app-wide legibility floor) —
    // the quietness comes from colour and weight, not from smaller text.
    fontSize: 13,
    fontWeight: '400',
    color: colors.neutral[500],
  },
  retryChip: {
    // A real touch target for a real action, without moving the panel's
    // layout: the chip is the line, plus room to hit it.
    minHeight: 44,
    justifyContent: 'center',
  },
  retryChipPressed: {
    opacity: 0.6,
  },
});
