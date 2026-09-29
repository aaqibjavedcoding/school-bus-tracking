/**
 * The map-style pipeline's React/native wiring — the impure half of the
 * label-health story whose decisions all live in `map-style.ts` (pure, pinned
 * by `map-style.spec.ts`) and whose retry policy lives in
 * `map-style-recovery.ts` (pure, pinned by `map-style-recovery.spec.ts`).
 *
 * On mount (per style URL) it:
 *
 * 1. fetches the style JSON in JS **with bounded backoff** (deep-fix R3:
 *    `[2 s, 5 s, 15 s]` — one flaky first fetch on mobile data used to be a
 *    permanent red line and a dead map until the app restarted) and repairs a
 *    missing/non-https `glyphs` template (`inspectMapStyle`); the inspected
 *    object is passed to the map so the successful retry is the request
 *    MapLibre actually uses;
 * 2. registers one percent-encoded fontstack rewrite per declared `text-font`
 *    stack (`TransformRequestManager`), so the Android glyph fetch asks for
 *    `Noto%20Sans%20Regular` instead of a space-broken path;
 * 3. probes one real glyph URL to VERIFY the fonts endpoint answers — a 404
 *    there is the LiveTrafficStan#82 "silently unlabeled" failure;
 * 4. routes native map errors (`LogManager.onLog`) into the same diagnostics,
 *    and every failure becomes a visible `map.issue.*` line on the map panel
 *    and a Help-diagnostics row — never blank-silent.
 *
 * ### Recovery (R3), stated once
 *
 * - **The fetch retries** (`runWithBackoff`): one flaky first fetch on mobile
 *   data used to be a permanent red line and a dead map until the app
 *   restarted. When the whole bounded budget is spent the pipeline reports
 *   `styleLoad` and swaps in the bundled offline base style
 *   (`OFFLINE_FALLBACK_MAP_STYLE` — zero network, a plain background), so a
 *   dead-zone phone still shows stops, the bus and an honest status instead
 *   of a dead box.
 * - **The engine's own load retries** (`onStyleLoadFailed`, wired to the
 *   Map's `onDidFailLoadingMap`): `planStyleLoadFailure` schedules a bounded
 *   sequence of style **re-sets** (`restyleForRetry`, one `metadata` nonce —
 *   the bridge stringifies the style, so only a different string reloads),
 *   and the same offline fallback when the budget is spent.
 * - **Recovery clears the line**: `notifyStyleLoaded` (wired ahead of the
 *   camera's `onDidFinishLoadingMap`) clears `styleLoad` — but never while
 *   the fallback is showing, because the fallback loading is not the tiles
 *   coming back. A successful glyph probe (or a style with nothing to label)
 *   clears `glyphs`.
 *
 * One recovery runs at a time (`planStyleLoadFailure` → `wait` while one is
 * in flight); every timer is cleared on unmount.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  LogManager,
  TransformRequestManager,
  type MapProps,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';
import {
  OFFLINE_FALLBACK_MAP_STYLE,
  buildGlyphProbeUrl,
  glyphUrlTransforms,
  inspectMapStyle,
  resolveMapStyleUrl,
  restyleForRetry,
  type MapStyleIssueCode,
  type StyleInspection,
} from './map-style.ts';
import {
  planStyleLoadFailure,
  runWithBackoff,
} from './map-style-recovery.ts';
import {
  clearMapIssue,
  getMapIssues,
  reportMapIssue,
  subscribeMapIssues,
} from './map-diagnostics.ts';

export interface MapStyleState {
  /** Value for the map's `mapStyle` prop: URL while loading, then the inspected style object. */
  mapStyle: MapProps['mapStyle'];
  /** Issues reported so far (also mirrored in the map-diagnostics store). */
  issues: readonly MapStyleIssueCode[];
  /**
   * Wire to the Map's `onDidFailLoadingMap`: reports `styleLoad` and runs the
   * bounded re-set/recovery policy. Never leave the engine's failure silent.
   */
  onStyleLoadFailed: () => void;
  /**
   * Wire to the Map's `onDidFinishLoadingMap` (before the camera's handler):
   * the load that actually succeeded is what clears the `styleLoad` line.
   */
  notifyStyleLoaded: () => void;
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

interface StyleControllerDeps {
  setMapStyle: (style: StyleSpecification) => void;
}

/**
 * The per-hook recovery controller. One per map surface, created once and
 * held in a ref, so the two event handlers the Map needs are referentially
 * stable (the surfaces are `React.memo`'d — a new closure per render would
 * bust the memo every 5 s status tick). Everything mutable lives here, not
 * in React state, because none of it is render data.
 */
function createStyleController(deps: StyleControllerDeps) {
  /** The URL being loaded; refreshed per render by the hook body. */
  let styleUrl = '';
  /** Unmounted (or effect-cleaned-up): every scheduled thing must stop. */
  let disposed = false;
  /** The fetch pipeline is running — a native did-fail must not double up. */
  let fetching = false;
  /** Pending bounded re-set, if any. */
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive native failures since the last genuinely loaded style. */
  let consecutiveNativeFailures = 0;
  /** The inspected style object, kept so a re-set can re-issue it (with a nonce). */
  let baseStyle: Record<string, unknown> | null = null;
  /** Re-set nonce, so the engine bridge sees a *different* style string. */
  let retryGeneration = 0;
  /** True while the bundled offline base style is what the map shows. */
  let showingFallback = false;

  function clearRetryTimer(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  /**
   * The floor: the bundled offline base style. Reachable with zero network,
   * so it is the one style that can always be set when everything else ran
   * out — and the `styleLoad` line stays up over it, naming the cause.
   */
  function showOfflineFallback(): void {
    clearRetryTimer();
    showingFallback = true;
    baseStyle = null;
    deps.setMapStyle(OFFLINE_FALLBACK_MAP_STYLE as unknown as StyleSpecification);
  }

  /** The glyph-endpoint verification: probe decides, success clears. */
  async function verifyGlyphs(
    glyphsTemplate: string,
    fontStacks: readonly string[],
    glyphsRepaired: boolean,
  ): Promise<void> {
    if (glyphsRepaired) reportMapIssue('glyphs');
    if (fontStacks.length === 0) {
      // Nothing to label by design — no stale line from an earlier style.
      if (!disposed) clearMapIssue('glyphs');
      return;
    }
    // Verify — do not assume. One small range from the first declared
    // stack is enough to prove the fonts endpoint answers.
    try {
      const probe = await fetch(buildGlyphProbeUrl(glyphsTemplate, fontStacks[0]));
      if (disposed) return;
      if (probe.ok) {
        clearMapIssue('glyphs');
      } else {
        reportMapIssue('glyphs');
      }
    } catch {
      if (!disposed) reportMapIssue('glyphs');
    }
  }

  /**
   * The JS pipeline: bounded fetch → repair → hand the inspected object to
   * the map. On total exhaustion: the offline base style, plus the line that
   * names the cause. Success does not clear `styleLoad` here — the engine
   * still has to *render* the style, and `notifyStyleLoaded` owns that.
   */
  async function runPipeline(): Promise<void> {
    if (fetching || disposed) return;
    fetching = true;
    try {
      const inspection = await runWithBackoff({
        isCancelled: () => disposed,
        attempt: async () => {
          const response = await fetch(styleUrl);
          if (!response.ok) throw new Error(`style HTTP ${response.status}`);
          const inspected = inspectMapStyle(await response.json());
          if (inspected.glyphsTemplate === null) {
            throw new Error('style JSON is not an object');
          }
          // Narrowed past the guard: every caller below reads a real template.
          return inspected as StyleInspection & { glyphsTemplate: string };
        },
      });
      if (disposed) return;

      for (const transform of glyphUrlTransforms(inspection.fontStacks)) {
        TransformRequestManager.addUrlTransform(transform);
      }

      showingFallback = false;
      consecutiveNativeFailures = 0;
      retryGeneration = 0;
      // Passing the inspected object means a successful *retried* JS fetch is
      // the style MapLibre uses; leaving the URL here would ask the engine to
      // make a separate, un-retried style request of its own.
      baseStyle = inspection.style;
      deps.setMapStyle(inspection.style as unknown as StyleSpecification);

      await verifyGlyphs(
        inspection.glyphsTemplate,
        inspection.fontStacks,
        inspection.glyphsRepaired,
      );
    } catch {
      if (disposed) return;
      reportMapIssue('styleLoad');
      showOfflineFallback();
    } finally {
      fetching = false;
    }
  }

  /** The engine said the style failed. Bounded re-sets, then the fallback. */
  function onStyleLoadFailed(): void {
    if (disposed) return;
    reportMapIssue('styleLoad');
    const action = planStyleLoadFailure({
      showingFallback,
      recoveryInFlight: fetching || retryTimer !== null,
      consecutiveFailures: consecutiveNativeFailures,
    });
    if (action.kind === 'fallback') {
      showOfflineFallback();
      return;
    }
    if (action.kind !== 'retry') return;
    consecutiveNativeFailures += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (disposed) return;
      if (baseStyle !== null) {
        // Re-set the inspected style. The bridge forwards
        // `JSON.stringify(mapStyle)`, and React's prop diff dispatches only a
        // *changed* string — an identical object re-set would never reach the
        // engine, so the nonce copy is what makes this a real retry.
        retryGeneration += 1;
        deps.setMapStyle(
          restyleForRetry(baseStyle, retryGeneration) as unknown as StyleSpecification,
        );
      } else {
        // The map is still on the raw URL: run the fetch pipeline (bounded)
        // to get the inspected object — or the fallback if the network is gone.
        void runPipeline();
      }
    }, action.delayMs);
  }

  /**
   * The engine said the style finished loading. That — not the fetch, not
   * the re-set — is what clears the line; and only when what loaded is a real
   * style, because the offline fallback rendering is no recovery at all.
   */
  function notifyStyleLoaded(): void {
    clearRetryTimer();
    consecutiveNativeFailures = 0;
    if (!showingFallback) clearMapIssue('styleLoad');
  }

  return {
    get styleUrl() {
      return styleUrl;
    },
    set styleUrl(next: string) {
      styleUrl = next;
    },
    runPipeline,
    onStyleLoadFailed,
    notifyStyleLoaded,
    /** Effect start/restart: allow work again. */
    resume(): void {
      disposed = false;
    },
    /** Unmount / URL change: stop every scheduled thing. */
    dispose(): void {
      disposed = true;
      clearRetryTimer();
    },
  };
}

type StyleController = ReturnType<typeof createStyleController>;

export function useMapStyle(
  env: Record<string, string | undefined> = {
    EXPO_PUBLIC_MAP_STYLE_URL: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
  },
): MapStyleState {
  const styleUrl = resolveMapStyleUrl(env);
  const [mapStyle, setMapStyle] = useState<MapProps['mapStyle']>(styleUrl);
  const issues = useSyncExternalStore(subscribeMapIssues, getMapIssues);

  const controllerRef = useRef<StyleController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createStyleController({ setMapStyle });
  }
  const controller = controllerRef.current;
  // The controller was created once; keep its view of the URL current.
  controller.styleUrl = styleUrl;

  useEffect(() => {
    controller.resume();
    void controller.runPipeline();

    // Native failures (style parse, glyph 404, WebGL loss) arrive as log
    // lines on Android — capture, classify, surface. Recovery scheduling is
    // deliberately NOT driven from log lines: they are noisy, and the
    // engine's `onDidFailLoadingMap` event is the bounded retry's trigger.
    // `return false` keeps the default console behaviour so nothing is
    // swallowed.
    const subscription = LogManager.onLog((event) => {
      const code = classifyMapLog(event.level, event.tag ?? null, event.message ?? null);
      if (code !== null) reportMapIssue(code);
      return false;
    });

    return () => {
      controller.dispose();
      // `onLog` returns a handle in current builds and void in older ones.
      const handle = subscription as { remove?: () => void } | undefined;
      handle?.remove?.();
    };
  }, [styleUrl, controller]);

  return {
    mapStyle,
    issues,
    onStyleLoadFailed: controller.onStyleLoadFailed,
    notifyStyleLoaded: controller.notifyStyleLoaded,
  };
}
