'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_MAP_STYLE_URL, MAP_ATTRIBUTION, resolveMapStyleUrl } from '../map/map-style';
import {
  GEOLOCATION_OPTIONS,
  GEOLOCATION_UNSUPPORTED_MESSAGE,
  type StopCoordinates,
  coordinatesDiffer,
  coordinatesFromLngLat,
  geolocationErrorMessage,
  parseCoordinates,
  resolveInitialView,
  SELECTED_ZOOM,
} from './stop-location';

export type StopLocationPickerProps = {
  /** The live latitude/longitude strings from the stop form. */
  value: StopCoordinates;
  /** Called with a 6-decimal pair whenever the map picks a position. */
  onChange: (value: StopCoordinates) => void;
};

/**
 * Interactive location picker for the Add/Edit stop modal.
 *
 * Replaces the "copy the numbers out of Google Maps" step: click the map or
 * drag the marker and the existing Latitude/Longitude inputs fill themselves.
 * Those inputs stay editable and authoritative — the map follows them.
 *
 * Provider: maplibre-gl with the repository's self-hosted OpenFreeMap style
 * (no key, no billing, no geocoding). Mounted client-side only via
 * `StopLocationPicker`, because MapLibre touches `window` at import time.
 */
export function StopLocationPickerInner({ value, onChange }: StopLocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  // The form owns the value; the map reads the latest setter without
  // re-running the one-shot init effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Snapshot of the coordinates the modal opened with: the initial camera is a
  // one-shot decision, later edits are handled by the sync effect below.
  const initialValueRef = useRef(value);

  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'info'; message: string } | null>(null);

  /** Writes a map-chosen position back into the form. */
  const emit = useCallback((longitude: number, latitude: number) => {
    onChangeRef.current(coordinatesFromLngLat(longitude, latitude));
  }, []);

  // --- map lifecycle: created once per modal open, destroyed on unmount -----
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return undefined;

    const initial = resolveInitialView(initialValueRef.current);
    const map = new maplibregl.Map({
      container,
      style: resolveMapStyleUrl(process.env as Record<string, string | undefined>),
      center: initial.center,
      zoom: initial.zoom,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.AttributionControl({ compact: false, customAttribution: MAP_ATTRIBUTION }),
      'bottom-right',
    );
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('click', (event) => emit(event.lngLat.lng, event.lngLat.lat));

    // The modal animates/lays out after mount, so the canvas is measured in a
    // container that may still be 0-width. Re-measure once laid out, and keep
    // following the container afterwards.
    const invalidate = () => {
      if (mapRef.current) mapRef.current.resize();
    };
    const raf = requestAnimationFrame(invalidate);
    const timer = setTimeout(invalidate, 250);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => invalidate());
    observer?.observe(container);
    window.addEventListener('resize', invalidate);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', invalidate);
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [emit]);

  // --- marker follows the form (map clicks, drags and manual typing alike) --
  const { latitude, longitude } = value;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const selected = parseCoordinates({ latitude, longitude });

    if (!selected) {
      // Partial / invalid / cleared input: no marker, camera left alone.
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (!markerRef.current) {
      const marker = new maplibregl.Marker({ draggable: true, color: '#1d4ed8' })
        .setLngLat(selected)
        .addTo(map);
      marker.on('dragend', () => {
        const position = marker.getLngLat();
        emit(position.lng, position.lat);
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat(selected);
    }

    const center = map.getCenter();
    if (coordinatesDiffer([center.lng, center.lat], selected)) {
      map.easeTo({ center: selected, duration: 300 });
    }
  }, [latitude, longitude, emit]);

  // --- "Use my current location": only ever on an explicit click -----------
  const useCurrentLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus({ tone: 'error', message: GEOLOCATION_UNSUPPORTED_MESSAGE });
      return;
    }
    setLocating(true);
    setStatus({ tone: 'info', message: 'Finding your location…' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setStatus({ tone: 'info', message: 'Location set from your device.' });
        emit(position.coords.longitude, position.coords.latitude);
        mapRef.current?.easeTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: SELECTED_ZOOM,
          duration: 300,
        });
      },
      (error) => {
        setLocating(false);
        setStatus({ tone: 'error', message: geolocationErrorMessage(error) });
      },
      GEOLOCATION_OPTIONS,
    );
  }, [emit]);

  return (
    <div className="stop-location-picker">
      <div className="stop-location-toolbar">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={useCurrentLocation}
          disabled={locating}
          aria-busy={locating}
        >
          {locating ? 'Finding location…' : 'Use my current location'}
        </button>
        <span className="muted">
          Click the map or drag the pin to set the stop — the fields below fill in.
        </span>
      </div>
      <div
        ref={containerRef}
        className="stop-location-map"
        role="application"
        aria-label="Stop location map. Click to place the stop pin."
      />
      <p
        className={status?.tone === 'error' ? 'field-error' : 'muted stop-location-note'}
        role="status"
        aria-live="polite"
      >
        {status ? status.message : `Map data: ${MAP_ATTRIBUTION}`}
      </p>
    </div>
  );
}

export { DEFAULT_MAP_STYLE_URL };
