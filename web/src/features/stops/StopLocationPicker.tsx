'use client';

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_MAP_STYLE_URL, MAP_ATTRIBUTION } from '../map/map-style';

export type StopCoordinates = { latitude: string; longitude: string };
const NAGPUR: [number, number] = [79.0882, 21.1458];
const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
const fmt = (n: number) => n.toFixed(6);

export function StopLocationPicker({ value, onChange }: { value: StopCoordinates; onChange: (value: StopCoordinates) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const [geoState, setGeoState] = useState<'idle' | 'loading'>('idle');
  const [geoError, setGeoError] = useState('');
  const parsed = [Number(value.longitude), Number(value.latitude)] as [number, number];
  const hasPosition = valid(parsed[1], parsed[0]);

  useEffect(() => {
    if (!el.current || map.current) return;
    const initial = hasPosition ? parsed : NAGPUR;
    const instance = new maplibregl.Map({ container: el.current, style: DEFAULT_MAP_STYLE_URL, center: initial, zoom: hasPosition ? 15 : 11, attributionControl: false });
    map.current = instance;
    instance.addControl(new maplibregl.AttributionControl({ customAttribution: MAP_ATTRIBUTION }), 'bottom-right');
    const place = (lng: number, lat: number) => { if (!valid(lat, lng)) return; marker.current?.remove(); marker.current = new maplibregl.Marker({ draggable: true }).setLngLat([lng, lat]).addTo(instance); marker.current.on('dragend', () => { const p = marker.current!.getLngLat(); onChangeRef.current({ latitude: fmt(p.lat), longitude: fmt(p.lng) }); }); onChangeRef.current({ latitude: fmt(lat), longitude: fmt(lng) }); };
    instance.on('click', (event) => place(event.lngLat.lng, event.lngLat.lat));
    if (hasPosition) place(parsed[0], parsed[1]);
    return () => { marker.current?.remove(); instance.remove(); map.current = null; marker.current = null; };
    // Picker is intentionally remounted with the modal; coordinate edits are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { const instance = map.current; if (!instance || !hasPosition) return; instance.easeTo({ center: parsed, duration: 250 }); if (!marker.current) { marker.current = new maplibregl.Marker({ draggable: true }).setLngLat(parsed).addTo(instance); marker.current.on('dragend', () => { const p = marker.current!.getLngLat(); onChangeRef.current({ latitude: fmt(p.lat), longitude: fmt(p.lng) }); }); } else marker.current.setLngLat(parsed); }, [value.latitude, value.longitude, hasPosition, parsed[0], parsed[1]]);

  const useCurrent = () => { if (!navigator.geolocation) { setGeoError('Location is not supported by this browser.'); return; } setGeoState('loading'); setGeoError(''); navigator.geolocation.getCurrentPosition((p) => { const next = { latitude: fmt(p.coords.latitude), longitude: fmt(p.coords.longitude) }; onChangeRef.current(next); map.current?.easeTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 16 }); setGeoState('idle'); }, (error) => { setGeoState('idle'); setGeoError(error.code === 1 ? 'Location permission was denied.' : error.code === 2 ? 'Your location is currently unavailable.' : error.code === 3 ? 'Location request timed out. Try again.' : 'Could not get your location. Try again.'); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }); };
  return <div className="stop-location-picker"><div className="stop-location-toolbar"><button type="button" className="btn btn-secondary" onClick={useCurrent} disabled={geoState === 'loading'} aria-label="Use my current location">{geoState === 'loading' ? 'Finding location…' : 'Use my current location'}</button><span className="muted">Tap the map or drag the marker to choose a stop.</span></div><div ref={el} className="stop-location-map" aria-label="Interactive stop location map" role="application" />{geoError ? <p className="field-error" role="alert">{geoError}</p> : null}<p className="muted stop-location-note">{MAP_ATTRIBUTION}. Coordinates are only saved when selected or entered manually.</p></div>;
}
