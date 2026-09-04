#!/usr/bin/env node
/**
 * Generates the Expo app icons/splash deterministically (no external deps):
 * a school-bus yellow rounded square with a simple bus glyph on navy.
 *
 * Usage: node scripts/generate-assets.mjs   (writes into ./assets)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'assets');
mkdirSync(outDir, { recursive: true });

const NAVY = [15, 23, 42];
const AMBER = [245, 158, 23];
const AMBER_DARK = [217, 119, 6];
const WHITE = [255, 255, 255];
const GRAY = [148, 163, 184];

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      const [r, g, b, a] = rgba(x, y, width, height);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, checksum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** True when (x, y) is inside the rounded-rect canvas of an adaptive icon. */
const inRoundedSquare = (x, y, size, radius = size * 0.18) => {
  const min = Math.min(x, y, size - 1 - x, size - 1 - y);
  if (min >= radius) return true;
  const dx = Math.min(x, size - 1 - x);
  const dy = Math.min(y, size - 1 - y);
  return Math.hypot(radius - dx, radius - dy) <= radius;
};

/** Simple front-view bus glyph. */
const busGlyph = (x, y, size) => {
  const u = size / 24; // "pixel" unit based on a 24-grid
  const inRect = (x0, y0, w, h) => x >= x0 * u && x < (x0 + w) * u && y >= y0 * u && y < (y0 + h) * u;
  return (
    inRect(4, 4, 16, 14) || // body
    inRect(3, 7, 1, 6) || // left mirror
    inRect(20, 7, 1, 6) || // right mirror
    inRect(6, 18, 3, 2) || // left wheel
    inRect(15, 18, 3, 2) // right wheel
  );
};

const busWindow = (x, y, size) => {
  const u = size / 24;
  const inRect = (x0, y0, w, h) => x >= x0 * u && x < (x0 + w) * u && y >= y0 * u && y < (y0 + h) * u;
  return inRect(6, 6, 5, 4) || inRect(13, 6, 5, 4) || inRect(6, 11, 12, 2);
};

// ---- icon.png: navy rounded square, amber bus, white windows ----
const icon = png(1024, 1024, (x, y, size) => {
  if (!inRoundedSquare(x, y, size)) return [...NAVY, 0];
  if (busGlyph(x, y, size)) {
    if (busWindow(x, y, size)) return [...NAVY, 255];
    return [...AMBER, 255];
  }
  return [...NAVY, 255];
});

// ---- adaptive-icon.png: bus on navy (safe zone, larger margins) ----
const adaptive = png(1024, 1024, (x, y, size) => {
  if (busGlyph(x, y, size)) {
    if (busWindow(x, y, size)) return [...WHITE, 255];
    return [...AMBER, 255];
  }
  return [...NAVY, 255];
});

// ---- splash.png: navy canvas, amber bus, subtle ground line ----
const splash = png(1024, 1024, (x, y, size) => {
  const u = size / 24;
  const bus = busGlyph(x, y - size / 4, size);
  const window = busWindow(x, y - size / 4, size);
  if (bus) return window ? [...NAVY, 255] : [...AMBER, 255];
  if (y > 18 * u && y <= 18.6 * u) return [...GRAY, 120];
  return [...NAVY, 255];
});

// ---- favicon: 48px icon ----
const favicon = png(48, 48, (x, y, size) => {
  if (busGlyph(x, y, size)) {
    if (busWindow(x, y, size)) return [...NAVY, 255];
    return [...AMBER, 255];
  }
  return [...AMBER_DARK, 255];
});

writeFileSync(join(outDir, 'icon.png'), icon);
writeFileSync(join(outDir, 'adaptive-icon.png'), adaptive);
writeFileSync(join(outDir, 'splash.png'), splash);
writeFileSync(join(outDir, 'favicon.png'), favicon);
console.log('assets written to', outDir);
