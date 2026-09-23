#!/usr/bin/env node
/**
 * KidBus brand-asset generator (deterministic, dependency-free).
 *
 * Recreates the owner's approved mark — a gold map-pin whose head is a navy
 * disc carrying a white side-view school bus — and derives every shipped
 * raster from that one drawing, so the phone icon, Android adaptive
 * foreground, splash, and the web mark/favicon stay pixel-consistent.
 *
 * Palette is the single brand source mirrored from
 * `@school-bus-tracking/design-tokens` (`colors.brand`):
 *   navy  #0F172A  (the app theme, splash + adaptive background)
 *   gold  #F5A623  (schoolBusGold)
 *   white #FFFFFF
 *
 * If the owner's original high-res PNGs are ever dropped into the repo, prefer
 * them; this generator exists so the asset set is reproducible from code and
 * never hand-edited. Usage: node scripts/generate-brand-assets.mjs [outDir]
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(here, '..', 'assets');
mkdirSync(outDir, { recursive: true });

const NAVY = [15, 23, 42]; // #0F172A
const GOLD = [245, 166, 35]; // #F5A623
const WHITE = [255, 255, 255];

// ---- PNG writer (identical approach to generate-assets.mjs) ----
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const o = y * (width * 4 + 1) + 1 + x * 4;
      const [r, g, b, a] = rgba(x, y, width, height);
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- geometry (all coordinates normalised 0..1) ----
const HEAD = { x: 0.5, y: 0.4, r: 0.3 }; // pin head circle
const APEX = { x: 0.5, y: 0.95 }; // pin point
const TAIL_L = { x: 0.5 - HEAD.r * 0.86, y: HEAD.y + HEAD.r * 0.5 };
const TAIL_R = { x: 0.5 + HEAD.r * 0.86, y: HEAD.y + HEAD.r * 0.5 };

const inCircle = (x, y, c) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r ** 2;
function inTriangle(x, y, a, b, c) {
  const s = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = s(a, b, { x, y });
  const d2 = s(b, c, { x, y });
  const d3 = s(c, a, { x, y });
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
const inPin = (x, y) =>
  inCircle(x, y, HEAD) || inTriangle(x, y, APEX, TAIL_L, TAIL_R);

const roundRect = (x, y, rx, ry, rw, rh, r) => {
  const cx = Math.max(rx, Math.min(rx + rw - r, x));
  const cy = Math.max(ry, Math.min(ry + rh - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2 || (x >= rx + r && x <= rx + rw - r && y >= ry && y <= ry + rh) || (y >= ry + r && y <= ry + rh - r && x >= rx && x <= rx + rw);
};

// bus (white) geometry
const BODY = { x: 0.3, y: 0.31, w: 0.4, h: 0.18, r: 0.05 };
const WHEELS = [
  { x: 0.39, y: 0.5, r: 0.05 },
  { x: 0.62, y: 0.5, r: 0.05 },
];
const HUB_R = 0.023;
const WINDOWS = [
  { x: 0.33, y: 0.345, w: 0.07, h: 0.07 },
  { x: 0.435, y: 0.345, w: 0.07, h: 0.07 },
  { x: 0.54, y: 0.345, w: 0.07, h: 0.07 },
  { x: 0.64, y: 0.345, w: 0.045, h: 0.07 }, // windshield
];

function inBusWhite(x, y) {
  const wheel = WHEELS.some((w) => inCircle(x, y, w));
  const hub = WHEELS.some((w) => inCircle(x, y, { x: w.x, y: w.y, r: HUB_R }));
  const body = roundRect(x, y, BODY.x, BODY.y, BODY.w, BODY.h, BODY.r);
  const win = WINDOWS.some((wd) => x >= wd.x && x <= wd.x + wd.w && y >= wd.y && y <= wd.y + wd.h);
  if (wheel && !hub) return true;
  if (body && !win) return true;
  return false;
}

/**
 * Colour of the mark at normalised (x, y): returns an RGBA tuple or null
 * (transparent). The head is a navy disc with a white bus; the surrounding
 * pin (ring + tail) is gold.
 */
function markAt(x, y) {
  if (!inPin(x, y)) return null;
  if (inCircle(x, y, { ...HEAD, r: HEAD.r * 0.8 })) {
    return inBusWhite(x, y) ? [...WHITE, 255] : [...NAVY, 255];
  }
  return [...GOLD, 255];
}

// sample the mark over an arbitrary square region (for centring/scaling)
const sample = (px, py, size, ox, oy, scale) =>
  markAt((px / size - ox) / scale, (py / size - oy) / scale);

// ---- icon.png: navy theme square, mark centred ----
const icon = png(1024, 1024, (x, y, s) => {
  const m = sample(x, y, s, 0.06, 0.06, 0.88);
  return m ?? [...NAVY, 255];
});

// ---- adaptive-icon.png: transparent foreground, mark within the safe zone ----
const adaptive = png(1024, 1024, (x, y, s) => {
  const m = sample(x, y, s, 0.19, 0.19, 0.62);
  return m ?? [0, 0, 0, 0];
});

// ---- splash.png: navy canvas, mark centred at ~half ----
const splash = png(1024, 1024, (x, y, s) => {
  const m = sample(x, y, s, 0.27, 0.27, 0.46);
  return m ?? [...NAVY, 255];
});

// ---- favicon / web mark ----
const favicon = png(48, 48, (x, y, s) => {
  const m = sample(x, y, s, 0.08, 0.08, 0.84);
  return m ?? [...NAVY, 255];
});
const webmark = png(256, 256, (x, y, s) => sample(x, y, s, 0.04, 0.04, 0.92) ?? [0, 0, 0, 0]);

const kind = process.argv[3] === 'web' ? 'web' : 'mobile';
if (kind === 'mobile') {
  writeFileSync(join(outDir, 'icon.png'), icon);
  writeFileSync(join(outDir, 'adaptive-icon.png'), adaptive);
  writeFileSync(join(outDir, 'splash.png'), splash);
  writeFileSync(join(outDir, 'favicon.png'), favicon);
} else {
  writeFileSync(join(outDir, 'favicon.png'), favicon);
  writeFileSync(join(outDir, 'kidbus-mark.png'), webmark);
}
console.log(`brand assets (${kind}) written to`, outDir);
