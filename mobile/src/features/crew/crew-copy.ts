/**
 * Every string the Phase-2 crew surfaces render, in one pure module.
 *
 * Why: Phase 3 adds Hindi/voice, which needs a single swap point — an i18n
 * layer that returns the same keys. Nothing here formats dynamic data; the
 * components interpolate values around these constants. Keep entries flat,
 * key-stable and free of React imports so `node --test` can pin them.
 */

export const crewCopy = {
  /** Giant status-card words (always uppercase — colour + icon repeat them). */
  statusWord: {
    scheduled: 'SCHEDULED',
    boarding: 'BOARDING',
    inProgress: 'ON THE ROAD',
    completed: 'COMPLETED',
    cancelled: 'CANCELLED',
  },

  /** Status-card chrome. */
  detailsToggle: 'More details',
  detailsToggleHide: 'Hide details',
  nextStopFallback: 'Next stop updates after GPS starts',
  allStopsDone: 'All stops done',
  etaUnavailable: 'ETA soon',
  tripCountNote: (count: number): string => `${count} trips today · showing the active one`,
  departedAt: (time: string): string => `Departed ${time}`,
  arrivedAt: (time: string): string => `Arrived ${time}`,

  /** Collapsible details rows. */
  details: {
    route: 'Route',
    scheduled: 'Scheduled',
    date: 'Date',
    bus: 'Bus',
    role: 'Role',
    connection: 'Connection',
  },

  /** Compact GPS strip on the trip screen (driver). */
  gps: {
    sharingOn: 'Sharing ✅',
    sharingOff: 'Sharing ❌',
    lastUpdate: (time: string): string => `Updated ${time}`,
    neverUpdated: 'No update yet',
    retry: 'Retry',
    stop: 'Stop',
    helpLink: 'GPS details & support',
  },

  /** Help / Support screen. */
  help: {
    title: 'Help & support',
    intro:
      'If the school says the bus is not moving on their screen, show them this page. These numbers are for the support team — you never have to read them while driving.',
    supportHeadline: 'For the support team',
    supportAdvice:
      'Read out the four numbers below and the last-fix line. "Dropped (offline)" growing while you have internet usually means a weak signal area — support can check the same counters on the server.',
  },

  /** SOS hold-to-confirm. */
  sos: {
    holdLabel: 'HOLD to send SOS',
    holdingHint: 'Keep holding…',
    a11yLabel: 'Emergency SOS. Press and hold to alert the school.',
    sent: 'SOS sent ✅',
    queued: 'SOS queued ⏳ — will send when internet returns',
    queuedShort: 'Queued ⏳ will send when online',
    retrying: 'Sending…',
    activeAlert: 'Alert active — school has been notified',
    manageHint: 'Details & cancel are on the SOS tab.',
    sendFailed: 'SOS could not be sent',
  },

  /** Manifest board/drop rows. */
  manifest: {
    board: 'Board',
    drop: 'Drop',
    waitingLabel: 'Waiting',
    boardHint: 'Tap the row when the student gets on.',
    dropHint: 'Tap the row when the student gets off.',
    confirmBoard: (name: string, time: string): string => `${name} ✓ ${time}`,
    confirmDrop: (name: string, time: string): string => `${name} ✕ ${time}`,
    queuedBoard: (name: string): string => `${name} ⏳ saved offline`,
    queuedDrop: (name: string): string => `${name} ⏳ saved offline`,
    announceBoard: (name: string): string => `${name} boarded`,
    announceDrop: (name: string): string => `${name} dropped`,
    rowA11y: {
      waiting: (name: string): string => `${name}, waiting. Double-tap to board.`,
      onBoard: (name: string, time: string): string => `${name}, on board since ${time}.`,
      droppedRow: (name: string, time: string): string => `${name}, dropped off at ${time}.`,
    },
  },

  /** Tab/screen captions introduced by Phase 2. */
  screens: {
    help: 'Help',
  },
} as const;

export type CrewCopy = typeof crewCopy;
