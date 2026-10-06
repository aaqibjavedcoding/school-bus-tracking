import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { useMapStyle } from '../../map/use-map-style';

type Coordinates = { latitude: string; longitude: string };
const NAGPUR = { latitude: 21.1458, longitude: 79.0882 };
const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
const fmt = (n: number) => n.toFixed(6);

export function StopLocationPicker({ value, onChange }: { value: Coordinates; onChange: (value: Coordinates) => void }) {
  const { mapStyle } = useMapStyle();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lat = Number(value.latitude); const lng = Number(value.longitude);
  const center = valid(lat, lng) ? { latitude: lat, longitude: lng } : NAGPUR;
  let Map: React.ComponentType<any> | undefined;
  let PointAnnotation: React.ComponentType<any> | undefined;
  try { const native = require('@maplibre/maplibre-react-native'); Map = native.Map; PointAnnotation = native.PointAnnotation; } catch { /* Expo Go fallback */ }
  const locate = async () => {
    if (busy) return; setBusy(true); setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Location permission was denied. Enable it in Settings and try again.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      onChange({ latitude: fmt(position.coords.latitude), longitude: fmt(position.coords.longitude) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not get your location. Try again.'); } finally { setBusy(false); }
  };
  return <View style={styles.wrap}><Pressable style={styles.button} onPress={() => void locate()} disabled={busy} accessibilityRole="button" accessibilityLabel="Use my current location"><Text style={styles.buttonText}>{busy ? 'Finding location…' : 'Use my current location'}</Text></Pressable><Text style={styles.hint}>Tap the map to choose a stop. You can also edit coordinates below.</Text>{Map ? <View style={styles.map}>{<Map style={StyleSheet.absoluteFill} mapStyle={mapStyle} logoEnabled={false} attributionEnabled onPress={(event: any) => { const coordinate = event?.geometry?.coordinates; if (Array.isArray(coordinate) && valid(Number(coordinate[1]), Number(coordinate[0]))) onChange({ latitude: fmt(Number(coordinate[1])), longitude: fmt(Number(coordinate[0])) }); }}><PointAnnotation id="stop-location" coordinate={[center.longitude, center.latitude]} /></Map>}</View> : <Text style={styles.fallback}>Map preview is unavailable in Expo Go. Use the coordinate fields or a development build.</Text>}{error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}</View>;
}
const styles = StyleSheet.create({ wrap: { gap: spacing.sm, marginVertical: spacing.sm }, map: { height: 220, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.neutral[100] }, button: { alignSelf: 'flex-start', padding: spacing.sm, borderRadius: 8, backgroundColor: colors.secondary[100] }, buttonText: { color: colors.secondary[800], fontWeight: '700' }, hint: { color: colors.neutral[600], fontSize: 13 }, fallback: { color: colors.neutral[600], padding: spacing.md }, error: { color: colors.status.danger, fontSize: 13 } });
