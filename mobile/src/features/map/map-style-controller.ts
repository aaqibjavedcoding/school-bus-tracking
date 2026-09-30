/**
 * The map-style pipeline's decisions, with every impure thing injected.
 *
 * `use-map-style.ts` is now only the React/native binding: it supplies the
 * ports (the `fetch`, the `TransformRequestManager`, the `mapStyle` setter),
 * subscribes to the native log bridge and to `useNetworkStatus`, and hands
 * the engine's events to this controller. Everything that *decides* lives
 * here, so `map-style-controller.spec.ts` can drive the whole lifecycle —
 * failure, retry, fallback, network return, recovery — under plain
 * `node --test` with no native module and no real network.
 *
 * ### What it does, on mount (per style URL)
 *
 * 1. fetches the style JSON with **bounded backoff** (`runWithBackoff`,
 *    `[2 s, 5 s, 15 s]`) and repairs a missing/non-https `glyphs` template
 *    (`inspectMapStyle`); the inspected object is what the map is given, so
 *    the successful retry is the request MapLibre actually uses;
 * 2. registers one percent-encoded fontstack rewrite per declared
 *    `text-font` stack, so the Android glyph fetch asks for
 *    `Noto%20Sans%20Regular` instead of a space-broken path;
 * 3. probes one real glyph URL to VERIFY the fonts endpoint answers.
 *
 * ### When it is allowed to say something is wrong
 *
 * This is the half that was broken, and the rules now are:
 *
 * - **Silence during retries.** `onStyleLoadFailed` reports nothing while
 *   `planStyleLoadFailure` is still handing out `retry`. Reporting before the
 *   first retry had even run contradicted the whole bounded-backoff design.
 * - **The fallback is not a failure.** When the budget is spent the map drops
 *   to the bundled offline base style and reports `styleOffline` — a neutral
 *   "Offline map — tap to retry" chip. The map genuinely works: the markers,
 *   the ring and the panel are all app-drawn.
 * - **Red means terminal.** `styleLoad` is reported only when the engine
 *   fails *while the offline fallback is already showing*, i.e. it cannot
 *   render even a style that needs no network.
 * - **A log line may only corroborate.** `corroborateLog` can confirm an
 *   issue the pipeline already concluded; it can never raise one.
 * - **Recovery is automatic.** A real style load or a fully-rendered frame
 *   clears the lines, and `onNetworkRestored()` re-runs the whole pipeline
 *   when connectivity comes back — no restart, no tap.
 */

import {
  OFFLINE_FALLBACK_MAP_STYLE,
  buildGlyphProbeUrl,
  glyphUrlTransforms,
  inspectMapStyle,
  restyleForRetry,
  type GlyphUrlTransform,
  type StyleInspection,
} from './map-style.ts';
import { planStyleLoadFailure, runWithBackoff } from './map-style-recovery.ts';
import { clearMapIssue, reportMapIssue } from './map-diagnostics.ts';

/** The smallest response shape the pipeline reads. */
export interface StyleFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Everything impure, injected. */
export interface StyleControllerPorts {
  /** Hands a style (URL string or inspected object) to the map surface. */
  setMapStyle(style: unknown): void;
  /** `TransformRequestManager.addUrlTransform` in production. */
  addUrlTransform(transform: GlyphUrlTransform): void;
  /** `fetch` in production; a stub in specs. */
  fetchResource(url: string): Promise<StyleFetchResponse>;
  /** Between-attempt wait; defaults to the real bounded sleeper. */
  sleep?: (delayMs: number) => Promise<void>;
  /** The re-set timer; defaults to `setTimeout`. */
  schedule?: (callback: () => void, delayMs: number) => unknown;
  /** Cancels a `schedule` handle; defaults to `clearTimeout`. */
  cancel?: (handle: unknown) => void;
}

export interface StyleController {
  styleUrl: string;
  /** Run the fetch → repair → verify pipeline. */
  runPipeline(): Promise<void>;
  /** Wire to the Map's `onDidFailLoadingMap`. */
  onStyleLoadFailed(): void;
  /** Wire to the Map's `onDidFinishLoadingMap`, ahead of the camera's. */
  notifyStyleLoaded(): void;
  /** Wire to the Map's `onDidFinishRenderingMapFully`. */
  notifyTilesRendered(): void;
  /** The network came back: re-run the pipeline if anything is still wrong. */
  onNetworkRestored(): void;
  /** The user tapped the "Offline map — tap to retry" chip. */
  retryNow(): void;
  /** A native log line that the strict classifier considered fatal. */
  corroborateLog(code: 'styleLoad' | 'glyphs'): void;
  /** True while the bundled offline base style is what the map shows. */
  isShowingFallback(): boolean;
  /** Effect start/restart: allow work again. */
  resume(): void;
  /** Unmount / URL change: stop every scheduled thing. */
  dispose(): void;
}

export function createStyleController(ports: StyleControllerPorts): StyleController {
  const schedule = ports.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = ports.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  /** The URL being loaded; refreshed per render by the hook body. */
  let styleUrl = '';
  /** Unmounted (or effect-cleaned-up): every scheduled thing must stop. */
  let disposed = false;
  /** The fetch pipeline is running — a native did-fail must not double up. */
  let fetching = false;
  /** Pending bounded re-set, if any. */
  let retryHandle: unknown = null;
  /** Consecutive native failures since the last genuinely loaded style. */
  let consecutiveNativeFailures = 0;
  /** The inspected style object, kept so a re-set can re-issue it. */
  let baseStyle: Record<string, unknown> | null = null;
  /** Re-set nonce, so the engine bridge sees a *different* style string. */
  let retryGeneration = 0;
  /** True while the bundled offline base style is what the map shows. */
  let showingFallback = false;
  /**
   * Has the pipeline concluded that the style is in trouble?
   *
   * This is the gate a log line has to get past: `corroborateLog` may only
   * confirm a conclusion that already exists.
   */
  let styleTroubleConcluded = false;

  function clearRetryTimer(): void {
    if (retryHandle !== null) {
      cancel(retryHandle);
      retryHandle = null;
    }
  }

  /**
   * The floor: the bundled offline base style. Reachable with zero network,
   * so it is the one style that can always be set when everything else ran
   * out — and the map still WORKS over it, which is why the chip that goes
   * with it is neutral and offers a retry rather than declaring a failure.
   */
  function showOfflineFallback(): void {
    clearRetryTimer();
    showingFallback = true;
    styleTroubleConcluded = true;
    baseStyle = null;
    ports.setMapStyle(OFFLINE_FALLBACK_MAP_STYLE);
    reportMapIssue('styleOffline');
  }

  /** The glyph-endpoint verification: the probe decides, success clears. */
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
      const probe = await ports.fetchResource(buildGlyphProbeUrl(glyphsTemplate, fontStacks[0]));
      if (disposed) return;
      if (probe.ok) clearMapIssue('glyphs');
      else reportMapIssue('glyphs');
    } catch {
      if (!disposed) reportMapIssue('glyphs');
    }
  }

  /**
   * The JS pipeline: bounded fetch → repair → hand the inspected object to
   * the map. On total exhaustion: the offline base style plus the neutral
   * chip. Success does not clear `styleLoad` here — the engine still has to
   * *render* the style, and `notifyStyleLoaded` owns that.
   */
  async function runPipeline(): Promise<void> {
    if (fetching || disposed) return;
    fetching = true;
    try {
      const inspection = await runWithBackoff({
        isCancelled: () => disposed,
        sleep: ports.sleep,
        attempt: async () => {
          const response = await ports.fetchResource(styleUrl);
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
        ports.addUrlTransform(transform);
      }

      showingFallback = false;
      consecutiveNativeFailures = 0;
      retryGeneration = 0;
      // Passing the inspected object means a successful *retried* JS fetch is
      // the style MapLibre uses; leaving the URL here would ask the engine to
      // make a separate, un-retried style request of its own.
      baseStyle = inspection.style;
      ports.setMapStyle(inspection.style);

      await verifyGlyphs(
        inspection.glyphsTemplate,
        inspection.fontStacks,
        inspection.glyphsRepaired,
      );
    } catch {
      if (disposed) return;
      // The bounded budget is spent. The fallback is a working map, so the
      // line that goes with it is the neutral one.
      showOfflineFallback();
    } finally {
      fetching = false;
    }
  }

  /**
   * The engine said the style failed.
   *
   * Silent while the bounded re-sets still have budget: a retry that has not
   * run yet is not a failure the driver needs to read about.
   */
  function onStyleLoadFailed(): void {
    if (disposed) return;
    const action = planStyleLoadFailure({
      showingFallback,
      recoveryInFlight: fetching || retryHandle !== null,
      consecutiveFailures: consecutiveNativeFailures,
    });

    if (action.kind === 'fallback') {
      showOfflineFallback();
      return;
    }

    if (action.kind === 'wait') {
      // `planStyleLoadFailure` returns `wait` for two different situations,
      // and only one of them is bad news: the offline fallback is already on
      // screen and the engine STILL could not load it. A style that needs no
      // network failing to render is the end of the line.
      if (showingFallback) {
        styleTroubleConcluded = true;
        reportMapIssue('styleLoad');
      }
      return;
    }

    consecutiveNativeFailures += 1;
    retryHandle = schedule(() => {
      retryHandle = null;
      if (disposed) return;
      if (baseStyle !== null) {
        // Re-set the inspected style. The bridge forwards
        // `JSON.stringify(mapStyle)`, and React's prop diff dispatches only a
        // *changed* string — an identical object re-set would never reach the
        // engine, so the nonce copy is what makes this a real retry.
        retryGeneration += 1;
        ports.setMapStyle(restyleForRetry(baseStyle, retryGeneration));
      } else {
        // The map is still on the raw URL: run the fetch pipeline (bounded)
        // to get the inspected object — or the fallback if the network is gone.
        void runPipeline();
      }
    }, action.delayMs);
  }

  /** Everything a successful render proves, in one place. */
  function recovered(): void {
    clearRetryTimer();
    consecutiveNativeFailures = 0;
    // The engine can render: the terminal state is over either way.
    clearMapIssue('styleLoad');
    if (showingFallback) return;
    // …and a real style rendering means the tiles are genuinely back.
    styleTroubleConcluded = false;
    clearMapIssue('styleOffline');
  }

  /**
   * The engine said the style finished loading. That — not the fetch, not
   * the re-set — is what clears the line; and the offline chip only goes
   * when what loaded is a real style, because the fallback rendering is not
   * the tiles coming back.
   */
  function notifyStyleLoaded(): void {
    recovered();
  }

  /**
   * A frame rendered completely — tiles and all. Same conclusion as a style
   * load, and it is the event that fires when a map quietly heals itself
   * (a retried tile request that lands, a network that came back).
   */
  function notifyTilesRendered(): void {
    recovered();
  }

  /** Start over from the top: the caller believes conditions have changed. */
  function retryNow(): void {
    if (disposed) return;
    clearRetryTimer();
    consecutiveNativeFailures = 0;
    retryGeneration = 0;
    // We are trying again, so the fallback is no longer the final answer.
    showingFallback = false;
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
    notifyTilesRendered,

    onNetworkRestored(): void {
      if (disposed) return;
      // Nothing is wrong: do not spend a phone's radio re-fetching a style
      // that is already rendering.
      if (!styleTroubleConcluded && !showingFallback) return;
      retryNow();
    },

    retryNow,

    corroborateLog(code): void {
      if (disposed) return;
      if (code === 'glyphs') {
        // The glyph probe is the authority on the fonts endpoint; a log line
        // may only confirm a verdict it already reached.
        return;
      }
      // A style log line may only confirm a conclusion the pipeline already
      // reached — never raise one by itself.
      if (!styleTroubleConcluded) return;
      if (showingFallback) reportMapIssue('styleOffline');
    },

    isShowingFallback: () => showingFallback,

    resume(): void {
      disposed = false;
    },

    dispose(): void {
      disposed = true;
      clearRetryTimer();
    },
  };
}
