'use client';

/**
 * Languages of the crew console (`/crew`) — English, Hindi, Marathi.
 *
 * The web app is otherwise English-only (admin console), but the crew page
 * is used by drivers and conductors, the same people who use the mobile app —
 * so every string this PR adds ships in the same three languages as
 * `mobile/src/lib/i18n.{en,hi,mr}.ts`, with wording reused from there
 * wherever a matching key exists (e.g. `trip.stopMark.*`, `navigate.card.*`).
 *
 * Default is **Hindi**: the crew audience reads Hindi first; English is the
 * fallback for missing keys only. The choice persists per device in
 * `localStorage` under {@link CREW_LANGUAGE_STORAGE_KEY}.
 *
 * Scoped to `/crew` on purpose — admin/parent pages are out of this PR's
 * scope, so no global i18n framework is introduced.
 */
import { useCallback, useEffect, useState } from 'react';

export type CrewLanguage = 'en' | 'hi' | 'mr';

export const CREW_LANGUAGES: readonly CrewLanguage[] = ['en', 'hi', 'mr'];

/** Crew audience default — Hindi, matching the mobile app's crew default. */
export const DEFAULT_CREW_LANGUAGE: CrewLanguage = 'hi';

export const CREW_LANGUAGE_STORAGE_KEY = 'sbt.crew.language';

/** Native-script labels for the switcher — never translated themselves. */
export const CREW_LANGUAGE_LABELS: Record<CrewLanguage, string> = {
  en: 'English',
  hi: 'हिन्दी',
  mr: 'मराठी',
};

type Dictionary = Record<string, string>;

const en: Dictionary = {
  'lang.label': 'Language',
  // ---- Next-stop card -------------------------------------------------
  'nextStop.title': 'Next stop',
  'nextStop.stopOf': 'Stop {position} of {total}',
  'nextStop.distance': 'Distance',
  'nextStop.eta': 'ETA',
  'nextStop.etaMinutes': '~{count} min',
  'nextStop.etaUnavailable': 'Waiting for GPS',
  'nextStop.kidsWaiting.one': '{count} kid waiting here',
  'nextStop.kidsWaiting.other': '{count} kids waiting here',
  'nextStop.kidsDone': 'All kids marked at this stop',
  'nextStop.moreKids': '+{count} more',
  'nextStop.navigate': 'Navigate',
  'nextStop.navigateHint':
    'Opens turn-by-turn in Google Maps — next stop first, remaining stops as waypoints.',
  'nextStop.noCoordinates': 'This stop has no map coordinates, so navigation cannot open.',
  'nextStop.allDone': 'All stops on this trip are done.',
  'nextStop.noStops': 'No stops on this route yet.',
  // ---- Stops table -----------------------------------------------------
  'stops.title': 'Stops',
  'stops.description':
    'Mark each stop as you serve it. Arrived and skipped stops are recorded for the school.',
  'stops.header.stop': 'Stop',
  'stops.header.kids': 'Children',
  'stops.header.eta': 'ETA',
  'stops.header.status': 'Status',
  'stops.header.actions': 'Actions',
  'stops.status.arrived': 'Arrived',
  'stops.status.skipped': 'Skipped',
  'stops.status.pending': 'Pending',
  'stops.status.next': 'Next',
  'stops.action.arrived': 'Arrived',
  'stops.action.skip': 'Skip',
  'stops.skip.reasonLabel': 'Why are you skipping this stop?',
  'stops.skip.reasonPlaceholder': 'e.g. road closed, nobody waiting',
  'stops.skip.confirm': 'Confirm skip',
  'stops.skip.cancel': 'Cancel',
  'stops.skip.reasonTooShort': 'Reason must be at least 3 characters.',
  'stops.toast.recorded': 'Stop {number} recorded',
  'stops.toast.alreadyRecorded': 'Stop {number} was already recorded',
  'stops.toast.skipped': 'Stop {number} skipped',
  'stops.toast.failed': 'Could not save. Check the connection and try again.',
  // ---- Map card ---------------------------------------------------------
  'map.title': 'Live map',
  'map.legend.planned':
    'Blue line = planned order of the stops, drawn as straight lines — not the real road.',
  'map.legend.trail': 'Green line = path the bus has actually driven.',
  'map.legend.next': 'The enlarged marker is the next stop.',
  'map.fitRoute': 'Fit route',
  'map.followBus': 'Follow bus',
};

const hi: Dictionary = {
  'lang.label': 'भाषा',
  // ---- Next-stop card -------------------------------------------------
  'nextStop.title': 'अगला स्टॉप',
  'nextStop.stopOf': 'स्टॉप {position} / {total}',
  'nextStop.distance': 'दूरी',
  'nextStop.eta': 'ETA',
  'nextStop.etaMinutes': '~{count} मिनट',
  'nextStop.etaUnavailable': 'GPS का इंतज़ार',
  'nextStop.kidsWaiting.one': '{count} बच्चा यहाँ रुका है',
  'nextStop.kidsWaiting.other': '{count} बच्चे यहाँ रुके हैं',
  'nextStop.kidsDone': 'इस स्टॉप के सभी बच्चे दर्ज हो गए',
  'nextStop.moreKids': '+{count} और',
  'nextStop.navigate': 'नेविगेट करें',
  'nextStop.navigateHint':
    'Google Maps में टर्न-बाय-टर्न रास्ता खुलेगा — पहले अगला स्टॉप, बाकी स्टॉप वेपॉइंट के रूप में।',
  'nextStop.noCoordinates':
    'इस स्टॉप के नक्शे पर निर्देशांक नहीं हैं, इसलिए नेविगेशन नहीं खुल सकता।',
  'nextStop.allDone': 'इस ट्रिप के सभी स्टॉप पूरे हो गए।',
  'nextStop.noStops': 'इस रूट पर अभी कोई स्टॉप नहीं है।',
  // ---- Stops table -----------------------------------------------------
  'stops.title': 'स्टॉप सूची',
  'stops.description':
    'हर स्टॉप पर पहुँचते ही उसे दर्ज करें। पहुँचे और छोड़े गए स्टॉप स्कूल के रिकॉर्ड में जाते हैं।',
  'stops.header.stop': 'स्टॉप',
  'stops.header.kids': 'बच्चे',
  'stops.header.eta': 'ETA',
  'stops.header.status': 'स्थिति',
  'stops.header.actions': 'कार्रवाई',
  'stops.status.arrived': 'पहुँच गए',
  'stops.status.skipped': 'छोड़ा गया',
  'stops.status.pending': 'बाकी',
  'stops.status.next': 'अगला',
  'stops.action.arrived': 'पहुँच गए',
  'stops.action.skip': 'छोड़ें',
  'stops.skip.reasonLabel': 'यह स्टॉप क्यों छोड़ रहे हैं?',
  'stops.skip.reasonPlaceholder': 'जैसे रास्ता बंद, कोई नहीं था',
  'stops.skip.confirm': 'छोड़ना पक्का करें',
  'stops.skip.cancel': 'रद्द करें',
  'stops.skip.reasonTooShort': 'कारण कम से कम 3 अक्षरों का होना चाहिए।',
  'stops.toast.recorded': 'स्टॉप {number} दर्ज हुआ',
  'stops.toast.alreadyRecorded': 'स्टॉप {number} पहले से दर्ज है',
  'stops.toast.skipped': 'स्टॉप {number} छोड़ा गया',
  'stops.toast.failed': 'सेव नहीं हो सका। कनेक्शन जाँचकर फिर कोशिश करें।',
  // ---- Map card ---------------------------------------------------------
  'map.title': 'लाइव नक्शा',
  'map.legend.planned': 'नीली रेखा = स्टॉप का तयशुदा क्रम, सीधी रेखाओं में — यह असली सड़क नहीं है।',
  'map.legend.trail': 'हरी रेखा = बस का अब तक चला हुआ रास्ता।',
  'map.legend.next': 'बड़ा निशान अगला स्टॉप है।',
  'map.fitRoute': 'पूरा रूट दिखाएँ',
  'map.followBus': 'बस के साथ चलें',
};

const mr: Dictionary = {
  'lang.label': 'भाषा',
  // ---- Next-stop card -------------------------------------------------
  'nextStop.title': 'पुढचा थांबा',
  'nextStop.stopOf': 'थांबा {position} / {total}',
  'nextStop.distance': 'अंतर',
  'nextStop.eta': 'ETA',
  'nextStop.etaMinutes': '~{count} मिनिटे',
  'nextStop.etaUnavailable': 'GPS साठी वाट पाहत',
  'nextStop.kidsWaiting.one': 'येथे {count} मूल प्रतीक्षा करत आहे',
  'nextStop.kidsWaiting.other': 'येथे {count} मुले प्रतीक्षा करत आहेत',
  'nextStop.kidsDone': 'या थांब्यावरची सर्व मुले नोंदवली गेली',
  'nextStop.moreKids': '+{count} आणखी',
  'nextStop.navigate': 'नेव्हिगेट करा',
  'nextStop.navigateHint':
    'Google Maps मध्ये टर्न-बाय-टर्न मार्ग उघडेल — आधी पुढचा थांबा, उरलेले थांबे वेपॉइंट म्हणून.',
  'nextStop.noCoordinates':
    'या थांब्याचे नकाशावर निर्देशांक नाहीत, त्यामुळे नेव्हिगेशन उघडू शकत नाही.',
  'nextStop.allDone': 'या ट्रिपचे सर्व थांबे पूर्ण झाले.',
  'nextStop.noStops': 'या मार्गावर अजून कोणताही थांबा नाही.',
  // ---- Stops table -----------------------------------------------------
  'stops.title': 'थांब्यांची यादी',
  'stops.description':
    'प्रत्येक थांब्यावर पोहोचताच तो नोंदवा. पोहोचलेले आणि वगळलेले थांबे शाळेच्या नोंदीत जातात.',
  'stops.header.stop': 'थांबा',
  'stops.header.kids': 'मुले',
  'stops.header.eta': 'ETA',
  'stops.header.status': 'स्थिती',
  'stops.header.actions': 'कृती',
  'stops.status.arrived': 'पोहोचलो',
  'stops.status.skipped': 'वगळला',
  'stops.status.pending': 'बाकी',
  'stops.status.next': 'पुढचा',
  'stops.action.arrived': 'पोहोचलो',
  'stops.action.skip': 'वगळा',
  'stops.skip.reasonLabel': 'हा थांबा का वगळत आहात?',
  'stops.skip.reasonPlaceholder': 'उदा. रस्ता बंद, कोणी नव्हते',
  'stops.skip.confirm': 'वगळणे निश्चित करा',
  'stops.skip.cancel': 'रद्द करा',
  'stops.skip.reasonTooShort': 'कारण किमान 3 अक्षरांचे असावे.',
  'stops.toast.recorded': 'थांबा {number} नोंदवला',
  'stops.toast.alreadyRecorded': 'थांबा {number} आधीच नोंदवला आहे',
  'stops.toast.skipped': 'थांबा {number} वगळला',
  'stops.toast.failed': 'जतन होऊ शकले नाही. कनेक्शन तपासून पुन्हा प्रयत्न करा.',
  // ---- Map card ---------------------------------------------------------
  'map.title': 'लाइव्ह नकाशा',
  'map.legend.planned': 'निळी रेषा = थांब्यांचा ठरलेला क्रम, सरळ रेषांमध्ये — हा खरा रस्ता नाही.',
  'map.legend.trail': 'हिरवी रेषा = बसने आतापर्यंत प्रवास केलेला मार्ग.',
  'map.legend.next': 'मोठी खूण म्हणजे पुढचा थांबा.',
  'map.fitRoute': 'संपूर्ण मार्ग दाखवा',
  'map.followBus': 'बससोबत रहा',
};

const DICTIONARIES: Record<CrewLanguage, Dictionary> = { en, hi, mr };

export type CrewMessageParams = Record<string, string | number>;

/**
 * Looks a key up in `language`, falling back to English, then to the key
 * itself (a visible key beats a blank screen). `{param}` placeholders are
 * replaced from `params`; plural keys use the `.one` / `.other` convention
 * driven by `params.count` (same scheme as the mobile dictionaries).
 */
export function crewT(language: CrewLanguage, key: string, params?: CrewMessageParams): string {
  let template = DICTIONARIES[language]?.[key] ?? DICTIONARIES.en[key];
  if (template === undefined && typeof params?.count === 'number') {
    const plural = `${key}.${params.count === 1 ? 'one' : 'other'}`;
    template = DICTIONARIES[language]?.[plural] ?? DICTIONARIES.en[plural];
  }
  if (template === undefined) {
    return key;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params && name in params ? String(params[name]) : match,
  );
}

/** Plural-aware shortcut: `crewT` with the `.one`/`.other` suffix resolved. */
export function crewTCount(
  language: CrewLanguage,
  key: string,
  count: number,
  params?: CrewMessageParams,
): string {
  return crewT(language, key, { count, ...params });
}

export function isCrewLanguage(value: unknown): value is CrewLanguage {
  return value === 'en' || value === 'hi' || value === 'mr';
}

/**
 * The crew page's language state: Hindi by default, persisted per device.
 * Reads storage after mount (SSR-safe) and never throws when storage is
 * blocked (private mode) — the default simply applies for the session.
 */
export function useCrewLanguage(): {
  language: CrewLanguage;
  setLanguage: (language: CrewLanguage) => void;
  t: (key: string, params?: CrewMessageParams) => string;
} {
  const [language, setLanguageState] = useState<CrewLanguage>(DEFAULT_CREW_LANGUAGE);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CREW_LANGUAGE_STORAGE_KEY);
      if (isCrewLanguage(stored)) {
        setLanguageState(stored);
      }
    } catch {
      // Storage blocked — keep the Hindi default for this session.
    }
  }, []);

  const setLanguage = useCallback((next: CrewLanguage) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(CREW_LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Storage blocked — the choice still applies until reload.
    }
  }, []);

  const t = useCallback(
    (key: string, params?: CrewMessageParams) => crewT(language, key, params),
    [language],
  );

  return { language, setLanguage, t };
}
