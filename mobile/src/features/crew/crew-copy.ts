import { t } from '../../lib/i18n.ts';

/**
 * Every string the crew surfaces render, in one pure module — now a thin,
 * locale-aware view over the i18n dictionaries instead of an English literal
 * table.
 *
 * Phase 2 built this as the Phase-3 plug point and the swap is deliberately
 * **shape-preserving**: the keys are the same, the formatters have the same
 * signatures, and `crew-copy.spec.ts` still passes unchanged. What changed is
 * *when* a value is read — every entry is a getter (or a formatter that calls
 * `t()` at call time), so a language switch is picked up on the next render
 * rather than frozen at module load.
 *
 * Two consequences worth knowing:
 *
 * - **Never destructure this object into a module-level constant.** A
 *   `const { sent } = crewCopy.sos` at import time would capture one locale
 *   forever — the exact bug `trip-status-style.ts` had before it moved its
 *   `word` into a getter. Read it inside a component/function body.
 * - Nothing here formats *data*. Student names, route/bus codes and server
 *   timestamps are interpolated by the callers, and are never translated.
 */

export const crewCopy = {
  /** Giant status-card words — colour is never the only cue, the word repeats it. */
  statusWord: {
    get scheduled(): string {
      return t('status.scheduled');
    },
    get boarding(): string {
      return t('status.boarding');
    },
    get inProgress(): string {
      return t('status.inProgress');
    },
    get completed(): string {
      return t('status.completed');
    },
    get cancelled(): string {
      return t('status.cancelled');
    },
  },

  /** Status-card chrome. */
  get detailsToggle(): string {
    return t('trip.detailsToggle');
  },
  get detailsToggleHide(): string {
    return t('trip.detailsToggleHide');
  },
  get nextStopFallback(): string {
    return t('trip.nextStopFallback');
  },
  get allStopsDone(): string {
    return t('trip.allStopsDone');
  },
  get etaUnavailable(): string {
    return t('trip.etaUnavailable');
  },
  /** "Next: <stop name>" — the stop name itself is data and stays as sent. */
  nextStop: (name: string): string => t('trip.nextStop', { name }),
  etaLine: (minutes: string): string => t('trip.eta', { minutes }),
  tripCountNote: (count: number): string => t('trip.tripCountNote', { count }),
  departedAt: (time: string): string => t('trip.departedAt', { time }),
  arrivedAt: (time: string): string => t('trip.arrivedAt', { time }),

  /** Collapsible details rows. */
  details: {
    get route(): string {
      return t('trip.detail.route');
    },
    get scheduled(): string {
      return t('trip.detail.scheduled');
    },
    get date(): string {
      return t('trip.detail.date');
    },
    get bus(): string {
      return t('trip.detail.bus');
    },
    get role(): string {
      return t('trip.detail.role');
    },
    get connection(): string {
      return t('trip.detail.connection');
    },
  },

  /** Compact GPS strip on the trip screen (driver). */
  gps: {
    get sharingOn(): string {
      return t('gps.sharingOn');
    },
    get sharingOff(): string {
      return t('gps.sharingOff');
    },
    lastUpdate: (time: string): string => t('gps.lastUpdate', { time }),
    get neverUpdated(): string {
      return t('gps.neverUpdated');
    },
    get retry(): string {
      return t('gps.retry');
    },
    get stop(): string {
      return t('gps.stop');
    },
    get helpLink(): string {
      return t('gps.helpLink');
    },
  },

  /** Help / Support screen. */
  help: {
    get title(): string {
      return t('help.title');
    },
    get intro(): string {
      return t('help.intro');
    },
    get supportHeadline(): string {
      return t('help.supportHeadline');
    },
    get supportAdvice(): string {
      return t('help.supportAdvice');
    },
  },

  /** SOS hold-to-confirm. */
  sos: {
    get holdLabel(): string {
      return t('sos.holdLabel');
    },
    get holdingHint(): string {
      return t('sos.holdingHint');
    },
    get a11yLabel(): string {
      return t('sos.a11yLabel');
    },
    get a11yHint(): string {
      return t('sos.holdA11yHint');
    },
    get sent(): string {
      return t('sos.sent');
    },
    get queued(): string {
      return t('sos.queued');
    },
    get queuedShort(): string {
      return t('sos.queuedShort');
    },
    get retrying(): string {
      return t('sos.retrying');
    },
    get activeAlert(): string {
      return t('sos.activeAlert');
    },
    get manageHint(): string {
      return t('sos.manageHint');
    },
    get sendFailed(): string {
      return t('sos.sendFailed');
    },
  },

  /**
   * "Sound & vibration" settings (Phase 3b) — the Help & support screen.
   *
   * Additive only: Phase 2's shape is untouched, so its call sites and
   * `crew-copy.spec.ts` needed no edits. Same rule as everything else here —
   * getters, so a language switch is picked up on the next render.
   */
  feedback: {
    get title(): string {
      return t('feedback.title');
    },
    get hint(): string {
      return t('feedback.hint');
    },
    get voice(): string {
      return t('feedback.voice');
    },
    get voiceHint(): string {
      return t('feedback.voiceHint');
    },
    get vibration(): string {
      return t('feedback.vibration');
    },
    get vibrationHint(): string {
      return t('feedback.vibrationHint');
    },
    get test(): string {
      return t('feedback.test');
    },
    get a11yHint(): string {
      return t('feedback.a11yHint');
    },
  },

  /** Manifest board/drop rows. */
  manifest: {
    get board(): string {
      return t('manifest.board');
    },
    get drop(): string {
      return t('manifest.drop');
    },
    get waitingLabel(): string {
      return t('manifest.waitingLabel');
    },
    get boardHint(): string {
      return t('manifest.boardHint');
    },
    get dropHint(): string {
      return t('manifest.dropHint');
    },
    confirmBoard: (name: string, time: string): string =>
      t('manifest.confirmBoard', { name, time }),
    confirmDrop: (name: string, time: string): string => t('manifest.confirmDrop', { name, time }),
    queuedBoard: (name: string): string => t('manifest.queuedBoard', { name }),
    queuedDrop: (name: string): string => t('manifest.queuedDrop', { name }),
    announceBoard: (name: string): string => t('manifest.announceBoard', { name }),
    announceDrop: (name: string): string => t('manifest.announceDrop', { name }),
    rowA11y: {
      waiting: (name: string): string => t('manifest.rowA11y.waiting', { name }),
      onBoard: (name: string, time: string): string =>
        t('manifest.rowA11y.onBoard', { name, time }),
      droppedRow: (name: string, time: string): string =>
        t('manifest.rowA11y.dropped', { name, time }),
    },
  },
};

export type CrewCopy = typeof crewCopy;
