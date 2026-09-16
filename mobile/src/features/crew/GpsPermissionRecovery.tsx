import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Linking, AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { colors } from '@school-bus-tracking/design-tokens';
import { Button } from '../../components';
import { t } from '../../lib/i18n.ts';

/**
 * GPS permission recovery UX for Driver/Conductor.
 *
 * Handles:
 * - Permission denied (can request again)
 * - Permission permanently denied (must go to settings)
 * - Location services disabled (must go to settings)
 * - Background permission unavailable
 * - Battery optimization issues
 *
 * Provides:
 * - Clear explanation of what's needed
 * - Retry/recheck button
 * - Settings link where supported
 * - Current GPS status
 * - Last successful update time
 *
 * Does NOT trap the user in a dead-end screen.
 */

export type GpsIssue =
  | 'none'
  | 'permission_denied'
  | 'permission_permanently_denied'
  | 'location_services_disabled'
  | 'background_permission_denied';

export interface GpsPermissionRecoveryProps {
  /** Last time GPS successfully sent a location to the server. */
  lastSuccessfulUpdate: string | null;
  /** Called when the user successfully grants permission. */
  onPermissionGranted: () => void;
  /** Called when the user dismisses the recovery screen. */
  onDismiss?: () => void;
}

export function GpsPermissionRecovery({
  lastSuccessfulUpdate,
  onPermissionGranted,
  onDismiss,
}: GpsPermissionRecoveryProps) {
  const [issue, setIssue] = useState<GpsIssue>('none');
  const [isChecking, setIsChecking] = useState(false);

  const checkPermission = useCallback(async () => {
    setIsChecking(true);
    try {
      // Check if location services are enabled.
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setIssue('location_services_disabled');
        return;
      }

      // Check foreground permission.
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        // Check background permission.
        const bgStatus = await Location.getBackgroundPermissionsAsync();
        if (bgStatus.status !== 'granted') {
          setIssue('background_permission_denied');
          return;
        }

        setIssue('none');
        onPermissionGranted();
        return;
      }

      // Permission not granted. Try to determine if it's permanently denied.
      const { canAskAgain } = await Location.getForegroundPermissionsAsync();
      if (!canAskAgain) {
        setIssue('permission_permanently_denied');
      } else {
        setIssue('permission_denied');
      }
    } finally {
      setIsChecking(false);
    }
  }, [onPermissionGranted]);

  // Check on mount and when app comes to foreground.
  useEffect(() => {
    checkPermission();

    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') {
        checkPermission();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [checkPermission]);

  const handleRequestPermission = useCallback(async () => {
    setIsChecking(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        // Request background permission too.
        await Location.requestBackgroundPermissionsAsync();
        setIssue('none');
        onPermissionGranted();
      } else {
        // Re-check to determine the issue.
        await checkPermission();
      }
    } finally {
      setIsChecking(false);
    }
  }, [checkPermission, onPermissionGranted]);

  const handleOpenSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  if (issue === 'none') {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>📍</Text>
      </View>

      <Text style={styles.title}>{getTitle(issue)}</Text>
      <Text style={styles.description}>{getDescription(issue)}</Text>

      {lastSuccessfulUpdate && (
        <Text style={styles.lastUpdate}>
          {t('gps.recovery.lastUpdate', { time: formatRelativeTime(lastSuccessfulUpdate) })}
        </Text>
      )}

      <View style={styles.actions}>
        {issue === 'permission_denied' ? (
          <Button
            label={t('gps.recovery.grant')}
            icon="locate"
            size="field"
            busy={isChecking}
            onPress={() => void handleRequestPermission()}
          />
        ) : null}

        {issue === 'permission_permanently_denied' ||
        issue === 'location_services_disabled' ||
        issue === 'background_permission_denied' ? (
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
