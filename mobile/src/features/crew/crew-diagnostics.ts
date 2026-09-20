import { LIVE_TRACKING_NAMESPACE } from '@school-bus-tracking/shared-types';
import { t } from '../../lib/i18n.ts';
import { formatTime } from '../../lib/format.ts';
import type { RuntimeEnvironment } from '../../lib/runtime-environment.ts';
import type { CrewTrackingState } from './tracking-lifecycle.ts';
import { apiHost } from './tracking-status.ts';

/**
 * The "read these lines to support" readout on the Help screen.
 *
 * Every row is one fact a support engineer can act on: what kind of app this
 * phone is running (Expo Go has no map engine and no background task — see
 * `lib/runtime-environment.ts`), which server it talks to, and what the OS /
 * lifecycle say about GPS. The builder is pure (state in, rows out) so
 * `crew-diagnostics.spec.ts` can pin the two invariants that matter most:
 *
 * - **no secret ever reaches a row** — the API base URL may be misconfigured
 *   with a token in the query string or in userinfo, and a raw string would
 *   hand it to a support call;
 * - **server strings stay server strings** — `lastStopReason` and the
 *   recovery `lastReason` are English data read verbatim (the
 *   server-string boundary, `docs/mobile-ux.md`), exactly like the four
 *   support counters.
 */

/** One rendered row of the diagnostics card (label above value). */
export interface DiagnosticsRow {
  /** Localised row label (`t()`-resolved by the caller's locale). */
  label: string;
  /** The fact. Data is rendered as sent by the server; chrome is i18n. */
  value: string;
}

/** The "no fact" placeholder — a symbol, not copy. */
const DASH = '—';

export function buildDiagnosticsRows(
  state: CrewTrackingState,
  runtime: RuntimeEnvironment,
  apiBaseUrl: string | null,
): DiagnosticsRow[] {
  const host = apiHost(apiBaseUrl);

  // What kind of app is this phone running? Expo Go on Android has no Google
  // Maps and no background task; a development build has everything. The
  // platform completes the fact ("Expo Go · android").
  let runtimeValue: string;
  if (runtime.isExpoGo) {
    runtimeValue = `${t('help.diagnostics.valueExpoGo')} · ${runtime.platform}`;
  } else if (runtime.platform !== 'unknown') {
    runtimeValue = `${t('help.diagnostics.valueDevBuild')} · ${runtime.platform}`;
  } else {
    runtimeValue = t('help.diagnostics.valueUnknown');
  }

  // Which server does this phone talk to? Host only: `apiHost` drops any
  // userinfo, path, query and fragment, so a misconfigured
  // `EXPO_PUBLIC_API_URL` with a token in it can never reach this row.
  const apiHostValue = host ?? t('help.diagnostics.valueNotSet');
  // The live-tracking socket is the same server, this namespace — never the
  // raw URL (which could carry a query string the host row just lost).
  const socketValue = host ? `${host}${LIVE_TRACKING_NAMESPACE}` : DASH;

  const servicesValue =
    state.servicesEnabled === null
      ? DASH
      : state.servicesEnabled
        ? t('common.on')
        : t('common.off');

  let backgroundValue: string = state.backgroundPermission;
  if (state.backgroundUnavailableReason === 'expo-go') {
    // "unavailable" alone does not say why; this is the fixable case.
    backgroundValue = `${backgroundValue} · ${t('gps.backgroundNeedsDevBuild')}`;
  }

  const sharingParts = [
    state.foregroundActive ? t('help.diagnostics.valueForeground') : null,
    state.backgroundActive ? t('help.diagnostics.valueBackground') : null,
  ].filter((part): part is string => part !== null);
  const sharingValue = sharingParts.length > 0 ? sharingParts.join(' + ') : DASH;

  // Server strings, read verbatim (the server-string boundary).
  const lastStopValue = state.lastStopReason
    ? state.lastStopTripStatus
      ? `${state.lastStopReason} · ${state.lastStopTripStatus}`
      : state.lastStopReason
    : DASH;

  let recoveryValue = String(state.recovery.attempts);
  if (state.recovery.exhausted) {
    recoveryValue += ` · ${t('help.diagnostics.valueExhausted')}`;
  }
  if (state.recovery.lastReason) {
    recoveryValue += ` · ${state.recovery.lastReason}`;
  }

  // The lifecycle message is the app's own copy (localised); the timestamp is
  // when it became visible.
  const lastErrorValue =
    state.message === null ? DASH : `${state.message} · ${formatTime(state.messageAt)}`;

  // Delivery counters, compact for one read-aloud line. "Sent" is everything
  // the server received (accepted + rejected + throttled); "Accepted" is what
  // the school saw; "Pending (offline)" is held for the bounded retry.
  const stats = state.stats;
  const sent = stats.emittedCount + stats.rejectedCount + stats.throttledCount;
  const deliveryValue = [
    `${t('help.diagnostics.sent')} ${sent}`,
    `${t('help.diagnostics.accepted')} ${stats.emittedCount}`,
    `${t('help.diagnostics.rejected')} ${stats.rejectedCount}`,
    `${t('help.diagnostics.pending')} ${stats.disconnectedCount}`,
    `${t('help.diagnostics.invalid')} ${stats.invalidCount}`,
    `${t('help.diagnostics.retried')} ${stats.retriedCount}`,
  ].join(' · ');

  return [
    { label: t('help.diagnostics.runtime'), value: runtimeValue },
    { label: t('help.diagnostics.apiHost'), value: apiHostValue },
    { label: t('help.diagnostics.socket'), value: socketValue },
    { label: t('help.diagnostics.connection'), value: state.connection },
    { label: t('help.diagnostics.locationServices'), value: servicesValue },
    { label: t('help.diagnostics.foregroundPermission'), value: state.foregroundPermission },
    { label: t('help.diagnostics.backgroundPermission'), value: backgroundValue },
    { label: t('help.diagnostics.sharing'), value: sharingValue },
    { label: t('help.diagnostics.lastStop'), value: lastStopValue },
    { label: t('help.diagnostics.recovery'), value: recoveryValue },
    { label: t('help.diagnostics.lastError'), value: lastErrorValue },
    { label: t('help.diagnostics.delivery'), value: deliveryValue },
  ];
}
