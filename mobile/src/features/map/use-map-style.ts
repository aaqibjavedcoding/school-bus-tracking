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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { mapStyleForDimension, type MapDimension } from '@school-bus-tracking/map-assets';
import type { MapProps, StyleSpecification } from '@maplibre/maplibre-react-native';
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
import { planStyleLoadFailure, runWithBackoff } from './map-style-recovery.ts';
import {
  classifyMapLog,
  planStyleFailureReporting,
  planStyleLoadedReporting,
  shouldRetryOnNetworkChange,
} from './map-issue-policy.ts';
import {
  clearMapIssue,
  getMapIssues,
  recordMapLog,
  reportMapIssue,
  setMapRetryHandler,
  subscribeMapIssues,
} from './map-diagnostics.ts';
import { useNetworkStatus } from '../../hooks/useNetworkStatus.ts';

/**
 * MapLibre is a custom native module and Expo Go does not carry it. Keep the
 * module require out of this file's evaluation path; the hook only loads it
 * once a real native map surface is enabled.
 */
type MapLibreModule = typeof import('@maplibre/maplibre-react-native');

function requireMapLibre(): MapLibreModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@maplibre/maplibre-react-native') as MapLibreModule;
}

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
  /**
   * Re-run the style pipeline from scratch, resetting the bounded budget.
   *
   * Driven from two places: the "tap to retry" affordance on the degraded
   * chip, and automatically when the device network comes back. The second
   * is what makes "turn airplane mode off and the notice clears itself, with
   * no restart and no tap" true.
   */
  retryStyleLoad: () => void;
}

/**
 * Re-exported from `map-issue-policy.ts`, where it moved so the allow-list
 * can be pinned without React or the native module in scope.
 */
export { classifyMapLog } from './map-issue-policy.ts';

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

  /** Applies a `MapIssuePlan` from the pure policy to the diagnostics store. */
  function applyIssuePlan(plan: {
    report: readonly MapStyleIssueCode[];
    clear: readonly MapStyleIssueCode[];
  }): void {
    for (const code of plan.clear) clearMapIssue(code);
    for (const code of plan.report) reportMapIssue(code);
  }

  function clearRetryTimer(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  /**
   * The floor: the bundled offline base style. Reachable with zero network,
   * so it is the one style that can always be set when everything else ran
   * out.
   *
   * This state is **degraded, not failed**. Stops, the route line and the bus
   * all still render over the offline base — the map does its job, it just
   * has no streamed tiles. Reporting `styleLoad` (red, "Map failed to load —
   * check your network connection and map tiles") for a map the user can see
   * and use was simply untrue, so it reports `offlineFallback` instead: a
   * neutral chip with a retry affordance.
   */
  function showOfflineFallback(): void {
    clearRetryTimer();
    showingFallback = true;
    baseStyle = null;
    reportMapIssue('offlineFallback');
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

      const { TransformRequestManager } = requireMapLibre();
      for (const transform of glyphUrlTransforms(inspection.fontStacks)) {
        TransformRequestManager.addUrlTransform(transform);
      }

      showingFallback = false;
      consecutiveNativeFailures = 0;
      retryGeneration = 0;
      // The real style is back. Both the degraded chip and any terminal line
      // are stale the moment a fetched style is handed to the engine.
      clearMapIssue('offlineFallback');
      clearMapIssue('styleLoad');
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
      // The bounded budget is spent. `showOfflineFallback` reports the
      // degraded chip — the map still works, so this is not `styleLoad`.
      showOfflineFallback();
    } finally {
      fetching = false;
    }
  }

  /**
   * The engine said the style failed. Bounded re-sets, then the fallback.
   *
   * Reporting happens **after** the plan, not before it. Reporting first
   * contradicted the bounded-backoff design in `map-style-recovery.ts`: the
   * first of up to four attempts raised a red permanent line before the
   * second attempt had even been scheduled, so a single flaky request on
   * mobile data read as a dead map. The pipeline now stays silent while it
   * still has retries left, and speaks only once the budget is spent (or the
   * fallback itself could not load).
   */
  function onStyleLoadFailed(): void {
    if (disposed) return;
    const action = planStyleLoadFailure({
      showingFallback,
      recoveryInFlight: fetching || retryTimer !== null,
      consecutiveFailures: consecutiveNativeFailures,
    });
    // What the user is told follows the plan and never precedes it.
    applyIssuePlan(planStyleFailureReporting({ action, showingFallback }));

    if (action.kind === 'fallback') {
      // Budget spent: drop to the bundled offline base style.
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
    // Something rendered, so the terminal "nothing renders" line is false
    // whatever it was that rendered — including the offline fallback.
    clearMapIssue('styleLoad');
    // The degraded chip only clears when what loaded is a real, online style;
    // the fallback loading is not the tiles coming back.
    if (!showingFallback) clearMapIssue('offlineFallback');
    // Belt and braces: the same decision, from the pure policy, so the two
    // can never drift. `clearMapIssue` is idempotent and does not notify when
    // there is nothing to clear.
    applyIssuePlan(planStyleLoadedReporting(showingFallback));
  }

  /**
   * Re-run the whole pipeline from scratch: the manual "tap to retry" on the
   * degraded chip, and the automatic re-run when the network comes back.
   *
   * Resets the bounded budget, because the circumstances genuinely changed —
   * that is the difference between this and one more attempt in the sequence.
   */
  function retryStyleLoad(): void {
    if (disposed) return;
    clearRetryTimer();
    consecutiveNativeFailures = 0;
    retryGeneration = 0;
    void runPipeline();
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
    retryStyleLoad,
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
  dimension: MapDimension = '2d',
  /** False while the Expo Go fallback is being rendered. */
  enabled = true,
): MapStyleState {
  const styleUrl = resolveMapStyleUrl(env);
  const [mapStyle, setMapStyle] = useState<MapProps['mapStyle']>(styleUrl);
  // URLs cannot be decorated, so the initial request remains the existing
  // OpenFreeMap URL. Once the inspected style object arrives, 3D adds only a
  // sky and a layer that references its already-present vector source.
  const presentedMapStyle = useMemo(
    () => mapStyleForDimension(mapStyle, dimension) as MapProps['mapStyle'],
    [mapStyle, dimension],
  );
  const issues = useSyncExternalStore(subscribeMapIssues, getMapIssues);
  const network = useNetworkStatus();

  const controllerRef = useRef<StyleController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createStyleController({ setMapStyle });
  }
  const controller = controllerRef.current;
  // The controller was created once; keep its view of the URL current.
  controller.styleUrl = styleUrl;

  useEffect(() => {
    if (!enabled) {
      // Dispose any native work if a route changes from a real map to the
      // fallback (for example after a runtime-policy refresh). Most
      // importantly, do not require MapLibre on this path.
      controller.dispose();
      setMapRetryHandler(null);
      return;
    }

    controller.resume();
    void controller.runPipeline();

    // Native failures (style parse, glyph 404, WebGL loss) arrive as log
    // lines on Android — capture, classify, surface. Recovery scheduling is
    // deliberately NOT driven from log lines: they are noisy, and the
    // engine's `onDidFailLoadingMap` event is the bounded retry's trigger.
    // `return false` keeps the default console behaviour so nothing is
    // swallowed.
    const { LogManager } = requireMapLibre();
    const subscription = LogManager.onLog((event) => {
      const code = classifyMapLog(event.level, event.tag ?? null, event.message ?? null);
      if (code !== null) {
        // Recorded, never reported. A native log line may corroborate an
        // issue the style pipeline has already concluded — it may never raise
        // one by itself, because the engine logs at warn/error while working
        // perfectly and this subscription used to turn every one of those
        // into a red "Map failed to load". The raw text is kept so Help →
        // Diagnostics can still name what failed from a field screenshot.
        recordMapLog(code, `${event.tag ?? ''} ${event.message ?? ''}`);
      }
      return false;
    });

    // The retry affordance on the degraded chip lives inside `MapIssueLines`,
    // which reads the diagnostics store rather than taking props through two
    // component trees — so the pipeline registers its retry there too.
    setMapRetryHandler(controller.retryStyleLoad);

    return () => {
      controller.dispose();
      setMapRetryHandler(null);
      // `onLog` returns a handle in current builds and void in older ones.
      const handle = subscription as { remove?: () => void } | undefined;
      handle?.remove?.();
    };
  }, [enabled, styleUrl, controller]);

  // Auto-recovery on reconnect. Airplane mode off must clear the notice with
  // no app restart and no manual tap, so the transition into `online` re-runs
  // the whole pipeline (which clears the issues on success).
  const previousNetworkRef = useRef(network);
  useEffect(() => {
    const previous = previousNetworkRef.current;
    previousNetworkRef.current = network;
    if (!enabled || !shouldRetryOnNetworkChange(previous, network)) return;
    controller.retryStyleLoad();
  }, [enabled, network, controller]);

  return {
    mapStyle: presentedMapStyle,
    issues,
    onStyleLoadFailed: controller.onStyleLoadFailed,
    notifyStyleLoaded: controller.notifyStyleLoaded,
    retryStyleLoad: controller.retryStyleLoad,
  };
}
