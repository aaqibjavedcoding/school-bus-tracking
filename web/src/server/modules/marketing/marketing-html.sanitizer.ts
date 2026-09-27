/**
 * Whitelist-based HTML validation + sanitization for marketing email
 * templates.
 *
 * ### Why a tokenizer, never regexes
 *
 * "Strip `<script>` with a regex" is the classic sanitizer bug: HTML is not a
 * regular language, and every regex-only filter has been bypassed by
 * `<scr<script>ipt>`, entity-encoded schemes (`jav&#x09;ascript:`), half-open
 * tags and comment tricks. This module walks the input **character by
 * character** and rebuilds the document from scratch, emitting only tags and
 * attributes an explicit allowlist names. Anything the parser is unsure about
 * becomes inert text.
 *
 * Two outcomes, used together (validate **and** sanitize):
 *
 * - `violations` — constructs that are **rejected** by the API: `<script>`,
 *   `<iframe>`, `<form>` (and the other executable/embedding elements), any
 *   `on*` event-handler attribute, and any URL whose scheme is not on the
 *   allowlist (`javascript:`, `data:`, `vbscript:`, …). A template whose HTML
 *   produces violations is not saved at all — silent stripping would teach
 *   template authors that dangerous markup "sometimes works".
 * - `html` — the rebuilt document: only allowlisted tags, only allowlisted
 *   attributes, all text entity-escaped, comments/doctypes dropped, unknown
 *   (benign) tags unwrapped to their text content.
 *
 * The sanitizer is deliberately total: it never throws on malformed input —
 * malformed markup can only produce text or rejected violations, never
 * executable output. It is pure (no I/O) so its behaviour is fully pinned by
 * unit tests.
 */

/** Result of running the sanitizer. */
export interface MarketingHtmlSanitizationResult {
  /** Rebuilt, allowlisted document. Only meaningful when `violations` is empty. */
  html: string;
  /** Rejected constructs (bounded list). Non-empty ⇒ the save must fail. */
  violations: string[];
}

/** Tags whose presence is a validation failure, not just a strip. */
const FORBIDDEN_TAGS = new Set([
  // Script execution / embedding.
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  // Document-level injection surfaces.
  'style',
  'link',
  'meta',
  'base',
  'title',
  'head',
  'body',
  'html',
  // Form hijacking (the unsubscribe link must stay the platform's own).
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'option',
  'optgroup',
  'datalist',
  'label',
  'fieldset',
  'legend',
  // Foreign content parses with different rules — never allow it through.
  'svg',
  'math',
  // Template/script-holding elements.
  'template',
  'noscript',
  'slot',
  'canvas',
]);

/** Tags the sanitizer may emit. Everything else is unwrapped to text. */
const ALLOWED_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'caption',
  'center',
  'code',
  'col',
  'colgroup',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'font',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

/** Void elements: emitted without a closing tag. */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);

// `img` is allowed even though every other non-void tag needs content.
ALLOWED_TAGS.add('img');

/**
 * Attributes accepted per allowed tag. `class` is accepted on every allowed
 * tag. Anything else is dropped (silently — dropping is the *sanitizing* half;
 * the rejecting half is the `on*` / unsafe-URL checks below).
 */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target']),
  img: new Set(['src', 'alt', 'width', 'height']),
  font: new Set(['color', 'face', 'size']),
  ol: new Set(['start', 'type']),
  table: new Set(['align', 'border', 'cellpadding', 'cellspacing', 'width', 'bgcolor']),
  tr: new Set(['bgcolor']),
  td: new Set(['colspan', 'rowspan', 'align', 'valign', 'width', 'bgcolor']),
  th: new Set(['colspan', 'rowspan', 'align', 'valign', 'width', 'bgcolor']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  hr: new Set(['width', 'size']),
};

/** Attributes whose value is a URL and must pass the scheme allowlist. */
const URL_ATTRIBUTES = new Set(['href', 'src']);

/** Schemes a link (`href`) may use. */
const HREF_SCHEMES = ['http', 'https', 'mailto', 'tel'];

/** Schemes an image (`src`) may use. */
const SRC_SCHEMES = ['http', 'https'];

/** Cap on reported violations so a hostile body cannot bloat the error. */
const MAX_VIOLATIONS = 10;

/** One parsed start/end tag. */
interface TagToken {
  kind: 'tag';
  name: string;
  closing: boolean;
  selfClosing: boolean;
  /** `true` when the tag contained `<` inside an attribute name (smuggling). */
  malformed: boolean;
  attributes: Array<{ name: string; value: string }>;
}

/** One run of character data. */
interface TextToken {
  kind: 'text';
  text: string;
}

type Token = TagToken | TextToken;

/**
 * Character-reference decoding for attribute values.
 *
 * Numeric references are decoded exhaustively; the small named set covers the
 * references that round-trip through re-escaping. The **security** of URL
 * validation does not depend on this table: an entity the decoder does not
 * know survives as a literal `&…;`, and `isSafeMarketingUrl` rejects any
 * scheme candidate that still contains `&` (an entity in scheme position is
 * always an evasion attempt — no legitimate scheme contains one).
 */
function decodeKnownEntities(value: string): string {
  return value.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body.startsWith('#')) {
        const codePoint =
          body[1] === 'x' || body[1] === 'X'
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
          return match;
        }
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      switch (body) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        case 'nbsp':
          return ' ';
        default:
          return match;
      }
    },
  );
}

/** Escapes text content for re-emission (`&` only when not already an entity). */
function escapeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '<') {
      out += '&lt;';
    } else if (char === '>') {
      out += '&gt;';
    } else if (char === '&') {
      // Preserve well-formed existing entities (`&amp;`, `&#39;`, `&#x27;`,
      // `&nbsp;`); escape a bare ampersand. A `&` that merely looks like an
      // entity is harmless either way — it renders as text.
      const rest = text.slice(i + 1);
      if (/^(#[xX][0-9a-fA-F]+;|#[0-9]+;|[a-zA-Z][a-zA-Z0-9]{0,31};)/.test(rest)) {
        out += char;
      } else {
        out += '&amp;';
      }
    } else {
      out += char;
    }
  }
  return out;
}

/** Escapes an attribute value for re-emission inside double quotes. */
function escapeAttributeValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * URL scheme validation with the browser's own leniencies pre-applied.
 *
 * Browsers strip tab/newline/carriage-return anywhere in a URL and ignore
 * leading/trailing control characters *before* deciding the scheme — so the
 * check must do the same, or `jav\tascript:` slips through. The scheme
 * candidate is everything before the first `:/?#`; a candidate containing `&`
 * is rejected outright (an undecoded entity in scheme position can only be an
 * evasion attempt — see `decodeKnownEntities`).
 */
export function isSafeMarketingUrl(raw: string, allowedSchemes: readonly string[]): boolean {
  // The control-character classes are the point: browsers strip tab/newline/
  // carriage-return anywhere in a URL and ignore leading/trailing control
  // characters *before* deciding the scheme, so the check must do the same or
  // `jav\tascript:` slips through.
  /* eslint-disable no-control-regex -- deliberate, see above */
  const stripped = raw
    .replace(/[\t\n\r]/g, '')
    .replace(/^[\x00-\x1f\x20\x7f]+/, '')
    .replace(/[\x00-\x1f\x20\x7f]+$/, '');
  /* eslint-enable no-control-regex */
  if (stripped.length === 0) {
    return false;
  }
  const boundary = stripped.search(/[:/?#]/);
  const candidate = boundary === -1 ? stripped : stripped.slice(0, boundary);
  if (candidate.includes('&')) {
    return false;
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(candidate)) {
    // No scheme (relative URL, fragment, query, protocol-relative `//host`).
    return true;
  }
  return allowedSchemes.includes(candidate.toLowerCase());
}

/** Strips NUL bytes — the HTML tokenizer turns them into U+FFFD, not markup. */
function stripNulls(input: string): string {
  /* eslint-disable-next-line no-control-regex -- stripping NUL is the purpose */
  return input.includes('\x00') ? input.replace(/\x00/g, '') : input;
}

/**
 * Tokenizes an HTML document into text and tag tokens.
 *
 * Total: any byte sequence yields tokens; nothing can put the scanner into an
 * infinite loop (the cursor always advances).
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const length = input.length;

  while (i < length) {
    const next = input.indexOf('<', i);
    if (next === -1) {
      tokens.push({ kind: 'text', text: input.slice(i) });
      break;
    }
    if (next > i) {
      tokens.push({ kind: 'text', text: input.slice(i, next) });
    }
    i = next;

    // Comments, doctypes, CDATA and processing instructions are dropped.
    if (input.startsWith('<!--', i)) {
      const end = findCommentEnd(input, i + 4);
      i = end;
      continue;
    }
    if (input.startsWith('<!', i) || input.startsWith('<?', i)) {
      const end = input.indexOf('>', i + 2);
      i = end === -1 ? length : end + 1;
      continue;
    }

    const isClosing = input.startsWith('</', i);
    const nameStart = isClosing ? i + 2 : i + 1;
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(input.slice(nameStart));
    if (!nameMatch) {
      // `<` followed by anything else is literal text (the HTML spec's
      // "data state" behaviour) — emit it escaped and move on.
      tokens.push({ kind: 'text', text: '<' });
      i += 1;
      continue;
    }

    const name = nameMatch[0].toLowerCase();
    let cursor = nameStart + nameMatch[0].length;
    const attributes: Array<{ name: string; value: string }> = [];
    let selfClosing = false;
    let malformed = false;

    // Attribute scanning.
    for (;;) {
      // Skip whitespace and stray slashes between attributes.
      while (cursor < length && /[\s/]/.test(input[cursor])) {
        cursor += 1;
      }
      if (cursor >= length) {
        break;
      }
      const char = input[cursor];
      if (char === '>') {
        cursor += 1;
        break;
      }
      const attrNameMatch = /^[^\s/>=]+/.exec(input.slice(cursor));
      if (!attrNameMatch) {
        // `=` with no name — skip one character to guarantee progress.
        cursor += 1;
        continue;
      }
      const attrName = attrNameMatch[0].toLowerCase();
      // A `<` inside an attribute name is the half-open-tag smuggling vector
      // (`<scr<script>ipt>`): browsers fold it into the attribute name, which
      // is inert — but regex sanitizers that strip substrings turn it into a
      // live tag. Reject the markup outright so no downstream consumer can
      // ever be bitten by it.
      if (attrName.includes('<')) {
        malformed = true;
      }
      cursor += attrNameMatch[0].length;
      // Skip whitespace before `=` (and tolerate `= = "x"` junk).
      while (cursor < length && /\s/.test(input[cursor])) {
        cursor += 1;
      }
      let value = '';
      if (cursor < length && input[cursor] === '=') {
        cursor += 1;
        while (cursor < length && /\s/.test(input[cursor])) {
          cursor += 1;
        }
        if (cursor < length && (input[cursor] === '"' || input[cursor] === "'")) {
          const quote = input[cursor];
          const close = input.indexOf(quote, cursor + 1);
          if (close === -1) {
            value = input.slice(cursor + 1);
            cursor = length;
          } else {
            value = input.slice(cursor + 1, close);
            cursor = close + 1;
          }
        } else {
          const unquoted = /^[^\s>]*/.exec(input.slice(cursor));
          value = unquoted ? unquoted[0] : '';
          cursor += value.length;
        }
      }
      attributes.push({ name: attrName, value: decodeKnownEntities(value) });
      if (attributes.length > 200) {
        break; // Pathological input; the rest of the tag is dropped.
      }
    }

    if (input[cursor - 2] === '/' && cursor > 0) {
      // `/` immediately before the closing `>`.
      selfClosing = input.slice(Math.max(0, cursor - 2), cursor) === '/>';
    }
    if (!selfClosing) {
      selfClosing = attributes.some((attribute) => attribute.name === '/');
    }

    tokens.push({
      kind: 'tag',
      name,
      closing: isClosing,
      selfClosing,
      attributes,
      malformed,
    });
    i = cursor;
  }

  return tokens;
}

/** Finds the end of a comment (`-->` or the spec's `--!>`), EOF-terminated. */
function findCommentEnd(input: string, from: number): number {
  const plain = input.indexOf('-->', from);
  const bang = input.indexOf('--!>', from);
  if (plain === -1 && bang === -1) {
    return input.length;
  }
  if (plain === -1) {
    return bang + 4;
  }
  if (bang === -1) {
    return plain + 3;
  }
  return Math.min(plain + 3, bang + 4);
}

/**
 * Validates and sanitizes one marketing template HTML body.
 *
 * Pure function; see the module comment for the security model.
 */
export function sanitizeMarketingHtml(input: string): MarketingHtmlSanitizationResult {
  const violations: string[] = [];
  const noteViolation = (message: string): void => {
    if (violations.length < MAX_VIOLATIONS && !violations.includes(message)) {
      violations.push(message);
    }
  };

  const output: string[] = [];

  for (const token of tokenize(stripNulls(input))) {
    if (token.kind === 'text') {
      output.push(escapeText(token.text));
      continue;
    }

    if (FORBIDDEN_TAGS.has(token.name)) {
      noteViolation(`Forbidden tag: <${token.name}>`);
      continue;
    }

    if (token.malformed) {
      noteViolation('Malformed markup: unescaped "<" inside a tag');
      continue;
    }

    if (!ALLOWED_TAGS.has(token.name)) {
      // Unknown-but-benign tag: sanitize by unwrapping (keep inner text).
      continue;
    }

    if (token.closing) {
      output.push(`</${token.name}>`);
      continue;
    }

    const allowedAttributes = ALLOWED_ATTRIBUTES[token.name] ?? new Set<string>();
    const emitted: string[] = [];
    let needsNoopener = false;

    for (const attribute of token.attributes) {
      const name = attribute.name.replace(/^\/+/, '');

      if (name.startsWith('on')) {
        noteViolation(`Event-handler attribute is not allowed: ${name}`);
        continue;
      }
      if (name === 'style' || name === 'srcdoc' || name === 'formaction' || name === 'action') {
        // Silently dropped: CSS/inline-document injection surfaces.
        continue;
      }
      if (!allowedAttributes.has(name) && name !== 'class') {
        continue;
      }
      if (URL_ATTRIBUTES.has(name)) {
        const schemes = token.name === 'img' ? SRC_SCHEMES : HREF_SCHEMES;
        if (!isSafeMarketingUrl(attribute.value, schemes)) {
          noteViolation(`Unsafe URL in ${name} attribute of <${token.name}>`);
          continue;
        }
      }
      if (token.name === 'a' && name === 'target') {
        const target = attribute.value.trim();
        if (target.toLowerCase() === '_blank') {
          needsNoopener = true;
        } else {
          continue; // Only `_blank` is honoured; anything else is dropped.
        }
      }
      emitted.push(`${name}="${escapeAttributeValue(attribute.value)}"`);
    }

    if (needsNoopener) {
      emitted.push('rel="noopener noreferrer"');
    }

    const attrs = emitted.length > 0 ? ` ${emitted.join(' ')}` : '';
    if (VOID_TAGS.has(token.name)) {
      output.push(`<${token.name}${attrs}>`);
    } else if (token.selfClosing) {
      output.push(`<${token.name}${attrs} />`);
    } else {
      output.push(`<${token.name}${attrs}>`);
    }
  }

  return { html: output.join(''), violations };
}
