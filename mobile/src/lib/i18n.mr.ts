import type { Dictionary } from './i18n.en.ts';

/**
 * Marathi (Devanagari) dictionary — the third locale (regional-language
 * rollout, batch 1).
 *
 * Same contract as `i18n.hi.ts`: typed as `Dictionary` (= `typeof en`), so a
 * missing or extra key is a **compile** error; `i18n-parity.spec.ts`
 * re-asserts the runtime invariants (no empty values, identical
 * `{placeholder}` sets, distinct status words) for every supported locale.
 *
 * Translation rules (same acceptance criteria as Hindi):
 *
 * - **Data is never translated.** `{name}`, `{route}`, `{time}` placeholders
 *   carry server data and stay as the server sent them.
 * - **Crew vocabulary is short and spoken.** बसव / उतरव / बाकी — the register
 *   a Marathi driver actually uses, not a textbook translation.
 * - **Length budget.** `i18n-clipping.spec.ts` enforces a per-key character
 *   budget for every locale; nothing here exceeds it.
 * - **Symbols travel with the string** (✓ ✕ ⏳ ✅ ❌ ●) — the colour-independent
 *   cue Phase 1/2 pinned.
 *
 * Voice phrases (`voice.*`) are deliberately **Latin-script Marathi**, not
 * Devanagari: the same device rationale as Hindi (see `crew-voice.ts`) —
 * budget Androids usually ship without an `mr-IN` voice pack, and Latin
 * Marathi is read cleanly by the default `en-IN` voice. Written UI stays
 * Devanagari; only the speaker gets the Latin channel.
 */
export const mr: Dictionary = {
  // ── Crew navigation ────────────────────────────────────────────────────
  'nav.tab.drive': 'ड्राइव्ह',
  'nav.tab.trip': 'ट्रिप',
  'nav.tab.manifest': 'यादी',
  'nav.tab.students': 'बालेक',
  'nav.tab.stops': 'थांबे',
  'nav.tab.sos': 'SOS',
  'nav.trip.title': '{role} · आज',
  'nav.trip.titleFallback': 'आजची ट्रिप',
  'nav.manifest.titleDriver': 'बसमधील बालेक',
  'nav.manifest.titleConductor': 'बसव-उतारा',
  'nav.stops.title': 'थांबे आणि ETA',
  'nav.sos.title': 'आपत्काळ',
  'nav.help.title': 'मदत आणि सहाय्य',
  'nav.platform.title': 'प्लॅटफॉर्म अ‍ॅडमिन',

  // ── Roles ──────────────────────────────────────────────────────────────
  'role.driver': 'ड्रायव्हर',
  'role.conductor': 'कंडक्टर',
  'role.crew': 'क्रू',
  'role.parent': 'अभिभावक',
  'role.schoolAdmin': 'शाळेचा अ‍ॅडमिन',
  'role.superAdmin': 'प्लॅटफॉर्म अ‍ॅडमिन',

  // ── Trip state words ───────────────────────────────────────────────────
  'status.scheduled': 'निर्धारित',
  'status.boarding': 'बोर्डिंग',
  'status.inProgress': 'मार्गावर',
  'status.completed': 'संपली',
  'status.cancelled': 'रद्द',

  // ── Trip screen ────────────────────────────────────────────────────────
  'trip.loading': 'आजची ट्रिप उघडत आहे…',
  'trip.loadError': 'तुमच्या ट्रिप उघडता आल्या नाहीत',
  'trip.empty.title': 'आज कोणतीही ट्रिप नाही',
  'trip.empty.body':
    'आज तुम्हाला कोणताही रन दिलेला नाही. शाळेतर्फे ट्रिप पाठवली की ती लगेच इथे दिसते.',
  'trip.detailsToggle': 'अधिक तपशील',
  'trip.detailsToggleHide': 'तपशील लपवा',
  'trip.nextStopFallback': 'GPS सुरू झाल्यावर पुढचा थांबा दिसतो',
  'trip.allStopsDone': 'सर्व थांबे पूर्ण',
  'trip.nextStop': 'पुढे: {name}',
  'trip.eta': 'पहुँचण्यास {minutes}',
  'trip.etaUnavailable': 'वेळ लवकरच',
  'trip.tripCountNote': 'आज {count} ट्रिप · सुरू असलेली दाखवली आहे',
  'trip.departedAt': '{time} ला रवाना झाली',
  'trip.arrivedAt': '{time} ला पोहोचली',
  'trip.detail.route': 'मार्ग',
  'trip.detail.scheduled': 'निर्धारित वेळ',
  'trip.detail.date': 'तारीख',
  'trip.detail.bus': 'बस',
  'trip.detail.role': 'भूमिका',
  'trip.detail.connection': 'कनेक्शन',
  'trip.emptyValue': '—',
  'trip.link.manifestDriver': 'यादी',
  'trip.link.manifestConductor': 'बसव-उतारा',
  'trip.link.stops': 'थांबे आणि ETA',

  // ── Trip lifecycle actions ─────────────────────────────────────────────
  'trip.action.boarding': 'बोर्डिंग सुरू करा',
  'trip.action.inProgress': 'रवानगी करा',
  'trip.action.completed': 'ट्रिप पूर्ण करा',
  'trip.completedNote': 'ही ट्रिप पूर्ण झाली आहे.',
  'trip.cancelledNote': 'ही ट्रिप रद्द केली गेली.',
  'trip.cancelledReason': 'ही ट्रिप रद्द केली गेली: {reason}',
  'trip.queuedNote': '{action} या फोनवर जतन झाली — इंटरनेट मिळताच पाठवली जाईल.',
  'trip.updateError': 'ट्रिप बदलता आली नाही.',
  'trip.cancel.button': 'ट्रिप रद्द करा…',
  'trip.cancel.reasonLabel': 'रद्द करण्याची कारणे',
  'trip.cancel.reasonPlaceholder': 'उदा. वाहनाची खराबी',
  'trip.cancel.confirm': 'रद्द करणे नक्की करा',
  'trip.cancel.keep': 'ट्रिप ठेवा',
  'trip.cancel.reasonRequired': 'रद्द करण्याची कारणे लिहिणे आवश्यक आहे.',
  'trip.cancel.failed': 'ट्रिप रद्द करता आली नाही.',

  // ── Manifest (board / drop) ────────────────────────────────────────────
  'manifest.loading': 'यादी उघडत आहे…',
  'manifest.loadError': 'तुमची ट्रिप उघडता आली नाही',
  'manifest.empty.tripTitle': 'आज कोणतीही ट्रिप नाही',
  'manifest.empty.tripBody': 'ट्रिप नसताना यादी नसते.',
  'manifest.empty.studentsTitle': 'या मार्गावर कोणतेही बालेक नाही',
  'manifest.empty.studentsBody':
    'यादीमध्ये फक्त ते सक्रिय बालेक येतात ज्यांचा घरगुती थांबा याच मार्गावर आहे.',
  'manifest.unavailable': 'यादी उपलब्ध नाही',
  'manifest.hint.driver':
    'तुम्ही किती बालेक नेत आहात. रवाना होण्यापूर्वी कंडक्टरांकडून विचारून घ्या.',
  'manifest.hint.conductor': 'बालक बसताना "बसव" दाबा, उतरताना "उतरव" — वेळ आपोआप नोंद होते.',
  'manifest.counts': '{boarded} बसले · {pending} बाकी · {dropped} उतरले',
  'manifest.summary.total': '{count} बालेक',
  'manifest.summary.pending': '{count} बाकी',
  'manifest.summary.boarded': '{count} बसले',
  'manifest.summary.dropped': '{count} उतरले',
  'manifest.search.placeholder': 'बालक, प्रवेश नंबर किंवा थांबा शोधा…',
  'manifest.filter.all': 'सर्व',
  'manifest.filter.waiting': 'बाकी',
  'manifest.filter.boarded': 'बसले',
  'manifest.filter.dropped': 'उतरले',
  'manifest.empty.searchTitle': 'कोणतेही बालेक सापडले नाही',
  'manifest.empty.searchBody': 'या शोध किंवा फिल्टरने कोणतेही बालेक सापडत नाही.',
  'manifest.clearFilters': 'फिल्टर काढा',
  'manifest.board': 'बसव',
  'manifest.drop': 'उतरव',
  'manifest.waitingLabel': 'बाकी',
  'manifest.boardHint': 'बालक बसताना या ओळीला दाबा.',
  'manifest.dropHint': 'बालक उतरताना या ओळीला दाबा.',
  'manifest.confirmBoard': '{name} ✓ {time}',
  'manifest.confirmDrop': '{name} ✕ {time}',
  'manifest.queuedBoard': '{name} ⏳ ऑफलाइन जतन',
  'manifest.queuedDrop': '{name} ⏳ ऑफलाइन जतन',
  'manifest.announceBoard': '{name} बसला',
  'manifest.announceDrop': '{name} उतरला',
  'manifest.rowA11y.waiting': '{name}, बाकी. बसवण्यासाठी दोनदा दाबा.',
  'manifest.rowA11y.onBoard': '{name}, {time} पासून बसला आहे.',
  'manifest.rowA11y.dropped': '{name}, {time} ला उतरला.',
  'manifest.now': 'आता',
  'manifest.earlier': 'आधी',
  'manifest.queuedBoardToast': 'ऑफलाइन जतन — इंटरनेट मिळताच बोर्डिंग सिंक होईल.',
  'manifest.queuedDropToast': 'ऑफलाइन जतन — इंटरनेट मिळताच उतरवणे सिंक होईल.',
  'manifest.boardFailed': 'बालक बसवता आले नाही',
  'manifest.dropFailed': 'बालक उतरवता आले नाही',

  // ── SOS ────────────────────────────────────────────────────────────────
  // 16 chars — the buttonFull budget (22). A longer wording wraps on the 64px
  // field button; the full sentence lives in `sos.a11yLabel`.
  'sos.holdLabel': 'दडपून ठेवा — SOS',
  'sos.holdingHint': 'दडपून ठेवा…',
  'sos.a11yLabel': 'आपत्कालीन SOS. शाळेला कळवण्यासाठी दडपून ठेवा.',
  'sos.holdA11yHint': 'एक सेकंदापुरते दडपून ठेवा; भरल्यावर अ‍ॅलर्ट आपोआप पाठवला जातो.',
  'sos.sent': 'SOS पाठवला ✅',
  'sos.queued': 'SOS रांगेत ⏳ — इंटरनेट मिळताच पाठवला जाईल',
  'sos.queuedShort': 'रांगेत ⏳ ऑनलाइन झाल्यावर जाईल',
  'sos.retrying': 'पाठवत आहे…',
  'sos.activeAlert': 'अ‍ॅलर्ट सुरू — शाळेला कळवले आहे',
  'sos.manageHint': 'तपशील आणि रद्द करणे SOS टॅबवर आहे.',
  'sos.sendFailed': 'SOS पाठवता आला नाही',
  'sos.invalid': 'अ‍ॅलर्ट योग्य नाही',
  'sos.roleTitle': '{role} आपत्काळ',
  'sos.attachTrip': 'हा अ‍ॅलर्ट आजच्या ट्रिपशी जोडला जाईल.',
  'sos.attachTripRoute': 'हा अ‍ॅलर्ट आजच्या ट्रिपशी जोडला जाईल · {route}.',
  'sos.empty.title': 'आज कोणतीही ट्रिप नाही',
  'sos.empty.body': 'तुम्ही तरीही आपत्काळ नोंदवू शकता — ती ट्रिपशिवाय नोंदवली जाईल.',
  'sos.loading': 'तुमची ट्रिप उघडत आहे…',
  'sos.activeTitle': 'अ‍ॅलर्ट सुरू आहे',
  'sos.acknowledged': 'शाळाने अ‍ॅलर्ट नोंदवला आहे. मदत मार्गावर आहे.',
  'sos.notified': 'शाळेला कळवले आहे. तुमचा फोन सोबत ठेवा.',
  'sos.cancelAlert': 'अ‍ॅलर्ट रद्द करा',
  'sos.cardTitle': 'आपत्कालीन SOS',
  'sos.cardBodyTrip': 'लाल बटण दडपून ठेवा — शाळेला लगेच कळते आणि तुमची सध्याची ट्रिप जोडली जाते.',
  'sos.cardBodyNoTrip': 'लाल बटण दडपून ठेवा — शाळेला लगेच कळते.',
  'sos.noReadingNeeded':
    'वाचण्याची गरज नाही: दडपून ठेवा, लोकेशन्सह पाठवला जातो. वेळ आहे तर "प्रथम तपशील द्या" निवडा — अ‍ॅलर्ट तुमच्या {role} खात्याशी नोंदवला जातो.',
  'sos.detailsButton': 'प्रथम तपशील द्या (काय झाले, संदेश)…',
  'sos.recentTitle': 'तुमचे अलीकडील अ‍ॅलर्ट',
  'sos.sheetTitle': 'आपत्काळ नोंदवा',
  'sos.typeLabel': 'काय चालू आहे?',
  'sos.messageLabel': 'संदेश',
  'sos.messagePlaceholder': 'उदा. बसचा वॉलला धक्का लागला, सर्व बालेक सुरक्षित.',
  'sos.locationLabel': 'माझे स्थान जोडा',
  'sos.locationHint':
    'फक्त तेव्हा जेव्हा डिव्हाइसमध्ये आधीच GPS फिक्स आहे — स्थान कधीही काढून लावले जात नाही.',
  'sos.back': 'मागे',
  'sos.cancelTitle': 'हा अ‍ॅलर्ट रद्द करावा?',
  'sos.cancelMessage':
    'फक्त तेव्हा रद्द करा जेव्हा अ‍ॅलर्ट चुकीने गेला असेल — नोंद शाळेच्या इतिहासात राहते.',
  'sos.cancelConfirm': 'अ‍ॅलर्ट रद्द करा',
  'sos.cancelFailed': 'अ‍ॅलर्ट रद्द करता आला नाही',

  // ── GPS sharing ────────────────────────────────────────────────────────
  'gps.sharingOn': 'शेअरिंग सुरू ✅',
  'gps.sharingOff': 'शेअरिंग बंद ❌',
  'gps.lastUpdate': '{time} ला अ‍ॅपडेट',
  'gps.neverUpdated': 'अजून अ‍ॅपडेट नाही',
  'gps.retry': 'पुन्हा करा',
  'gps.stop': 'थांबवा',
  'gps.helpLink': 'GPS तपशील आणि सहाय्य',
  'gps.panelTitle': 'लाइव्ह GPS शेअरिंग',
  'gps.badgeSharing': 'शेअरिंग सुरू',
  'gps.badgeOff': 'बंद',
  'gps.notReady': 'ट्रिप बोर्डिंग किंवा सुरू असतानाच GPS स्वीकारला जातो. सध्याची स्थिती: {status}.',
  'gps.share': 'GPS शेअर करा',
  'gps.stopSharing': 'शेअरिंग थांबवा',
  'gps.backgroundTitle': 'बॅकग्राउंडमध्ये शेअर सुरू ठेवा',
  'gps.backgroundOn': 'स्क्रीन बंद असतानाही स्थान बॅकग्राउंड टास्कने सुरू राहते.',
  'gps.backgroundAllowed': 'परवानगी आहे — स्क्रीन बंद ठेवताना पाठवण्यासाठी सुरू करा.',
  'gps.backgroundNeeded': '"Allow all the time" लोकेशन परवानगी आवश्यक आहे.',
  'gps.tierGood': 'GPS बरं',
  'gps.tierWeak': 'GPS कमकुवत',
  'gps.tierStale': 'GPS जुने',
  'gps.network': 'नेटवर्क {state}',
  'gps.location': 'स्थान {state}',
  'gps.lastFix': 'शेवटचे फिक्स {time}',
  'gps.accuracy': '±{meters} मी.',
  'gps.noFix': 'या डिव्हाइसवरून अजून फिक्स मिळालेले नाही.',
  'gps.serverReason': 'सर्व्हरने सांगितले: {reason}',
  'gps.status.live': 'शाळा बस पाहू शकते · {time}',
  'gps.status.localOnly': 'GPS मिळाला, अद्याप पाठवला नाही · {time}',
  'gps.status.connecting': 'शाळेशी जोडत आहे…',
  'gps.status.reconnecting': 'पुन्हा जोडत आहे…',
  'gps.status.stale': 'शेवटी {time} पाठवला',
  'gps.status.waitingForFix': 'पहिल्या GPS ची वाट पाहत आहे…',
  'gps.status.permissionBlocked': 'लोकेशन परवानगी आवश्यक',
  'gps.status.servicesOff': 'लोकेशन सेवा बंद आहे',
  'gps.status.revoked': 'प्रवेश रद्द — ट्रॅकिंग बंद',
  'gps.status.stopped': 'शेअर होत नाही',
  'gps.deliveryBadge': 'डिलिव्हरी',
  'gps.accuracyReduced': 'अंदाजे GPS',
  'gps.servicesOff': 'लोकेशन बंद',
  'gps.recoveryAttempts': 'पुन्हा {count}',
  'gps.serverAck': 'सर्व्हरने {time} स्वीकारला',
  'gps.serverNoAck': 'सर्व्हरने अद्याप लोकेशन स्वीकारली नाही',
  'gps.message.servicesOff': 'बसची स्थिती पाठवण्यासाठी लोकेशन सेवा चालू करा.',
  'gps.message.permissionRequired': 'शाळेशी GPS शेअर करण्यासाठी लोकेशन परवानगी आवश्यक आहे.',
  'gps.message.startFailed': 'GPS शेअरिंग सुरू होऊ शकले नाही.',
  'gps.message.backgroundDenied': 'स्क्रीन बंद असतानाही पाठवण्यासाठी “Always” लोकेशन परवानगी द्या.',
  'gps.message.backgroundUnavailable': 'या डिव्हाइसवर बॅकग्राउंड लोकेशन उपलब्ध नाही.',
  'gps.message.backgroundNeedsTrip': 'बॅकग्राउंड शेअरिंगसाठी सुरू असलेली ट्रिप आवश्यक आहे.',
  'gps.message.backgroundFailed': 'बॅकग्राउंड शेअरिंग चालू होऊ शकले नाही.',
  'gps.message.revoked': 'लाइव्ह ट्रॅकिंगचा प्रवेश रद्द झाला — शेअरिंग थांबवले आहे.',
  'gps.service.title': 'शाळा बस GPS शेअरिंग',
  'gps.service.body': 'ट्रिप सुरू असताना हा फोन त्याची GPS शाळेला पाठवत आहे.',
  'gps.noTripBody': 'आज ट्रिप नाही — ट्रिप सुरू असताना GPS गणक इथे दिसतात.',
  'gps.driverOnlyTitle': 'GPS शेअरिंग',
  'gps.driverOnlyBody':
    'या रनमध्ये GPS शेअर करणे ड्रायव्हरचे काम आहे. शाळेला बस दिसत नसेल तर ड्रायव्हरला या पेजवर येऊन आकडे वाचण्यास सांगा.',

  // ── Offline queue / sync banner ────────────────────────────────────────
  'offline.pending.one': 'ऑफलाइन · 1 काम या फोनवर जतन झाले',
  'offline.pending.other': 'ऑफलाइन · {count} काम या फोनवर जतन झालीत',
  'offline.idle': 'ऑफलाइन · काम जतन होऊन नंतर पाठवले जातील',
  'offline.syncing.one': '1 काम सिंक होत आहे…',
  'offline.syncing.other': '{count} काम सिंक होत आहेत…',
  'offline.failed.one': '1 काम सिंक करता आले नाही',
  'offline.failed.other': '{count} काम सिंक करता आले नाहीत',
  'offline.waiting.one': '1 काम सिंकायला बाकी',
  'offline.waiting.other': '{count} काम सिंकायला बाकी',
  'offline.problem': 'सिंक समस्या',
  'offline.detailOffline': 'कनेक्शन परत येताच ती आपोआप पाठवली जातील.',
  'offline.willRetry': 'आपोआप पुन्हा प्रयत्न होईल. {error}',
  'offline.syncNow': 'आता सिंक करा',
  'offline.retry': 'पुन्हा करा',
  'offline.dismiss': 'काढा',

  // ── Stops & ETA screen ─────────────────────────────────────────────────
  'stops.loading': 'थांबे उघडत आहेत…',
  'stops.currentAndNext': 'सध्या आणि पुढचा थांबा',
  'stops.routeStops': 'मार्गाचे थांबे',
  'stops.arrivals': 'पहुँचणीची नोंद',
  'stops.noArrivals': 'या ट्रिपसाठी अजून कोणताही थांबा नोंदवलेला नाही.',
  'stops.arrivalMeta': '{time} · थांब्यापासून {distance}',
  'stops.empty.title': 'आज कोणतीही ट्रिप नाही',
  'stops.empty.body': 'ट्रिप पाठवली की थांबे आणि ETA दिसू लागतात.',

  // ── Help & support screen ──────────────────────────────────────────────
  'help.loading': 'मदत उघडत आहे…',
  'help.title': 'मदत आणि सहाय्य',
  'help.intro':
    'जर शाळेच्या स्क्रीनवर बस चालत दिसत नसेल, तर त्यांना हा पेज दाखवा. हे आकडे सपोर्ट टीमसाठी आहेत — वाहन चालवताना वाचण्याची गरज नाही.',
  'help.supportHeadline': 'सपोर्ट टीमसाठी',
  'help.supportAdvice':
    'खालील चार आकडे आणि शेवटचे फिक्स ओळ वाचून सांगा. इंटरनेट असतानाही "Dropped (offline)" वाढत राहिले तर सहसा सिग्नल कमकुवत असतो — सपोर्टला सर्व्हरवरही तेच गणक पहाता येतात.',
  'help.settingsTitle': 'अ‍ॅप सेटिंग्ज',
  'help.languageTitle': 'भाषा',
  'help.languageHint': 'भाषा निवडताच स्क्रीन त्याच भाषेत दिसते.',
  'help.languageCurrent': 'सध्या दिसत आहे',

  // ── Language switcher (self-designations stay in their own script) ─────
  'settings.language.nameEn': 'English',
  'settings.language.nameHi': 'हिन्दी',
  'settings.language.nameMr': 'मराठी',
  'settings.language.a11y': 'अ‍ॅपची भाषा बदला',
  'settings.language.a11yHint': 'प्रत्येक स्क्रीन English, हिन्दी आणि मराठी यांमध्ये बदलते.',

  // ── Sound & vibration settings (Phase 3b) ──────────────────────────────
  'settings.sound.title': 'आवाज आणि कंपन',
  'settings.sound.hint': 'प्रत्येक कारवाईची पुष्टी फोन बोलून, कंपनाने किंवा दोन्ही मार्गाने करतो.',
  'settings.sound.voiceLabel': 'बोलून पुष्टी द्या',
  'settings.sound.voiceHint': 'प्रत्येक बसवण्या-उतरवण्यानंतर पहिले नाव आणि वेळ बोलतो.',
  'settings.sound.vibrationLabel': 'कारवाईवर कंपन',
  'settings.sound.vibrationHint': 'कारवाई नोंदवल्यावर किंवा नाकारल्यावर छोटे कंपन.',
  'settings.sound.voiceA11y': 'बोल्या पुष्टी',
  'settings.sound.vibrationA11y': 'कंपन पुष्टी',
  'settings.sound.noEngineNote':
    'आवाज नाही? तुमच्या फोनमध्ये बोलण्याचा इंजिन नसू शकतो — अ‍ॅप तरीही प्रत्येक कारवाई नोंदवतो.',

  // ── Voice phrases (SPOKEN, never rendered — see `crew-voice.ts`) ───────
  //
  // Latin-script Marathi, for the same device reason as the Hindi phrases:
  // the default `en-IN` voice reads it cleanly; an `mr-IN` pack is usually
  // absent. Budget: 6–9 words — the driver is listening while driving.
  'voice.board.done': '{name} bas madhe aaun gele, {time}',
  'voice.drop.done': '{name} bas madheun uatla, {time}',
  'voice.board.summary': '{count} balek bas madhe aaun gele',
  'voice.drop.summary': '{count} balek bas madheun uatle',
  'voice.trip.boarding': 'Boarding suru zavli',
  'voice.trip.inProgress': 'Trip suru, savdhannin raho',
  'voice.trip.completed': 'Trip sampurna zali, dhanyavad',
  'voice.sos.fired': 'Emergency alert school la pavla',
  'voice.sos.queued': 'Network nasle, alert pun pathavle jayel',
  'voice.offline.synced': '{count} pending kaam pathavle',
  'voice.gps.on': 'Location pathavne suru',
  'voice.gps.off': 'Location pathavne band',
  'voice.time.now': 'atatach',
  'voice.time.morning': 'subah',
  'voice.time.afternoon': 'dopahar',
  'voice.time.evening': 'shaam',
  'voice.time.night': 'raat',

  // ── Login ──────────────────────────────────────────────────────────────
  'login.brandMark': 'SBT',
  'login.brandName': 'School Bus Tracking',
  'login.subtitle': 'तुमच्या शाळेच्या खात्याने लॉगिन करा',
  'login.schoolLabel': 'शाळेचा कोड',
  'login.schoolPlaceholder': 'उदा. lincoln-high',
  'login.schoolHint': 'तुमच्या शाळेचा तेनेंट कोड. फक्त प्लॅटफॉर्म अ‍ॅडमिन्ससाठी रिकामे छोडा.',
  'login.email': 'ईमेल',
  'login.emailPlaceholder': 'you@school.edu',
  'login.password': 'पासवर्ड',
  'login.passwordPlaceholder': '••••••••',
  'login.emailTitle': 'ईमेलने लॉगिन करा',
  'login.submit': 'लॉगिन करा',
  'login.failed': 'लॉगिन करता आले नाही',
  'login.footer':
    'ड्रायव्हर, कंडक्टर, अभिभावक आणि शाळेचे अ‍ॅडमिन — सर्वजण इथे लॉगिन करतात. अ‍ॅप तुमच्या भूमिकेनुसार आपोआप बदलतो.',

  // ── Crew mobile-login (Phase 4b) ───────────────────────────────────────
  'login.crewPath.cta': 'ड्रायव्हर / कंडक्टर म्हणून लॉगिन करा',
  'login.crewPath.backToAdmin': 'इथे बदलायला ईमेल आणि पासवर्ड वापरा',
  'login.crewPath.pin.title': 'तुमचे 4-अंकी PIN टाका',
  'login.crewPath.pin.subtitle': 'तुमचा शाळेचा कोड आणि शाळेच्या अ‍ॅडमिनने सेट केलेला PIN टाका.',
  'login.crewPath.pin.schoolRequired': 'तुमचा शाळा कोड टाका',
  'login.crewPath.pin.padLabel': 'PIN',
  'login.crewPath.pin.submit': 'अनलॉक करा',
  'login.crewPath.pin.clearKey': 'PIN साफ करा',
  'login.crewPath.lockout.wait':
    'बऱ्याच वेळा चुकीचे PIN. {seconds} सेकंदांनंतर पुन्हा करा — किंवा अ‍ॅडमिनला रीसेट करा.',
  'login.crewPath.lockout.adminHint':
    'लॉकआउट दूर करण्यासाठी शाळेच्या अ‍ॅडमिनला तुमचा PIN रीसेट करण्यास सांगा.',

  // ── Shared status vocabulary ───────────────────────────────────────────
  'status.label.scheduled': 'निर्धारित',
  'status.label.boarding': 'बोर्डिंग',
  'status.label.inProgress': 'सुरू',
  'status.label.completed': 'पूर्ण',
  'status.label.cancelled': 'रद्द',
  'attendance.label.pending': 'बाकी',
  'attendance.label.boarded': 'बसले',
  'attendance.label.dropped': 'उतरले',
  'boarding.label.boarded': 'बसला',
  'boarding.label.dropped': 'उतरला',
  'boarding.label.notBoarded': 'बसले नाही',

  // ── Live connection chip + ETA views ───────────────────────────────────
  'connection.live': '● लाइव्ह',
  'connection.reconnecting': '● पुन्हा जोडत आहे…',
  'connection.offline': '● ऑफलाइन',
  'eta.unavailable': 'उपलब्ध नाही',
  'eta.arrived': 'पहोचले',
  'eta.waitingForGps': 'GPS साठी वाट पाहत',

  // ── Live tracking map (parent + admin) ─────────────────────────────────
  'map.followBus': 'बस फॉलो करा',
  'map.followingA11y': 'बस फॉलो केली जात आहे',
  'map.exploringA11y': 'नकाशा पाहत आहात — फॉलो थांबले आहे',
  'map.status.live': 'लाइव्ह स्थिती',
  'map.status.lastKnown': 'शेवटची ज्ञात',
  'map.status.noLocation': 'स्थिती नाही',
  'map.status.approximate': 'अंदाजे',
  'map.updatedAt': 'अपडेट {time}',
  'map.staleNote': '{time} पासून नवीन स्थिती नाही।',
  'map.offlineNote': 'ऑफलाइन — शेवटची ज्ञात स्थिती दाखवत आहे।',
  'map.routeNotice': 'थांब्यांमधील सरळ रेषा — प्रत्यक्ष मार्ग नाही।',
  'map.noCoordinates': 'या मार्गात अद्याप नकाशागत थांबे नाहीत।',
  'map.busA11y': 'शाळेची बस',
  'map.stopA11y': 'थांबा {number}',

  // ── Shared chrome ──────────────────────────────────────────────────────
  'common.retry': 'पुन्हा करा',
  'common.error': 'काहीतरी चुकीचे झाले',
  'common.clearSearch': 'शोध साफ करा',
  'common.dismiss': 'काढा',
  'common.on': 'सुरू',
  'common.off': 'बंद',

  // ── Time ───────────────────────────────────────────────────────────────
  'time.minutes.one': '~{count} मिनिट',
  'time.minutes.other': '~{count} मिनिटे',

  // ── GPS permission recovery ────────────────────────────────────────────
  'gps.recovery.permissionDenied.title': 'GPS परवानगी आवश्यक',
  'gps.recovery.permissionDenied.body':
    'बसचे स्थान अभिभावक आणि शाळेशी शेअर करण्यासाठी या अ‍ॅपला लोकेशन परवानगी लागते. तुमचे स्थान फक्त सुरू असलेल्या ट्रिपच्या वेळी शेअर होते.',
  'gps.recovery.blocked.title': 'GPS परवानगी ब्लॉक',
  'gps.recovery.blocked.body':
    'लोकेशन परवानगी नाकारली गेली. कृपया फोनच्या सेटिंग्ज उघडून या अ‍ॅपसाठी लोकेशन सुरू करा, जेणेकरून ट्रिपच्या वेळी बसचे स्थान शेअर होऊ शकेल.',
  'gps.recovery.servicesOff.title': 'लोकेशन सेवा बंद',
  'gps.recovery.servicesOff.body':
    'तुमच्या फोनमध्ये लोकेशन सेवा बंद आहे. ट्रिपच्या वेळी बसचे स्थान शेअर करण्यासाठी सेटिंग्जमध्ये ती सुरू करा.',
  'gps.recovery.background.title': 'बॅकग्राउंड GPS आवश्यक',
  'gps.recovery.background.body':
    'अ‍ॅप पाठीमागे असतानाही बसचे स्थान शेअर होत राहण्यासाठी बॅकग्राउंड लोकेशन लागते. कृपया सेटिंग्जमध्ये "Allow all the time" निवडा.',
  'gps.recovery.issue.title': 'GPS समस्या',
  'gps.recovery.issue.body': 'GPS परवानगींमध्ये काही समस्या आहे.',
  'gps.recovery.grant': 'परवानगी द्या',
  'gps.recovery.openSettings': 'सेटिंग्ज उघडा',
  'gps.recovery.recheck': 'पुन्हा तपासा',
  'gps.recovery.continue': 'GPS नसूनही पुढे चालू ठेवा',
  'gps.recovery.lastUpdate': 'शेवटचे GPS अ‍ॅपडेट: {time}',

  'gps.recovery.noServerUpdate': 'सर्व्हरने अद्याप कोणतीही लोकेशन स्वीकारलेली नाही.',
  'gps.recovery.accuracy.title': 'अचूक लोकेशन आवश्यक',
  'gps.recovery.accuracy.body':
    'या ॲपकडे फक्त अंदाजे लोकेशन आहे. सेटिंग्जमध्ये “Precise location” चालू करा जेणेकरून बस स्टॉप योग्य ओळखला जाईल.',
  'gps.recovery.backgroundUnavailable.title': 'बॅकग्राउंड GPS उपलब्ध नाही',
  'gps.recovery.backgroundUnavailable.body':
    'हे डिव्हाइस बॅकग्राउंड लोकेशन देत नाही. ॲप स्क्रीनवर सुरू असताना शेअरिंग चालू राहील.',
  'gps.battery.android.title': 'बॅटरी मर्यादा GPS थांबवू शकते',
  'gps.battery.android.body':
    'बॅटरी वाचवण्यासाठी Android लोकेशन शेअरिंग थांबवू शकते. Battery सेटिंग्ज उघडून या ॲपला “Unrestricted” करा आणि ड्राइव्हिंग दरम्यान Battery saver बंद ठेवा.',
  'gps.battery.ios.title': 'बॅटरी मर्यादा GPS थांबवू शकते',
  'gps.battery.ios.body':
    'Low Power Mode आणि Background App Refresh मुळे लोकेशन अपडेट उशिरा येऊ शकतात. Settings → Battery आणि Settings → General → Background App Refresh मध्ये या ॲपची तपासणी करा.',
  'gps.battery.other.title': 'बॅटरी मर्यादा GPS थांबवू शकते',
  'gps.battery.other.body':
    'या डिव्हाइसचे पॉवर-सेव्हिंग मोड स्क्रीन बंद असताना लोकेशन शेअरिंग थांबवू किंवा उशिरा करू शकतात.',
  'gps.battery.openBatterySettings': 'बॅटरी सेटिंग्ज उघडा',
  'gps.battery.openAppSettings': 'ॲप सेटिंग्ज उघडा',
  'gps.battery.honesty':
    'हे ॲप तुमच्या बॅटरी सेटिंग्ज वाचू शकत नाही आणि त्या बदलतही नाही. फोनने ॲप थांबवल्यास, तो पुन्हा उघडेपर्यंत शेअरिंग बंद राहते.',
  // ── Driver navigation hand-off ─────────────────────────────────────────
  'navigate.card.title': 'मार्गदर्शन',
  'navigate.card.description': 'पुढचा थांबा तुमच्या फोनच्या मॅप अ‍ॅपमध्ये उघडतो.',
  'navigate.card.button': 'थांब्याकडे जा',
  'navigate.card.meta.one': 'ट्रिप {id} · या मार्गावर 1 थांबा.',
  'navigate.card.meta.other': 'ट्रिप {id} · या मार्गावर {stops} थांबे.',
  'navigate.card.noStops': 'या मार्गावर अजून कोणताही थांबा नाही.',
  'navigate.card.noGeofence':
    'या मार्गाचे थांबे GEO-फेंस केलेले नाहीत — शाळेला निर्देशक जोडण्यास सांगा.',

  // ── Relative time ──────────────────────────────────────────────────────
  'time.justNow': 'आताच',
  'time.minutesAgo': '{count} मिनिटे आधी',
  'time.hoursAgo': '{count} तास आधी',
  'time.daysAgo': '{count} दिवस आधी',

  // ── Known server error codes ───────────────────────────────────────────
  'error.HTTP_400': 'हा अनुरोध स्वीकारला गेला नाही. पुन्हा प्रयत्न करा.',
  'error.HTTP_401': 'तुमचे सेशन संपले आहे. कृपया पुन्हा लॉगिन करा.',
  'error.HTTP_403': 'तुम्हाला हे करण्याची परवानगी नाही.',
  'error.HTTP_404': 'मागित घटक सापडला नाही.',
  'error.HTTP_409': 'ही कारवाई आधीच पूर्ण झाली — अ‍ॅप आता नवीन स्थिती दाखवतो.',
  'error.HTTP_422': 'काही तपशील अधुरे किंवा चुकीचे आहेत. तपासून पुन्हा प्रयत्न करा.',
  'error.HTTP_429': 'बऱ्याच वेळा अनुरोध. थोडा वेळ थांबून पुन्हा करा.',
  'error.HTTP_500': 'सर्व्हरने अनुरोध पूर्ण करू शकला नाही. थोड्या वेळात पुन्हा प्रयत्न करा.',
  'error.HTTP_503': 'सर्व्हरने अनुरोध पूर्ण करू शकला नाही. थोड्या वेळात पुन्हा प्रयत्न करा.',
  'error.INTERNAL_SERVER_ERROR':
    'सर्व्हरने अनुरोध पूर्ण करू शकला नाही. थोड्या वेळात पुन्हा प्रयत्न करा.',
  'error.RATE_LIMIT_EXCEEDED': 'बऱ्याच वेळा अनुरोध. थोडा वेळ थांबून पुन्हा करा.',
  'error.SERVICE_NOT_READY': 'सर्व्हर सुरू होत आहे. थोड्या वेळात पुन्हा प्रयत्न करा.',
  'error.networkOffline': 'इंटरनेट नाही. तुमची कारवाई या फोनवर जतन झाली आणि नंतर सिंक होईल.',
  'error.unknownCodePrefix': 'सर्व्हर कोड',
  'error.CREW_PIN_LOCKED': 'बऱ्याच वेळा चुकीचे PIN. थोड्या वेळात पुन्हा प्रयत्न करा.',
  'error.CREW_PIN_INVALID': 'हे PIN चुकीचे आहे. पुन्हा प्रयत्न करा.',
  'error.CREW_PIN_AMBIGUOUS': 'हे PIN एकापेक्षा जास्त कर्मचाऱ्यांचे आहे. अ‍ॅडमिनकडून बदलवा.',
};
