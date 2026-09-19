import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Linking, AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { colors } from '@school-bus-tracking/design-tokens';
import { Button } from '../../components';
import { t } from '../../lib/i18n.ts';
import {
  evaluateGpsPermissions,
  evaluatePermissionRequest,
  isRequestableIssue,
  SETTINGS_ONLY_ISSUES,
  type GpsIssue,
  type LocationPermissionSnapshot,
} from './gps-permission-state.ts';
import { refreshCrewPermissions } from './tracking-lifecycle.ts';
import type { CrewLocationSharing } from './useCrewLocationSharing.ts';

/**
 * GPS permission recovery UX for Driver/Conductor.
 *
 * Handles:
 * - Permission denied (can request again)
 * - Permission permanently denied (must go to settings)
 * - Location services disabled (must go to settings)
 * - Approximate / reduced-accuracy authorization (must go to settings)
 * - Background permission denied **after** a foreground grant
 * - Background permission unavailable on this device
 *
 * The correctness rule this panel exists for: **a request result is read, never
 * assumed.** The previous version requested the background permission and then
 * cleared the issue without checking the answer, so a driver who chose "While
 * using the app" was told everything was fine while background tracking never
 * started. Now both results go through the pure `evaluatePermissionRequest`,
 * and `onPermissionGranted` fires only when every *required* check passed.
 *
 * Background access is requested only when it is actually required — the issue
 * being recovered is a background one, or the crew member already consented to
 * background sharing on the Help screen. Granting foreground permission alone
 * never reports success for background tracking.
 *
 * A granted permission also never implies tracking started: this panel repairs
 * the OS side only, and starting to share stays an explicit crew action.
 *
 * Does NOT trap the user in a dead-end screen.
 */

export type { GpsIssue };

export interface GpsPermissionRecoveryProps {
  /**
   * Last time the **server acknowledged** a fix (`stats.lastAckAt`) — not the
   * last local device fix, which proves nothing about delivery.
   */
  lastSuccessfulUpdate: string | null;
  /** Called when every required permission check passes. */
  onPermissionGranted: () => void;
  /** Called when the user dismisses the recovery screen. */
  onDismiss?: () => void;
  /**
   * The shared tracking lifecycle binding. When present, the panel reads and
   * refreshes the same permission facts the GPS strip and panel use, so the
   * three surfaces can never disagree.
   */
  sharing?: CrewLocationSharing | null;
}

export function GpsPermissionRecovery({
  lastSuccessfulUpdate,
  onPermissionGranted,
  onDismiss,
  sharing = null,
}: GpsPermissionRecoveryProps) {
  const [issue, setIssue] = useState<GpsIssue>('none');
  const [isChecking, setIsChecking] = useState(false);

  const applyIssue = useCallback(
    (next: GpsIssue) => {
      setIssue(next);
      if (next === 'none') {
        onPermissionGranted();
      }
    },
    [onPermissionGranted],
  );

  /**
   * Reads the real OS state (services, foreground, background, accuracy) and
   * publishes it to the shared lifecycle when one is wired.
   */
  const checkPermission = useCallback(async () => {
    setIsChecking(true);
    try {
      const backgroundRequired = sharing?.backgroundConsent === true;

      if (sharing) {
        const permissions = await refreshCrewPermissions();
        const evaluation = evaluateGpsPermissions({
          servicesEnabled: permissions.servicesEnabled,
          foreground: snapshotOf(permissions.foregroundPermission),
          background: snapshotOf(permissions.backgroundPermission),
          backgroundRequired,
        });
        applyIssue(evaluation.issue);
        return;
      }

      const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => null);
      const foreground = await Location.getForegroundPermissionsAsync().catch(() => null);
      const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
      const evaluation = evaluateGpsPermissions({
        servicesEnabled,
        foreground,
        background,
        backgroundRequired,
      });
      applyIssue(evaluation.issue);
    } finally {
      setIsChecking(false);
    }
  }, [applyIssue, sharing]);

  // Check on mount and whenever the app returns to the foreground — that is how
  // a grant (or a revocation) made in OS settings is observed.
  useEffect(() => {
    void checkPermission();

    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') {
        void checkPermission();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [checkPermission]);

  const handleRequestPermission = useCallback(async () => {
    setIsChecking(true);
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => null);
      const foregroundResult: LocationPermissionSnapshot | null =
        await Location.requestForegroundPermissionsAsync().catch(() => null);

      // Background access is asked for only when it is required — an issue
      // about background location, or an explicit prior consent. Otherwise a
      // foreground grant is reported as exactly that, and nothing more.
      const backgroundRequired =
        sharing?.backgroundConsent === true ||
        issue === 'background_permission_denied' ||
        issue === 'background_permission_unavailable';
      const backgroundResult: LocationPermissionSnapshot | null = backgroundRequired
        ? await Location.requestBackgroundPermissionsAsync().catch(() => null)
        : null;

      const evaluation = evaluatePermissionRequest({
        servicesEnabled,
        foregroundResult,
        backgroundResult,
        backgroundRequested: backgroundRequired,
        backgroundRequired,
      });

      if (sharing) {
        // Keep the shared lifecycle in step with what the OS just told us.
        await refreshCrewPermissions();
      }
      applyIssue(evaluation.issue);
    } finally {
      setIsChecking(false);
    }
  }, [applyIssue, issue, sharing]);

  const handleOpenSettings = useCallback(() => {
    void Linking.openSettings().catch(() => undefined);
  }, []);

  if (issue === 'none') {
    return null;
  }

  const showGrant = isRequestableIssue(issue);
  const showSettings = SETTINGS_ONLY_ISSUES.includes(issue) || issue === 'background_permission_denied';

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>📍</Text>
      </View>

      <Text style={styles.title}>{getTitle(issue)}</Text>
      <Text style={styles.description}>{getDescription(issue)}</Text>

      {lastSuccessfulUpdate ? (
        <Text style={styles.lastUpdate}>
          {t('gps.recovery.lastUpdate', { time: formatRelativeTime(lastSuccessfulUpdate) })}
        </Text>
      ) : (
        <Text style={styles.lastUpdate}>{t('gps.recovery.noServerUpdate')}</Text>
      )}

      <View style={styles.actions}>
        {showGrant ? (
          <Button
            label={t('gps.recovery.grant')}
            icon="locate"
            size="field"
            busy={isChecking}
            onPress={() => void handleRequestPermission()}
          />
        ) : null}

        {showSettings ? (
          <Button
            label={t('gps.recovery.openSettings')}
            icon="settings"
            size="field"
            onPress={handleOpenSettings}
          />
        ) : null}

        <Button
          label={t('gps.recovery.recheck')}
          variant="secondary"
          icon="refresh"
          size="lg"
          busy={isChecking}
          onPress={() => void checkPermission()}
        />

        {onDismiss ? (
          <Button
            label={t('gps.recovery.continue')}
            variant="ghost"
            size="lg"
            onPress={onDismiss}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * Coarse state → snapshot shape for the pure evaluator. Only used on the
 * lifecycle-backed path, where the fine-grained response was already read.
 */
function snapshotOf(
  state: 'granted' | 'denied' | 'undetermined' | 'unavailable',
): LocationPermissionSnapshot | null {
  if (state === 'unavailable') {
    return null;
  }
  return {
    granted: state === 'granted',
    canAskAgain: state !== 'denied',
    // Accuracy is not carried in the coarse state; the lifecycle keeps its own
    // `accuracy` field, so the evaluator must not guess "full" here.
    status: state,
  };
}

/** Localised like every other label — the `GpsIssue` codes stay the wire values. */
function getTitle(issue: GpsIssue): string {
  switch (issue) {
    case 'permission_denied':
      return t('gps.recovery.permissionDenied.title');
    case 'permission_permanently_denied':
      return t('gps.recovery.blocked.title');
    case 'location_services_disabled':
      return t('gps.recovery.servicesOff.title');
    case 'background_permission_denied':
      return t('gps.recovery.background.title');
    case 'background_permission_unavailable':
      return t('gps.recovery.backgroundUnavailable.title');
    case 'location_accuracy_reduced':
      return t('gps.recovery.accuracy.title');
    default:
      return t('gps.recovery.issue.title');
  }
}

function getDescription(issue: GpsIssue): string {
  switch (issue) {
    case 'permission_denied':
      return t('gps.recovery.permissionDenied.body');
    case 'permission_permanently_denied':
      return t('gps.recovery.blocked.body');
    case 'location_services_disabled':
      return t('gps.recovery.servicesOff.body');
    case 'background_permission_denied':
      // "Allow all the time" stays in English inside the Hindi string on
      // purpose: it is the label of the OS setting the driver has to find.
      return t('gps.recovery.background.body');
    case 'background_permission_unavailable':
      return t('gps.recovery.backgroundUnavailable.body');
    case 'location_accuracy_reduced':
      return t('gps.recovery.accuracy.body');
    default:
      return t('gps.recovery.issue.body');
  }
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) return t('time.justNow');
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return t('time.minutesAgo', { count: diffMinutes });
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });
  return t('time.daysAgo', { count: Math.floor(diffHours / 24) });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#ffffff',
  },
  iconContainer: {
    marginBottom: 16,
  },
  icon: {
    fontSize: 40,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.neutral[900],
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: colors.neutral[600],
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  lastUpdate: {
    fontSize: 14,
    color: colors.neutral[500],
    marginBottom: 24,
  },
  actions: {
    width: '100%',
    gap: 12,
  },
});
