/**
 * The map-style pipeline's React/native wiring — the impure half of the
 * label-health story whose decisions all live in `map-style.ts` (pure, pinned
 * by `map-style.spec.ts`).
 *
 * On mount (per style URL) it:
 *
 * 1. fetches the style JSON in JS and repairs a missing/non-https `glyphs`
 *    template (`inspectMapStyle`) — a repaired style is passed to the map as
 *    an object, an intact one keeps its URL (and its CDN caching);
 * 2. registers one percent-encoded fontstack rewrite per declared `text-font`
 *    stack (`TransformRequestManager`), so the Android glyph fetch asks for
 *    `Noto%20Sans%20Regular` instead of a space-broken path;
 * 3. probes one real glyph URL to VERIFY the fonts endpoint answers — a 404
 *    there is the LiveTrafficStan#82 "silently unlabeled" failure;
 * 4. routes native map errors (`LogManager.onLog`) into the same diagnostics,
 *    and every failure becomes a visible `map.issue.*` line on the map panel
 *    and a Help-diagnostics row — never blank-silent.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  LogManager,
  TransformRequestManager,
  type MapProps,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';
import {
  buildGlyphProbeUrl,
  glyphUrlTransforms,
  inspectMapStyle,
  resolveMapStyleUrl,
  type MapStyleIssueCode,
} from './map-style.ts';
import {
  getMapIssues,
  reportMapIssue,
  subscribeMapIssues,
} from './map-diagnostics.ts';

export interface MapStyleState {
  /** Value for the map's `mapStyle` prop: the URL, or the repaired style. */
  mapStyle: MapProps['mapStyle'];
  /** Issues reported so far (also mirrored in the map-diagnostics store). */
  issues: readonly MapStyleIssueCode[];
}

/** Classifies a native log line into a map issue code, or `null` to ignore. */
export function classifyMapLog(
  level: string,
  tag: string | null,
  message: string | null,
): MapStyleIssueCode | null {
  if (level !== 'error' && level !== 'warn') return null;
  const text = `${tag ?? ''} ${message ?? ''}`.toLowerCase();
  if (text.includes('glyph') || text.includes('font')) return 'glyphs';
  if (text.includes('style') || text.includes('maplibre') || text.includes('mbgl')) {
    return 'styleLoad';
  }
  return null;
}

export function useMapStyle(
  env: Record<string, string | undefined> = {
    EXPO_PUBLIC_MAP_STYLE_URL: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
  },
): MapStyleState {
  const styleUrl = resolveMapStyleUrl(env);
  const [mapStyle, setMapStyle] = useState<MapProps['mapStyle']>(styleUrl);
  const issues = useSyncExternalStore(subscribeMapIssues, getMapIssues);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(styleUrl);
        if (!response.ok) throw new Error(`style HTTP ${response.status}`);
        const inspection = inspectMapStyle(await response.json());
        if (cancelled) return;
        if (inspection.glyphsTemplate === null) throw new Error('style JSON is not an object');

        for (const transform of glyphUrlTransforms(inspection.fontStacks)) {
          TransformRequestManager.addUrlTransform(transform);
        }

        if (inspection.glyphsRepaired) {
          reportMapIssue('glyphs');
        }

        if (inspection.fontStacks.length > 0) {
          // Verify — do not assume. One small range from the first declared
          // stack is enough to prove the fonts endpoint answers.
          const probe = await fetch(
            buildGlyphProbeUrl(inspection.glyphsTemplate, inspection.fontStacks[0]),
          );
          if (!probe.ok) reportMapIssue('glyphs');
        }

        if (!cancelled && inspection.glyphsRepaired) {
          setMapStyle(inspection.style as unknown as StyleSpecification);
        }
      } catch {
        if (!cancelled) reportMapIssue('styleLoad');
      }
    })();

    // Native failures (style parse, glyph 404, WebGL loss) arrive as log
    // lines on Android — capture, classify, surface. `return false` keeps the
    // default console behaviour so nothing is swallowed.
    const subscription = LogManager.onLog((event) => {
      const code = classifyMapLog(event.level, event.tag ?? null, event.message ?? null);
      if (code !== null) reportMapIssue(code);
      return false;
    });

    return () => {
      cancelled = true;
      // `onLog` returns a handle in current builds and void in older ones.
      const handle = subscription as { remove?: () => void } | undefined;
      handle?.remove?.();
    };
  }, [styleUrl]);

  return { mapStyle, issues };
}
