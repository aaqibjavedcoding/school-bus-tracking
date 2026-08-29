import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  LIVE_TRACKING_EVENTS,
  LIVE_TRACKING_NAMESPACE,
  TripStatus,
  type TrackingJoinAck,
  type TripEtaResponse,
  type TripEtaUpdateEvent,
  type TripLocationUpdateEvent,
  type TripStopArrivedEvent,
  type TripTrackingState,
  type TripTrackingStoppedEvent,
} from '@school-bus-tracking/shared-types';
import { getSocketHub } from '../services/sockets';

/**
 * Observer subscription for one trip's live-tracking room — the mobile mirror
 * of the web `useLiveTripTracking` hook, talking to the exact same gateway.
 *
 * Security notes that must stay true:
 *
 * - The server authorises the join (`tracking:join` ack); this hook only ever
 *   names a trip id, never a school, role or user.
 * - Rooms are per-socket on the server, so after every reconnect the hook
 *   re-emits `tracking:join` (see the `connect` handler).
 */

export type TrackingConnection = 'live' | 'reconnecting' | 'offline';

export interface LiveFix {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  recorded_at: string;
  received_at: string;
}

export interface LiveTripState {
  connection: TrackingConnection;
  fix: LiveFix | null;
  trackingState: TripTrackingState | null;
  tripStatus: TripStatus | null;
  /** True while the trip is open but no GPS fix exists yet (never faked). */
  noLocationYet: boolean;
  eta: TripEtaResponse | null;
  lastArrival: TripStopArrivedEvent | null;
  /** Present when the server denied the join (e.g. `trip_not_open`). */
  joinDenied: TrackingJoinAck['reason'] | null;
  trackingStopped: TripTrackingStoppedEvent | null;
}

const initial: LiveTripState = {
  connection: 'offline',
  fix: null,
  trackingState: null,
  tripStatus: null,
  noLocationYet: false,
  eta: null,
  lastArrival: null,
  joinDenied: null,
  trackingStopped: null,
};

type FixSource = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  recorded_at: string;
  received_at: string;
};

function toFix(value: FixSource): LiveFix {
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

export function useLiveTrip(tripId: string | null): LiveTripState {
  const [state, setState] = useState<LiveTripState>(initial);
  const joinedRef = useRef<string | null>(null);

  useEffect(() => {
    setState(tripId ? { ...initial, connection: 'reconnecting' } : initial);
    joinedRef.current = null;
    if (!tripId) {
      return undefined;
    }

    const socket: Socket = getSocketHub().socketFor(LIVE_TRACKING_NAMESPACE);
    let cancelled = false;

    const patch = (next: Partial<LiveTripState>): void => {
      if (!cancelled) {
        setState((prev) => ({ ...prev, ...next }));
      }
    };

    const join = (): void => {
      socket.emit(LIVE_TRACKING_EVENTS.join, { trip_id: tripId }, (raw: unknown) => {
        const ack = raw as TrackingJoinAck;
        if (cancelled || !ack) {
          return;
        }
        if (ack.status === 'joined') {
          joinedRef.current = tripId;
          patch({
            joinDenied: null,
            trackingState: ack.tracking_state ?? null,
            tripStatus: ack.trip_status ?? null,
            noLocationYet: !ack.latest,
            fix: ack.latest ? toFix(ack.latest) : null,
          });
          return;
        }
        joinedRef.current = null;
        patch({ joinDenied: ack.reason ?? 'unauthorized' });
      });
    };

    const onConnect = (): void => {
      patch({ connection: 'live' });
      // The server never carries room membership across sockets.
      join();
    };
    const onDisconnect = (): void => {
      patch({ connection: 'reconnecting' });
    };

    const onLocation = (event: TripLocationUpdateEvent): void => {
      patch({
        fix: toFix(event),
        noLocationYet: false,
        trackingState: event.tracking_state,
        tripStatus: event.trip_status,
      });
    };
    const onEta = (event: TripEtaUpdateEvent): void => {
      patch({
        eta: event.eta,
        tripStatus: event.eta.trip_status,
        trackingState: event.eta.tracking_state,
      });
    };
    const onArrival = (event: TripStopArrivedEvent): void => {
      patch({ lastArrival: event });
    };
    const onStarted = (event: {
      trip_status: TripStatus;
      tracking_state: TripTrackingState;
    }): void => {
      patch({
        tripStatus: event.trip_status,
        trackingState: event.tracking_state,
        trackingStopped: null,
      });
    };
    const onStopped = (event: TripTrackingStoppedEvent): void => {
      patch({
        tripStatus: event.trip_status,
        trackingState: event.tracking_state,
        trackingStopped: event,
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(LIVE_TRACKING_EVENTS.locationUpdate, onLocation);
    socket.on(LIVE_TRACKING_EVENTS.etaUpdate, onEta);
    socket.on(LIVE_TRACKING_EVENTS.stopArrived, onArrival);
    socket.on(LIVE_TRACKING_EVENTS.trackingStarted, onStarted);
    socket.on(LIVE_TRACKING_EVENTS.trackingStopped, onStopped);

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      cancelled = true;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(LIVE_TRACKING_EVENTS.locationUpdate, onLocation);
      socket.off(LIVE_TRACKING_EVENTS.etaUpdate, onEta);
      socket.off(LIVE_TRACKING_EVENTS.stopArrived, onArrival);
      socket.off(LIVE_TRACKING_EVENTS.trackingStarted, onStarted);
      socket.off(LIVE_TRACKING_EVENTS.trackingStopped, onStopped);
      if (joinedRef.current === tripId) {
        socket.emit(LIVE_TRACKING_EVENTS.leave, { trip_id: tripId });
        joinedRef.current = null;
      }
    };
  }, [tripId]);

  return state;
}
