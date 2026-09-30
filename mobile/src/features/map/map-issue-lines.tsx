import React, { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@school-bus-tracking/design-tokens';
import { useTranslation } from '../../lib/i18n-provider';
import { t } from '../../lib/i18n.ts';
import {
  canRetryMap,
  getMapIssues,
  requestMapRetry,
  subscribeMapIssues,
} from './map-diagnostics.ts';
import type { MapStyleIssueCode } from './map-style.ts';

/**
 * The "something is up with the map" lines, rendered by both map panels (the
 * crew driver map and the school bus map). Each issue is one short localised
 * line (`map.issue.*`): the map never fails silently.
 *
 * **Severity is not uniform, and pretending it was is what made this screen
 * lie.** Three states, three treatments:
 *
 * | code | means | treatment |
 * | --- | --- | --- |
 * | `offlineFallback` | the bundled offline base style is drawing; stops, the route and the bus are all on screen | neutral chip + a Retry button |
 * | `glyphs` | the fonts endpoint was probed and did not answer, so labels cannot draw | neutral chip |
 * | `styleLoad` | terminal: even the zero-network fallback did not load, nothing renders | red line |
 *
 * A map that is drawing the offline base style *works*. Calling that "Map
 * failed to load — check your network connection and map tiles" while the
 * user watches their bus move across it was the defect.
 *
 * Each line ends with its machine-readable issue **code** in muted text —
 * `Offline map — tap to retry (offlineFallback)`. The code carries no
 * translation on purpose: it is the token a field screenshot can quote
 * verbatim, so a report names exactly what fired.
 */
const ISSUE_KEYS = {
  styleLoad: 'map.issue.styleLoad',
  offlineFallback: 'map.issue.offlineFallback',
  glyphs: 'map.issue.glyphs',
} as const;

/** Only the terminal state — nothing renders at all — earns red. */
const TERMINAL_CODES: readonly MapStyleIssueCode[] = ['styleLoad'];

/** Only the recoverable-by-refetching state offers a retry button. */
const RETRYABLE_CODES: readonly MapStyleIssueCode[] = ['offlineFallback'];

export const MapIssueLines: React.FC = () => {
  useTranslation();
  const issues = useSyncExternalStore(subscribeMapIssues, getMapIssues);
  if (issues.length === 0) return null;
  return (
    <>
      {issues.map((code) => {
        const terminal = TERMINAL_CODES.includes(code);
        const retryable = RETRYABLE_CODES.includes(code) && canRetryMap();
        return (
          <View key={code} style={styles.row}>
            <Text style={terminal ? styles.terminal : styles.degraded}>
              {t(ISSUE_KEYS[code])}
              {/* The diagnostic code, visually quiet, never translated. */}
              <Text style={styles.issueCode}>{` (${code})`}</Text>
            </Text>
            {retryable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('map.issue.retry')}
                onPress={requestMapRetry}
                style={styles.retry}
                // The chip is short; the hit area must not be.
                hitSlop={8}
              >
                <Text style={styles.retryLabel}>{t('map.issue.retry')}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </>
  );
};
MapIssueLines.displayName = 'MapIssueLines';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  /**
   * Degraded, not failed. Muted rather than red, because the map in front of
   * the user is working and a red line would be telling them otherwise.
   */
  degraded: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  /** Terminal: nothing renders. This one really is a failure. */
  terminal: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.status.danger,
  },
  issueCode: {
    // Same 13 px floor as the line itself (the app-wide legibility floor) —
    // the quietness comes from colour and weight, not from smaller text.
    fontSize: 13,
    fontWeight: '400',
    color: colors.neutral[500],
  },
  retry: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.neutral[400],
  },
  retryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary[600],
  },
});
