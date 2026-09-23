#!/usr/bin/env node
/**
 * Rasterises the single brand source — `logo/kidbus-logo.svg` — into every
 * PNG slot the Expo build and the web app need.
 *
 * The SVG is the ONLY artwork. Nothing in this file draws: it renders the
 * committed SVG (mark, colours and KIDBUS wordmark included) at fixed sizes.
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

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');
const repoRoot = join(mobileRoot, '..');
const LOGO_SVG = join(repoRoot, 'logo', 'kidbus-logo.svg');

/**
 * The mark's bounding box inside the 800×800 canvas, from the artwork
 * geometry: the pin spans x 198–602 / y 82–604 and the bus body overhangs
 * the pin on the left to x 162. A 10px margin keeps anti-aliased edges.
 */
const MARK = { x: 152, y: 72, width: 460, height: 542 };
/** Background rect the full-logo renders keep and the mark-only renders drop. */
const BG_RECT = '<rect width="800" height="800" fill="#FCFCF9"/>';
/** The wordmark element the mark-only renders drop (the full logo keeps it). */
const WORDMARK = /<text[\s\S]*?<\/text>/;

const svg = readFileSync(LOGO_SVG, 'utf8');
if (!svg.includes(BG_RECT) || !svg.includes('viewBox="0 0 800 800"') || !WORDMARK.test(svg)) {
  throw new Error(`Unexpected artwork in ${LOGO_SVG} — update ${__filename}`);
}
const markSvg = svg
  .replace(BG_RECT, '')
  .replace(WORDMARK, '')
  .replace('viewBox="0 0 800 800"', `viewBox="${MARK.x} ${MARK.y} ${MARK.width} ${MARK.height}"`);

/** Full logo (background + mark + wordmark) at a square size. */
const fullLogoPng = async (size) =>
  sharp(Buffer.from(svg), { density: (96 * size) / 800 })
    .resize(size, size)
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
];

for (const { file, png } of outputs) {
  writeFileSync(file, await png());
  console.log('wrote', file);
}
