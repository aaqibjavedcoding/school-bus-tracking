import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIDBUS_DAY_STYLE, KIDBUS_NIGHT_STYLE } from '@school-bus-tracking/map-assets';
// The generator that owns the sprite files. Importing it is side-effect free —
// it only writes when it is the process's entry point (`--check` included) —
// so its icon table can be asserted against the shipped atlas.
import { SPRITE_CELL, SPRITE_DIR, SPRITE_ICON_IDS, buildKidbusSprite } from '../../scripts/generate-kidbus-sprite.mjs';

/**
 * KidBus cartography guard — the labels and icons the map is *allowed to claim*.
 *
 * `docs/map-report-flight-view-google-maps-cost.md` §2 pinned three defects in
 * the shipped style, and all three were structural (the map looked empty while
 * every file involved was valid):
 *
 * 1. `poi` asked for `poi-<class>` ids the sprite did not contain, and MapLibre
 *    *skips a symbol entirely* when its `icon-image` is missing — so every POI
 *    icon and label was invisible, at every zoom, on web and native;
 * 2. `transportation_name` had no `symbol-placement`, so road names fell on one
 *    point of the line and mostly vanished into collision detection;
 * 3. one unfiltered `place` layer let city/village names win every collision,
 *    so colony/suburb/neighbourhood names never appeared at z13–16.
 *
 * A style is data, so a unit test of the style is the only way these stay fixed:
 * this spec reads the **shipped** JSON (`web/public/map-styles/*.json`) and the
 * **shipped** sprite (`web/public/map-sprites/*`), not the TypeScript source, so
 * it fails if a build step, a hand edit or a stale artefact ships something the
 * typed source does not say. It also pins the object↔JSON rule so the two can
 * never silently diverge.
 *
 * The provider rule (no key, no card, no metered tier) is a separate guard:
 * `web/scripts/map-provider-policy.spec.ts`.
 */

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const styleJson = (name: string) =>
  JSON.parse(readFileSync(join(webRoot, 'public/map-styles', `${name}.json`), 'utf8')) as StyleLike;
const spriteJson = (name: string) =>
  JSON.parse(readFileSync(join(webRoot, 'public/map-sprites', `${name}.json`), 'utf8')) as Record<
    string,
    { width: number; height: number; x: number; y: number; pixelRatio: number }
  >;

interface StyleLike {
  name: string;
  sprite: string;
  glyphs: string;
  sources: Record<string, { url?: string }>;
  layers: Array<{
    id: string;
    type: string;
    minzoom?: number;
    maxzoom?: number;
    filter?: unknown;
    layout?: Record<string, unknown>;
    paint?: Record<string, unknown>;
    'source-layer'?: string;
  }>;
}

const SHIPPED: ReadonlyArray<readonly ['kidbus-day' | 'kidbus-night', StyleLike]> = [
  ['kidbus-day', styleJson('kidbus-day')],
  ['kidbus-night', styleJson('kidbus-night')],
];

const SPRITE_INDEXES = {
  'kidbus.json': spriteJson('kidbus'),
  'kidbus@2x.json': spriteJson('kidbus@2x'),
} as const;

const spriteKeys = Object.keys(SPRITE_INDEXES['kidbus.json']);
const layerOf = (style: StyleLike, id: string) => style.layers.find((layer) => layer.id === id);
const layoutOf = (style: StyleLike, id: string) => layerOf(style, id)?.layout ?? {};

/** PNG dimensions and colour type, straight out of the IHDR chunk. */
function pngHeader(path: string): { width: number; height: number; bitDepth: number; colourType: number } {
  const bytes = readFileSync(path);
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.ok(isPng, `${path} is not a PNG`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colourType: bytes[25],
  };
}

/**
 * Evaluates the tiny expression dialect the styles use for `icon-image`
 * (`match` over `['get', 'class']` with literal strings) — enough to answer
 * "which sprite id does this class ask for?", and deliberately no more: an
 * expression this evaluator cannot read fails the spec, so a future style has
 * to be looked at by a human instead of silently skipping the check.
 */
function evaluateIconImage(expression: unknown, properties: Record<string, unknown>): string {
  if (typeof expression === 'string') return expression;
  assert.ok(Array.isArray(expression), `unsupported icon-image expression: ${JSON.stringify(expression)}`);
  const [op, ...rest] = expression as unknown[];
  assert.equal(op, 'match', 'icon-image must be a literal `match` — never a `concat` that builds ids at runtime');
  const [input, ...pairs] = rest as [unknown, ...unknown[]];
  const value = evaluateLiteralOrGet(input, properties);
  for (let i = 0; i < pairs.length - 1; i += 2) {
    const labels = Array.isArray(pairs[i]) ? (pairs[i] as unknown[]) : [pairs[i]];
    if (labels.includes(value)) return evaluateIconImage(pairs[i + 1], properties);
  }
  const fallback = pairs[pairs.length - 1];
  assert.ok(fallback !== undefined, 'icon-image must have a fallback (the unnamed sprite id)');
  return evaluateIconImage(fallback, properties);
}

function evaluateLiteralOrGet(node: unknown, properties: Record<string, unknown>): unknown {
  if (Array.isArray(node) && node[0] === 'get') return properties[String(node[1])];
  return node;
}

describe('the shipped style JSON is the typed style object (object ↔ JSON drift)', () => {
  it('kidbus-day.json is exactly the built KIDBUS_DAY_STYLE', () => {
    assert.deepEqual(styleJson('kidbus-day'), JSON.parse(JSON.stringify(KIDBUS_DAY_STYLE)));
  });

  it('kidbus-night.json is exactly the built KIDBUS_NIGHT_STYLE', () => {
    assert.deepEqual(styleJson('kidbus-night'), JSON.parse(JSON.stringify(KIDBUS_NIGHT_STYLE)));
  });

  it('ships the same layer ids in the same order in both variants', () => {
    const day = SHIPPED[0][1];
    const night = SHIPPED[1][1];
    assert.deepEqual(
      night.layers.map((layer) => layer.id),
      day.layers.map((layer) => layer.id),
    );
    assert.deepEqual(
      night.layers.map((layer) => layer.type),
      day.layers.map((layer) => layer.type),
    );
  });

  it('adds no network surface of its own: one source, same-origin sprite, OpenFreeMap glyphs', () => {
    for (const [name, style] of SHIPPED) {
      assert.equal(Object.keys(style.sources).length, 1, `${name} must keep the single OpenFreeMap source`);
      for (const source of Object.values(style.sources)) {
        assert.match(String(source.url), /^https:\/\/tiles\.openfreemap\.org\//, `${name} source url`);
      }
      assert.match(style.glyphs, /^https:\/\/tiles\.openfreemap\.org\/fonts\//, `${name} glyphs`);
      // Same-origin on web, resolved against the API origin on native — never a
      // third-party sprite host (that would be a new CSP host and a new bill).
      assert.equal(style.sprite, '/map-sprites/kidbus', `${name} sprite must stay the shipped same-origin path`);
    }
  });
});

describe('sprite-id integrity (the defect that hid every POI)', () => {
  it('the generator, the shipped indexes and the shipped styles agree on the ids', () => {
    assert.deepEqual(Object.keys(SPRITE_INDEXES['kidbus.json']), [...SPRITE_ICON_IDS]);
    assert.deepEqual(Object.keys(SPRITE_INDEXES['kidbus@2x.json']), [...SPRITE_ICON_IDS]);
    for (const [name, style] of SHIPPED) {
      const iconImage = layoutOf(style, 'poi')['icon-image'];
      // Every class the style maps, plus the fallback branch, resolves to a
      // sprite id that exists — and every cell in the atlas is reachable, so a
      // renamed or removed class cannot leave a dead icon behind.
      const reachable = new Set(
        [...matchLabels(iconImage), undefined].map((klass) =>
          evaluateIconImage(iconImage, klass === undefined ? {} : { class: klass }),
        ),
      );
      for (const id of reachable) {
        assert.ok(spriteKeys.includes(id), `${name}: icon-image names "${id}", which is not in the sprite`);
      }
      for (const id of spriteKeys) {
        assert.ok(reachable.has(id), `${name}: sprite id "${id}" is never reachable from icon-image`);
      }
    }
  });

  it('every OpenMapTiles POI class the style cares about resolves to a real sprite id', () => {
    // Representatives of each mapped family, plus one class that is mapped
    // nowhere: an unknown class must still draw the neutral marker, never a
    // skipped symbol (that was the original defect's failure mode).
    const classes = [
      'school',
      'college',
      'university',
      'kindergarten',
      'hospital',
      'clinic',
      'doctors',
      'place_of_worship',
      'religion',
      'fuel',
      'charging_station',
      'police',
      'fire_station',
      'park',
      'playground',
      'campsite',
      'restaurant',
      'fast_food',
      'cafe',
      'bar',
      'pharmacy',
      'chemist',
      'veterinary',
      'bank',
      'atm',
      'bus_station',
      'station',
      'railway',
      'airport',
      'shop',
      'supermarket',
      'mall',
      'marketplace',
      'castle',
      'ruins',
    ];
    for (const [name, style] of SHIPPED) {
      const iconImage = layoutOf(style, 'poi')['icon-image'];
      for (const klass of classes) {
        const id = evaluateIconImage(iconImage, { class: klass });
        assert.ok(
          spriteKeys.includes(id),
          `${name}: class "${klass}" resolves to "${id}", which is not in the sprite`,
        );
      }
      assert.equal(
        evaluateIconImage(iconImage, { class: 'castle' }),
        'poi-default',
        `${name}: an unmapped class must fall back to the neutral marker`,
      );
    }
  });

  it('the shipped atlas files are the size their indexes describe', () => {
    for (const [indexName, index] of Object.entries(SPRITE_INDEXES)) {
      const isAt2x = indexName.includes('@2x');
      const header = pngHeader(
        join(webRoot, 'public/map-sprites', indexName.replace('.json', '.png')),
      );
      assert.equal(header.bitDepth, 8, `${indexName}: 8-bit channels`);
      assert.equal(header.colourType, 6, `${indexName}: RGBA (the icons are anti-aliased)`);
      assert.equal(header.height, SPRITE_CELL * (isAt2x ? 2 : 1), `${indexName}: one cell tall`);
      assert.equal(
        header.width,
        SPRITE_CELL * (isAt2x ? 2 : 1) * Object.keys(index).length,
        `${indexName}: one cell per icon`,
      );
      for (const [id, cell] of Object.entries(index)) {
        assert.equal(cell.width, SPRITE_CELL, `${indexName}.${id} cell width`);
        assert.equal(cell.height, SPRITE_CELL, `${indexName}.${id} cell height`);
        assert.equal(cell.pixelRatio, isAt2x ? 2 : 1, `${indexName}.${id} pixelRatio`);
        assert.ok(cell.x + cell.width <= header.width, `${indexName}.${id} stays inside the atlas`);
        assert.equal(cell.y, 0, `${indexName}.${id} sits on the single row`);
      }
    }
  });

  it('the shipped sprite is byte-for-byte what the generator renders (no stale atlas)', () => {
    // The atlas is a build artefact committed to the repo, so it can go stale:
    // an icon added to the generator without re-running it, a hand-patched PNG,
    // a partially committed file set. Re-rendering in memory is cheap for 12
    // icons and is the same comparison `--check` makes.
    const rendered = buildKidbusSprite();
    assert.equal(rendered.size, 4, 'two pixel ratios × index + image');
    for (const [name, contents] of rendered) {
      const shipped = readFileSync(join(SPRITE_DIR, name));
      const expected = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
      assert.ok(
        shipped.equals(expected),
        `${name} differs from the generator — run \`node scripts/generate-kidbus-sprite.mjs\``,
      );
    }
  });

  it('the sprite files exist where the web app serves them from', () => {
    for (const name of ['kidbus.json', 'kidbus.png', 'kidbus@2x.json', 'kidbus@2x.png']) {
      assert.ok(existsSync(join(webRoot, 'public/map-sprites', name)), `missing sprite file: ${name}`);
    }
    assert.ok(existsSync(join(webRoot, '..', 'scripts', 'generate-kidbus-sprite.mjs')));
  });
});

/**
 * Every class label an `icon-image` match can be asked about (the label arrays
 * of the `match` pairs, flattened). The fallback branch is evaluated separately.
 */
function matchLabels(expression: unknown): string[] {
  if (!Array.isArray(expression)) return [];
  const [op, , ...pairs] = expression as unknown[];
  if (op !== 'match') return [];
  const labels: string[] = [];
  for (let i = 0; i < pairs.length - 1; i += 2) {
    const label = pairs[i];
    if (Array.isArray(label)) labels.push(...label.map(String));
    else if (typeof label === 'string') labels.push(label);
  }
  return labels;
}

describe('road names ride their roads (transportation_name)', () => {
  it('declares line placement, map rotation, spacing, zoom sizes, minzoom and a halo', () => {
    for (const [name, style] of SHIPPED) {
      const nameLayers = style.layers.filter((layer) => layer.id.startsWith('transportation_name'));
      assert.ok(nameLayers.length >= 1, `${name} must ship a road-name layer`);
      for (const layer of nameLayers) {
        const layout = layer.layout ?? {};
        const paint = layer.paint ?? {};
        assert.equal(layout['symbol-placement'], 'line', `${name}.${layer.id}: symbol-placement`);
        assert.equal(
          layout['text-rotation-alignment'],
          'map',
          `${name}.${layer.id}: text-rotation-alignment`,
        );
        assert.equal(
          layout['text-pitch-alignment'],
          'viewport',
          `${name}.${layer.id}: labels stay readable in the 3D camera`,
        );
        const spacing = layout['symbol-spacing'];
        assert.equal(typeof spacing, 'number', `${name}.${layer.id}: symbol-spacing`);
        assert.ok(Number(spacing) >= 200, `${name}.${layer.id}: spacing of ${spacing} repeats too often`);
        // A constant size at every zoom is how a label carpet starts.
        const size = layout['text-size'];
        assert.ok(Array.isArray(size), `${name}.${layer.id}: text-size must be zoom-interpolated`);
        assert.equal(size[0], 'interpolate', `${name}.${layer.id}: text-size expression`);
        assert.ok(String(size).includes('zoom'), `${name}.${layer.id}: text-size must depend on zoom`);
        assert.ok(layer.minzoom !== undefined && layer.minzoom >= 12, `${name}.${layer.id}: minzoom`);
        assert.ok(
          typeof paint['text-halo-width'] === 'number' && Number(paint['text-halo-width']) >= 1,
          `${name}.${layer.id}: halo (the name must survive a busy tile)`,
        );
        assert.equal(typeof layout['text-field'], 'object', `${name}.${layer.id}: text-field`);
        assert.equal(typeof layout['text-font'], 'object', `${name}.${layer.id}: text-font (never default)`);
      }
      // Hierarchy: the major-road names appear before the minor ones.
      const major = layerOf(style, 'transportation_name');
      const minor = layerOf(style, 'transportation_name-minor');
      assert.ok(major && minor, `${name}: both road-name layers`);
      assert.ok(
        Number(major.minzoom) < Number(minor.minzoom),
        `${name}: major road names must appear before minor road names`,
      );
    }
  });
});

describe('area names are class-wise, and the colony names survive at z13–16', () => {
  /**
   * The ladder (Session 7): the class → minzoom table the tracking map's
   * z13–16 band depends on. `label_other`-style classes (suburb, quarter,
   * hamlet, neighbourhood, city_block) are the ones that used to disappear.
   */
  const EXPECTED = [
    { id: 'place-city', classes: ['city'], minzoom: 2 },
    { id: 'place-town', classes: ['town'], minzoom: 6 },
    { id: 'place-village', classes: ['village'], minzoom: 9 },
    { id: 'place-suburb', classes: ['suburb'], minzoom: 11 },
    { id: 'place-quarter', classes: ['quarter'], minzoom: 12 },
    { id: 'place-hamlet', classes: ['hamlet'], minzoom: 13 },
    { id: 'place-neighbourhood', classes: ['neighbourhood', 'city_block'], minzoom: 13 },
  ] as const;

  it('ships one layer per class, each with its own minzoom', () => {
    for (const [name, style] of SHIPPED) {
      for (const expected of EXPECTED) {
        const layer = layerOf(style, expected.id);
        assert.ok(layer, `${name}: missing ${expected.id}`);
        assert.equal(layer.minzoom, expected.minzoom, `${name}.${expected.id}: minzoom`);
        assert.equal(layer['source-layer'], 'place', `${name}.${expected.id}: reads the place layer`);
        // A class filter, never the old unfiltered single `place` layer.
        const filter = JSON.stringify(layer.filter);
        for (const klass of expected.classes) {
          assert.ok(
            filter.includes(`"${klass}"`),
            `${name}.${expected.id}: filter must name class ${klass} (got ${filter})`,
          );
        }
        assert.ok(
          filter.startsWith('["match",["get","class"]'),
          `${name}.${expected.id}: filter must be a ` +
            'class match on the tile feature',
        );
      }
      assert.equal(
        layerOf(style, 'place'),
        undefined,
        `${name}: there is no single unfiltered place layer any more`,
      );
    }
  });

  it('keeps the z13–16 band: every colony-class layer is live there', () => {
    for (const [name, style] of SHIPPED) {
      for (const id of ['place-suburb', 'place-quarter', 'place-hamlet', 'place-neighbourhood']) {
        const layer = layerOf(style, id)!;
        assert.ok(Number(layer.minzoom) <= 13, `${name}.${id}: must appear by z13`);
        const maxzoom = layer.maxzoom;
        assert.ok(
          maxzoom === undefined || Number(maxzoom) > 16,
          `${name}.${id}: must not be hidden before z16`,
        );
        // A name that draws at z13 needs a size, a halo and a sort key.
        const layout = layer.layout ?? {};
        const paint = layer.paint ?? {};
        assert.ok(Array.isArray(layout['text-size']), `${name}.${id}: zoom-interpolated size`);
        assert.ok(layout['symbol-sort-key'] !== undefined, `${name}.${id}: symbol-sort-key`);
        assert.ok(['number', 'string'].includes(typeof paint['text-halo-width']), `${name}.${id}: halo`);
      }
    }
  });

  it('orders the layers by importance, so the big name wins a collision on purpose', () => {
    const order = SHIPPED[0][1].layers.map((layer) => layer.id);
    const index = (id: string) => {
      const at = order.indexOf(id);
      assert.ok(at >= 0, `missing layer ${id}`);
      return at;
    };
    const ladder = ['place-city', 'place-town', 'place-village', 'place-suburb', 'place-quarter', 'place-hamlet', 'place-neighbourhood'];
    for (let i = 1; i < ladder.length; i += 1) {
      assert.ok(
        index(ladder[i - 1]) < index(ladder[i]),
        `${ladder[i - 1]} must be placed before ${ladder[i]} (earlier layer wins a collision)`,
      );
    }
    // And the ranking *within* the two layers that share z13 is deliberate:
    // a suburb beats a neighbourhood.
    const suburbKey = layerOf(SHIPPED[0][1], 'place-suburb')!.layout!['symbol-sort-key'];
    const neighbourhoodKey = layerOf(SHIPPED[0][1], 'place-neighbourhood')!.layout!['symbol-sort-key'];
    assert.equal(typeof suburbKey, 'number');
    assert.equal(typeof neighbourhoodKey, 'number');
    assert.ok(Number(suburbKey) < Number(neighbourhoodKey), 'lower sort key = placed first');
  });

  it('gives every place layer a size ladder that grows with zoom', () => {
    for (const [name, style] of SHIPPED) {
      for (const expected of EXPECTED) {
        const size = layoutOf(style, expected.id)['text-size'];
        assert.ok(Array.isArray(size), `${name}.${expected.id}: text-size`);
        assert.equal(size[0], 'interpolate', `${name}.${expected.id}: text-size expression`);
      }
    }
  });
});

describe('POIs are placed deliberately, not carpeted', () => {
  it('gates the POI layer by zoom and ranks what survives', () => {
    for (const [name, style] of SHIPPED) {
      const layer = layerOf(style, 'poi')!;
      assert.ok(layer, `${name}: poi layer`);
      assert.ok(Number(layer.minzoom) >= 13, `${name}: POIs must not draw at overview zooms`);
      const layout = layer.layout ?? {};
      assert.ok(layout['symbol-sort-key'] !== undefined, `${name}: poi symbol-sort-key`);
      assert.deepEqual(
        layout['text-variable-anchor'],
        ['top', 'bottom', 'left', 'right'],
        `${name}: labels must be able to hop around the icon`,
      );
      assert.equal(layout['text-optional'], true, `${name}: an icon still draws when its label cannot`);
      // The zoom-dependent rank bar: the filter itself must depend on zoom.
      assert.ok(
        JSON.stringify(layer.filter).includes('"zoom"'),
        `${name}: the poi filter must gate by rank *and* zoom, not by rank alone`,
      );
      const size = layout['icon-size'];
      assert.ok(Array.isArray(size) && size[0] === 'interpolate', `${name}: icon-size ladder`);
    }
  });
});
