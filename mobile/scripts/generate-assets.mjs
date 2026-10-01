#!/usr/bin/env node
/**
 * Rasterises the shared brand lockup and map marker source into every
 * PNG slot the Expo build and the web app need.
 *
 * The SVG is the ONLY artwork. Nothing in this file draws: it renders the
 * committed SVG (mark, colours and KIDBUS wordmark included) at fixed sizes.
 *
 * The map bus is the same deal: `@school-bus-tracking/map-assets` owns the
 * sole top-down school-bus SVG. The three Metro density files below are mechanical
 * RGBA rasterisations of that shared SVG, never a second hand-drawn marker.
 * The mark-only variant used by the adaptive-icon foreground, the splash and
 * the favicon is the same SVG with two purely mechanical derivations, so the
 * artwork itself is never redrawn here:
 *
 *   1. the opaque `#FCFCF9` background `<rect>` is dropped (those slots sit
 *      on backgrounds the platform owns — `#0F172A` from `app.json`);
 *   2. the `<text>` wordmark element is dropped and the `viewBox` cropped to
 *      the pin-and-bus mark. The wordmark cannot simply be cropped away —
 *      the pin tip reaches below the text's cap line — and at favicon size
 *      a 92px wordmark would render as mush (and navy-on-navy, invisibly).
 *      The bus artwork itself is never redrawn here.
 *
 * ### Sizes and why they are what they are
 *
 * - `assets/icon.png` 1024² — full logo (background + mark + wordmark),
 *   the store/home-screen artwork.
 * - `assets/adaptive-icon.png` 1024² transparent — mark scaled to 600px
 *   (~59% of the canvas) and centred: Android masks adaptive layers to a
 *   circle and the safe zone is the central 66/108 ≈ 61% — everything inked
 *   stays inside it. The navy behind it comes from `app.json`
 *   (`android.adaptiveIcon.backgroundColor`), not from this file.
 * - `assets/splash.png` 1024² transparent — mark at 560px, nudged up from
 *   centre; `app.json` paints the `#0F172A` canvas it floats on.
 * - `assets/favicon.png` 48² — mark-only (see above), centred on
 *   transparency.
 * - `web/src/app/icon2.png` 256² / `apple-icon.png` 180² — full logo; the
 *   app-router file conventions. (`web/src/app/icon1.svg` is a verbatim copy
 *   of the logo SVG for browsers that prefer vector favicons; Next links
 *   both `icon1` and `icon2`, and browsers that support SVG favicons pick
 *   the vector, the rest fall back to the PNG.)
 *
 * The web header/login/landing lockups render `web/public/kidbus-logo.svg`,
 * a verbatim copy of the logo — regenerated only by copying, never by this
 * script (there is nothing to rasterise).
 *
 * Usage: `npm install` (sharp is a devDependency of this workspace), then
 * `node scripts/generate-assets.mjs` from `mobile/`. Commit the outputs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BUS_MARKER_ART_SVG, BUS_MARKER_BOX } from '@school-bus-tracking/map-assets';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');
const repoRoot = join(mobileRoot, '..');
const LOGO_SVG = join(repoRoot, 'logo', 'school-bus-lockup.svg');
const MARK_SVG = join(repoRoot, 'logo', 'school-bus-mark.svg');

// The lockup and its mark are separate maintained SVGs. They are only
// rasterised here; no icon geometry is recreated in JavaScript.
const svg = readFileSync(LOGO_SVG, 'utf8');
const markSvg = readFileSync(MARK_SVG, 'utf8');

/** Full logo (background + mark + wordmark) at a square size. */
const fullLogoPng = async (size) =>
  sharp(Buffer.from(svg))
    .resize(size, size, { fit: 'contain', background: '#FCFCF9' })
    .png()
    .toBuffer();

/** Mark-only, height-constrained, centred on a transparent square canvas. */
const markPng = async (canvas, markHeight, { verticalShift = 0 } = {}) => {
  const mark = await sharp(Buffer.from(markSvg)).resize({ height: markHeight }).png().toBuffer();
  const meta = await sharp(mark).metadata();
  return sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: mark,
        left: Math.round((canvas - meta.width) / 2),
        top: Math.round((canvas - markHeight) / 2 + verticalShift),
      },
    ])
    .png()
    .toBuffer();
};

/**
 * Mechanical bus rasterisation for React Native. The static ground shadow is
 * rendered as a native layer outside the rotated PNG (see BusMarker.tsx), so
 * this art-only SVG intentionally contains the same coachwork but not that
 * shadow. `BUS_MARKER_ART_SVG` is derived from the one full shared SVG source.
 */
const busMarkerPng = async (scale) =>
  sharp(Buffer.from(BUS_MARKER_ART_SVG))
    .resize(BUS_MARKER_BOX.width * scale, BUS_MARKER_BOX.height * scale, { fit: 'fill' })
    .ensureAlpha()
    // Keep an RGBA true-colour PNG. Metro needs transparency around the coach,
    // and the native invariant spec reads the IHDR colour type directly.
    .png({ palette: false })
    .toBuffer();

const outputs = [
  { file: join(mobileRoot, 'assets', 'icon.png'), png: () => fullLogoPng(1024) },
  { file: join(mobileRoot, 'assets', 'adaptive-icon.png'), png: () => markPng(1024, 600) },
  {
    file: join(mobileRoot, 'assets', 'splash.png'),
    png: () => markPng(1024, 560, { verticalShift: -60 }),
  },
  { file: join(mobileRoot, 'assets', 'favicon.png'), png: () => markPng(48, 48) },
  { file: join(repoRoot, 'web', 'src', 'app', 'icon2.png'), png: () => fullLogoPng(256) },
  { file: join(repoRoot, 'web', 'src', 'app', 'apple-icon.png'), png: () => fullLogoPng(180) },
  { file: join(mobileRoot, 'assets', 'bus-marker.png'), png: () => busMarkerPng(1) },
  { file: join(mobileRoot, 'assets', 'bus-marker@2x.png'), png: () => busMarkerPng(2) },
  { file: join(mobileRoot, 'assets', 'bus-marker@3x.png'), png: () => busMarkerPng(3) },
];

for (const { file, png } of outputs) {
  writeFileSync(file, await png());
  console.log('wrote', file);
}
