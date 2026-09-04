'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import { useEmergencyAlarm } from './useEmergencyAlarm';
import { activeAlarmCountLabel, alarmStatusHint, describeEmergencyAlarm } from './helpers';

/**
 * School-admin emergency alarm control for the top bar (Task 44 follow-up).
 *
 * The counterpart of the parents-only `NotificationBell`: it renders for a
 * `SCHOOL_ADMIN` only, and it exists for one reason — the moment a driver or
 * conductor presses the SOS button, the admin's tab must be *audibly*
 * impossible to ignore, on whatever screen they happen to be on.
 *
 * The siren itself lives in `emergency-alarm.ts` (Web Audio, no asset, no new
 * dependency) and is driven by the existing `/emergencies` socket feed; this
 * component only reflects and controls it:
 *
 * - a red, pulsing count that opens the emergency console;
 * - a mute toggle (visual alerts and the live list keep working while muted);
 * - a visible **"Enable alarm sound"** button whenever the browser's autoplay
 *   policy is holding a queued alarm back, so a blocked alarm is never a silent
 *   failure — one click is a user gesture, which unlocks the audio and starts
 *   the siren immediately;
 * - an `aria-live="assertive"` announcement, so the alarm reaches screen-reader
 *   users too, with or without sound.
 *
 * Nothing here changes how notifications are delivered: the tenant room is
 * still assigned by the gateway from the verified JWT, and normal notifications
 * are never wired to this control at all.
 */
export const EmergencyAlarmBell: React.FC = () => {
  const router = useRouter();
  const { status, active, muted, enabled, toggleMuted, enableSound } = useEmergencyAlarm();

  if (!enabled) {
    return null;
  }

  const count = active.length;
  const latest = active[count - 1] ?? null;
  const sounding = status === 'sounding';
  const blocked = status === 'blocked';
  const hint = alarmStatusHint(status);
  const label =
    count > 0 ? `${hint} — ${activeAlarmCountLabel(count)}. Open the emergency console.` : hint;

  return (
    <div className={`emergency-alarm ${sounding ? 'sounding' : ''}`.trim()} data-status={status}>
      {/* Assertive live region: the alarm must reach screen readers as well. */}
      <p className="sr-only" role="status" aria-live="assertive">
        {latest ? `Emergency. ${describeEmergencyAlarm(latest)}.` : ''}
      </p>

      {blocked ? (
        <button
          type="button"
          className="emergency-alarm-enable"
          onClick={enableSound}
          title="The browser blocked autoplay. Click once to let the emergency alarm sound."
        >
          Enable alarm sound
        </button>
      ) : null}

      <button
        type="button"
        className={`emergency-alarm-button ${count > 0 ? 'active' : ''}`.trim()}
        aria-label={label}
        title={label}
        onClick={() => router.push('/emergencies')}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10.3 3.6 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        {count > 0 ? (
          <span className="emergency-alarm-count" aria-hidden="true">
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </button>

      <button
        type="button"
        className="emergency-alarm-mute"
        onClick={toggleMuted}
        aria-pressed={muted}
        title={muted ? 'Unmute the emergency alarm sound' : 'Mute the emergency alarm sound'}
      >
        {muted ? (
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M11 5 6 9H2v6h4l5 4V5Z" />
            <path d="m22 9-6 6" />
            <path d="m16 9 6 6" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M11 5 6 9H2v6h4l5 4V5Z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        )}
        <span className="sr-only">{muted ? 'Alarm sound muted' : 'Alarm sound on'}</span>
      </button>
    </div>
  );
};
