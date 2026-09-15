import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { CREW_PIN_LENGTH } from '@school-bus-tracking/validation';

import {
  QR_ERROR_CORRECTION,
  QR_QUIET_ZONE,
  matrixToSvgPath,
  normalizePinInput,
  pairingCountdown,
  pinBadge,
  qrMatrix,
  qrToSvg,
  validatePinDraft,
} from './crew-login.ts';

/** A payload of exactly the shape the server issues: prefix + 64 hex chars. */
const PAYLOAD = 'SBT-CREW-1:' + 'a1b2c3d4e5f60718'.repeat(4);

/** Rows/cols of a matrix, as a window starting at `base`. */
function window(matrix: boolean[][], rowBase: number, colBase: number, span = 7): boolean[][] {
  return Array.from({ length: span }, (_, r) =>
    Array.from({ length: span }, (_, c) => matrix[rowBase + r][colBase + c]),
  );
}

/** The 7×7 finder pattern every QR carries: dark ring, light ring, dark centre. */
function assertFinderPattern(block: boolean[][], where: string): void {
  for (let i = 0; i < 7; i += 1) {
    assert.equal(block[0][i], true, `${where}: top ring`);
    assert.equal(block[6][i], true, `${where}: bottom ring`);
    assert.equal(block[i][0], true, `${where}: left ring`);
    assert.equal(block[i][6], true, `${where}: right ring`);
  }
  for (let r = 1; r <= 5; r += 1) {
    for (let c = 1; c <= 5; c += 1) {
      const centre = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      assert.equal(block[r][c], centre, `${where}: cell ${r},${c}`);
    }
  }
}

describe('qrMatrix', () => {
  it('encodes the issued payload into a square symbol of a scannable size', () => {
    const matrix = qrMatrix(PAYLOAD);
    assert.equal(matrix.length, 37, 'the size this payload + EC level produces');
    for (const row of matrix) {
      assert.equal(row.length, matrix.length, 'the symbol must be square');
    }
    assert.equal(QR_ERROR_CORRECTION, 'M');
    // A QR version 1 symbol is 21×21; anything smaller would mean the payload
    // was silently truncated rather than encoded.
    assert.ok(matrix.length >= 21);
    const dark = matrix.flat().filter(Boolean).length;
    assert.ok(dark > matrix.length, 'a symbol with almost nothing dark is not a QR');
  });

  it('carries the three finder patterns, and only three', () => {
    const matrix = qrMatrix(PAYLOAD);
    const size = matrix.length;

    assertFinderPattern(window(matrix, 0, 0), 'top-left');
    assertFinderPattern(window(matrix, 0, size - 7), 'top-right');
    assertFinderPattern(window(matrix, size - 7, 0), 'bottom-left');

    // The one-module light separator around each finder pattern is what lets a
    // decoder tell the pattern apart from the data beside it.
    for (let i = 0; i < 8; i += 1) {
      assert.equal(matrix[7][i], false, `top-left separator row, col ${i}`);
      assert.equal(matrix[i][7], false, `top-left separator column, row ${i}`);
      assert.equal(matrix[7][size - 1 - i], false, `top-right separator row, col ${size - 1 - i}`);
      assert.equal(
        matrix[size - 1 - i][7],
        false,
        `bottom-left separator column, row ${size - 1 - i}`,
      );
    }
    for (let i = 0; i < 8; i += 1) {
      assert.equal(matrix[size - 8][i], false, `bottom-left separator row, col ${i}`);
      assert.equal(matrix[i][size - 8], false, `top-right separator column, row ${i}`);
    }

    // There is no fourth finder pattern: the bottom-right corner is data, and a
    // stray one there would mean the encoder produced a malformed symbol.
    const bottomRight = window(matrix, size - 7, size - 7);
    assert.equal(
      bottomRight[0].every(Boolean),
      false,
      'the bottom-right corner must not be a finder pattern',
    );
  });

  it('is deterministic, and different payloads produce different symbols', () => {
    assert.deepEqual(qrMatrix(PAYLOAD), qrMatrix(PAYLOAD), 'the same payload must repeat exactly');
    const other = qrMatrix('SBT-CREW-1:' + 'ffffffffffffffff'.repeat(4));
    assert.notDeepEqual(qrMatrix(PAYLOAD), other, 'a different token must not render identically');
  });

  it('encodes a payload one character shorter without changing shape', () => {
    // Guards against the encoder throwing at a boundary the server could reach
    // if the token length ever changed.
    const matrix = qrMatrix(PAYLOAD.slice(0, -1));
    assert.ok(matrix.length >= 21);
    assert.equal(matrix.length % 4, 1, 'QR side lengths are always 4n + 1');
  });
});

describe('matrixToSvgPath', () => {
  it('emits one unit square per dark module, offset by the quiet zone', () => {
    const matrix = [
      [true, false],
      [false, true],
    ];
    assert.equal(matrixToSvgPath(matrix, 4), 'M4 4h1v1h-1zM5 5h1v1h-1z');
    assert.equal(matrixToSvgPath(matrix, 0), 'M0 0h1v1h-1zM1 1h1v1h-1z');
  });

  it('emits nothing for an all-light matrix', () => {
    assert.equal(
      matrixToSvgPath([
        [false, false],
        [false, false],
      ]),
      '',
    );
  });

  it('covers every dark module of a real symbol exactly once', () => {
    const matrix = qrMatrix(PAYLOAD);
    const path = matrixToSvgPath(matrix, QR_QUIET_ZONE);
    const dark = matrix.flat().filter(Boolean).length;
    assert.equal(path.split('z').length - 1, dark, 'one sub-path per dark module');
  });
});

describe('qrToSvg', () => {
  it('sizes the viewBox to include the quiet zone on both edges', () => {
    const matrix = qrMatrix(PAYLOAD);
    const svg = qrToSvg(PAYLOAD);
    assert.equal(svg.size, matrix.length + QR_QUIET_ZONE * 2);
    assert.ok(svg.path.startsWith('M'), 'the path must be a move-to sequence');
    assert.deepEqual(svg, qrToSvg(PAYLOAD), 'rendering must be stable across calls');
  });

  it('starts every sub-path inside the quiet zone, never on the edge', () => {
    // A symbol drawn flush to the viewBox edge will not scan: decoders need the
    // blank margin to find the symbol boundary.
    const svg = qrToSvg(PAYLOAD);
    const coords = [...svg.path.matchAll(/M(\d+) (\d+)/g)].map(([, x, y]) => ({
      x: Number(x),
      y: Number(y),
    }));
    assert.ok(coords.length > 0);
    const max = svg.size - QR_QUIET_ZONE - 1;
    for (const { x, y } of coords) {
      assert.ok(x >= QR_QUIET_ZONE && x <= max, `x=${x} outside the symbol area`);
      assert.ok(y >= QR_QUIET_ZONE && y <= max, `y=${y} outside the symbol area`);
    }
  });
});

describe('pinBadge', () => {
  it('reports a set PIN, and leaves the timestamp to the component', () => {
    assert.deepEqual(pinBadge({ pin_set: true, pin_updated_at: '2026-04-01T08:30:00.000Z' }), {
      tone: 'success',
      label: 'PIN set',
      caption: null,
    });
  });

  it('reports a missing PIN with the consequence, not the field name', () => {
    assert.deepEqual(pinBadge({ pin_set: false, pin_updated_at: null }), {
      tone: 'warning',
      label: 'No PIN',
      caption: 'Can only sign in by QR',
    });
  });

  it('says "unknown" rather than "no PIN" when the API did not populate the field', () => {
    // `pin_set` is optional on StaffResponse. Rendering `undefined` as "No PIN"
    // would send an administrator to re-issue a credential the driver already
    // has; the neutral badge is the honest answer during a mixed-version deploy.
    for (const person of [{}, { pin_set: null }, { pin_set: undefined, pin_updated_at: null }]) {
      assert.deepEqual(pinBadge(person), { tone: 'neutral', label: 'PIN unknown', caption: null });
    }
  });

  it('never claims a PIN is set on the strength of a timestamp alone', () => {
    // The projection derives pin_set from pin_updated_at, and the migration CHECK
    // keeps them in step — but the badge must follow the flag the API sent, not
    // re-derive it here from a second source of truth.
    assert.equal(pinBadge({ pin_set: false, pin_updated_at: '2026-04-01T08:30:00.000Z' }).label, 'No PIN');
  });
});

describe('pairingCountdown', () => {
  const EXPIRES = '2026-04-01T12:05:00.000Z';
  const expiresMs = Date.parse(EXPIRES);

  it('counts down in m:ss with zero-padded seconds', () => {
    assert.deepEqual(pairingCountdown(EXPIRES, expiresMs - 65_000), {
      expired: false,
      remainingMs: 65_000,
      label: '1:05',
    });
    assert.deepEqual(pairingCountdown(EXPIRES, expiresMs - 5_000), {
      expired: false,
      remainingMs: 5_000,
      label: '0:05',
    });
    assert.equal(pairingCountdown(EXPIRES, expiresMs - 300_000).label, '5:00');
  });

  it('is expired at the boundary and stays expired afterwards', () => {
    assert.equal(pairingCountdown(EXPIRES, expiresMs).expired, true, 'exactly now is expired');
    assert.equal(pairingCountdown(EXPIRES, expiresMs).remainingMs, 0);
    assert.equal(pairingCountdown(EXPIRES, expiresMs).label, '0:00');
    const after = pairingCountdown(EXPIRES, expiresMs + 60_000);
    assert.equal(after.expired, true);
    assert.equal(after.remainingMs, 0, 'the countdown must not go negative');
    assert.equal(after.label, '0:00');
  });

  it('treats a missing or unparsable expiry as expired', () => {
    // Showing a code whose lifetime cannot be verified is worse than asking the
    // administrator to mint a fresh one.
    for (const value of [null, undefined, '', 'not-a-date']) {
      const result = pairingCountdown(value, Date.parse(EXPIRES));
      assert.equal(result.expired, true, `expiry=${JSON.stringify(value)}`);
      assert.equal(result.remainingMs, 0);
    }
  });
});

describe('normalizePinInput', () => {
  it('keeps only digits and caps at the PIN length', () => {
    assert.equal(normalizePinInput('48-21'), '4821');
    assert.equal(normalizePinInput(' 4 8 2 1 '), '4821');
    assert.equal(normalizePinInput('48a21'), '4821');
    assert.equal(normalizePinInput('1234567'), '1234');
    assert.equal(CREW_PIN_LENGTH, 4);
  });

  it('never adds a character, so it cannot turn invalid input into a valid PIN', () => {
    for (const raw of ['', '----', 'abcd', '१२३४']) {
      const normalized = normalizePinInput(raw);
      assert.equal(normalized.length <= CREW_PIN_LENGTH, true);
      assert.equal(/^\d*$/.test(normalized), true, `raw=${JSON.stringify(raw)}`);
    }
    // Devanagari digits are not `\d` in a non-unicode regex, so they are dropped
    // rather than silently mapped onto different ASCII digits.
    assert.equal(normalizePinInput('१२३४'), '');
  });
});

describe('validatePinDraft', () => {
  it('accepts exactly four digits, including 0000', () => {
    for (const pin of ['4821', '0000', '9999']) {
      assert.equal(validatePinDraft(pin), null, `pin=${pin}`);
    }
  });

  it('rejects everything else with the shared schema’s own message', () => {
    for (const pin of ['', '123', '12345', 'abcd', '12a4', ' 1234', '1234 ']) {
      const message = validatePinDraft(pin);
      assert.ok(message, `pin=${JSON.stringify(pin)} must be rejected`);
      assert.match(message!, /exactly 4 digits/);
    }
  });

  it('never echoes the rejected draft back in the message', () => {
    // The message is rendered into the DOM and can end up in a screenshot or a
    // support ticket. A PIN-shaped string in an error is a credential leak, so
    // the copy states the rule only.
    for (const pin of ['1234', '12345', '0821', '9999']) {
      const message = validatePinDraft(pin) ?? '';
      assert.equal(message.includes(pin), false, `message echoed ${pin}: ${message}`);
    }
    // The same rule as the server side: `crew-login.dto.spec.ts` asserts the DTO
    // never leaks a submitted PIN either.
    assert.equal(validatePinDraft('1234'), null, 'a valid PIN has no message to leak');
  });

  it('agrees with the draft the input normaliser produces', () => {
    // The two are used together: normalise on every keystroke, validate on
    // submit. A draft that normalises to four digits must always validate.
    for (const raw of ['48-21', ' 0821 ', '4821xxxx']) {
      assert.equal(validatePinDraft(normalizePinInput(raw)), null, `raw=${raw}`);
    }
  });
});
