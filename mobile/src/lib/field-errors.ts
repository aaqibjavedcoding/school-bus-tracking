import { isTechnicalMessage } from './error-messages.ts';

/**
 * Turning a validation failure into **guidance under the right input**.
 *
 * The reported bug on mobile was the same as on the web console: a rejected form
 * printed whatever the API or the schema happened to say — `email must be an
 * email`, `admin.last_name should not be empty`, a UUID, `Invalid input` —
 * sometimes as a toast, sometimes as nothing at all, because the flat message
 * array the API returns was not read by a helper that only understands a
 * per-field map.
 *
 * This module is the mobile port of `web/src/lib/field-errors.ts` and keeps the
 * same three rules, so both apps say the same thing for the same failure:
 *
 * 1. **A message is attributed, never dumped.** The API's `message` may be a
 *    flat array of friendly sentences and the envelope may also carry a
 *    `{ field: message }` map; both end up keyed by the form's own field name.
 *    Attribution is by the *words* of the sentence, so the field a screen labels
 *    `pickup_time` and the DTO key the message names have to be reconciled by
 *    a label the caller passes in.
 * 2. **Developer text is never rendered.** A message that is a property name
 *    with a validator verb, a UUID, a JSON fragment or a schema phrase is
 *    rewritten into a sentence ("Please enter a valid email address.") rather
 *    than shown — and `error-messages.ts` still classifies it as technical on
 *    top of that.
 * 3. **Anything that cannot be attributed becomes a form-level line**, so no
 *    guidance is lost; when everything did land on an input, the line becomes the
 *    "fix the highlighted fields" sentence.
 *
 * Pure and React-free (only `error-messages.ts`, itself pure), so
 * `node --experimental-strip-types --test` pins the whole thing.
 */

/** `form field -> the words this form calls it by`. */
export type FieldLabelMap = Record<string, string>;

/**
 * The property names mobile's forms send, and the label the input above them
 * actually shows. Kept to the DTO keys the mobile screens use; an unknown key
 * falls back to a de-uglified version of itself.
 */
export const MOBILE_FIELD_LABELS: FieldLabelMap = {
  email: 'email address',
  password: 'password',
  new_password: 'new password',
  confirm_password: 'confirm password',
  current_password: 'current password',
  pin: 'PIN',
  otp: 'OTP',
  school_code: 'school code',
  school_id: 'school code',
  first_name: 'first name',
  last_name: 'last name',
  name: 'name',
  phone: 'phone number',
  mobile_number: 'mobile number',
  alt_phone: 'alternate phone number',
  gender: 'gender',
  date_of_birth: 'date of birth',
  blood_group: 'blood group',
  address: 'address',
  admission_number: 'admission number',
  roll_number: 'roll number',
  class: 'class',
  section: 'section',
  student_ids: 'students',
  guardian_ids: 'guardians',
  relationship: 'relationship',
  vehicle_number: 'vehicle number',
  registration_number: 'registration number',
  bus_number: 'bus number',
  plate_number: 'plate number',
  capacity: 'capacity',
  capacity_per_trip: 'capacity per trip',
  gps_device_id: 'GPS device ID',
  license_number: 'licence number',
  licence_number: 'licence number',
  license_expiry: 'licence expiry date',
  route_id: 'route',
  route_name: 'route name',
  stop_id: 'stop',
  driver_id: 'driver',
  conductor_id: 'conductor',
  staff_id: 'staff member',
  student_id: 'student',
  trip_date: 'trip date',
  start_time: 'start time',
  end_time: 'end time',
  pickup_time: 'pickup time',
  drop_time: 'drop time',
  departure_time: 'departure time',
  arrival_time: 'arrival time',
  latitude: 'latitude',
  longitude: 'longitude',
  geofence_radius_meters: 'stop radius',
  sequence_number: 'stop order',
  document_type: 'document type',
  document_number: 'document number',
  issue_date: 'issue date',
  expiry_date: 'expiry date',
  valid_till: 'validity date',
  file_name: 'file name',
  file_url: 'file link',
  file_size: 'file size',
  mime_type: 'file type',
  notes: 'notes',
  reason: 'reason',
  description: 'description',
  code: 'code',
  amount: 'amount',
  status: 'status',
  shift_id: 'shift',
  is_active: 'active status',
  mark: 'mark',
};

/** The label to use for a field, defaulting to a readable version of its key. */
export function labelForField(field: string, labels: FieldLabelMap = MOBILE_FIELD_LABELS): string {
  const known = labels[field];
  if (known) return known;
  const last = field.includes('.') ? (field.split('.').pop() as string) : field;
  return last.replace(/_/g, ' ').toLowerCase();
}

function sentence(label: string): string {
  return label.length === 0 ? label : label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Text that must never reach a screen: DTO property names, identifiers, schema
 * jargon, markup, a bare HTTP reason phrase — or any sentence that opens
 * lower-case, which is how a validator always talks.
 */
const RAW_TEXT_PATTERNS: RegExp[] = [
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b\s+(should|must|is|are)\b/,
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\b[0-9a-f]{24}\b/i,
  /^\s*[{[]/,
  /<!doctype|<html|&lt;/i,
  /\bISO-?\s?8601\b/i,
  /\bdate-?time\b/i,
  /\bNaN\b/,
  /\bnull\b|\bundefined\b/,
  /\benum\b/i,
  /\bexpected .+, received\b/i,
  /^\s*(string|number|boolean|array|object|date|nan|received|expected|invalid input|invalid date|required)\b/i,
  /\bcharacter\(s\)/i,
  /\bmust contain at least\b|\bmust contain at most\b/i,
  /\btoo_big\b|\btoo_small\b|\binvalid_type\b|\bunrecognized_keys\b/,
  /\bmust be one of\b/i,
  /\bstatus (?:code\s*)?[1-5]\d\d\b/i,
  /\brequest failed\b/i,
  /^[a-z]/,
  /\bat\s+[\w$.]+\s*\(/,
];

/** True for developer text rather than something to show a user. */
export function isRawValidationText(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const text = value.trim();
  if (text.length === 0) return true;
  // Mobile keeps its own stricter classifier too: a technical message is
  // technical whatever the pattern list below happens to miss.
  if (isTechnicalMessage(text)) return true;
  return RAW_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

/** True when a server sentence is already user-facing guidance. */
export function isHumanGuidance(value: unknown): boolean {
  if (isRawValidationText(value)) return false;
  const text = (value as string).trim();
  if (text.length > 400) return false;
  return /^[A-Z"'“]/.test(text) || /^please\b/i.test(text);
}

/** What kind of problem a message is describing. */
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

const KIND_PATTERNS: Array<[GuidanceKind, RegExp]> = [
  ['required', /\b(is|be) (empty|required|missing)\b|\bcannot be empty\b|\bno se\b|\brequired\b/i],
  ['tooShort', /\btoo short\b|\bat least (\d+) characters?\b|\bminimum( of)? (\d+) char/i],
  ['tooLong', /\btoo long\b|\bat most (\d+) characters?\b|\bmaximum( of)? (\d+) char/i],
  ['integer', /\binteger\b|\bwhole number\b/i],
  ['number', /\bnumber\b(?! of)|\bnumeric\b|\bmust be a number\b/i],
  ['min', /\btoo small\b|\bmust be (>=|greater than|at least)\b|\bminimum\b/i],
  ['max', /\btoo big\b|\bmust be (<=|less than|at most)\b|\bmaximum\b/i],
  ['after', /\bafter\b|\blater than\b|\bmust be greater than\b.*date/i],
  ['before', /\bbefore\b|\bearlier than\b|\bmust be less than\b.*date/i],
  ['date', /\bdate\b|\bISO\b|\bcalendar\b/i],
  ['time', /\btime\b|\bHH:MM\b/i],
  ['email', /\bemail\b|\be-mail\b/i],
  ['url', /\burl\b|\blink\b|\buri\b/i],
  ['choice', /\bone of\b|\bnot in\b|\boption\b/i],
  ['boolean', /\btrue or false\b|\byes or no\b/i],
  ['taken', /\balready (exists|in use|taken)\b|\bduplicate\b|\btaken\b/i],
  ['format', /\bformat\b|\binvalid pattern\b|\bmatch\b/i],
];

/** Classifies a message so the app can answer it with the right sentence. */
export function classifyValidationMessage(raw: string): GuidanceKind {
  const text = raw.toLowerCase();
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return 'invalid';
}

/** The sentence this app shows for one kind of problem on one field. */
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

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary containment, so `date` cannot match inside `it updated`. */
function includesPhrase(text: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`\\b${escapeForRegExp(needle)}\\b`, 'i').test(text);
}

/**
 * Which input a server sentence belongs to.
 *
 * Longest needle wins: a message about the "expiry date" also contains the word
 * "date", and the input it must land under is the expiry one.
 */
export function attributeMessageToField(
  message: string,
  fields: string[],
  labels: FieldLabelMap = MOBILE_FIELD_LABELS,
): string | null {
  let best: { field: string; length: number } | null = null;
  for (const field of fields) {
    const label = labels[field] ?? labelForField(field, labels);
    const needles = [label, field, field.replace(/_/g, ' '), field.split('.').pop() ?? field];
    for (const needle of needles) {
      if (needle.length < 3) continue;
      if (needle.length > (best?.length ?? 0) && includesPhrase(message, needle)) {
        best = { field, length: needle.length };
        break;
      }
    }
  }
  return best ? best.field : null;
}

/**
 * The line to show for one issue on one field: the server's own sentence when
 * it is guidance that names the field, an app-written one otherwise.
 */
export function fieldErrorMessage(
  raw: string,
  field: string,
  labels: FieldLabelMap = MOBILE_FIELD_LABELS,
): string {
  const label = labelForField(field, labels);
  if (isRawValidationText(raw)) return guidanceFor(label, classifyValidationMessage(raw));
  const text = raw.trim();
  if (!isHumanGuidance(text)) return guidanceFor(label, classifyValidationMessage(text));
  if (includesPhrase(text, label) || includesPhrase(text, field.replace(/_/g, ' '))) return text;
  // Guidance that names nothing ("This is required.") is still worth showing, but
  // under an input it has to say what it is about.
  return `${sentence(label)}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** A form's own labels, so a screen states what its inputs are called. */
export function pickFieldLabels(
  fields: readonly string[],
  labels: FieldLabelMap = MOBILE_FIELD_LABELS,
): FieldLabelMap {
  const picked: FieldLabelMap = {};
  for (const field of fields) {
    picked[field] = labels[field] ?? labelForField(field, labels);
  }
  return picked;
}

export interface FieldErrorMapping {
  /** `field -> guidance to render under that input`. */
  fieldErrors: Record<string, string>;
  /** Sentences that belong to no single input. */
  formErrors: string[];
}

function messageList(value: unknown): string[] {
  if (typeof value === 'string') return value.length > 0 ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  return [];
}

function errorObject(details: unknown): Record<string, unknown> | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  return details as Record<string, unknown>;
}

/**
 * Maps an API validation failure onto a screen's fields.
 *
 * Handles both shapes the backend produces: the per-field map
 * (`error.details[field]`) and the flat friendly-message array the validation
 * pipe throws (`error.message: string[]`). A field already present in the map
 * wins over a sentence that merely mentions it, so no message is shown twice.
 */
export function mapApiValidationErrors(
  error: unknown,
  fields: string[] | FieldLabelMap = Object.keys(MOBILE_FIELD_LABELS),
): FieldErrorMapping {
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];
  const candidate = error as { details?: unknown; message?: unknown } | null;
  if (!candidate || typeof candidate !== 'object') return { fieldErrors, formErrors };

  const labels = Array.isArray(fields) ? pickFieldLabels(fields) : fields;
  const fieldNames = new Set(Object.keys(labels));
  const envelope = errorObject(candidate.details) ?? {};
  const nested = errorObject(envelope.error) ?? envelope;

  // 1. A real per-field map wins: the server already did the attribution.
  const perField = errorObject(nested.details);
  if (perField) {
    for (const [key, value] of Object.entries(perField)) {
      const messages = messageList(value);
      if (messages.length === 0 || !fieldNames.has(key)) continue;
      const message = fieldErrorMessage(messages[0], key, labels);
      if (!fieldErrors[key]) fieldErrors[key] = message;
    }
  }

  // 2. Every remaining sentence — including the flat array the ValidationPipe
  //    produces — is attributed by label. A sentence no input owns is kept as a
  //    form-level line, but only when it is guidance: raw schema text has already
  //    been consumed (or dropped) by step 1 and must not reappear above the form.
  const flat = [
    ...messageList(nested.message),
    ...(Array.isArray(candidate.message) ? messageList(candidate.message) : []),
  ];
  for (const message of flat) {
    const field = attributeMessageToField(message, Object.keys(labels), labels);
    if (field) {
      if (!fieldErrors[field]) fieldErrors[field] = fieldErrorMessage(message, field, labels);
      continue;
    }
    if (isHumanGuidance(message)) {
      const trimmed = message.trim();
      if (!formErrors.includes(trimmed)) formErrors.push(trimmed);
    }
  }

  return { fieldErrors, formErrors };
}

/** The one sentence every form shows when each problem found its input. */
export const FIX_HIGHLIGHTED_FIELDS = 'Please fix the highlighted fields and try again.';

/** What to put in a form's own error line, given a mapping. */
export function formMessageForInvalidSubmission(mapping: FieldErrorMapping): string {
  if (mapping.formErrors.length > 0) return mapping.formErrors.join(' ');
  return Object.keys(mapping.fieldErrors).length > 0 ? FIX_HIGHLIGHTED_FIELDS : '';
}
