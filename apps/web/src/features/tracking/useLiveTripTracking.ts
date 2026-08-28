'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LIVE_TRACKING_EVENTS,
  TripStatus,
  type TrackingJoinAck,
  type TripLocationLatestResponse,
  type TripLocationUpdateEvent,
  type TripTrackingStartedEvent,
  type TripTrackingState,
  type TripTrackingStoppedEvent,
} from '@school-bus-tracking/shared-types';
import { tripLocationUpdateSchema } from '@school-bus-tracking/validation';
import { ApiClientError } from '@school-bus-tracking/api-client';
import { apiClient } from '../../services/api';
import { getLiveTrackingSocket } from '../../services/live-tracking-socket';

export type ConnectionState = 'live' | 'reconnecting' | 'offline';

export interface LiveFix {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  recorded_at: string;
  received_at: string;
}

function toFix(value: TripLocationLatestResponse | TripLocationUpdateEvent | LiveFix): LiveFix {
  return {
    latitude: value.latitude,
    longitude: value.longitude,
    heading: value.heading ?? null,
    speed: value.speed ?? null,
    accuracy: value.accuracy ?? null,
    recorded_at: value.recorded_at,
    received_at: value.received_at,
  };
}

function currentConnection(): ConnectionState {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'offline';
  }
  return 'reconnecting';
}

export function useLiveTripTracking(tripId: string | null) {
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [fix, setFix] = useState<LiveFix | null>(null);
  const [trackingState, setTrackingState] = useState<TripTrackingState | null>(null);
  const [tripStatus, setTripStatus] = useState<TripStatus | null>(null);
  const [noLocationYet, setNoLocationYet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const joinedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!tripId) {
      setFix(null);
      setTrackingState(null);
      setTripStatus(null);
      setNoLocationYet(false);
      setError(null);
      setConnection('offline');
      return undefined;
    }

    const socket = getLiveTrackingSocket();
    let cancelled = false;

    const loadRestSnapshot = async () => {
      try {
        const envelope = await apiClient.getTripLocation(tripId);
        if (cancelled || !envelope.data) return;
        setFix(toFix(envelope.data));
        setTrackingState(envelope.data.tracking_state);
        setTripStatus(envelope.data.trip_status);
        setNoLocationYet(false);
      } catch (caught) {
        if (caught instanceof ApiClientError && caught.status === 404) {
          setNoLocationYet(true);
          return;
        }
        if (!cancelled) {
          setError('Could not load the latest bus location.');
        }
      }
    };

    const join = () => {
      socket.emit(LIVE_TRACKING_EVENTS.join, { trip_id: tripId }, (ack: TrackingJoinAck) => {
        if (cancelled) return;
        if (ack.status === 'joined') {
          joinedRef.current = tripId;
          setError(null);
          setTrackingState(ack.tracking_state ?? null);
          setTripStatus(ack.trip_status ?? null);
          if (ack.latest) {
            setFix(toFix(ack.latest));
            setNoLocationYet(false);
          } else {
            setNoLocationYet(true);
          }
          return;
        }
        joinedRef.current = null;
        if (ack.reason === 'trip_not_open') {
          void loadRestSnapshot();
          return;
        }
        setError('Live tracking is unavailable for this trip.');
      });
    };

    const onConnect = () => {
      setConnection('live');
      join();
    };
    const onDisconnect = () => {
      setConnection(currentConnection());
    };
    const onReconnectAttempt = () => setConnection('reconnecting');
    const onOffline = () => setConnection('offline');
    const onOnline = () => {
      setConnection(socket.connected ? 'live' : 'reconnecting');
      if (!socket.connected) socket.connect();
    };
    const onLocation = (payload: TripLocationUpdateEvent) => {
      if (payload.trip_id !== tripId) return;
      setFix(toFix(payload));
      setTrackingState(payload.tracking_state);
      setTripStatus(payload.trip_status);
      setNoLocationYet(false);
    };
    const onStarted = (payload: TripTrackingStartedEvent) => {
      if (payload.trip_id !== tripId) return;
      setTrackingState(payload.tracking_state);
      setTripStatus(payload.trip_status);
    };
    const onStopped = (payload: TripTrackingStoppedEvent) => {
      if (payload.trip_id !== tripId) return;
      setTrackingState(payload.tracking_state);
      setTripStatus(payload.trip_status);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.on(LIVE_TRACKING_EVENTS.locationUpdate, onLocation);
    socket.on(LIVE_TRACKING_EVENTS.trackingStarted, onStarted);
    socket.on(LIVE_TRACKING_EVENTS.trackingStopped, onStopped);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    void loadRestSnapshot();

    if (socket.connected) {
      setConnection('live');
      join();
    } else {
      setConnection(currentConnection());
      socket.connect();
    }

    return () => {
      cancelled = true;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.off(LIVE_TRACKING_EVENTS.locationUpdate, onLocation);
      socket.off(LIVE_TRACKING_EVENTS.trackingStarted, onStarted);
      socket.off(LIVE_TRACKING_EVENTS.trackingStopped, onStopped);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      if (joinedRef.current === tripId) {
        socket.emit(LIVE_TRACKING_EVENTS.leave, { trip_id: tripId });
        joinedRef.current = null;
      }
    };
  }, [tripId]);

  return { connection, fix, trackingState, tripStatus, noLocationYet, error };
}

export function useCrewLocationShare(tripId: string | null, enabled: boolean): string | null {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tripId || !enabled) {
      setError(null);
      return undefined;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('This device cannot share GPS.');
      return undefined;
    }

    const socket = getLiveTrackingSocket();
    if (!socket.connected) socket.connect();

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setError(null);
        const speedMs = position.coords.speed;
        const payload = {
          trip_id: tripId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed:
            speedMs != null && Number.isFinite(speedMs) ? Math.max(0, speedMs * 3.6) : undefined,
          heading:
            position.coords.heading != null && Number.isFinite(position.coords.heading)
              ? position.coords.heading
              : undefined,
          recorded_at: new Date(position.timestamp).toISOString(),
        };
        const parsed = tripLocationUpdateSchema.safeParse(payload);
        if (!parsed.success) return;
        socket.emit(LIVE_TRACKING_EVENTS.locationUpdate, parsed.data);
      },
      () => {
        setError('Location permission is needed to share the bus position.');
      },
      { enableHighAccuracy: true, maximumAge: 2500, timeout: 12_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [tripId, enabled]);

  return error;
}
