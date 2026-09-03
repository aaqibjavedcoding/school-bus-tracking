'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserRole } from '@school-bus-tracking/shared-types';
import { getEmergenciesSocket } from '../../services/emergencies-socket';
import { connectAuthenticatedSocket } from '../../services/socket-auth';
import { useAuth } from '../auth/AuthProvider';
import { getEmergencyAlarmPlayer, type EmergencyAlarmSnapshot } from './emergency-alarm';
import { attachEmergencyAlarm } from './helpers';

/** Idle snapshot, used while the hook is disabled (non-admin roles, SSR). */
const IDLE_SNAPSHOT: EmergencyAlarmSnapshot = {
  status: 'idle',
  active: [],
  unlocked: false,
  muted: false,
  pendingCount: 0,
  lastError: null,
};

/** Gestures browsers accept as the activation of an `AudioContext`. */
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * School-admin emergency alarm hook.
 *
 * Wires the *existing* emergency feed to the siren: the shared `/emergencies`
 * socket (authenticated with the same in-memory JWT as every other namespace,
 * placed by the gateway into the socket's own tenant room) is listened to for
 * `emergency:new` / `emergency:updated`, and `helpers.alarmDecisionFor` decides
 * whether a frame may make a sound. Nothing is subscribed that the emergency
 * console does not already use, and no room is ever named by the client.
 *
 * The hook is enabled for `SCHOOL_ADMIN` only — the same shape as the
 * parents-only `NotificationBell`. A driver's or conductor's web session is
 * joined to the same room by the gateway, but the crew member who raised an SOS
 * already knows about it, so their tab stays silent.
 *
 * Autoplay: the audio context may only start inside a user gesture, so the hook
 * listens for the first `pointerdown` / `keydown` / `touchstart` and unlocks it
 * there. An SOS that arrives before any gesture is queued by the player and
 * plays the moment the unlock succeeds; until then the shell shows a visible
 * "Enable alarm sound" control, so the alarm never fails silently.
 */
export function useEmergencyAlarm(options: { enabled?: boolean } = {}) {
  const { user } = useAuth();
  const isAdmin = user?.role === UserRole.SCHOOL_ADMIN;
  const enabled = options.enabled ?? isAdmin;
  const player = getEmergencyAlarmPlayer();
  const [snapshot, setSnapshot] = useState<EmergencyAlarmSnapshot>(() =>
    enabled ? player.getSnapshot() : IDLE_SNAPSHOT,
  );

  useEffect(() => {
    if (!enabled) {
      setSnapshot(IDLE_SNAPSHOT);
      return undefined;
    }

    const unsubscribe = player.subscribe(setSnapshot);
    setSnapshot(player.getSnapshot());

    // Reuse the process-wide emergencies socket; `connectAuthenticatedSocket`
    // leaves it closed while the session holds no access token, exactly as the
    // emergency console and the crew SOS panel do.
    const socket = getEmergenciesSocket();
    connectAuthenticatedSocket(socket);
    const detach = attachEmergencyAlarm(socket, player);

    let unlocked = player.getSnapshot().unlocked;
    const removeGestureListeners = () => {
      for (const event of UNLOCK_EVENTS) {
        window.removeEventListener(event, unlock, true);
      }
    };
    const unlock = () => {
      if (unlocked) {
        return;
      }
      void player.unlock().then((ready) => {
        unlocked = ready;
        if (ready) {
          // Once audio may play, the gesture listeners have done their job.
          removeGestureListeners();
        }
      });
    };
    for (const event of UNLOCK_EVENTS) {
      window.addEventListener(event, unlock, true);
    }

    return () => {
      removeGestureListeners();
      detach();
      unsubscribe();
    };
  }, [enabled, player]);

  /** Mutes or unmutes the siren; the visual indicator keeps working either way. */
  const setMuted = useCallback(
    (muted: boolean) => {
      player.setMuted(muted);
    },
    [player],
  );

  const toggleMuted = useCallback(() => {
    player.setMuted(!player.getSnapshot().muted);
  }, [player]);

  /** "Enable alarm sound" — a real user gesture, so the browser allows it. */
  const enableSound = useCallback(() => {
    void player.unlock();
  }, [player]);

  return { ...snapshot, setMuted, toggleMuted, enableSound, enabled };
}
