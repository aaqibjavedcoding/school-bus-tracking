/**
 * Per-field validation display — the single place a rejected form turns into
 * guidance a person can act on.
 *
 * ### The problem this solves
 *
 * Both halves of the validation contract speak in *field* terms, but the UI
 * used to show them as one undifferentiated line:
 *
 * - the API's `ValidationPipe` answers a 400 with a **flat array** of friendly
 *   sentences (`{ message: ["Please enter a value for the registration
 *   number.", …] }`) — friendly, but never placed under the input it belongs to;
 * - the shared Zod schemas the forms validate with first speak in **DTO
 *   language** (`'date cannot be empty'`, `must be a valid ISO-8601 date
 *   (YYYY-MM-DD) or date-time`, `capacity must be >= 1`). Rendering that text is
 *   how a form ended up showing a user the name of a database column.
 *
 * ### The rule
 *
 * **A field error always names the field in human words, and no raw DTO or
 * UUID text is ever rendered.** Attribution is by label: the registry below is
 * the one list of "which DTO property is which input" every form shares, so a
 * message can be placed under its input and rewritten when it is not already
 * guidance. Anything that belongs to no field of this form goes to the
 * form-level line — it is never dropped and never guessed at.
 *
 * Pure module: no React, no DOM, no API client — testable under `node --test`.
 */

/** A form field's human words, e.g. `registration_number` → `registration number`. */
export type FieldLabelMap = Record<string, string>;

/**
 * The field registry for every web form.
 *
 * Keys are the DTO/`_request` property names the forms already use to address
 * their inputs (`fieldErrors.capacity`, `fieldErrors['school.name']`), so a
 * page never has to translate between its form state and this map. Values are
 * lowercase human labels, sentence-ready after the first word is capitalised.
 */
export const FIELD_LABELS: FieldLabelMap = {
  // School / tenant
  name: 'name',
  code: 'code',
  subdomain: 'subdomain',
  timezone: 'time zone',
  email: 'email address',
  phone: 'phone number',
  address_line1: 'address line 1',
  address_line2: 'address line 2',
  city: 'city',
  state: 'state',
  postal_code: 'postal code',
  country: 'country',
  school_id: 'school code',
  // People
  first_name: 'first name',
  last_name: 'last name',
  password: 'password',
  confirm_password: 'password confirmation',
  current_password: 'current password',
  new_password: 'new password',
  pin: 'PIN',
  role: 'role',
  gender: 'gender',
  date_of_birth: 'date of birth',
  emergency_contact_name: 'emergency contact name',
  emergency_contact_phone: 'emergency contact phone',
  medical_notes: 'medical notes',
  admission_number: 'admission number',
  grade_level: 'grade level',
  section: 'section',
  relationship: 'relationship',
  parent_id: 'parent',
  user_id: 'person',
  is_active: 'active status',
  status: 'status',
  // Fleet
  registration_number: 'registration number',
  bus_number: 'bus number',
  capacity: 'capacity',
  bus_id: 'bus',
  driver_id: 'driver',
  conductor_id: 'conductor',
  // Routes, stops, runs, shifts
  route_id: 'route',
  route_assignment_id: 'route assignment',
  run_id: 'run',
  shift_id: 'shift',
  stop_id: 'stop',
  home_stop_id: 'home stop',
  description: 'description',
  latitude: 'latitude',
  longitude: 'longitude',
  geofence_radius_meters: 'geofence radius in metres',
  start_time: 'start time',
  end_time: 'end time',
  effective_from: 'effective from date',
  effective_to: 'effective to date',
  // Trips
  scheduled_start_at: 'scheduled start',
  scheduled_end_at: 'scheduled end',
  estimated_arrival_time: 'estimated arrival time',
  date: 'date',
  cancellation_reason: 'cancellation reason',
  // Documents
  document_type: 'document type',
  document_number: 'document number',
  issue_date: 'issue date',
  expiry_date: 'expiry date',
  notes: 'notes',
  file_name: 'file name',
  file_url: 'file link',
  owner_type: 'document owner',
  // Subscriptions / plans
  plan_id: 'plan',
  price: 'price',
  currency: 'currency',
  billing_period: 'billing period',
  trial_start: 'trial start date',
  trial_end: 'trial end date',
  current_period_start: 'current period start',
  current_period_end: 'current period end',
  features: 'features',
  limits: 'limits',
  // Admin — nested object paths the forms address with dots
  'school.name': 'school name',
  'school.code': 'school code',
  'school.email': 'email address',
  'school.phone': 'phone number',
  'school.city': 'city',
  'school.state': 'state',
  'school.address_line1': 'address line 1',
  'school.address_line2': 'address line 2',
  'school.postal_code': 'postal code',
  'school.country': 'country',
  'school.timezone': 'time zone',
  'admin.first_name': 'first name',
  'admin.last_name': 'last name',
  'admin.email': 'email address',
  'admin.phone': 'phone number',
  'admin.password': 'password',
};

/**
 * Fallback label for a field the registry does not know (`bus_id` → `bus id`).
 *
 * Better than nothing, and never a raw DTO name: the underscores are gone and
 * the sentence below still names the field.
 */
export function labelForField(field: string, labels: FieldLabelMap = FIELD_LABELS): string {
  const known = labels[field];
  if (known) return known;
  const last = field.includes('.') ? (field.split('.').pop() as string) : field;
  return last.replace(/_/g, ' ').toLowerCase();
}

/** Capitalises the first word so a label can open a sentence. */
function sentence(label: string): string {
  return label.length === 0 ? label : label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Text that must never reach a screen: DTO property names, identifiers,
 * framework jargon, markup, or a bare HTTP reason phrase.
 */
const RAW_TEXT_PATTERNS: RegExp[] = [
  // `registration_number should not be empty` — a property name followed by a
  // validator verb is class-validator/Zod speaking to a developer.
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b\s+(should|must|is|are)\b/,
  // any lingering snake_case identifier
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/,
  // UUIDs and object ids
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\b[0-9a-f]{24}\b/i,
  // serialised payloads and schema jargon
  /^\s*[{[]/,
  /<!doctype|<html|&lt;/i,
  /\bISO-?\s?8601\b/i,
  /\bdate-?time\b/i,
  /\bNaN\b/,
  /\bnull\b|\bundefined\b/,
  /\benum\b/i,
  /\bexpected .+, received\b/i,
  // Zod's own sentence stems: they name a type, never a field.
  /^\s*(string|number|boolean|array|object|date|nan|received|expected|invalid input|invalid date|required)\b/i,
  /\bcharacter\(s\)/i,
  /\bmust contain at least\b|\bmust contain at most\b/i,
  /\btoo_big\b|\btoo_small\b|\binvalid_type\b|\bunrecognized_keys\b/,
  /\bmust be one of\b/i,
  /\bstatus (?:code\s*)?[1-5]\d\d\b/i,
  /\brequest failed\b/i,
  // A validator default opens with the lower-case property name
  // (`capacity must be an integer number`); guidance never does.
  /^[a-z]/,
  /\bat\s+[\w$.]+\s*\(/, // a stack frame
];

/** True when a message is developer text rather than something to show a user. */
export function isRawValidationText(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const text = value.trim();
  if (text.length === 0) return true;
  return RAW_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * True when a server sentence is already guidance: it is plain prose, it is not
 * developer text, and it is short enough to be a message rather than a payload.
 */
export function isHumanGuidance(value: unknown): boolean {
  if (isRawValidationText(value)) return false;
  const text = (value as string).trim();
  if (text.length > 400) return false;
  return /^[A-Z"'“]/.test(text) || /^please\b/i.test(text);
}

/**
 * A friendly, field-naming sentence for one kind of problem.
 *
 * Kept here (rather than inline in each form) so the web console and every page
 * say the same thing for the same failure.
 */
export function guidanceFor(label: string, kind: GuidanceKind): string {
  const name = sentence(label);
  switch (kind) {
    case 'required':
      return `Please enter the ${label}.`;
    case 'tooShort':
      return `Please enter a longer ${label}.`;
    case 'tooLong':
      return `Please keep the ${label} shorter.`;
    case 'number':
      return `Please enter a number for the ${label}.`;
    case 'integer':
      return `Please enter a whole number for the ${label}.`;
    case 'min':
      return `Please enter a larger value for the ${label}.`;
    case 'max':
      return `Please enter a smaller value for the ${label}.`;
    case 'date':
      return `Please enter the ${label} as a real date, for example 2026-04-01.`;
    case 'time':
      return `Please enter the ${label} as a time, for example 07:30.`;
    case 'email':
      return `Please enter a valid ${label}, for example name@school.edu.`;
    case 'url':
      return `Please enter the ${label} as a full web link starting with https://.`;
    case 'choice':
      return `Please choose one of the listed options for the ${label}.`;
    case 'boolean':
      return `Please choose yes or no for the ${label}.`;
    case 'after':
      return `Please enter a ${label} that comes after the other date.`;
    case 'before':
      return `Please enter a ${label} that comes before the other date.`;
    case 'taken':
      return `${name} is already in use. Please use another one.`;
    case 'format':
      return `Please check the format of the ${label}.`;
    case 'invalid':
    default:
      return `Please check the ${label} and try again.`;
  }
}

export type GuidanceKind =
  | 'required'
  | 'tooShort'
  | 'tooLong'
  | 'number'
  | 'integer'
  | 'min'
  | 'max'
  | 'date'
  | 'time'
  | 'email'
  | 'url'
  | 'choice'
  | 'boolean'
  | 'after'
  | 'before'
  | 'taken'
  | 'format'
  | 'invalid';

/**
 * Classifies a raw validator message. Ordered from the most specific pattern to
 * the least, so `must be a valid ISO-8601 date` never reads as "required".
 */
const KIND_PATTERNS: ReadonlyArray<readonly [GuidanceKind, RegExp]> = [
  ['required', /(^|\b)(required|cannot be empty|should not be empty|must not be empty|is empty|entered|be entered)\b/i],
  ['date', /\b(iso-?8601|invalid date|date-time|valid date|calendar date)\b/i],
  ['time', /\b(invalid time|hh:mm|time of day)\b/i],
  ['email', /\b(email|e-mail)\b/i],
  ['url', /\b(url|uri|web link|https?:\/\/)\b/i],
  ['integer', /\b(integer|whole number)\b/i],
  ['number', /\b(number|numeric|nan)\b/i],
  ['boolean', /\b(boolean|true or false|yes or no)\b/i],
  ['choice', /\b(one of|enum|not in list|invalid option|unrecognized key)\b/i],
  ['tooShort', /\b(at least \d+ character|min length|too small|must contain at least)\b/i],
  ['tooLong', /\b(at most \d+ character|max length|too long|must contain at most)\b/i],
  ['min', /\b(greater than or equal|at least|minimum|must be >?= ?)/i],
  ['max', /\b(less than or equal|at most|maximum|must be <=? ?)/i],
  ['after', /\b(after|later than|must be greater than)\b/i],
  ['before', /\b(before|earlier than|must be less than)\b/i],
  ['taken', /\b(already (exists|in use|taken)|duplicate|unique)\b/i],
  ['format', /\b(format|pattern|match|invalid)\b/i],
];

/** The kind of problem a raw validator message describes. */
export function classifyValidationMessage(raw: string): GuidanceKind {
  const text = raw.trim();
  if (text.length === 0) return 'invalid';
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return 'invalid';
}

/** True when a sentence already mentions this field, in words a person reads. */
function namesLabel(text: string, field: string, label: string): string {
  const haystack = text.toLowerCase();
  const words = label.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  if (words.some((word) => haystack.includes(word))) return text;
  if (haystack.includes(field.replace(/_/g, ' ').toLowerCase())) return text;
  // Guidance that names no field is still guidance — prefix it so the user can
  // tell which input it belongs to.
  return `${sentence(label)}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/**
 * One field's error, always as guidance that names the field.
 *
 * A message that is already human (the API's friendly DTO sentences) is kept
 * verbatim — the server owns the business rule and its wording is better than
 * anything invented here — and prefixed with the field name when the sentence
 * itself does not mention it. Anything else (Zod jargon, a property name, a
 * UUID) is classified and rewritten.
 */
export function fieldErrorMessage(
  field: string,
  raw: unknown,
  labels: FieldLabelMap = FIELD_LABELS,
): string {
  const label = labelForField(field, labels);
  if (typeof raw === 'string' && isHumanGuidance(raw)) {
    return namesLabel(raw.trim(), field, label);
  }
  if (typeof raw !== 'string') return guidanceFor(label, 'invalid');
  return guidanceFor(label, classifyValidationMessage(raw));
}

/** Reads a message (or array of them) out of a nested validation payload. */
function messageList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => messageList(item));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: string[] = [];
    for (const key of ['message', 'messages', 'details']) {
      if (record[key] !== undefined) out.push(...messageList(record[key]));
    }
    return out;
  }
  return [];
}

/**
 * The sentences of a rejected form, keyed by the input they belong to.
 *
 * A match needs **word boundaries** (so `bus` never fires inside `bus_number`)
 * and the label must be multi-word or at least six characters when the whole
 * registry is in play — a global `run`/`name`/`date` label would otherwise
 * capture unrelated prose ("The default run cannot be retired"). A form that
 * passes its own map is authoritative: `name` means its own name field.
 */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `needle` occurs in `text` as a whole word or phrase. */
function includesPhrase(text: string, needle: string): boolean {
  if (needle.length === 0) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeForRegExp(needle)}([^a-z0-9]|$)`, 'i').test(text);
}

/**
 * The registry minus the labels too generic to attribute safely: single words
 * under six characters (`run`, `date`, `code`, `name`, `city`) name half the
 * sentences a server writes.
 */
const GLOBAL_ATTRIBUTION_LABELS: FieldLabelMap = Object.fromEntries(
  Object.entries(FIELD_LABELS).filter(
    ([, label]) => label.includes(' ') || label.trim().length >= 6,
  ),
);

/** The field a sentence is about, by the label or property it names. */
export function attributeMessageToField(
  message: string,
  labels: FieldLabelMap = GLOBAL_ATTRIBUTION_LABELS,
): string | null {
  let best: string | null = null;
  let bestLength = 0;
  for (const [field, label] of Object.entries(labels)) {
    const needles = [label.toLowerCase(), field.toLowerCase(), field.replace(/_/g, ' ')];
    for (const needle of needles) {
      if (needle.length < 3) continue;
      if (needle.length > bestLength && includesPhrase(message, needle)) {
        best = field;
        bestLength = needle.length;
      }
    }
  }
  return best;
}

/**
 * The label map of ONE form: only the fields it actually renders.
 *
 * Attribution is what places a sentence under an input, so a form must describe
 * itself — a `name` field on the routes screen means "route name", and a
 * message about the school name must not light that input up. Passing only this
 * form's fields makes an unrendered field's message fall to the form-level line
 * instead of vanishing into a key no input reads.
 */
export function pickFieldLabels(
  fields: readonly string[],
  labels: FieldLabelMap = FIELD_LABELS,
): FieldLabelMap {
  const picked: FieldLabelMap = {};
  for (const field of fields) {
    picked[field] = labels[field] ?? labelForField(field, labels);
  }
  return picked;
}

/** What a rejected form needs: per-field errors, plus what is left over. */
export interface FieldErrorMapping {
  fieldErrors: Record<string, string>;
  formErrors: string[];
}

/** The API's `error` object, whether the body nests it or not. */
function errorObject(details: unknown): Record<string, unknown> | null {
  if (!details || typeof details !== 'object') return null;
  const record = details as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === 'object') return nested as Record<string, unknown>;
  return record;
}

/**
 * Maps an API error onto this app's form fields.
 *
 * Handles both shapes the API produces:
 *
 * - a **per-field map** (`error.details = { capacity: '…' }`) — the key already
 *   names the field, so only the text is sanitised;
 * - a **flat `message` array** (`{ message: ['Please enter a value for the
 *   registration number.', …] }`) — each sentence is attributed to the field
 *   whose label it names, and anything unattributed becomes a form-level line.
 *
 * Business rejections (409 duplicates, plan limits) flow through the same
 * attribution: "A bus with this registration number already exists." lands on
 * `registration_number`, which is exactly where the user has to fix it.
 */
export function mapApiValidationErrors(
  error: unknown,
  labels: FieldLabelMap = GLOBAL_ATTRIBUTION_LABELS,
): FieldErrorMapping {
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];
  const candidate = error as { details?: unknown; message?: unknown } | null;
  if (!candidate || typeof candidate !== 'object') return { fieldErrors, formErrors };

  const envelope = errorObject(candidate.details) ?? {};
  const perField = envelope.details;

  // 1. A real per-field map wins: the server already did the attribution.
  if (perField && typeof perField === 'object' && !Array.isArray(perField)) {
    for (const [key, value] of Object.entries(perField as Record<string, unknown>)) {
      const messages = messageList(value);
      if (messages.length === 0) continue;
      const message = fieldErrorMessage(key, messages[0], labels);
      if (!fieldErrors[key]) fieldErrors[key] = message;
    }
  }

  // 2. Every remaining sentence — including the flat array the ValidationPipe
  //    produces — is attributed by label.
  const flat = [
    ...messageList(envelope.message),
    ...(Array.isArray(candidate.message) ? messageList(candidate.message) : []),
  ];
  for (const message of flat) {
    const field = attributeMessageToField(message, labels);
    if (field) {
      if (!fieldErrors[field]) fieldErrors[field] = fieldErrorMessage(field, message, labels);
      continue;
    }
    if (isHumanGuidance(message)) {
      const trimmed = message.trim();
      if (!formErrors.includes(trimmed)) formErrors.push(trimmed);
    }
  }

  return { fieldErrors, formErrors };
}

/**
 * The one sentence shown above a form when at least one field is highlighted.
 *
 * Forms previously showed the API's joined sentences in a toast *and* nothing
 * under the inputs; now the inputs carry the detail and the form line says what
 * to do next.
 */
export const FIX_HIGHLIGHTED_FIELDS = 'Please fix the highlighted fields and try again.';

/**
 * The form-level line for a rejected submission: the mapped leftover messages,
 * or the one generic instruction when every message landed on a field.
 */
export function formMessageForInvalidSubmission(mapping: FieldErrorMapping): string {
  return mapping.formErrors.length > 0 ? mapping.formErrors.join(' ') : FIX_HIGHLIGHTED_FIELDS;
}
