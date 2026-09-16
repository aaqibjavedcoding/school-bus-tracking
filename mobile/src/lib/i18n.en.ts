/**
 * English dictionary — the **source of truth** for every UI string the mobile
 * app owns (Phase 3 localisation).
 *
 * Data-only: no imports, no logic, no React. `i18n.hi.ts` is typed as
 * `Dictionary` (= `typeof en`), so a missing or mis-spelled Hindi entry is a
 * **compile** error, and `i18n-parity.spec.ts` additionally pins the runtime
 * invariants (no empty values, identical `{placeholder}` sets, `.one`/`.other`
 * plural pairs complete).
 *
 * Two kinds of string deliberately do NOT live here:
 *
 * - **Data** — student names, route/bus codes, stop names, school names,
 *   registration numbers. Translating data is wrong; it is rendered as the
 *   server sent it.
 * - **Server-supplied English** — API error `message`s, `EMERGENCY_TYPE_LABELS`
 *   / `EMERGENCY_STATUS_LABELS`, `*_document_type_label`. The server speaks
 *   English and Phase 3 is client-side only, so those pass through untouched.
 *   Where the server gives a *known error code* the app swaps in its own copy
 *   via `localizeErrorCode` in `i18n.ts`; an unknown code is shown as-is with
 *   the raw code surfaced, never silently hidden.
 *
 * Placeholders are written `{likeThis}`; `t()` types the params object from
 * them, so `t('board.done', { name })` without `time` will not compile.
 */
export const en = {
  // ── Crew navigation (tab bar + screen titles) ──────────────────────────
  'nav.tab.drive': 'Drive',
  'nav.tab.trip': 'Trip',
  'nav.tab.manifest': 'Manifest',
  'nav.tab.students': 'Students',
  'nav.tab.stops': 'Stops',
  'nav.tab.sos': 'SOS',
  'nav.trip.title': '{role} · Today',
  'nav.trip.titleFallback': "Today's trip",
  'nav.manifest.titleDriver': 'Students on board',
  'nav.manifest.titleConductor': 'Boarding & drop',
  'nav.stops.title': 'Stops & ETA',
  'nav.sos.title': 'Emergency',
  'nav.help.title': 'Help & support',
  'nav.platform.title': 'Platform admin',

  // ── Roles ──────────────────────────────────────────────────────────────
  'role.driver': 'Driver',
  'role.conductor': 'Conductor',
  'role.crew': 'Crew',
  'role.parent': 'Parent',
  'role.schoolAdmin': 'School admin',
  'role.superAdmin': 'Platform admin',

  // ── Trip state words (28px on the giant status card) ───────────────────
  'status.scheduled': 'SCHEDULED',
  'status.boarding': 'BOARDING',
  'status.inProgress': 'ON THE ROAD',
  'status.completed': 'COMPLETED',
  'status.cancelled': 'CANCELLED',

  // ── Trip screen ────────────────────────────────────────────────────────
  'trip.loading': "Loading today's trip…",
  'trip.loadError': 'Could not load your trips',
  'trip.empty.title': 'No trip scheduled today',
  'trip.empty.body':
    'You have no runs assigned for today. Trips appear here as soon as the school dispatches them.',
  'trip.detailsToggle': 'More details',
  'trip.detailsToggleHide': 'Hide details',
  'trip.nextStopFallback': 'Next stop updates after GPS starts',
  'trip.allStopsDone': 'All stops done',
  'trip.nextStop': 'Next: {name}',
  'trip.eta': 'ETA {minutes}',
  'trip.etaUnavailable': 'ETA soon',
  'trip.tripCountNote': '{count} trips today · showing the active one',
  'trip.departedAt': 'Departed {time}',
  'trip.arrivedAt': 'Arrived {time}',
  'trip.detail.route': 'Route',
  'trip.detail.scheduled': 'Scheduled',
  'trip.detail.date': 'Date',
  'trip.detail.bus': 'Bus',
  'trip.detail.role': 'Role',
  'trip.detail.connection': 'Connection',
  'trip.emptyValue': '—',
  'trip.link.manifestDriver': 'Manifest',
  'trip.link.manifestConductor': 'Board & drop',
  'trip.link.stops': 'Stops & ETA',

  // ── Trip lifecycle actions ─────────────────────────────────────────────
  'trip.action.boarding': 'Start boarding',
  'trip.action.inProgress': 'Depart & drive',
  'trip.action.completed': 'Complete trip',
  'trip.completedNote': 'This trip is completed.',
  'trip.cancelledNote': 'This trip was cancelled.',
  'trip.cancelledReason': 'This trip was cancelled: {reason}',
  'trip.queuedNote': '{action} saved on this phone — it will sync when you are back online.',
  'trip.updateError': 'Could not update the trip.',
  'trip.cancel.button': 'Cancel trip…',
  'trip.cancel.reasonLabel': 'Cancellation reason',
  'trip.cancel.reasonPlaceholder': 'e.g. Vehicle fault',
  'trip.cancel.confirm': 'Confirm cancellation',
  'trip.cancel.keep': 'Keep trip',
  'trip.cancel.reasonRequired': 'A cancellation reason is required.',
  'trip.cancel.failed': 'Could not cancel the trip.',

  // ── Manifest (board / drop) ────────────────────────────────────────────
  'manifest.loading': 'Loading manifest…',
  'manifest.loadError': 'Could not load your trip',
  'manifest.empty.tripTitle': 'No trip today',
  'manifest.empty.tripBody': 'There is no manifest without a trip.',
  'manifest.empty.studentsTitle': 'No students on this route',
  'manifest.empty.studentsBody':
    'Every manifest entry comes from active students whose home stop belongs to this route.',
  'manifest.unavailable': 'Manifest unavailable',
  'manifest.hint.driver': 'The head-count you are carrying. Ask the conductor before moving off.',
  'manifest.hint.conductor':
    'Tap board when a student gets on and drop when they get off — the time is recorded automatically.',
  'manifest.counts': '{boarded} boarded · {pending} waiting · {dropped} dropped',
  'manifest.summary.total': '{count} students',
  'manifest.summary.pending': '{count} waiting',
  'manifest.summary.boarded': '{count} on board',
  'manifest.summary.dropped': '{count} dropped',
  'manifest.search.placeholder': 'Search student, admission no. or stop…',
  'manifest.filter.all': 'All',
  'manifest.filter.waiting': 'Waiting',
  'manifest.filter.boarded': 'On board',
  'manifest.filter.dropped': 'Dropped',
  'manifest.empty.searchTitle': 'No students match',
  'manifest.empty.searchBody': 'No students match the current search or filter.',
  'manifest.clearFilters': 'Clear filters',
  'manifest.board': 'Board',
  'manifest.drop': 'Drop',
  'manifest.waitingLabel': 'Waiting',
  'manifest.boardHint': 'Tap the row when the student gets on.',
  'manifest.dropHint': 'Tap the row when the student gets off.',
  'manifest.confirmBoard': '{name} ✓ {time}',
  'manifest.confirmDrop': '{name} ✕ {time}',
  'manifest.queuedBoard': '{name} ⏳ saved offline',
  'manifest.queuedDrop': '{name} ⏳ saved offline',
  'manifest.announceBoard': '{name} boarded',
  'manifest.announceDrop': '{name} dropped',
  'manifest.rowA11y.waiting': '{name}, waiting. Double-tap to board.',
  'manifest.rowA11y.onBoard': '{name}, on board since {time}.',
  'manifest.rowA11y.dropped': '{name}, dropped off at {time}.',
  'manifest.now': 'now',
  'manifest.earlier': 'earlier',
  'manifest.queuedBoardToast': 'Saved offline — boarding will sync when back online.',
  'manifest.queuedDropToast': 'Saved offline — drop-off will sync when back online.',
  'manifest.boardFailed': 'Could not board student',
  'manifest.dropFailed': 'Could not drop student',

  // ── SOS ────────────────────────────────────────────────────────────────
  'sos.holdLabel': 'HOLD to send SOS',
  'sos.holdingHint': 'Keep holding…',
  'sos.a11yLabel': 'Emergency SOS. Press and hold to alert the school.',
  'sos.holdA11yHint':
    'Press and hold for about a second until the fill completes — the alert then sends by itself.',
  'sos.sent': 'SOS sent ✅',
  'sos.queued': 'SOS queued ⏳ — will send when internet returns',
  'sos.queuedShort': 'Queued ⏳ will send when online',
  'sos.retrying': 'Sending…',
  'sos.activeAlert': 'Alert active — school has been notified',
  'sos.manageHint': 'Details & cancel are on the SOS tab.',
  'sos.sendFailed': 'SOS could not be sent',
  'sos.invalid': 'Invalid alert',
  'sos.roleTitle': '{role} emergency',
  'sos.attachTrip': "This alert will be attached to today's trip.",
  'sos.attachTripRoute': "This alert will be attached to today's trip · {route}.",
  'sos.empty.title': 'No trip today',
  'sos.empty.body': 'You can still raise an emergency — it will be recorded without a trip.',
  'sos.loading': 'Loading your trip…',
  'sos.activeTitle': 'Alert active',
  'sos.acknowledged': 'The school acknowledged this alert. Help is on the way.',
  'sos.notified': 'The school has been notified. Keep your phone with you.',
  'sos.cancelAlert': 'Cancel alert',
  'sos.cardTitle': 'Emergency SOS',
  'sos.cardBodyTrip':
    'Press and hold the red button — the school is alerted instantly and your current trip is attached.',
  'sos.cardBodyNoTrip': 'Press and hold the red button — the school is alerted instantly.',
  'sos.noReadingNeeded':
    'No reading needed: hold to send with your location. Time to add details? Use “Add details first” — the alert is recorded against your {role} account either way.',
  'sos.detailsButton': 'Add details first (type, message)…',
  'sos.recentTitle': 'Your recent alerts',
  'sos.sheetTitle': 'Report an emergency',
  'sos.typeLabel': 'What is happening?',
  'sos.messageLabel': 'Message',
  'sos.messagePlaceholder': 'e.g. Bus hit a divider, all students safe.',
  'sos.locationLabel': 'Attach my location',
  'sos.locationHint':
    'Used only if the device already has a GPS fix — a position is never invented.',
  'sos.back': 'Back',
  'sos.cancelTitle': 'Cancel this alert?',
  'sos.cancelMessage':
    'Only cancel if the alert was raised by mistake — the school still keeps the record in its history.',
  'sos.cancelConfirm': 'Cancel alert',
  'sos.cancelFailed': 'Could not cancel the alert',

  // ── GPS sharing ────────────────────────────────────────────────────────
  'gps.sharingOn': 'Sharing ✅',
  'gps.sharingOff': 'Sharing ❌',
  'gps.lastUpdate': 'Updated {time}',
  'gps.neverUpdated': 'No update yet',
  'gps.retry': 'Retry',
  'gps.stop': 'Stop',
  'gps.helpLink': 'GPS details & support',
  'gps.panelTitle': 'Live GPS sharing',
  'gps.badgeSharing': 'Sharing',
  'gps.badgeOff': 'Off',
  'gps.notReady':
    'GPS is accepted once the trip is boarding or in progress. Current status: {status}.',
  'gps.share': 'Share GPS',
  'gps.stopSharing': 'Stop sharing',
  'gps.backgroundTitle': 'Keep sharing in background',
  'gps.backgroundOn': 'Device location runs as a background task while the screen is off.',
  'gps.backgroundAllowed': 'Allowed — enable to keep sending fixes with the screen off.',
  'gps.backgroundNeeded': 'Requires “Allow all the time” location permission.',
  'gps.tierGood': 'GPS good',
  'gps.tierWeak': 'GPS weak',
  'gps.tierStale': 'GPS stale',
  'gps.network': 'Network {state}',
  'gps.location': 'Location {state}',
  'gps.lastFix': 'Last fix {time}',
  'gps.accuracy': '±{meters} m',
  'gps.noFix': 'No fix from this device yet.',
  'gps.serverReason': 'Server said: {reason}',
  /**
   * The four support counters ("Sent", "Rejected", "Dropped (offline)",
   * "Invalid fix") are deliberately **not** here: `help-routing.spec.ts` pins
   * them on the Help surface verbatim because they are read aloud to the
   * support engineer, who works in English. See `docs/mobile-ux.md` →
   * "Server-string boundary".
   */
  'gps.noTripBody': 'No trip today — the GPS counters appear here while a trip is running.',
  'gps.driverOnlyTitle': 'GPS sharing',
  'gps.driverOnlyBody':
    "GPS sharing is the driver's job on this run. If the school cannot see the bus, ask the driver to open this page and read out the numbers.",

  // ── Offline queue / sync banner ────────────────────────────────────────
  'offline.pending.one': 'Offline · 1 action saved on this phone',
  'offline.pending.other': 'Offline · {count} actions saved on this phone',
  'offline.idle': 'Offline · actions will be saved and synced later',
  'offline.syncing.one': 'Syncing 1 action…',
  'offline.syncing.other': 'Syncing {count} actions…',
  'offline.failed.one': '1 action could not be synced',
  'offline.failed.other': '{count} actions could not be synced',
  'offline.waiting.one': '1 action waiting to sync',
  'offline.waiting.other': '{count} actions waiting to sync',
  'offline.problem': 'Sync problem',
  'offline.detailOffline': 'They will be sent automatically when the connection returns.',
  'offline.willRetry': 'Will retry automatically. {error}',
  'offline.syncNow': 'Sync now',
  'offline.retry': 'Retry',
  'offline.dismiss': 'Dismiss',

  // ── Stops & ETA screen ─────────────────────────────────────────────────
  'stops.loading': 'Loading stops…',
  'stops.currentAndNext': 'Current & next stop',
  'stops.routeStops': 'Route stops',
  'stops.arrivals': 'Arrivals',
  'stops.noArrivals': 'No stop has been recorded yet for this trip.',
  'stops.arrivalMeta': '{time} · {distance} from stop',
  'stops.empty.title': 'No trip today',
  'stops.empty.body': 'Stops and ETAs appear once a trip is dispatched.',

  // ── Help & support screen ──────────────────────────────────────────────
  'help.loading': 'Loading help…',
  'help.title': 'Help & support',
  'help.intro':
    'If the school says the bus is not moving on their screen, show them this page. These numbers are for the support team — you never have to read them while driving.',
  'help.supportHeadline': 'For the support team',
  'help.supportAdvice':
    'Read out the four numbers below and the last-fix line. "Dropped (offline)" growing while you have internet usually means a weak signal area — support can check the same counters on the server.',
  'help.settingsTitle': 'App settings',
  'help.languageTitle': 'Language',
  'help.languageHint': 'The screen changes language as soon as you pick one.',
  'help.languageCurrent': 'Now showing',

  // ── Language switcher (self-designations are locale-invariant) ─────────
  'settings.language.nameEn': 'English',
  'settings.language.nameHi': 'हिन्दी',
  'settings.language.nameMr': 'मराठी',
  'settings.language.a11y': 'Change app language',
  'settings.language.a11yHint': 'Switches every screen between English, Hindi and Marathi.',

  // ── Sound & vibration settings (Phase 3b) ──────────────────────────────
  'settings.sound.title': 'Sound & vibration',
  'settings.sound.hint': 'The phone can confirm each action out loud, by buzz, or both.',
  'settings.sound.voiceLabel': 'Speak confirmations',
  'settings.sound.voiceHint': 'Says the first name and time after each boarding or drop.',
  'settings.sound.vibrationLabel': 'Vibrate on action',
  'settings.sound.vibrationHint': 'A short buzz when an action is recorded or refused.',
  'settings.sound.voiceA11y': 'Spoken confirmations',
  'settings.sound.vibrationA11y': 'Vibration feedback',
  'settings.sound.noEngineNote':
    'No sound? Your phone may have no speech engine installed — the app still records every action.',

  // ── Voice phrases (SPOKEN, never rendered — see `crew-voice.ts`) ───────
  //
  // A separate namespace from the screen copy on purpose: the Hindi values of
  // these keys are **Latin-script Hinglish**, not Devanagari, because a budget
  // Android device usually has no `hi-IN` voice installed and would garble
  // Devanagari through its default English voice. Written UI stays Devanagari;
  // these are the only strings that leave through the speaker.
  //
  // Budget: 6–9 words. A driver is listening while driving.
  'voice.board.done': '{name} has boarded, {time}',
  'voice.drop.done': '{name} has got off, {time}',
  'voice.board.summary': '{count} students boarded',
  'voice.drop.summary': '{count} students got off',
  'voice.trip.boarding': 'Boarding started',
  'voice.trip.inProgress': 'Trip started, drive safe',
  'voice.trip.completed': 'Trip complete, well done',
  'voice.sos.fired': 'Emergency alert sent to school',
  'voice.sos.queued': 'No network, emergency alert will retry',
  'voice.offline.synced': '{count} saved actions have been sent',
  'voice.gps.on': 'Location sharing on',
  'voice.gps.off': 'Location sharing off',
  'voice.time.now': 'just now',
  'voice.time.morning': 'in the morning',
  'voice.time.afternoon': 'in the afternoon',
  'voice.time.evening': 'in the evening',
  'voice.time.night': 'at night',

  // ── Login (crew path localises too; the flow/endpoint is unchanged) ────
  'login.brandMark': 'SBT',
  'login.brandName': 'School Bus Tracking',
  'login.subtitle': 'Sign in with your school account',
  'login.schoolLabel': 'School code',
  'login.schoolPlaceholder': 'e.g. lincoln-high',
  'login.schoolHint': "Your school's tenant code. Leave empty only for platform admins.",
  'login.email': 'Email',
  'login.emailPlaceholder': 'you@school.edu',
  'login.password': 'Password',
  'login.passwordPlaceholder': '••••••••',
  'login.emailTitle': 'Sign in with email',
  'login.submit': 'Sign in',
  'login.failed': 'Could not sign in',
  'login.footer':
    'Drivers, conductors, parents and school admins all sign in here — the app adapts to your role.',

  // ── Crew mobile-login (Phase 4b) — second path on the same login screen ─
  // The two paths share the brand, the "school code" field and the routing;
  // they differ in *what the crew member has in their hand* (a phone with a
  // paired device → 4-digit PIN; a fresh phone or a re-pair → QR scanned by
  // the school admin). Copy is intentionally short and step-numbered so a
  // driver who is standing in a depot can read it in one glance.
  'login.crewPath.cta': 'Sign in as driver / conductor',
  'login.crewPath.backToAdmin': 'Use email and password instead',
  'login.crewPath.pin.title': 'Enter your 4-digit PIN',
  'login.crewPath.pin.subtitle':
    'The school admin set this PIN on your account. It unlocks the phone you already paired.',
  'login.crewPath.pin.schoolRequired': 'Enter your school code',
  'login.crewPath.pin.padLabel': 'PIN',
  'login.crewPath.pin.submit': 'Unlock',
  'login.crewPath.pin.clearKey': 'Clear PIN',
  'login.crewPath.qr.title': 'Scan the pairing QR',
  'login.crewPath.qr.subtitle':
    'Ask your school admin to show the QR on their computer. Point your camera at it.',
  'login.crewPath.qr.openScanner': 'Open camera',
  'login.crewPath.qr.cancelScan': 'Cancel scanning',
  'login.crewPath.qr.permission.title': 'Camera access needed',
  'login.crewPath.qr.permission.body':
    'The camera only looks for the school pairing code. We do not record or upload anything else.',
  'login.crewPath.qr.permission.openSettings': 'Open settings',
  'login.crewPath.qr.useTypeInstead': 'Type the code instead',
  'login.crewPath.qr.pasteTitle': 'Or paste the pairing code',
  'login.crewPath.qr.pastePlaceholder': 'SBT-CREW-1:…',
  'login.crewPath.qr.pasteSubmit': 'Use this code',
  'login.crewPath.qr.scanned': 'Code scanned — signing you in…',
  'login.crewPath.usePin': 'Use PIN instead',
  'login.crewPath.useQr': 'Scan QR instead',
  'login.crewPath.lockout.wait':
    'Too many wrong PINs. Try again in {seconds}s — or ask the admin to reset it.',
  'login.crewPath.lockout.adminHint':
    'A school admin can also generate a fresh pairing QR — the QR login clears the lockout.',
  'login.crewPath.expired':
    'That pairing code has expired. Ask the admin to generate a new one.',

  // ── Shared status vocabulary (badges used by crew + admin) ─────────────
  'status.label.scheduled': 'Scheduled',
  'status.label.boarding': 'Boarding',
  'status.label.inProgress': 'In Progress',
  'status.label.completed': 'Completed',
  'status.label.cancelled': 'Cancelled',
  'attendance.label.pending': 'Waiting',
  'attendance.label.boarded': 'On board',
  'attendance.label.dropped': 'Dropped off',
  'boarding.label.boarded': 'Boarded',
  'boarding.label.dropped': 'Dropped',
  'boarding.label.notBoarded': 'Not boarded',

  // ── Live connection chip + ETA views ───────────────────────────────────
  'connection.live': '● Live',
  'connection.reconnecting': '● Reconnecting…',
  'connection.offline': '● Offline',
  'eta.unavailable': 'Unavailable',
  'eta.arrived': 'Arrived',
  'eta.waitingForGps': 'Waiting for GPS',

  // ── Shared chrome ──────────────────────────────────────────────────────
  'common.retry': 'Retry',
  'common.error': 'Something went wrong',
  'common.clearSearch': 'Clear search',
  'common.dismiss': 'Dismiss',
  /** Switch state, spelled out — colour is never the only cue. */
  'common.on': 'On',
  'common.off': 'Off',

  // ── Time ───────────────────────────────────────────────────────────────
  'time.minutes.one': '~{count} minute',
  'time.minutes.other': '~{count} minutes',

  // ── GPS permission recovery ────────────────────────────────────────────
  'gps.recovery.permissionDenied.title': 'GPS Permission Needed',
  'gps.recovery.permissionDenied.body':
    'This app needs location access to share the bus location with parents and the school. Your location is only shared during active trips.',
  'gps.recovery.blocked.title': 'GPS Permission Blocked',
  'gps.recovery.blocked.body':
    'Location permission was denied. Please open your device settings and enable location access for this app to share bus location during trips.',
  'gps.recovery.servicesOff.title': 'Location Services Off',
  'gps.recovery.servicesOff.body':
    'Location services are turned off on your device. Please enable them in your device settings to share bus location during trips.',
  'gps.recovery.background.title': 'Background GPS Needed',
  'gps.recovery.background.body':
    'Background location access is needed so the bus location continues to be shared when the app is in the background during trips. Please enable "Allow all the time" in settings.',
  'gps.recovery.issue.title': 'GPS Issue',
  'gps.recovery.issue.body': 'There is an issue with GPS permissions.',
  'gps.recovery.grant': 'Grant permission',
  'gps.recovery.openSettings': 'Open settings',
  'gps.recovery.recheck': 'Recheck',
  'gps.recovery.continue': 'Continue without GPS',
  'gps.recovery.lastUpdate': 'Last GPS update: {time}',

  // ── Driver navigation hand-off ─────────────────────────────────────────
  'navigate.card.title': 'Navigate',
  'navigate.card.description': "Opens the next stop in your phone's map app.",
  'navigate.card.button': 'Navigate to stop',
  'navigate.card.meta.one': 'Trip {id} · 1 stop on this route.',
  'navigate.card.meta.other': 'Trip {id} · {stops} stops on this route.',
  'navigate.card.noStops': 'No stops on this route yet.',
  'navigate.card.noGeofence':
    'This route has no geofenced stops yet — ask the school to add coordinates.',

  // ── Relative time ──────────────────────────────────────────────────────
  'time.justNow': 'just now',
  'time.minutesAgo': '{count}m ago',
  'time.hoursAgo': '{count}h ago',
  'time.daysAgo': '{count}d ago',

  // ── Known server error codes (see `localizeErrorCode`) ─────────────────
  'error.HTTP_400': 'The request was not accepted. Try again.',
  'error.HTTP_401': 'Your session has expired. Please sign in again.',
  'error.HTTP_403': 'You do not have permission to do that.',
  'error.HTTP_404': 'The requested resource was not found.',
  'error.HTTP_409': 'That was already done — the app now shows the latest state.',
  'error.HTTP_422': 'Some details are missing or not valid. Check and try again.',
  'error.HTTP_429': 'Too many requests. Please wait a moment and try again.',
  'error.HTTP_500':
    'The server could not complete the request (HTTP 500). Please try again in a moment.',
  'error.HTTP_503':
    'The server could not complete the request (HTTP 503). Please try again in a moment.',
  'error.INTERNAL_SERVER_ERROR':
    'The server could not complete the request. Please try again in a moment.',
  'error.RATE_LIMIT_EXCEEDED': 'Too many requests. Please wait a moment and try again.',
  'error.SERVICE_NOT_READY': 'The server is still starting up. Please try again in a moment.',
  'error.networkOffline': 'No internet. Your action is saved on this phone and will sync later.',
  /** Prefix for an unknown code, so the raw code is visible, never hidden. */
  'error.unknownCodePrefix': 'Server code',
  /**
   * Crew mobile-login (Phase 4b). The three codes map one-to-one onto the
   * server's constants in `web/src/server/modules/auth/auth.constants.ts`.
   *
   * - `CREW_PIN_LOCKED` carries a structured `{retry_after_seconds}` and is
   *   rendered by the login screen with a live countdown — see
   *   `localizeCrewLoginError` in `i18n.ts`.
   * - `CREW_PIN_INVALID` is the generic "wrong PIN / wrong user / no PIN set"
   *   rejection, deliberately identical to the server's
   *   `INVALID_CREW_CREDENTIALS_MESSAGE` to avoid enumeration.
   * - `CREW_PAIRING_INVALID` is the generic "QR malformed / unknown / expired
   *   / already redeemed" rejection — same one-message rule, no enumeration.
   */
  'error.CREW_PIN_LOCKED': 'Too many wrong PINs. Try again later.',
  'error.CREW_PIN_INVALID': 'That PIN did not work. Please try again.',
  'error.CREW_PIN_AMBIGUOUS':
    'More than one crew member has this PIN. Ask your school admin to change it.',
  'error.CREW_PAIRING_INVALID':
    'That pairing code could not be used. Ask the admin for a fresh QR.',
} as const satisfies Record<string, string>;

/**
 * The literal-valued shape. Used *only* to infer each key's placeholder names
 * (`ParamsFor` in `i18n.ts`), which is what makes `t()`'s params type-safe.
 */
export type EnglishDictionary = typeof en;

/**
 * The shape every other locale must match: **exactly these keys**, values
 * widened to `string`. Key-exactness is what makes a missing or extra Hindi
 * entry a compile error; widening the values is what lets them be Hindi.
 */
export type Dictionary = { readonly [K in keyof EnglishDictionary]: string };
