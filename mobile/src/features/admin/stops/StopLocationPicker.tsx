import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import type { MapProps } from '@maplibre/maplibre-react-native';
import { useMapStyle } from '../../map/use-map-style';
import {
  FALLBACK_CENTER,
  FALLBACK_ZOOM,
  GEOLOCATION_DENIED_MESSAGE,
  GEOLOCATION_DONE_MESSAGE,
  GEOLOCATION_PENDING_MESSAGE,
  SELECTED_ZOOM,
  type StopCoordinates,
  coordinatesFromLngLat,
  locationErrorMessage,
  parseCoordinates,
  resolveInitialView,
} from './stop-location.ts';

/**
 * MapLibre is a custom native module (absent from Expo Go), so it is required
 * lazily behind the render boundary — the same pattern as
 * `features/map/LiveMapSurface.tsx` and `features/map/StopMarker.tsx`.
 */
type MapLibreModule = typeof import('@maplibre/maplibre-react-native');

function loadMapLibre(): MapLibreModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@maplibre/maplibre-react-native') as MapLibreModule;
  } catch {
    // Expo Go / web: the form still works through the coordinate fields.
    return null;
  }
}

export interface StopLocationPickerProps {
  /** The live latitude/longitude strings from the stop form. */
  value: StopCoordinates;
  /** Called with a 6-decimal pair whenever the map picks a position. */
  onChange: (value: StopCoordinates) => void;
}

/**
 * Native twin of the web Add/Edit-stop location picker.
 *
 * Tapping the map (or the "Use my current location" button) fills the existing
 * Latitude/Longitude fields, so an admin never has to copy numbers out of
 * another maps app. The fields stay editable and authoritative: an invalid or
 * half-typed pair simply hides the pin instead of moving it somewhere wrong,
 * and the fallback Nagpur camera is display-only — it is never written into
 * the form, so it can never reach the create/update request.
 *
 * Provider is the app's existing MapLibre + bundled style stack: no key, no
 * billing, no geocoding. Location permission is requested only inside the
 * button handler, never on mount.
 */
export function StopLocationPicker({ value, onChange }: StopLocationPickerProps) {
  const { mapStyle } = useMapStyle();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'info'; message: string } | null>(null);

  const selected = parseCoordinates(value);
  const view = resolveInitialView(value);
  const maplibre = loadMapLibre();

  const handleMapPress = useCallback(
    (event: { nativeEvent?: { lngLat?: unknown } }) => {
      const lngLat = event?.nativeEvent?.lngLat;
      if (!Array.isArray(lngLat) || lngLat.length < 2) return;
      const next = coordinatesFromLngLat(Number(lngLat[0]), Number(lngLat[1]));
      if (!parseCoordinates(next)) return;
      onChange(next);
    },
    [onChange],
  );

  const locate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus({ tone: 'info', message: GEOLOCATION_PENDING_MESSAGE });
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error(GEOLOCATION_DENIED_MESSAGE);
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      onChange(coordinatesFromLngLat(position.coords.longitude, position.coords.latitude));
      setStatus({ tone: 'info', message: GEOLOCATION_DONE_MESSAGE });
    } catch (caught) {
      setStatus({ tone: 'error', message: locationErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }, [busy, onChange]);

  // The native Map renders children (camera + marker); mirror the cast used by
  // `features/map/LiveMapSurface.tsx`.
  const Map = maplibre?.Map as
    React.ComponentType<MapProps & { children?: React.ReactNode }> | undefined;
  const Camera = maplibre?.Camera;
  const Marker = maplibre?.Marker;

  return (
    <View style={styles.wrap}>
      <Pressable
        style={[styles.button, busy && styles.buttonBusy]}
        onPress={() => void locate()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy }}
        accessibilityLabel="Use my current location"
      >
        <Text style={styles.buttonText}>
          {busy ? GEOLOCATION_PENDING_MESSAGE : 'Use my current location'}
        </Text>
      </Pressable>
      <Text style={styles.hint}>
        Tap the map to place the stop. You can also edit the coordinates below.
      </Text>
      {Map && Camera && Marker ? (
        <View style={styles.map}>
          <Map
            style={StyleSheet.absoluteFill}
            mapStyle={mapStyle}
            logo={false}
            attribution
            onPress={handleMapPress}
          >
            <Camera center={view.center} zoom={selected ? SELECTED_ZOOM : FALLBACK_ZOOM} />
            {/* No pin until a valid pair exists: the Nagpur fallback is a
                camera, not a selection. */}
            {selected ? (
              <Marker id="stop-location" lngLat={selected}>
                <View style={styles.pin} />
              </Marker>
            ) : null}
          </Map>
        </View>
      ) : (
        <Text style={styles.fallback}>
          Map preview needs a development build. Enter the coordinates below, or use the current
          location button.
        </Text>
      )}
      {status ? (
        <Text
          style={status.tone === 'error' ? styles.error : styles.hint}
          accessibilityRole={status.tone === 'error' ? 'alert' : 'text'}
          accessibilityLiveRegion="polite"
        >
          {status.message}
        </Text>
      ) : null}
    </View>
  );
}

/** Exported for the spec: the display-only camera fallback. */
export const DISPLAY_FALLBACK_CENTER = FALLBACK_CENTER;

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginVertical: spacing.sm },
  map: {
    height: 220,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.neutral[100],
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: colors.secondary[100],
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: colors.secondary[800], fontWeight: '700' },
  hint: { color: colors.neutral[600], fontSize: 13 },
  fallback: { color: colors.neutral[600], padding: spacing.md },
  error: { color: colors.status.danger, fontSize: 13 },
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#ffffff',
    backgroundColor: colors.primary[600],
  },
});
