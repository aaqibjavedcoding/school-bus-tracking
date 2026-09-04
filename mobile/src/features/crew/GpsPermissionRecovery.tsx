import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  AppState,
  type AppStateStatus,
} from 'react-native';
import * as Location from 'expo-location';
import { colors } from '@school-bus-tracking/design-tokens';

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
          Last GPS update: {formatRelativeTime(lastSuccessfulUpdate)}
        </Text>
      )}

      <View style={styles.actions}>
        {issue === 'permission_denied' && (
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleRequestPermission}
            disabled={isChecking}
          >
            <Text style={styles.primaryButtonText}>
              {isChecking ? 'Checking...' : 'Grant Permission'}
            </Text>
          </TouchableOpacity>
        )}

        {(issue === 'permission_permanently_denied' ||
          issue === 'location_services_disabled' ||
          issue === 'background_permission_denied') && (
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleOpenSettings}
          >
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={checkPermission}
          disabled={isChecking}
        >
          <Text style={styles.secondaryButtonText}>
            {isChecking ? 'Checking...' : 'Recheck'}
          </Text>
        </TouchableOpacity>

        {onDismiss && (
          <TouchableOpacity style={styles.dismissButton} onPress={onDismiss}>
            <Text style={styles.dismissButtonText}>Continue without GPS</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function getTitle(issue: GpsIssue): string {
  switch (issue) {
    case 'permission_denied':
      return 'GPS Permission Needed';
    case 'permission_permanently_denied':
      return 'GPS Permission Blocked';
    case 'location_services_disabled':
      return 'Location Services Off';
    case 'background_permission_denied':
      return 'Background GPS Needed';
    default:
      return 'GPS Issue';
  }
}

function getDescription(issue: GpsIssue): string {
  switch (issue) {
    case 'permission_denied':
      return 'This app needs location access to share the bus location with parents and the school. Your location is only shared during active trips.';
    case 'permission_permanently_denied':
      return 'Location permission was denied. Please open your device settings and enable location access for this app to share bus location during trips.';
    case 'location_services_disabled':
      return 'Location services are turned off on your device. Please enable them in your device settings to share bus location during trips.';
    case 'background_permission_denied':
      return 'Background location access is needed so the bus location continues to be shared when the app is in the background during trips. Please enable "Allow all the time" in settings.';
    default:
      return 'There is an issue with GPS permissions.';
  }
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) return 'just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
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
    fontSize: 48,
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
    fontSize: 12,
    color: colors.neutral[500],
    marginBottom: 24,
  },
  actions: {
    width: '100%',
    gap: 12,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary[500],
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  secondaryButtonText: {
    color: colors.neutral[900],
    fontSize: 16,
  },
  dismissButton: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  dismissButtonText: {
    color: colors.neutral[500],
    fontSize: 14,
  },
});
