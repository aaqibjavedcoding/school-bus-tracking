import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { EMERGENCY_EVENTS, EmergencyStatus } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../../services/api';
import { getEmergenciesSocket } from '../../../services/emergencies-socket';
import { connectAuthenticatedSocket } from '../../../services/socket-auth';
import { unwrapEnvelope } from '../../../lib/errors';
import {
  normalizeSosAlertEvent,
  sosAlertEnabledForRole,
  sosAlertFrameDecision,
  sosAlertLoop,
  type SosAlertSnapshot,
} from './sos-alert.ts';
import { installNativeSosAlertDrivers } from './sos-alert-native.ts';

/**
 * Drives the shared {@link sosAlertLoop} for a school-admin session.
 *
 * Thin wiring only — every decision lives in the pure `sos-alert.ts`:
 *
 * 1. installs the native drivers once (no-op on web and under tests);
 * 2. subscribes to the **existing** emergencies socket (the same one the
 *    console screen refreshes from — no new room, no new channel) and feeds
 *    its frames through the pure frame policy;
 * 3. fetches the currently-active emergencies once, so an SOS raised while
 *    the admin was on a cold start still alerts (this also heals frames
 *    missed while the app was backgrounded);
 * 4. gates the loop on the app being in the foreground — a backgrounded
 *    phone stays silent (no timers, no vibration, no speech);
 * 5. mirrors every loop change as React state for the banner + mute button.
 *
 * Mounting this hook in two places (the admin layout and the emergency
 * console) is safe by construction: the loop itself is a singleton, `raise`
 * is idempotent per emergency, and a duplicate listener cannot stack a
 * second loop — the same guarantee the web alarm's singleton player makes.
 *
 * Enabled for `SCHOOL_ADMIN` only, mirroring the web `useEmergencyAlarm`:
 * the crew member who raised the SOS already knows about it.
 */
export function useSosAlertLoop(
  role: string | null | undefined,
  options: { stopOnUnmount?: boolean } = {},
) {
  const enabled = sosAlertEnabledForRole(role);
  const stopOnUnmount = options.stopOnUnmount ?? false;
  const [snapshot, setSnapshot] = useState<SosAlertSnapshot>(() => sosAlertLoop.getSnapshot());

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    installNativeSosAlertDrivers();
    const unsubscribe = sosAlertLoop.subscribe(setSnapshot);

    // Foreground gate (the initial state included — a cold-opened app is
    // 'active' by the time this runs).
    sosAlertLoop.setAppActive(AppState.currentState === 'active');
    const appState = AppState.addEventListener('change', (status) => {
      sosAlertLoop.setAppActive(status === 'active');
    });

    // The live feed: new SOS frames raise the loop; status changes away
    // from OPEN silence them. Malformed frames are ignored by policy.
    const socket = getEmergenciesSocket();
    connectAuthenticatedSocket(socket);
    const onNew = (payload: unknown) => {
      const decision = sosAlertFrameDecision(EMERGENCY_EVENTS.new, payload);
      if (decision.action === 'raise') sosAlertLoop.raise(decision.event);
    };
    const onUpdated = (payload: unknown) => {
      const decision = sosAlertFrameDecision(EMERGENCY_EVENTS.updated, payload);
      if (decision.action === 'silence') sosAlertLoop.silence(decision.id);
    };
    socket.on(EMERGENCY_EVENTS.new, onNew);
    socket.on(EMERGENCY_EVENTS.updated, onUpdated);

    // What the socket cannot tell us: what was already open when this
    // section mounted. Idempotent by the loop's per-event de-duplication.
    void apiClient
      .listActiveEmergencies()
      .then((envelope) => {
        for (const item of unwrapEnvelope(envelope).items) {
          if (item.status !== EmergencyStatus.OPEN) continue;
          const event = normalizeSosAlertEvent(item);
          if (event) sosAlertLoop.raise(event);
        }
      })
      .catch(() => {
        // A failed catch-up read must never break the console; the next
        // socket frame (or the screen's own reload) heals it.
      });

    return () => {
      appState.remove();
      socket.off(EMERGENCY_EVENTS.new, onNew);
      socket.off(EMERGENCY_EVENTS.updated, onUpdated);
      unsubscribe();
      if (stopOnUnmount) {
        // Leaving the admin section (sign-out, role switch) must not leave
        // a siren running behind — the same rule the web player applies.
        sosAlertLoop.silenceAll();
      }
    };
  }, [enabled, stopOnUnmount]);

  /** Mutes or unmutes the loop; the banner itself keeps showing either way. */
  const setMuted = useCallback((muted: boolean) => {
    sosAlertLoop.setMuted(muted);
  }, []);

  const toggleMuted = useCallback(() => {
    sosAlertLoop.setMuted(!sosAlertLoop.getSnapshot().muted);
  }, []);

  return { ...snapshot, enabled, setMuted, toggleMuted };
}
