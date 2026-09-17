import { en, type Dictionary, type EnglishDictionary } from './i18n.en.ts';
import { hi } from './i18n.hi.ts';
import { mr } from './i18n.mr.ts';
import { isTechnicalMessage } from './error-messages.ts';

/**
 * The app's localisation layer (Phase 3) — small, typed and **dependency-free**.
 *
 * Why not `react-i18next` / `expo-localization` / a TTS library:
 *
 * - the app needs exactly two locales and ~250 keys, so a lookup table plus a
 *   `{placeholder}` replace covers the requirement without a runtime, a
 *   plural-rule engine or a translation CDN;
 * - `docs/mobile-expo-sdk.md` is strict about the Expo SDK line — every new
 *   dependency has to be the exact version SDK 57 publishes and has to stay
 *   in lockstep. Zero new dependencies is the safest possible answer, and it
 *   keeps the Expo Go flow (`scripts/expo-start.mjs`) untouched;
 * - this module stays loadable under plain `node --test` (the repo has no
 *   Jest/Vitest), so every rule below is pinned by a colocated spec.
 *
 * **This file imports no React Native module.** Persistence and the device
 * locale are *injected* (`configureLocaleStore`, `resolveInitialLocale`) by
 * the thin glue in `i18n-preferences.ts`, which is the only place that touches
 * AsyncStorage / `NativeModules.I18nManager`.
 *
 * ### Type-safety contract
 *
 * - a key typo is a compile error (`TranslationKey = keyof typeof en`);
 * - the params object is derived from the placeholders in the English
 *   template, so `t('manifest.confirmBoard', { name })` — missing `time` —
 *   does not compile, and neither does a key that takes no params being
 *   called with one;
 * - `i18n.hi.ts` is typed `Dictionary`, so a missing Hindi value is also a
 *   compile error; `i18n-parity.spec.ts` re-checks it at runtime.
 */

// ── Locales ────────────────────────────────────────────────────────────────

export type Locale = 'en' | 'hi' | 'mr';

/** Every locale the app can render. Adding one means adding a dictionary. */
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'hi', 'mr'];

/** The fallback of last resort — English is the source of truth. */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Crew (DRIVER / CONDUCTOR) default. Product decision (owner, 2026-09): the
 * app opens in **English** for everyone — crew included — and the driver
 * picks their own language from the switch (login screen + Help screen); the
 * choice persists and always wins over this default. English first, regional
 * languages on demand: a Marathi driver who never touches the switch sees an
 * app they can still operate (numbers, PIN, icons), while a Hindi-only driver
 * is one tap from Devanagari.
 */
export const CREW_DEFAULT_LOCALE: Locale = 'en';

/** The roles that get `CREW_DEFAULT_LOCALE`, matched against `UserRole`. */
export const CREW_LOCALE_ROLES: readonly string[] = ['DRIVER', 'CONDUCTOR'];

const dictionaries: Record<Locale, Dictionary> = { en, hi, mr };

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * `hi-IN` / `hi_IN` / `HI` → `hi`; `en-US` → `en`; `mr-IN` → `null`
 * (unsupported — the caller falls through to the next resolution step rather
 * than guessing a neighbouring language).
 */
export function normalizeLocaleTag(tag: string | null | undefined): Locale | null {
  if (typeof tag !== 'string') return null;
  const language = tag.trim().split(/[-_]/)[0]?.toLowerCase();
  return isSupportedLocale(language) ? language : null;
}

// ── Resolution order ───────────────────────────────────────────────────────

export interface LocaleResolution {
  /** What AsyncStorage returned for the saved preference (raw string). */
  saved: string | null;
  /**
   * The device locale as the OS reports it (`hi-IN`, `en-US`…). Injected by
   * `i18n-preferences.ts`; `null` outside a React Native runtime, which is why
   * the specs deterministically land on `en`.
   */
  device: string | null;
  /** The signed-in user's `UserRole`, or `null` before login. */
  role: string | null;
}

/** The role default for a role, given what the device reports. */
export function localeForRole(role: string | null, device: string | null): Locale {
  if (role !== null && CREW_LOCALE_ROLES.includes(role)) return CREW_DEFAULT_LOCALE;
  return normalizeLocaleTag(device) ?? DEFAULT_LOCALE;
}

/**
 * The one place the resolution order is decided:
 *
 * 1. **saved preference** — an explicit choice always wins, whatever the
 *    device or role says;
 * 2. **role default** — crew → `hi`; everyone else → the device locale;
 * 3. **`en`** — an unsupported/absent device locale falls back to the source
 *    of truth rather than to a guess.
 *
 * Note the deliberate consequence: a crew member on an English-locale phone
 * still opens in Hindi, because "crew default = Hindi" is the product rule and
 * the switch on the Help screen is the escape hatch.
 */
export function resolveInitialLocale(input: LocaleResolution): Locale {
  const saved = normalizeLocaleTag(input.saved);
  if (saved) return saved;
  return localeForRole(input.role, input.device);
}

// ── Placeholders ───────────────────────────────────────────────────────────

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** Every `{name}` in a template, in order of appearance (duplicates kept). */
export function placeholderNames(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    names.push(match[1]!);
  }
  return names;
}

/**
 * Replaces `{name}` from `values`. An *unknown* placeholder is left verbatim
 * rather than becoming `undefined` — a half-translated string that shows
 * `{time}` is debuggable; one that shows "undefined" is not.
 */
export function interpolate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  );
}

// ── Typed `t()` ────────────────────────────────────────────────────────────

export type TranslationKey = keyof Dictionary;

/**
 * Union of the placeholder names of key `K`, parsed from the **English
 * template's literal type** — the source of truth. Reading it from the widened
 * `Dictionary` would yield `string` and lose the inference.
 */
export type ParamsFor<K extends TranslationKey> = PlaceholderUnion<EnglishDictionary[K]>;

type PlaceholderUnion<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? (Name extends string ? Name : never) | PlaceholderUnion<Rest>
  : never;

/** No placeholders → the params argument is forbidden; otherwise it is required. */
type ParamsArg<K extends TranslationKey> = [ParamsFor<K>] extends [never]
  ? []
  : [Readonly<Record<ParamsFor<K>, string | number>>];

let currentLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * The whole dictionary of the active locale. Handy for specs and for the
 * language switcher; components should call `t()`.
 */
export function dictionary(locale: Locale = currentLocale): Dictionary {
  return dictionaries[locale];
}

/**
 * Translate `key` in the active locale, falling back to English for a key a
 * dictionary somehow lacks (typed away, but a runtime hole must never render
 * `undefined` on a driver's screen).
 */
export function t<K extends TranslationKey>(key: K, ...params: ParamsArg<K>): string {
  const template = dictionaries[currentLocale][key] ?? en[key];
  const values = params[0];
  return values ? interpolate(template, values) : template;
}

// ── Locale switching ───────────────────────────────────────────────────────

/** Subscribe to locale changes; returns the unsubscribe function. */
export function subscribeLocale(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface SetLocaleOptions {
  /** Default `true` — an explicit user choice is what gets persisted. */
  persist?: boolean;
}

/**
 * Switch locale and notify subscribers — the app re-renders in place, no
 * restart. Persistence is fire-and-forget: a failing AsyncStorage write must
 * never leave the UI on the old language (same "delivery never fails the
 * operation" principle the push and offline layers use).
 */
export function setLocale(locale: Locale, options: SetLocaleOptions = {}): void {
  currentLocale = locale;
  if (options.persist !== false) {
    void persistLocale(locale);
  }
  for (const listener of [...listeners]) listener(locale);
}

/**
 * Boot-time apply: resolve from the saved preference / device / role and
 * switch **without** persisting, so a role default never overwrites an
 * explicit choice. Returns the locale it applied.
 */
export function applyResolvedLocale(input: LocaleResolution): Locale {
  const resolved = resolveInitialLocale(input);
  if (resolved !== currentLocale) setLocale(resolved, { persist: false });
  return resolved;
}

// ── Persistence (injected) ─────────────────────────────────────────────────

export interface LocaleStore {
  read(): Promise<string | null>;
  write(locale: Locale): Promise<void>;
}

let localeStore: LocaleStore | null = null;

/**
 * Wire AsyncStorage in from `i18n-preferences.ts`. Kept injectable so this
 * module has no React Native import and the persistence path is testable with
 * an in-memory fake.
 */
export function configureLocaleStore(store: LocaleStore | null): void {
  localeStore = store;
}

/** The saved preference, or `null` when unset/unreadable. */
export async function loadPersistedLocale(): Promise<string | null> {
  if (!localeStore) return null;
  try {
    return await localeStore.read();
  } catch {
    // A corrupt or unreadable preference falls back to the resolution order.
    return null;
  }
}

async function persistLocale(locale: Locale): Promise<void> {
  if (!localeStore) return;
  try {
    await localeStore.write(locale);
  } catch {
    // Never fatal — the in-memory switch already happened.
  }
}

// ── Plurals ────────────────────────────────────────────────────────────────

type PluralBases = {
  [K in TranslationKey as K extends `${infer Base}.one` ? Base : never]: true;
};

/** Only real `*.one` bases are accepted, so a typo here is a compile error. */
export type PluralKeyBase = keyof PluralBases;

/**
 * `pluralKey('offline.pending', 1)` → `'offline.pending.one'`.
 *
 * Hindi does not inflect nouns for number the way English does (`1 काम` and
 * `5 काम`), so the `.one`/`.other` pair usually differs only in English — but
 * keeping both means the pattern stays uniform and a future locale with real
 * plural rules needs no refactor. `i18n-parity.spec.ts` asserts every `.one`
 * has its `.other`.
 */
export function pluralKey<B extends PluralKeyBase>(
  base: B,
  count: number,
): Extract<TranslationKey, `${B & string}.one` | `${B & string}.other`> {
  const suffix = count === 1 ? 'one' : 'other';
  return `${String(base)}.${suffix}` as Extract<
    TranslationKey,
    `${B & string}.one` | `${B & string}.other`
  >;
}

// ── Keys whose two locales are intentionally identical ─────────────────────

/**
 * Strings that are *not* English copy and therefore must not be translated:
 * the brand, an acronym, a self-designation in its own script, a placeholder
 * email, and symbols. `i18n-parity.spec.ts` asserts that **every** key with
 * `hi === en` is listed here, so "forgot to translate this one" cannot hide
 * behind a legitimate invariant.
 */
export const LOCALE_INVARIANT_KEYS: readonly TranslationKey[] = [
  'nav.tab.sos',
  'login.brandMark',
  'login.brandName',
  'login.emailPlaceholder',
  'login.passwordPlaceholder',
  'login.crewPath.pin.padLabel',
  'settings.language.nameEn',
  'settings.language.nameHi',
  'settings.language.nameMr',
  'trip.emptyValue',
  'manifest.confirmBoard',
  'manifest.confirmDrop',
];

// ── Server error codes ─────────────────────────────────────────────────────

/**
 * The **known** error codes this app maps to its own copy.
 *
 * Verified against the server, not invented: `buildErrorEnvelope`
 * (`web/src/server/http/response-envelope.ts`) emits `HTTP_<status>` when the
 * exception body carries no `error`, `INTERNAL_SERVER_ERROR` for a
 * non-`HttpException`, and forwards a body's `error` string otherwise — the
 * two custom ones in the codebase are `RATE_LIMIT_EXCEEDED`
 * (`rate-limit.constants.ts`) and `SERVICE_NOT_READY` (`api/health.ts`).
 *
 * Anything else the server ever adds is *unknown* here and is handled by the
 * pass-through rule below — never by silently dropping the code.
 */
/**
 * The subset of keys that take **no** placeholders. The error-code map is typed
 * with it so `t(key)` stays fully checked at a runtime-resolved key — no cast,
 * and adding a parameterised key to the map below becomes a compile error.
 */
export type StaticTranslationKey = {
  [K in TranslationKey]: [ParamsFor<K>] extends [never] ? K : never;
}[TranslationKey];

export const KNOWN_ERROR_CODES: Record<string, StaticTranslationKey> = {
  HTTP_400: 'error.HTTP_400',
  HTTP_401: 'error.HTTP_401',
  HTTP_403: 'error.HTTP_403',
  HTTP_404: 'error.HTTP_404',
  HTTP_409: 'error.HTTP_409',
  HTTP_422: 'error.HTTP_422',
  HTTP_429: 'error.HTTP_429',
  HTTP_500: 'error.HTTP_500',
  HTTP_503: 'error.HTTP_503',
  INTERNAL_SERVER_ERROR: 'error.INTERNAL_SERVER_ERROR',
  RATE_LIMIT_EXCEEDED: 'error.RATE_LIMIT_EXCEEDED',
  SERVICE_NOT_READY: 'error.SERVICE_NOT_READY',
  /**
   * Crew mobile-login (Phase 4b). Four documented codes from
   * `web/src/server/modules/auth/auth.constants.ts`:
   *
   * - `CREW_PIN_LOCKED`     — school-wide lockout (HTTP 429). Has structured
   *                          `retry_after_seconds` and `remaining_attempts: 0`
   *                          in `error.details`; `localizeCrewLoginError`
   *                          surfaces them to the lockout countdown.
   * - `CREW_PIN_INVALID`    — wrong PIN, or a school with no matching crew PIN
   *                          (HTTP 401, generic message — see
   *                          `INVALID_CREW_CREDENTIALS_MESSAGE`).
   * - `CREW_PIN_AMBIGUOUS`  — the PIN matched more than one crew member at that
   *                          school (HTTP 401). Unreachable while
   *                          `setPin`'s uniqueness rule holds; it is an
   *                          admin-action message, not a credential hint.
   *
   * `localizeApiError` covers all three with the same fallback rule as the
   * other codes: known code → dictionary copy, unknown code → server message
   * + raw-code note.
   */
  CREW_PIN_LOCKED: 'error.CREW_PIN_LOCKED',
  CREW_PIN_INVALID: 'error.CREW_PIN_INVALID',
  CREW_PIN_AMBIGUOUS: 'error.CREW_PIN_AMBIGUOUS',
};

/**
 * Codes where the **server's own message is the contract** and must win over
 * the localised copy.
 *
 * `HTTP_403` is the documented case: the API only ever issues four 403s and
 * `docs/mobile-operations.md` → "403 Diagnosis (Server Taxonomy)" requires the
 * client to show the server's message verbatim and never mask a 403. The
 * localised string stays as the fallback for when the server sends none.
 */
export const SERVER_MESSAGE_WINS: ReadonlySet<string> = new Set(['HTTP_403']);

export function isKnownErrorCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && code in KNOWN_ERROR_CODES;
}

/**
 * Status → dictionary key, used when the envelope carried **no** code: the API
 * always sends one, but a proxy, a captive portal or a future endpoint may not,
 * and a bare status must still reach the crew as a sentence in their own
 * language rather than as a technical string.
 */
const STATUS_ERROR_KEYS: Readonly<Record<number, StaticTranslationKey>> = {
  400: 'error.HTTP_400',
  401: 'error.HTTP_401',
  403: 'error.HTTP_403',
  404: 'error.HTTP_404',
  409: 'error.HTTP_409',
  422: 'error.HTTP_422',
  429: 'error.HTTP_429',
  500: 'error.HTTP_500',
  503: 'error.HTTP_503',
};

/** The dictionary key for a status, or `null` when nothing maps. */
export function errorKeyForStatus(status: number | null | undefined): StaticTranslationKey | null {
  if (typeof status !== 'number') return null;
  if (STATUS_ERROR_KEYS[status]) return STATUS_ERROR_KEYS[status]!;
  // Every other 5xx shares the "server could not complete the request" copy.
  if (status >= 500) return 'error.HTTP_500';
  return null;
}

export interface LocalizedApiError {
  /** What the UI shows. */
  message: string;
  /**
   * A visible "Server code XYZ" note for an **unknown** code, so support can
   * be told the exact code. `null` when the code was understood (or absent).
   */
  codeNote: string | null;
  /** True when the copy came from the dictionary rather than the server. */
  localized: boolean;
}

/**
 * The server-string boundary, as a function.
 *
 * The server speaks English and Phase 3 is client-side only, so:
 *
 * - **known code** → the app's own localised copy (except `SERVER_MESSAGE_WINS`);
 * - **unknown code** → the server message **as-is**, plus a visible raw-code
 *   note. Never translated by guesswork, never hidden;
 * - **status 0** (no network) → the localised offline line, because there is no
 *   server message at all and the crew needs to know the action was saved;
 * - **no code, no usable message, but a status** → the locale's copy for that
 *   status, so a bare `403`/`500` still reads as a sentence;
 * - **nothing at all** → `common.error`.
 *
 * ### Technical messages are never "the server's message"
 *
 * A message that is a *diagnostic* — `Request failed with status 401`, an HTML
 * error page, a stack trace, a bare `Forbidden` reason phrase — is not a
 * server-string: it is transport noise. `isTechnicalMessage` classifies it,
 * the message is dropped, and the copy above takes over. This is what keeps
 * `Request failed with status 401` off a driver's screen even when the code is
 * unknown to the app (the "unknown code" branch used to pass it straight
 * through).
 */
export function localizeApiError(input: {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}): LocalizedApiError {
  const code = typeof input.code === 'string' && input.code.length > 0 ? input.code : null;
  const serverMessage =
    typeof input.message === 'string' &&
    input.message.trim().length > 0 &&
    !isTechnicalMessage(input.message)
      ? input.message.trim()
      : null;

  if (input.status === 0) {
    return { message: t('error.networkOffline'), codeNote: null, localized: true };
  }

  if (code && isKnownErrorCode(code)) {
    const key = KNOWN_ERROR_CODES[code]!;
    if (SERVER_MESSAGE_WINS.has(code) && serverMessage) {
      return { message: serverMessage, codeNote: null, localized: false };
    }
    return { message: t(key), codeNote: null, localized: true };
  }

  if (code) {
    if (serverMessage) {
      return {
        message: serverMessage,
        codeNote: `${t('error.unknownCodePrefix')} ${code}`,
        localized: false,
      };
    }
    // An unknown code with a diagnostic instead of a message: show the
    // locale's status copy and keep the code visible for support.
    const key = errorKeyForStatus(input.status) ?? 'common.error';
    return {
      message: t(key),
      codeNote: `${t('error.unknownCodePrefix')} ${code}`,
      localized: true,
    };
  }

  if (serverMessage) {
    return { message: serverMessage, codeNote: null, localized: false };
  }

  const key = errorKeyForStatus(input.status);
  return key
    ? { message: t(key), codeNote: null, localized: true }
    : { message: t('common.error'), codeNote: null, localized: false };
}

// ── Crew mobile-login error mapping (Phase 4b) ───────────────────────────

/**
 * Read `retry_after_seconds` from the server's structured `error.details`.
 *
 * The server puts this on every `CREW_PIN_LOCKED` envelope so the login
 * screen can show a live countdown instead of an opaque "wait a quarter of
 * an hour". Anything that is not a positive integer number of seconds is
 * treated as absent — the caller falls back to a static message and the
 * countdown stays hidden.
 */
export function readRetryAfterSeconds(details: unknown): number | null {
  if (!details || typeof details !== 'object') return null;
  const value = (details as Record<string, unknown>).retry_after_seconds;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.ceil(value);
}

/**
 * Outcome of mapping a `POST /auth/crew-login` error envelope to UI state.
 *
 * What the login screen needs to render:
 *
 * - `message`   — the line of copy to show, already localised (or the server
 *                 message verbatim when the code is unknown — never hidden);
 * - `codeNote`  — the "Server code XYZ" note for an unknown code, so support
 *                 can be told the exact code (`null` when the code was known);
 * - `lockedForSeconds` — non-null **only** when the server returned
 *                 `CREW_PIN_LOCKED` with a usable `retry_after_seconds`. The
 *                 login screen uses it to drive the lockout countdown; an
 *                 `error.CREW_PIN_LOCKED` with no structured detail still
 *                 gets the static message but no countdown (defensive — the
 *                 server contract is the source of truth, but never invent
 *                 a number the server did not send).
 */
export interface CrewLoginErrorPresentation {
  message: string;
  codeNote: string | null;
  lockedForSeconds: number | null;
}

export function localizeCrewLoginError(input: {
  code?: string | null;
  message?: string | null;
  status?: number | null;
  details?: unknown;
}): CrewLoginErrorPresentation {
  const localized = localizeApiError(input);
  let lockedForSeconds: number | null = null;
  const code = typeof input.code === 'string' && input.code.length > 0 ? input.code : null;
  if (code === 'CREW_PIN_LOCKED') {
    lockedForSeconds = readRetryAfterSeconds(input.details);
  }
  return {
    message: localized.message,
    codeNote: localized.codeNote,
    lockedForSeconds,
  };
}
