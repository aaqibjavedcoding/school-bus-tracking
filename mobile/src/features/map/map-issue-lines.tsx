import React, { useSyncExternalStore } from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors } from '@school-bus-tracking/design-tokens';
import { useTranslation } from '../../lib/i18n-provider';
import { t } from '../../lib/i18n.ts';
import { getMapIssues, subscribeMapIssues } from './map-diagnostics.ts';

/**
 * The always-visible "something is wrong with the map" lines, rendered by both
 * map panels (the crew driver map and the school bus map). Each issue is one
 * short localised line (`map.issue.*`): the map never fails silently.
 *
 * Each line ends with its machine-readable issue **code** in muted text —
 * `Map failed to load… (styleLoad)`. The code carries no translation on
 * purpose: it is the token a field screenshot can quote verbatim, so a report
 * names exactly what failed (deep-fix R3 made the conditions clear on
 * recovery, which only matters if the report can say which one fired).
 */
const ISSUE_KEYS = {
  styleLoad: 'map.issue.styleLoad',
  glyphs: 'map.issue.glyphs',
} as const;

export const MapIssueLines: React.FC = () => {
  useTranslation();
  const issues = useSyncExternalStore(subscribeMapIssues, getMapIssues);
  if (issues.length === 0) return null;
  return (
    <>
      {issues.map((code) => (
        <Text key={code} style={styles.issue}>
          {t(ISSUE_KEYS[code])}
          {/* The diagnostic code, visually quiet, never translated. */}
          <Text style={styles.issueCode}>{` (${code})`}</Text>
        </Text>
      ))}
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
  issueCode: {
    // Same 13 px floor as the line itself (the app-wide legibility floor) —
    // the quietness comes from colour and weight, not from smaller text.
    fontSize: 13,
    fontWeight: '400',
    color: colors.neutral[500],
  },
});
