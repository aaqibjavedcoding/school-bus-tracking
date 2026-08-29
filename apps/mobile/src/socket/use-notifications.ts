import { useEffect, useRef, useState } from 'react';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATIONS_NAMESPACE,
  type NotificationRealtimeEvent,
} from '@school-bus-tracking/shared-types';
import { getSocketHub } from '../services/sockets';

/**
 * Parent realtime notifications (Task 21 contract).
 *
 * The `/notifications` gateway has *no* subscribe event by design: after a
 * successful handshake the server joins the socket to the private room of its
 * own JWT subject. The client therefore only listens — it can neither name a
 * room nor impersonate a parent.
 */
export function useNotificationStream(onNew: (event: NotificationRealtimeEvent) => void): {
  connected: boolean;
} {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onNew);
  handlerRef.current = onNew;

  useEffect(() => {
    const socket = getSocketHub().socketFor(NOTIFICATIONS_NAMESPACE);
    const onNewEvent = (event: NotificationRealtimeEvent): void => {
      handlerRef.current(event);
    };
    const onConnect = (): void => setConnected(true);
    const onDisconnect = (): void => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(NOTIFICATION_EVENTS.new, onNewEvent);
    if (socket.connected) {
      setConnected(true);
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(NOTIFICATION_EVENTS.new, onNewEvent);
    };
  }, []);

  return { connected };
}
