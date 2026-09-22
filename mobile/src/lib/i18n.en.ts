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
  // Strip repair taps (`gps-strip-action.ts`): the tap fixes the named
  // problem — only Settings can fix a switch-off / permanent denial, and the
  // OS will still answer an in-app request it can ask again.
  'gps.openSettings': 'Open location settings',
  'gps.requestPermission': 'Request location permission',
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
  // The diagnostics card's background-permission line, when the runtime
  // itself cannot run the task (the fixable case: a development build).
  'gps.backgroundNeedsDevBuild': 'Background needs a development build',
  'gps.tierGood': 'GPS good',
  'gps.tierWeak': 'GPS weak',
  'gps.tierStale': 'GPS stale',
  'gps.network': 'Network {state}',
  'gps.location': 'Location {state}',
  'gps.lastFix': 'Last fix {time}',
  'gps.accuracy': '±{meters} m',
  'gps.noFix': 'No fix from this device yet.',
  'gps.serverReason': 'Server said: {reason}',
  // ── GPS delivery status (mobile-reliability patch) ─────────────────────
  // Derived from the SERVER acknowledgement, never from a local fix: `live`
  // means the school can see the bus, `localOnly` means the phone has GPS but
  // nothing was delivered yet.
  'gps.status.live': 'School sees the bus · {time}',
  'gps.status.localOnly': 'GPS fix not delivered yet · {time}',
  'gps.status.connecting': 'Connecting to the school…',
  'gps.status.reconnecting': 'Reconnecting to the school…',
  'gps.status.stale': 'Last delivered {time}',
  'gps.status.waitingForFix': 'Waiting for the first GPS fix…',
  'gps.status.permissionBlocked': 'Location permission needed',
  'gps.status.servicesOff': 'Location services are off',
  'gps.status.revoked': 'Access revoked — tracking stopped',
  'gps.status.stopped': 'Not sharing',
  // Lifecycle-context lines (`crewTrackingStatusLine`): `{status}` and
  // `{host}` are data (the server's trip status, the server's host — never a
  // URL with a query string).
  'gps.status.tripNotEligible': 'This trip no longer accepts GPS sharing (server status: {status})',
  'gps.status.cannotReachServer': 'Cannot reach the school server ({host})',
  'gps.deliveryBadge': 'Delivery',
  'gps.accuracyReduced': 'Approx. GPS',
  'gps.servicesOff': 'Location off',
  'gps.recoveryAttempts': 'Retry {count}',
  'gps.serverAck': 'Server accepted {time}',
  'gps.serverNoAck': 'Server has not accepted a fix yet',
  // Action messages set by the shared tracking lifecycle.
  'gps.message.servicesOff': 'Turn on location services to share the bus position.',
  'gps.message.permissionRequired': 'Location permission is required to share GPS with the school.',
  'gps.message.startFailed': 'Could not start GPS sharing.',
  'gps.message.backgroundDenied':
    'Allow “Always” location access to keep sharing with the screen off.',
  'gps.message.backgroundUnavailable': 'Background location is not available on this device.',
  'gps.message.backgroundNeedsDevBuild':
    'Background sharing needs a development build — Expo Go cannot run the background GPS task.',
  'gps.message.backgroundNeedsTrip': 'Background sharing needs an active trip.',
  'gps.message.backgroundFailed': 'Could not enable background sharing.',
  'gps.message.revoked': 'Access to live tracking was revoked — sharing has stopped.',
  // Android foreground-service notification. Honest wording: the service shares
  // this device's GPS while the trip is active; it cannot promise delivery.
  'gps.service.title': 'School Bus GPS sharing',
  'gps.service.body': 'Sharing this phone’s GPS with the school while the trip is active.',
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

  // ── Diagnostics readout (for the support engineer) ──────────────────────
  // Labels are localised; the values are data (server strings stay verbatim —
  // the server-string boundary) or localised value words below. The delivery
  // counter WORDS are locale-invariant: they are read aloud to a support
  // engineer who works in English, like the four support counters.
  'help.diagnostics.title': 'Diagnostics (for support)',
  'help.diagnostics.hint':
    'If sharing is not working, read these lines to the support engineer. They show what this phone knows about its runtime, the school server and GPS — nothing here starts or stops sharing.',
  'help.diagnostics.runtime': 'App runtime',
  'help.diagnostics.apiHost': 'Server address (API host)',
  'help.diagnostics.socket': 'Live tracking socket',
  'help.diagnostics.connection': 'Connection',
  'help.diagnostics.locationServices': 'Location services',
  'help.diagnostics.foregroundPermission': 'Location permission (foreground)',
  'help.diagnostics.backgroundPermission': 'Location permission (background)',
  'help.diagnostics.sharing': 'Sharing running',
  'help.diagnostics.lastStop': 'Last stopped (server reason)',
  'help.diagnostics.recovery': 'Recovery attempts (last reason)',
  'help.diagnostics.lastError': 'Last error',
  'help.diagnostics.delivery': 'Delivery counters',
  'help.diagnostics.valueExpoGo': 'Expo Go',
  'help.diagnostics.valueDevBuild': 'Development build',
  'help.diagnostics.valueUnknown': 'Unknown',
  'help.diagnostics.valueNotSet': 'Not set',
  'help.diagnostics.valueExhausted': 'budget exhausted',
  'help.diagnostics.valueForeground': 'foreground',
  'help.diagnostics.valueBackground': 'background',
  // Invariant in hi/mr (declared in LOCALE_INVARIANT_KEYS).
  'help.diagnostics.sent': 'Sent',
  'help.diagnostics.accepted': 'Accepted',
  'help.diagnostics.rejected': 'Rejected',
  'help.diagnostics.pending': 'Pending (offline)',
  'help.diagnostics.invalid': 'Invalid fix',
  'help.diagnostics.retried': 'Retried',

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
  'login.offline': 'No internet connection. Please check your data/Wi-Fi and try again.',
  'login.footer':
    'Drivers, conductors, parents and school admins all sign in here — the app adapts to your role.',

  // ── Crew mobile-login (Phase 4b) — second path on the same login screen ─
  // Mobile crew login uses a school code and PIN only.
  'login.crewPath.cta': 'Sign in as driver / conductor',
  'login.crewPath.backToAdmin': 'Use email and password instead',
  'login.crewPath.pin.title': 'Enter your 4-digit PIN',
  'login.crewPath.pin.subtitle': 'Enter your school code and the PIN set by your school admin.',
  'login.crewPath.pin.schoolRequired': 'Enter your school code',
  'login.crewPath.pin.padLabel': 'PIN',
  'login.crewPath.pin.submit': 'Unlock',
  'login.crewPath.pin.clearKey': 'Clear PIN',
  'login.crewPath.pin.show': 'Show PIN',
  'login.crewPath.pin.hide': 'Hide PIN',
  'login.crewPath.lockout.wait':
    'Too many wrong PINs. Try again in {seconds}s — or ask the admin to reset it.',
  'login.crewPath.lockout.adminHint':
    'Ask your school admin to reset your PIN to clear the lockout.',

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

  // ── Live tracking map (parent + admin) ─────────────────────────────────
  /**
   * Map chrome for the shared tracking map (`src/features/map/BusMap.tsx`).
   *
   * The status words are deliberately *not* the socket chip's words:
   * `connection.*` describes the socket, these describe the GPS. A connected
   * socket with a four-minute-old fix reads "Live" on the connection chip and
   * "Last known" here, which is the honest pair.
   */
  'map.followBus': 'Follow bus',
  'map.followingA11y': 'Following the bus',
  'map.exploringA11y': 'Map exploration — follow paused',
  'map.status.live': 'Live position',
  'map.status.lastKnown': 'Last known',
  'map.status.noLocation': 'No position',
  'map.status.approximate': 'Approximate',
  'map.updatedAt': 'Updated {time}',
  'map.staleNote': 'No new position since {time}.',
  'map.offlineNote': 'Offline — showing the last known position.',
  /**
   * The stop connectors are straight lines between stop coordinates. They are
   * not a road-calculated route and not the path the bus actually drove, and
   * the map says so rather than letting the eye assume a routing engine.
   */
  'map.routeNotice': 'Straight lines between stops — not the driven route.',
  'map.noCoordinates': 'This route has no mapped stops yet.',
  // The map provider is missing from this runtime itself (Expo Go on Android
  // since Expo SDK 53) — a labelled panel says so instead of a blank box.
  'map.needsDevBuildTitle': 'Map preview needs a development build',
  'map.needsDevBuildBody':
    'Expo Go cannot load the map engine, so the map cannot be shown in this build. The trip, stops and GPS sharing keep working — use a development build to see the map.',
  'map.busA11y': 'School bus',
  'map.stopA11y': 'Stop {number}',

  /**
   * Driver Trip map (Session 2) — see `src/features/crew/crew-map-presentation.ts`.
   *
   * The source line is always on screen: the marker is this device's own GPS,
   * and saying so is what stops "so the school can see me?" being answered by a
   * map by implication. The two notes that follow are the only places this
   * screen may talk about delivery, and they only ever appear when it has *not*
   * happened. Nothing here may be reworded into "the school sees you" — that
   * sentence belongs to `gps.status.live`, which is derived from a server
   * acknowledgement and nothing else.
   */
  'driverMap.source': 'Your device',
  'driverMap.note.schoolStale': 'The school has an older position than this.',
  'driverMap.note.notDelivered': 'Not delivered to the school yet.',
  'driverMap.note.offline': 'Offline — the school cannot see this position yet.',
  'driverMap.note.notSharing': 'Sharing is off — this position is not being sent.',

  // ── Shared chrome ──────────────────────────────────────────────────────
  'common.retry': 'Retry',
  'common.error': 'Something went wrong',
  'common.clearSearch': 'Clear search',
  'common.dismiss': 'Dismiss',
  /** Switch state, spelled out — colour is never the only cue. */
  'common.on': 'On',
  'common.off': 'Off',
  /** Show/hide eye on a password field — the icon state matches visibility. */
  'common.showPassword': 'Show password',
  'common.hidePassword': 'Hide password',

  // ── Calendar date picker (no manual date typing anywhere) ─────────────
  'datePicker.title': 'Pick a date',
  'datePicker.today': 'Today',
  'datePicker.clear': 'Clear',
  'datePicker.placeholder': 'Select a date',
  'date.month.1': 'January',
  'date.month.2': 'February',
  'date.month.3': 'March',
  'date.month.4': 'April',
  'date.month.5': 'May',
  'date.month.6': 'June',
  'date.month.7': 'July',
  'date.month.8': 'August',
  'date.month.9': 'September',
  'date.month.10': 'October',
  'date.month.11': 'November',
  'date.month.12': 'December',
  'date.weekday.0': 'Su',
  'date.weekday.1': 'Mo',
  'date.weekday.2': 'Tu',
  'date.weekday.3': 'We',
  'date.weekday.4': 'Th',
  'date.weekday.5': 'Fr',
  'date.weekday.6': 'Sa',

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

  'gps.recovery.noServerUpdate': 'The server has not accepted a location yet.',
  'gps.recovery.accuracy.title': 'Precise Location Needed',
  'gps.recovery.accuracy.body':
    'This app only has approximate location. Turn on “Precise location” in settings so a bus stop can be confirmed correctly.',
  'gps.recovery.backgroundUnavailable.title': 'Background GPS Unavailable',
  'gps.recovery.backgroundUnavailable.body':
    'This device does not offer background location access. Sharing continues while the app is open on screen.',
  // ── Battery / background restrictions (guidance, never a detected state) ──
  'gps.battery.android.title': 'Battery restrictions can stop GPS',
  'gps.battery.android.body':
    'Android may stop location sharing to save battery. Open Battery settings and set this app to “Unrestricted”, and turn off Battery saver while driving.',
  'gps.battery.ios.title': 'Battery restrictions can stop GPS',
  'gps.battery.ios.body':
    'Low Power Mode and Background App Refresh can delay location updates. Check Settings → Battery and Settings → General → Background App Refresh for this app.',
  'gps.battery.other.title': 'Battery restrictions can stop GPS',
  'gps.battery.other.body':
    'Power-saving modes on this device may delay or stop location sharing while the screen is off.',
  'gps.battery.openBatterySettings': 'Open battery settings',
  'gps.battery.openAppSettings': 'Open app settings',
  'gps.battery.honesty':
    'This app cannot read your battery settings and will not override them. If the phone stops the app, sharing stops until it is opened again.',
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
  'error.HTTP_500': 'The server could not complete the request. Please try again in a moment.',
  'error.HTTP_503': 'The server could not complete the request. Please try again in a moment.',
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
   */
  'error.CREW_PIN_LOCKED': 'Too many wrong PINs. Try again later.',
  'error.CREW_PIN_INVALID': 'That PIN did not work. Please try again.',
  'error.CREW_PIN_AMBIGUOUS':
    'More than one crew member has this PIN. Ask your school admin to change it.',
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
