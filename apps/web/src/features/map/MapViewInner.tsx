'use client';

import L from 'leaflet';
import React, { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { formatRelative, formatSpeedKmh } from '../../lib/format';
import type { LiveFix } from '../tracking/useLiveTripTracking';
import type { MapViewProps } from './types';

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const DEFAULT_CENTER: [number, number] = [20, 0];

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function busIcon(heading: number | null): L.DivIcon {
  const rotation = heading ?? 0;
  return L.divIcon({
    className: 'bus-marker',
    html: `<div class="bus-marker-body" style="transform: rotate(${rotation}deg)">🚌</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  });
}

function stopIcon(sequence: number, kind: 'plain' | 'next' | 'current'): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="stop-marker ${kind}">${sequence}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -10],
  });
}

const InterpolatedBusMarker: React.FC<{ fix: LiveFix }> = ({ fix }) => {
  const markerRef = useRef<L.Marker | null>(null);
  const currentRef = useRef<[number, number]>([fix.latitude, fix.longitude]);
  const icon = useMemo(() => busIcon(fix.heading), [fix.heading]);

  useEffect(() => {
    const from = currentRef.current;
    const to: [number, number] = [fix.latitude, fix.longitude];
    const start = performance.now();
    const duration = 900;
    let frame = 0;

    const tick = (now: number) => {
      const t = easeInOutCubic(Math.min(1, (now - start) / duration));
      const next: [number, number] = [lerp(from[0], to[0], t), lerp(from[1], to[1], t)];
      currentRef.current = next;
      markerRef.current?.setLatLng(next);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fix.latitude, fix.longitude, fix.recorded_at]);

  return (
    <Marker
      position={currentRef.current}
      icon={icon}
      ref={(marker) => {
        markerRef.current = marker;
      }}
    >
      <Popup>
        <strong>School bus</strong>
        <div>Updated {formatRelative(fix.received_at)}</div>
        <div>{formatSpeedKmh(fix.speed)}</div>
      </Popup>
    </Marker>
  );
};

const FitLayer: React.FC<{
  fix: LiveFix | null;
  stops: StopResponse[];
}> = ({ fix, stops }) => {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    const points: [number, number][] = [];
    if (fix) points.push([fix.latitude, fix.longitude]);
    for (const stop of stops) {
      if (stop.latitude != null && stop.longitude != null) {
        points.push([stop.latitude, stop.longitude]);
      }
    }
    if (points.length === 0) return;
    if (!fitted.current) {
      fitted.current = true;
      if (points.length === 1) {
        map.setView(points[0], 15);
      } else {
        map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
      }
      return;
    }
    if (fix) {
      const bounds = map.getBounds();
      if (!bounds.contains([fix.latitude, fix.longitude])) {
        map.panTo([fix.latitude, fix.longitude], { animate: true });
      }
    }
  }, [fix, stops, map]);

  return null;
};

export const MapViewInner: React.FC<MapViewProps> = ({
  fix,
  stops = [],
  highlightStopId = null,
}) => {
  const mappedStops = stops.filter(
    (stop) => stop.latitude != null && stop.longitude != null,
  ) as Array<StopResponse & { latitude: number; longitude: number }>;
  const line = mappedStops
    .slice()
    .sort((a, b) => a.sequence_number - b.sequence_number)
    .map((stop) => [stop.latitude, stop.longitude] as [number, number]);

  const center: [number, number] = fix
    ? [fix.latitude, fix.longitude]
    : mappedStops[0]
      ? [mappedStops[0].latitude, mappedStops[0].longitude]
      : DEFAULT_CENTER;

  return (
    <div className="map-shell">
      <MapContainer
        center={center}
        zoom={fix || mappedStops.length > 0 ? 14 : 2}
        scrollWheelZoom
        attributionControl
      >
        <TileLayer url={OSM_URL} attribution={OSM_ATTRIBUTION} />
        <FitLayer fix={fix} stops={stops} />
        {line.length > 1 ? (
          <Polyline positions={line} pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.55 }} />
        ) : null}
        {mappedStops.map((stop) => (
          <Marker
            key={stop.id}
            position={[stop.latitude, stop.longitude]}
            icon={stopIcon(stop.sequence_number, highlightStopId === stop.id ? 'current' : 'plain')}
          >
            <Popup>
              <strong>
                Stop {stop.sequence_number}: {stop.name}
              </strong>
              {stop.address ? <div>{stop.address}</div> : null}
            </Popup>
          </Marker>
        ))}
        {fix ? <InterpolatedBusMarker fix={fix} /> : null}
      </MapContainer>
    </div>
  );
};
