import type { Dictionary } from './i18n.en.ts';

/**
 * Hindi (Devanagari) dictionary.
 *
 * Typed as `Dictionary` (= `typeof en`), so a missing key is a compile error
 * and an extra key is a compile error — `i18n-parity.spec.ts` re-asserts both
 * at runtime so a `as never` cast cannot sneak past the compiler.
 *
 * Translation rules used here (they are the acceptance criteria, not style):
 *
 * - **Data is never translated.** `{name}`, `{route}`, `{status}`, `{time}`
 *   placeholders carry server data and stay as the server sent them.
 * - **Crew vocabulary is short and spoken.** The audience reads at arm's
 *   length in daylight: चढ़ा / उतारा / बाकी instead of formal synonyms.
 * - **Length budget.** Hindi runs 20–30% longer than English, so every value
 *   here has to fit the container its key renders in. `i18n-clipping.spec.ts`
 *   enforces a per-key character budget; nothing below was allowed to exceed
 *   it, and no fixed-width container was widened to make room.
 * - **Symbols travel with the string** (✓ ✕ ⏳ ✅ ❌) — they are the colour-
 *   independent cue Phase 1/2 pinned, so they must not be dropped.
 */
export const hi: Dictionary = {
  // ── Crew navigation ────────────────────────────────────────────────────
  'nav.tab.drive': 'ड्राइव',
  'nav.tab.trip': 'ट्रिप',
  'nav.tab.manifest': 'सूची',
  'nav.tab.students': 'बच्चे',
  'nav.tab.stops': 'स्टॉप',
  'nav.tab.sos': 'SOS',
  'nav.trip.title': '{role} · आज',
  'nav.trip.titleFallback': 'आज की ट्रिप',
  'nav.manifest.titleDriver': 'सवार बच्चे',
  'nav.manifest.titleConductor': 'चढ़ना-उतरना',
  'nav.stops.title': 'स्टॉप और ETA',
  'nav.sos.title': 'आपातकाल',
  'nav.help.title': 'मदद और सहायता',
  'nav.platform.title': 'प्लेटफ़ॉर्म एडमिन',

  // ── Roles ──────────────────────────────────────────────────────────────
  'role.driver': 'ड्राइवर',
  'role.conductor': 'कंडक्टर',
  'role.crew': 'क्रू',
  'role.parent': 'अभिभावक',
  'role.schoolAdmin': 'स्कूल एडमिन',
  'role.superAdmin': 'प्लेटफ़ॉर्म एडमिन',

  // ── Trip state words ───────────────────────────────────────────────────
  'status.scheduled': 'निर्धारित',
  'status.boarding': 'बोर्डिंग',
  'status.inProgress': 'रास्ते में',
  'status.completed': 'पूरी हुई',
  'status.cancelled': 'रद्द',

  // ── Trip screen ────────────────────────────────────────────────────────
  'trip.loading': 'आज की ट्रिप खुल रही है…',
  'trip.loadError': 'आपकी ट्रिप नहीं खुल सकी',
  'trip.empty.title': 'आज कोई ट्रिप नहीं है',
  'trip.empty.body': 'आज आपको कोई रन नहीं दी गई है। स्कूल ट्रिप भेजते ही वह यहाँ दिख जाएगी।',
  'trip.detailsToggle': 'और जानकारी',
  'trip.detailsToggleHide': 'जानकारी छिपाएँ',
  'trip.nextStopFallback': 'GPS शुरू होने पर अगला स्टॉप दिखेगा',
  'trip.allStopsDone': 'सब स्टॉप पूरे',
  'trip.nextStop': 'अगला: {name}',
  'trip.eta': 'पहुँचने में {minutes}',
  'trip.etaUnavailable': 'समय जल्द दिखेगा',
  'trip.tripCountNote': 'आज {count} ट्रिप · सक्रिय वाली दिखाई जा रही है',
  'trip.departedAt': '{time} पर रवाना हुई',
  'trip.arrivedAt': '{time} पर पहुँची',
  'trip.detail.route': 'रूट',
  'trip.detail.scheduled': 'निर्धारित समय',
  'trip.detail.date': 'तारीख़',
  'trip.detail.bus': 'बस',
  'trip.detail.role': 'भूमिका',
  'trip.detail.connection': 'कनेक्शन',
  'trip.emptyValue': '—',
  'trip.link.manifestDriver': 'सूची',
  'trip.link.manifestConductor': 'चढ़ना-उतरना',
  'trip.link.stops': 'स्टॉप और ETA',

  // ── Trip lifecycle actions ─────────────────────────────────────────────
  'trip.action.boarding': 'बोर्डिंग शुरू करें',
  'trip.action.inProgress': 'रवाना हों',
  'trip.action.completed': 'ट्रिप पूरी करें',
  'trip.completedNote': 'यह ट्रिप पूरी हो चुकी है।',
  'trip.cancelledNote': 'यह ट्रिप रद्द कर दी गई।',
  'trip.cancelledReason': 'यह ट्रिप रद्द कर दी गई: {reason}',
  'trip.queuedNote': '{action} इस फ़ोन में सहेजा गया — इंटरनेट आते ही भेज दिया जाएगा।',
  'trip.updateError': 'ट्रिप बदली नहीं जा सकी।',
  'trip.cancel.button': 'ट्रिप रद्द करें…',
  'trip.cancel.reasonLabel': 'रद्द करने की वजह',
  'trip.cancel.reasonPlaceholder': 'जैसे: बस खराब हो गई',
  'trip.cancel.confirm': 'रद्द करना पक्का करें',
  'trip.cancel.keep': 'ट्रिप रहने दें',
  'trip.cancel.reasonRequired': 'रद्द करने की वजह लिखना ज़रूरी है।',
  'trip.cancel.failed': 'ट्रिप रद्द नहीं हो सकी।',

  // ── Manifest (board / drop) ────────────────────────────────────────────
  'manifest.loading': 'सूची खुल रही है…',
  'manifest.loadError': 'आपकी ट्रिप नहीं खुल सकी',
  'manifest.empty.tripTitle': 'आज कोई ट्रिप नहीं है',
  'manifest.empty.tripBody': 'ट्रिप के बिना सूची नहीं होती।',
  'manifest.empty.studentsTitle': 'इस रूट पर कोई बच्चा नहीं है',
  'manifest.empty.studentsBody': 'सूची में वही सक्रिय बच्चे आते हैं जिनका स्टॉप इसी रूट पर है।',
  'manifest.unavailable': 'सूची उपलब्ध नहीं है',
  'manifest.hint.driver': 'आप कितने बच्चों को ले जा रहे हैं। चलने से पहले कंडक्टर से पूछ लें।',
  'manifest.hint.conductor':
    'बच्चा चढ़े तो चढ़ा दबाएँ, उतरे तो उतारा — समय अपने आप दर्ज हो जाता है।',
  'manifest.counts': '{boarded} सवार · {pending} बाकी · {dropped} उतरे',
  'manifest.summary.total': '{count} बच्चे',
  'manifest.summary.pending': '{count} बाकी',
  'manifest.summary.boarded': '{count} सवार',
  'manifest.summary.dropped': '{count} उतरे',
  'manifest.search.placeholder': 'बच्चा, एडमिशन नंबर या स्टॉप खोजें…',
  'manifest.filter.all': 'सब',
  'manifest.filter.waiting': 'बाकी',
  'manifest.filter.boarded': 'सवार',
  'manifest.filter.dropped': 'उतरे',
  'manifest.empty.searchTitle': 'कोई बच्चा नहीं मिला',
  'manifest.empty.searchBody': 'इस खोज या फ़िल्टर से कोई बच्चा नहीं मिलता।',
  'manifest.clearFilters': 'फ़िल्टर हटाएँ',
  'manifest.board': 'चढ़ा',
  'manifest.drop': 'उतारा',
  'manifest.waitingLabel': 'बाकी',
  'manifest.boardHint': 'बच्चा बस में चढ़े तो इस पंक्ति को दबाएँ।',
  'manifest.dropHint': 'बच्चा बस से उतरे तो इस पंक्ति को दबाएँ।',
  'manifest.confirmBoard': '{name} ✓ {time}',
  'manifest.confirmDrop': '{name} ✕ {time}',
  'manifest.queuedBoard': '{name} ⏳ ऑफ़लाइन सहेजा',
  'manifest.queuedDrop': '{name} ⏳ ऑफ़लाइन सहेजा',
  'manifest.announceBoard': '{name} चढ़ गया',
  'manifest.announceDrop': '{name} उतर गया',
  'manifest.rowA11y.waiting': '{name}, बाकी है। चढ़ाने के लिए दो बार दबाएँ।',
  'manifest.rowA11y.onBoard': '{name}, {time} से सवार है।',
  'manifest.rowA11y.dropped': '{name}, {time} पर उतर गया।',
  'manifest.now': 'अभी',
  'manifest.earlier': 'पहले',
  'manifest.queuedBoardToast': 'ऑफ़लाइन सहेजा — चढ़ाई इंटरनेट आते ही sync हो जाएगी।',
  'manifest.queuedDropToast': 'ऑफ़लाइन सहेजा — उतरना इंटरनेट आते ही sync हो जाएगा।',
  'manifest.boardFailed': 'बच्चा चढ़ाया नहीं जा सका',
  'manifest.dropFailed': 'बच्चा उतारा नहीं जा सका',

  // ── SOS ────────────────────────────────────────────────────────────────
  // 22 chars — the buttonFull budget. A longer wording wrapped to two lines on
  // the 64px field button; the full sentence lives in `sos.a11yLabel`.
  'sos.holdLabel': 'दबाकर रखें — SOS भेजें',
  'sos.holdingHint': 'दबाए रखें…',
  'sos.a11yLabel': 'आपातकालीन SOS। स्कूल को बताने के लिए दबाकर रखें।',
  'sos.holdA11yHint': 'लगभग एक सेकंड दबाकर रखें; भर जाने पर अलर्ट अपने आप चला जाएगा।',
  'sos.sent': 'SOS भेज दिया ✅',
  'sos.queued': 'SOS कतार में ⏳ — इंटरनेट आते ही चला जाएगा',
  'sos.queuedShort': 'कतार में ⏳ ऑनलाइन होते ही जाएगा',
  'sos.retrying': 'भेजा जा रहा है…',
  'sos.activeAlert': 'अलर्ट चालू है — स्कूल को बता दिया गया है',
  'sos.manageHint': 'विवरण और रद्द करना SOS टैब पर है।',
  'sos.sendFailed': 'SOS नहीं भेजा जा सका',
  'sos.invalid': 'अलर्ट सही नहीं है',
  'sos.roleTitle': '{role} आपातकाल',
  'sos.attachTrip': 'यह अलर्ट आज की ट्रिप से जुड़ेगा।',
  'sos.attachTripRoute': 'यह अलर्ट आज की ट्रिप से जुड़ेगा · {route}।',
  'sos.empty.title': 'आज कोई ट्रिप नहीं है',
  'sos.empty.body': 'फिर भी आप आपातकाल बता सकते हैं — वह बिना ट्रिप के दर्ज हो जाएगा।',
  'sos.loading': 'आपकी ट्रिप खुल रही है…',
  'sos.activeTitle': 'अलर्ट चालू है',
  'sos.acknowledged': 'स्कूल ने अलर्ट देख लिया है। मदद रास्ते में है।',
  'sos.notified': 'स्कूल को बता दिया गया है। अपना फ़ोन साथ रखें।',
  'sos.cancelAlert': 'अलर्ट रद्द करें',
  'sos.cardTitle': 'आपातकालीन SOS',
  'sos.cardBodyTrip':
    'लाल बटन दबाकर रखें — स्कूल को तुरंत पता चल जाएगा और आपकी मौजूदा ट्रिप जुड़ जाएगी।',
  'sos.cardBodyNoTrip': 'लाल बटन दबाकर रखें — स्कूल को तुरंत पता चल जाएगा।',
  'sos.noReadingNeeded':
    'पढ़ना ज़रूरी नहीं: दबाकर रखें, लोकेशन के साथ चला जाएगा। समय हो तो “पहले विवरण दें” चुनें — अलर्ट आपकी {role} आईडी से ही दर्ज होगा।',
  'sos.detailsButton': 'पहले विवरण दें (क्या हुआ, संदेश)…',
  'sos.recentTitle': 'आपके हाल के अलर्ट',
  'sos.sheetTitle': 'आपातकाल दर्ज करें',
  'sos.typeLabel': 'क्या हुआ है?',
  'sos.messageLabel': 'संदेश',
  'sos.messagePlaceholder': 'जैसे: बस डिवाइडर से टकराई, सब बच्चे सुरक्षित हैं।',
  'sos.locationLabel': 'मेरी लोकेशन जोड़ें',
  'sos.locationHint': 'सिर्फ़ तभी जब डिवाइस में पहले से GPS फ़िक्स हो — लोकेशन कभी बनाई नहीं जाती।',
  'sos.back': 'वापस',
  'sos.cancelTitle': 'यह अलर्ट रद्द करें?',
  'sos.cancelMessage':
    'सिर्फ़ तभी रद्द करें जब अलर्ट गलती से गया हो — रिकॉर्ड स्कूल के इतिहास में बना रहता है।',
  'sos.cancelConfirm': 'अलर्ट रद्द करें',
  'sos.cancelFailed': 'अलर्ट रद्द नहीं किया जा सका',

  // ── GPS sharing ────────────────────────────────────────────────────────
  'gps.sharingOn': 'शेयर हो रहा है ✅',
  'gps.sharingOff': 'शेयर नहीं हो रहा ❌',
  'gps.lastUpdate': '{time} पर अपडेट',
  'gps.neverUpdated': 'अभी कोई अपडेट नहीं',
  'gps.retry': 'फिर कोशिश करें',
  'gps.stop': 'रोकें',
  'gps.helpLink': 'GPS विवरण और सहायता',
  'gps.panelTitle': 'लाइव GPS शेयरिंग',
  'gps.badgeSharing': 'शेयर हो रहा है',
  'gps.badgeOff': 'बंद',
  'gps.notReady': 'ट्रिप बोर्डिंग या चालू होने पर ही GPS लिया जाता है। मौजूदा स्थिति: {status}।',
  'gps.share': 'GPS शेयर करें',
  'gps.stopSharing': 'शेयरिंग रोकें',
  'gps.backgroundTitle': 'बैकग्राउंड में शेयर करते रहें',
  'gps.backgroundOn': 'स्क्रीन बंद होने पर भी लोकेशन बैकग्राउंड टास्क से चलती रहती है।',
  'gps.backgroundAllowed': 'अनुमति है — स्क्रीन बंद रहते भी भेजने के लिए चालू करें।',
  'gps.backgroundNeeded': '“Allow all the time” लोकेशन अनुमति चाहिए।',
  'gps.tierGood': 'GPS ठीक',
  'gps.tierWeak': 'GPS कमज़ोर',
  'gps.tierStale': 'GPS पुराना',
  'gps.network': 'नेटवर्क {state}',
  'gps.location': 'लोकेशन {state}',
  'gps.lastFix': 'आख़िरी फ़िक्स {time}',
  'gps.accuracy': '±{meters} मीटर',
  'gps.noFix': 'इस डिवाइस से अभी कोई फ़िक्स नहीं आया।',
  'gps.serverReason': 'सर्वर ने कहा: {reason}',
  'gps.status.live': 'स्कूल बस देख सकता है · {time}',
  'gps.status.localOnly': 'GPS मिला, अभी नहीं भेजा गया · {time}',
  'gps.status.connecting': 'स्कूल से जुड़ रहा है…',
  'gps.status.reconnecting': 'फिर जुड़ रहा है…',
  'gps.status.stale': 'आख़िरी बार {time} भेजा गया',
  'gps.status.waitingForFix': 'पहले GPS का इंतज़ार…',
  'gps.status.permissionBlocked': 'लोकेशन अनुमति चाहिए',
  'gps.status.servicesOff': 'लोकेशन सेवा बंद है',
  'gps.status.revoked': 'पहुंच रद्द — ट्रैकिंग बंद',
  'gps.status.stopped': 'शेयर नहीं हो रहा',
  'gps.deliveryBadge': 'डिलीवरी',
  'gps.accuracyReduced': 'लगभग GPS',
  'gps.servicesOff': 'लोकेशन बंद',
  'gps.recoveryAttempts': 'पुनः {count}',
  'gps.serverAck': 'सर्वर ने {time} स्वीकारा',
  'gps.serverNoAck': 'सर्वर ने अभी कोई लोकेशन स्वीकार नहीं की',
  'gps.message.servicesOff': 'बस की स्थिति भेजने के लिए लोकेशन सेवा चालू करें।',
  'gps.message.permissionRequired': 'स्कूल के साथ GPS साझा करने के लिए लोकेशन अनुमति ज़रूरी है।',
  'gps.message.startFailed': 'GPS शेयरिंग शुरू नहीं हो सकी।',
  'gps.message.backgroundDenied':
    'स्क्रीन बंद रहते भी भेजने के लिए “Always” लोकेशन अनुमति दें।',
  'gps.message.backgroundUnavailable': 'इस डिवाइस पर बैकग्राउंड लोकेशन उपलब्ध नहीं है।',
  'gps.message.backgroundNeedsTrip': 'बैकग्राउंड शेयरिंग के लिए चल रही ट्रिप चाहिए।',
  'gps.message.backgroundFailed': 'बैकग्राउंड शेयरिंग चालू नहीं हो सकी।',
  'gps.message.revoked': 'लाइव ट्रैकिंग की पहुंच रद्द हो गई — शेयरिंग बंद कर दी गई है।',
  'gps.service.title': 'स्कूल बस GPS शेयरिंग',
  'gps.service.body': 'ट्रिप चलते हुए यह फ़ोन अपनी GPS स्कूल को भेज रहा है।',
  'gps.noTripBody': 'आज कोई ट्रिप नहीं — ट्रिप चलने पर GPS काउंटर यहाँ दिखेंगे।',
  'gps.driverOnlyTitle': 'GPS शेयरिंग',
  'gps.driverOnlyBody':
    'इस रन में GPS शेयर करना ड्राइवर का काम है। स्कूल को बस नहीं दिख रही तो ड्राइवर से इस पेज पर आकर आँकड़े पढ़ने को कहें।',

  // ── Offline queue / sync banner ────────────────────────────────────────
  'offline.pending.one': 'ऑफ़लाइन · 1 काम इस फ़ोन में सहेजा गया',
  'offline.pending.other': 'ऑफ़लाइन · {count} काम इस फ़ोन में सहेजे गए',
  'offline.idle': 'ऑफ़लाइन · काम सहेज लिए जाएँगे और बाद में भेज दिए जाएँगे',
  'offline.syncing.one': '1 काम sync हो रहा है…',
  'offline.syncing.other': '{count} काम sync हो रहे हैं…',
  'offline.failed.one': '1 काम sync नहीं हो सका',
  'offline.failed.other': '{count} काम sync नहीं हो सके',
  'offline.waiting.one': '1 काम sync होने के लिए बाकी',
  'offline.waiting.other': '{count} काम sync होने के लिए बाकी',
  'offline.problem': 'sync में समस्या',
  'offline.detailOffline': 'कनेक्शन आते ही ये अपने आप भेज दिए जाएँगे।',
  'offline.willRetry': 'अपने आप फिर कोशिश होगी। {error}',
  'offline.syncNow': 'अभी sync करें',
  'offline.retry': 'फिर कोशिश करें',
  'offline.dismiss': 'हटाएँ',

  // ── Stops & ETA screen ─────────────────────────────────────────────────
  'stops.loading': 'स्टॉप खुल रहे हैं…',
  'stops.currentAndNext': 'अभी और अगला स्टॉप',
  'stops.routeStops': 'रूट के स्टॉप',
  'stops.arrivals': 'पहुँचने का रिकॉर्ड',
  'stops.noArrivals': 'इस ट्रिप में अभी कोई स्टॉप दर्ज नहीं हुआ।',
  'stops.arrivalMeta': '{time} · स्टॉप से {distance}',
  'stops.empty.title': 'आज कोई ट्रिप नहीं है',
  'stops.empty.body': 'ट्रिप भेजते ही स्टॉप और ETA दिखने लगेंगे।',

  // ── Help & support screen ──────────────────────────────────────────────
  'help.loading': 'मदद खुल रही है…',
  'help.title': 'मदद और सहायता',
  'help.intro':
    'अगर स्कूल की स्क्रीन पर बस चलती नहीं दिख रही, तो उन्हें यह पेज दिखाएँ। ये आँकड़े सपोर्ट टीम के लिए हैं — गाड़ी चलाते समय इन्हें पढ़ना ज़रूरी नहीं।',
  'help.supportHeadline': 'सपोर्ट टीम के लिए',
  'help.supportAdvice':
    'नीचे दिए चार आँकड़े और आख़िरी फ़िक्स वाली लाइन पढ़कर सुनाएँ। इंटरनेट होने पर भी "Dropped (offline)" बढ़ता रहे तो आमतौर पर सिग्नल कमज़ोर होता है — सपोर्ट यही काउंटर सर्वर पर भी देख सकता है।',
  'help.settingsTitle': 'ऐप सेटिंग',
  'help.languageTitle': 'भाषा',
  'help.languageHint': 'भाषा चुनते ही स्क्रीन तुरंत उसी भाषा में दिखेगी।',
  'help.languageCurrent': 'अभी दिख रही है',

  // ── Language switcher (self-designations stay in their own script) ─────
  'settings.language.nameEn': 'English',
  'settings.language.nameHi': 'हिन्दी',
  'settings.language.nameMr': 'मराठी',
  'settings.language.a11y': 'ऐप की भाषा बदलें',
  'settings.language.a11yHint': 'हर स्क्रीन को अंग्रेज़ी, हिन्दी और मराठी में बदलता है।',

  // ── Sound & vibration settings (Phase 3b) ──────────────────────────────
  'settings.sound.title': 'आवाज़ और कंपन',
  'settings.sound.hint': 'हर काम की पुष्टि फ़ोन बोलकर, कंपन से, या दोनों तरह से कर सकता है।',
  'settings.sound.voiceLabel': 'बोलकर बताए',
  'settings.sound.voiceHint': 'हर चढ़ने-उतरने पर पहला नाम और समय बोलता है।',
  'settings.sound.vibrationLabel': 'कंपन दे',
  'settings.sound.vibrationHint': 'काम दर्ज होने या न होने पर हल्का कंपन।',
  'settings.sound.voiceA11y': 'बोलकर पुष्टि',
  'settings.sound.vibrationA11y': 'कंपन से पुष्टि',
  'settings.sound.noEngineNote':
    'आवाज़ नहीं आ रही? हो सकता है फ़ोन में बोलने वाला इंजन न हो — ऐप फिर भी हर काम दर्ज करता है।',

  // ── Voice phrases (बोली जाती हैं, स्क्रीन पर कभी नहीं दिखतीं) ──────────
  //
  // **ये जान-बूझकर रोमन (Latin) लिपि में हैं, देवनागरी में नहीं।** सस्ते
  // Android फ़ोनों में अक्सर `hi-IN` वाली आवाज़ इंस्टॉल ही नहीं होती; ऐसे में
  // देवनागरी टेक्स्ट डिफ़ॉल्ट अंग्रेज़ी आवाज़ से टूटा-फूटा पढ़ा जाता है। रोमन
  // लिपि में लिखी हिंग्लिश हर फ़ोन की डिफ़ॉल्ट आवाज़ साफ़ बोल देती है और
  // ड्राइवर की अपनी बोली से भी मेल खाती है। स्क्रीन की भाषा देवनागरी ही रहती
  // है — ये दो अलग चैनल हैं (देखें `crew-voice.ts`).
  'voice.board.done': '{name} ka boarding ho gaya, {time}',
  'voice.drop.done': '{name} utar gaya, {time}',
  'voice.board.summary': '{count} bachche chadh gaye',
  'voice.drop.summary': '{count} bachche utar gaye',
  'voice.trip.boarding': 'Boarding shuru ho gayi',
  'voice.trip.inProgress': 'Trip shuru, dhyan se chalaiye',
  'voice.trip.completed': 'Trip poori hui, shukriya',
  'voice.sos.fired': 'Emergency alert school ko chala gaya',
  'voice.sos.queued': 'Network nahi hai, alert dobara bheja jayega',
  'voice.offline.synced': '{count} save kiye kaam bhej diye gaye',
  'voice.gps.on': 'Location bhejna chalu',
  'voice.gps.off': 'Location bhejna band',
  'voice.time.now': 'abhi',
  'voice.time.morning': 'subah',
  'voice.time.afternoon': 'dopahar',
  'voice.time.evening': 'shaam',
  'voice.time.night': 'raat',

  // ── Login ──────────────────────────────────────────────────────────────
  'login.brandMark': 'SBT',
  'login.brandName': 'School Bus Tracking',
  'login.subtitle': 'अपने स्कूल अकाउंट से साइन इन करें',
  'login.schoolLabel': 'स्कूल कोड',
  'login.schoolPlaceholder': 'जैसे: lincoln-high',
  'login.schoolHint': 'आपके स्कूल का कोड। सिर्फ़ प्लेटफ़ॉर्म एडमिन इसे खाली छोड़ें।',
  'login.email': 'ईमेल',
  'login.emailPlaceholder': 'you@school.edu',
  'login.password': 'पासवर्ड',
  'login.passwordPlaceholder': '••••••••',
  'login.emailTitle': 'ईमेल से साइन इन करें',
  'login.submit': 'साइन इन करें',
  'login.failed': 'साइन इन नहीं हो सका',
  'login.footer':
    'ड्राइवर, कंडक्टर, अभिभावक और स्कूल एडमिन — सब यहीं साइन इन करते हैं। ऐप आपकी भूमिका के अनुसार खुद बदल जाता है।',

  // ── Crew mobile-login (Phase 4b) ────────────────────────────────────────
  'login.crewPath.cta': 'ड्राइवर / कंडक्टर के रूप में साइन इन करें',
  'login.crewPath.backToAdmin': 'इसके बजाय ईमेल और पासवर्ड इस्तेमाल करें',
  'login.crewPath.pin.title': 'अपना 4-अंकीय PIN डालें',
  'login.crewPath.pin.subtitle': 'अपना स्कूल कोड और स्कूल एडमिन द्वारा सेट किया गया PIN दर्ज करें।',
  'login.crewPath.pin.schoolRequired': 'अपना स्कूल कोड डालें',
  'login.crewPath.pin.padLabel': 'PIN',
  'login.crewPath.pin.submit': 'अनलॉक करें',
  'login.crewPath.pin.clearKey': 'PIN मिटाएँ',
  'login.crewPath.lockout.wait':
    'बहुत बार ग़लत PIN डाला गया। {seconds} सेकंड बाद फिर कोशिश करें — या एडमिन से रीसेट करवाएँ।',
  'login.crewPath.lockout.adminHint':
    'लॉकआउट हटाने के लिए स्कूल एडमिन से अपना PIN रीसेट करने को कहें।',

  // ── Shared status vocabulary ───────────────────────────────────────────
  'status.label.scheduled': 'निर्धारित',
  'status.label.boarding': 'बोर्डिंग',
  'status.label.inProgress': 'चालू',
  'status.label.completed': 'पूरी हुई',
  'status.label.cancelled': 'रद्द',
  'attendance.label.pending': 'बाकी',
  'attendance.label.boarded': 'सवार',
  'attendance.label.dropped': 'उतर गए',
  'boarding.label.boarded': 'चढ़ गया',
  'boarding.label.dropped': 'उतर गया',
  'boarding.label.notBoarded': 'नहीं चढ़ा',

  // ── Live connection chip + ETA views ───────────────────────────────────
  'connection.live': '● लाइव',
  'connection.reconnecting': '● फिर जुड़ रहा है…',
  'connection.offline': '● ऑफ़लाइन',
  'eta.unavailable': 'उपलब्ध नहीं',
  'eta.arrived': 'पहुँच गए',
  'eta.waitingForGps': 'GPS का इंतज़ार',

  // ── Shared chrome ──────────────────────────────────────────────────────
  'common.retry': 'फिर कोशिश करें',
  'common.error': 'कुछ गड़बड़ हो गई',
  'common.clearSearch': 'खोज हटाएँ',
  'common.dismiss': 'हटाएँ',
  'common.on': 'चालू',
  'common.off': 'बंद',

  // ── Time ───────────────────────────────────────────────────────────────
  'time.minutes.one': '~{count} मिनट',
  'time.minutes.other': '~{count} मिनट',

  // ── GPS permission recovery ────────────────────────────────────────────
  'gps.recovery.permissionDenied.title': 'GPS अनुमति चाहिए',
  'gps.recovery.permissionDenied.body':
    'बस की लोकेशन अभिभावकों और स्कूल तक पहुँचाने के लिए इस ऐप को लोकेशन की अनुमति चाहिए। आपकी लोकेशन सिर्फ़ चलती ट्रिप के दौरान ही साझा होती है।',
  'gps.recovery.blocked.title': 'GPS अनुमति ब्लॉक है',
  'gps.recovery.blocked.body':
    'लोकेशन की अनुमति नहीं मिली। कृपया फ़ोन की सेटिंग खोलकर इस ऐप के लिए लोकेशन चालू करें, ताकि ट्रिप के दौरान बस की लोकेशन साझा हो सके।',
  'gps.recovery.servicesOff.title': 'लोकेशन सेवा बंद है',
  'gps.recovery.servicesOff.body':
    'आपके फ़ोन में लोकेशन सेवा बंद है। ट्रिप के दौरान बस की लोकेशन साझा करने के लिए उसे सेटिंग में चालू करें।',
  'gps.recovery.background.title': 'बैकग्राउंड GPS चाहिए',
  'gps.recovery.background.body':
    'ऐप पीछे चल रहा हो तब भी बस की लोकेशन साझा होती रहे, इसके लिए बैकग्राउंड लोकेशन चाहिए। कृपया सेटिंग में "Allow all the time" चुनें।',
  'gps.recovery.issue.title': 'GPS में समस्या',
  'gps.recovery.issue.body': 'GPS अनुमतियों में कुछ समस्या है।',
  'gps.recovery.grant': 'अनुमति दें',
  'gps.recovery.openSettings': 'सेटिंग खोलें',
  'gps.recovery.recheck': 'फिर जाँचें',
  'gps.recovery.continue': 'बिना GPS जारी रखें',
  'gps.recovery.lastUpdate': 'आख़िरी GPS अपडेट: {time}',

  'gps.recovery.noServerUpdate': 'सर्वर ने अभी तक कोई लोकेशन स्वीकार नहीं की है।',
  'gps.recovery.accuracy.title': 'सटीक लोकेशन चाहिए',
  'gps.recovery.accuracy.body':
    'इस ऐप के पास केवल अनुमानित लोकेशन है। सेटिंग में “Precise location” चालू करें ताकि बस स्टॉप सही पहचाना जा सके।',
  'gps.recovery.backgroundUnavailable.title': 'बैकग्राउंड GPS उपलब्ध नहीं',
  'gps.recovery.backgroundUnavailable.body':
    'यह डिवाइस बैकग्राउंड लोकेशन नहीं देता। ऐप स्क्रीन पर खुला रहे तब तक शेयरिंग चलती रहेगी।',
  'gps.battery.android.title': 'बैटरी पाबंदी GPS रोक सकती है',
  'gps.battery.android.body':
    'बैटरी बचाने के लिए Android लोकेशन शेयरिंग रोक सकता है। Battery सेटिंग खोलकर इस ऐप को “Unrestricted” करें और ड्राइविंग के दौरान Battery saver बंद रखें।',
  'gps.battery.ios.title': 'बैटरी पाबंदी GPS रोक सकती है',
  'gps.battery.ios.body':
    'Low Power Mode और Background App Refresh लोकेशन अपडेट देर से ला सकते हैं। Settings → Battery और Settings → General → Background App Refresh में इस ऐप की जांच करें।',
  'gps.battery.other.title': 'बैटरी पाबंदी GPS रोक सकती है',
  'gps.battery.other.body':
    'इस डिवाइस के पावर-सेविंग मोड स्क्रीन बंद होने पर लोकेशन शेयरिंग रोक या देर करा सकते हैं।',
  'gps.battery.openBatterySettings': 'बैटरी सेटिंग खोलें',
  'gps.battery.openAppSettings': 'ऐप सेटिंग खोलें',
  'gps.battery.honesty':
    'यह ऐप आपकी बैटरी सेटिंग पढ़ नहीं सकता और उन्हें बदलता भी नहीं। फ़ोन ने ऐप रोका, तो दोबारा खोलने तक शेयरिंग बंद रहती है।',
  // ── Driver navigation hand-off ─────────────────────────────────────────
  'navigate.card.title': 'रास्ता',
  'navigate.card.description': 'अगला स्टॉप आपके फ़ोन के मैप ऐप में खुलेगा।',
  'navigate.card.button': 'स्टॉप तक जाएँ',
  'navigate.card.meta.one': 'ट्रिप {id} · इस रूट पर 1 स्टॉप।',
  'navigate.card.meta.other': 'ट्रिप {id} · इस रूट पर {stops} स्टॉप।',
  'navigate.card.noStops': 'इस रूट पर अभी कोई स्टॉप नहीं है।',
  'navigate.card.noGeofence':
    'इस रूट के स्टॉप पर लोकेशन दर्ज नहीं है — स्कूल से कोऑर्डिनेट जोड़ने को कहें।',

  // ── Relative time ──────────────────────────────────────────────────────
  'time.justNow': 'अभी',
  'time.minutesAgo': '{count} मिनट पहले',
  'time.hoursAgo': '{count} घंटे पहले',
  'time.daysAgo': '{count} दिन पहले',

  // ── Known server error codes ───────────────────────────────────────────
  'error.HTTP_400': 'यह रिक्वेस्ट स्वीकार नहीं हुई। फिर कोशिश करें।',
  'error.HTTP_401': 'आपका सेशन ख़त्म हो गया है। कृपया दोबारा साइन इन करें।',
  'error.HTTP_403': 'आपको यह करने की अनुमति नहीं है।',
  'error.HTTP_404': 'माँगी गई चीज़ नहीं मिली।',
  'error.HTTP_409': 'यह काम पहले ही हो चुका है — ऐप अब ताज़ा स्थिति दिखा रहा है।',
  'error.HTTP_422': 'कुछ जानकारी अधूरी या गलत है। जाँचकर फिर कोशिश करें।',
  'error.HTTP_429': 'बहुत बार कोशिश हुई। थोड़ी देर रुककर फिर करें।',
  'error.HTTP_500': 'सर्वर रिक्वेस्ट पूरी नहीं कर सका। थोड़ी देर में फिर कोशिश करें।',
  'error.HTTP_503': 'सर्वर रिक्वेस्ट पूरी नहीं कर सका। थोड़ी देर में फिर कोशिश करें।',
  'error.INTERNAL_SERVER_ERROR': 'सर्वर रिक्वेस्ट पूरी नहीं कर सका। थोड़ी देर में फिर कोशिश करें।',
  'error.RATE_LIMIT_EXCEEDED': 'बहुत बार कोशिश हुई। थोड़ी देर रुककर फिर करें।',
  'error.SERVICE_NOT_READY': 'सर्वर अभी शुरू हो रहा है। थोड़ी देर में फिर कोशिश करें।',
  'error.networkOffline': 'इंटरनेट नहीं है। आपका काम फ़ोन में सहेजा गया है और बाद में sync होगा।',
  'error.unknownCodePrefix': 'सर्वर कोड',
  // ── Crew mobile-login (Phase 4b) ────────────────────────────────────────
  'error.CREW_PIN_LOCKED': 'बहुत बार ग़लत PIN डाला गया। थोड़ी देर बाद फिर कोशिश करें',
  'error.CREW_PIN_INVALID': 'PIN काम नहीं किया। फिर कोशिश करें।',
  'error.CREW_PIN_AMBIGUOUS': 'यह PIN एक से ज़्यादा कर्मचारी का है। एडमिन से बदलने को कहें।',
};
