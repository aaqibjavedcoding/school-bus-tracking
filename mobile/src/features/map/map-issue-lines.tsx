import React, { useSyncExternalStore } from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors } from '@school-bus-tracking/design-tokens';
import { useTranslation } from '../../lib/i18n-provider.ts';
import { t } from '../../lib/i18n.ts';
import { getMapIssues, subscribeMapIssues } from './map-diagnostics.ts';

/**
 * The always-visible "something is wrong with the map" lines, rendered by both
 * map panels (the crew driver map and the school bus map). Each issue is one
 * short localised line (`map.issue.*`): the map never fails silently.
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
});
