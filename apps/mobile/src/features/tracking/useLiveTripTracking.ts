import { useEffect, useRef, useState } from 'react';
import {
  LIVE_TRACKING_EVENTS,
  type TrackingJoinAck,
  type TripEtaResponse,
  type TripEtaUpdateEvent,
  type TripLocationLatestResponse,
  type TripLocationUpdateEvent,
  type TripStatus,
  type TripStopArrivedEvent,
  type TripTrackingStartedEvent,
  type TripTrackingState,
  type TripTrackingStoppedEvent,
} from '@school-bus-tracking/shared-types';
import { ApiClientError } from '@school-bus-tracking/api-client';
import { apiClient } from '../../services/api';
import { getLiveTrackingSocket } from '../../services/live-tracking-socket';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

/**
 * Live trip observer (mobile port of the web hook).
 *
 * One shared socket, one `tracking:join` per trip: the server authorizes the
 * join for the caller's role (crew rostered on the trip, admin of the
 * tenant, or the parent of a manifest student) and then streams
 * `trip:location:update`, `trip:eta:update`, `trip:stop:arrived` and the
 * tracking lifecycle events. A REST snapshot (latest fix + ETA) is loaded in
 * parallel so the screen is meaningful before the first push arrives.
 */

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

export function useLiveTripTracking(tripId: string | null) {
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [fix, setFix] = useState<LiveFix | null>(null);
  const [trackingState, setTrackingState] = useState<TripTrackingState | null>(null);
  const [tripStatus, setTripStatus] = useState<TripStatus | null>(null);
  const [noLocationYet, setNoLocationYet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eta, setEta] = useState<TripEtaResponse | null>(null);
  const [lastArrival, setLastArrival] = useState<TripStopArrivedEvent | null>(null);
  const joinedRef = useRef<string | null>(null);
  const network = useNetworkStatus();
  const networkRef = useRef(network);
  networkRef.current = network;

  useEffect(() => {
    if (!tripId) {
      setFix(null);
      setTrackingState(null);
      setTripStatus(null);
      setNoLocationYet(false);
      setError(null);
      setEta(null);
      setLastArrival(null);
      setConnection('offline');
      return undefined;
    }

    const socket = getLiveTrackingSocket();
    let cancelled = false;

    const loadRestSnapshot = async () => {
      // The two reads are independent: the ETA summary still loads while the
      // trip has no GPS fix yet (the location endpoint 404s in that case).
      try {
        const locationEnvelope = await apiClient.getTripLocation(tripId);
        if (cancelled) return;
        if (locationEnvelope.data) {
          setFix(toFix(locationEnvelope.data));
          setTrackingState(locationEnvelope.data.tracking_state);
          setTripStatus(locationEnvelope.data.trip_status);
          setNoLocationYet(false);
        }
      } catch (caught) {
        if (caught instanceof ApiClientError && caught.status === 404) {
          setNoLocationYet(true);
        } else if (!cancelled) {
          setError('Could not load the latest bus location.');
        }
      }

      try {
        const etaEnvelope = await apiClient.getTripEta(tripId);
        if (cancelled) return;
        if (etaEnvelope.data) {
          setEta(etaEnvelope.data);
          setTripStatus(etaEnvelope.data.trip_status);
          setTrackingState(etaEnvelope.data.tracking_state);
        }
      } catch {
        // A missing ETA never breaks the tracking screen; live updates can
        // still arrive over the socket.
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
      setConnection(networkRef.current === 'offline' ? 'offline' : 'reconnecting');
    };
    const onReconnectAttempt = () => setConnection('reconnecting');
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
    const onEtaUpdate = (payload: TripEtaUpdateEvent) => {
      if (payload.trip_id !== tripId) return;
      setEta(payload.eta);
      setTripStatus(payload.eta.trip_status);
      setTrackingState(payload.eta.tracking_state);
      setNoLocationYet(payload.eta.latest === null);
    };
    const onStopArrived = (payload: TripStopArrivedEvent) => {
      if (payload.trip_id !== tripId) return;
      setLastArrival(payload);
      setTripStatus(payload.trip_status);
      setTrackingState(payload.tracking_state);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.on(LIVE_TRACKING_EVENTS.locationUpdate, onLocation);
    socket.on(LIVE_TRACKING_EVENTS.trackingStarted, onStarted);
    socket.on(LIVE_TRACKING_EVENTS.trackingStopped, onStopped);
    socket.on(LIVE_TRACKING_EVENTS.etaUpdate, onEtaUpdate);
    socket.on(LIVE_TRACKING_EVENTS.stopArrived, onStopArrived);

    void loadRestSnapshot();

    if (socket.connected) {
      setConnection('live');
      join();
    } else {
      setConnection('reconnecting');
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
      socket.off(LIVE_TRACKING_EVENTS.etaUpdate, onEtaUpdate);
      socket.off(LIVE_TRACKING_EVENTS.stopArrived, onStopArrived);
      if (joinedRef.current === tripId) {
        socket.emit(LIVE_TRACKING_EVENTS.leave, { trip_id: tripId });
        joinedRef.current = null;
      }
    };
  }, [tripId]);

  // Device connectivity drives the offline chip (the socket keeps reconnecting
  // on its own once the network returns).
  useEffect(() => {
    if (network === 'offline') {
      setConnection('offline');
    }
  }, [network]);

  return { connection, fix, trackingState, tripStatus, noLocationYet, error, eta, lastArrival };
}
