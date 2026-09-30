/**
 * The map-style pipeline's React/native **wiring** — nothing else.
 *
 * Every decision lives in a pure module a spec can drive:
 *
 * - `map-style.ts` — which URL, glyph repair, the bundled offline style;
 * - `map-style-recovery.ts` — the bounded backoff and the failure decision
 *   table;
 * - `map-style-controller.ts` — the lifecycle: fetch, retry, fallback,
 *   recovery, and **when the user is allowed to be told something is wrong**;
 * - `map-log-classifier.ts` — what a native log line is permitted to mean.
 *
 * This file supplies the three impure things the controller needs (`fetch`,
 * `TransformRequestManager`, the `mapStyle` setter) and subscribes to the two
 * event sources that are native-only:
 *
 * 1. **`LogManager.onLog`** — captured, classified strictly, and allowed only
 *    to *corroborate* an issue the pipeline already concluded. It used to call
 *    `reportMapIssue` unconditionally on any warn/error line containing
 *    "style", "maplibre" or "mbgl", which is why a healthy map on a good
 *    network showed a red "Map failed to load" line.
 * 2. **`useNetworkStatus`** — an offline→online transition re-runs the whole
 *    pipeline, so airplane mode clears itself with no restart and no tap.
 *
 * The retry affordance on the neutral "Offline map — tap to retry" chip is
 * registered with the map-diagnostics store rather than drilled through two
 * memoised map surfaces; `MapIssueLines` calls it.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  LogManager,
  TransformRequestManager,
  type MapProps,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';
import { useNetworkStatus } from '../../hooks/useNetworkStatus.ts';
import { resolveMapStyleUrl, type MapStyleIssueCode } from './map-style.ts';
import { classifyMapLog } from './map-log-classifier.ts';
import { createStyleController, type StyleController } from './map-style-controller.ts';
import {
  getMapIssues,
  setMapRetryHandler,
  subscribeMapIssues,
} from './map-diagnostics.ts';

export { classifyMapLog } from './map-log-classifier.ts';

export interface MapStyleState {
  /** Value for the map's `mapStyle` prop: URL while loading, then the inspected style object. */
  mapStyle: MapProps['mapStyle'];
  /** Issues reported so far (also mirrored in the map-diagnostics store). */
  issues: readonly MapStyleIssueCode[];
  /**
   * Wire to the Map's `onDidFailLoadingMap`: runs the bounded re-set policy.
   * Stays silent while retries still have budget — see
   * `map-style-controller.ts`.
   */
  onStyleLoadFailed: () => void;
  /**
   * Wire to the Map's `onDidFinishLoadingMap` (before the camera's handler):
   * the load that actually succeeded is what clears the `styleLoad` line.
   */
  notifyStyleLoaded: () => void;
  /**
   * Wire to the Map's `onDidFinishRenderingMapFully`: a frame that rendered
   * completely is the other proof that the map healed itself.
   */
  notifyTilesRendered: () => void;
  /** The "Offline map — tap to retry" affordance. */
  retryStyle: () => void;
}

export function useMapStyle(
  env: Record<string, string | undefined> = {
    EXPO_PUBLIC_MAP_STYLE_URL: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
  },
): MapStyleState {
  const styleUrl = resolveMapStyleUrl(env);
  const [mapStyle, setMapStyle] = useState<MapProps['mapStyle']>(styleUrl);
  const issues = useSyncExternalStore(subscribeMapIssues, getMapIssues);
  const network = useNetworkStatus();

  const controllerRef = useRef<StyleController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createStyleController({
      setMapStyle: (style) => setMapStyle(style as StyleSpecification),
      addUrlTransform: (transform) => {
        TransformRequestManager.addUrlTransform(transform);
      },
      fetchResource: (url) => fetch(url),
    });
  }
  const controller = controllerRef.current;
  // The controller was created once; keep its view of the URL current.
  controller.styleUrl = styleUrl;

  useEffect(() => {
    controller.resume();
    void controller.runPipeline();

    // The retry affordance for the neutral offline chip. Registered here
    // because the chip renders inside two memoised map panels that have no
    // business knowing about the style pipeline.
    setMapRetryHandler(controller.retryNow);

    // Native failures (style parse, glyph 404, WebGL loss) arrive as log
    // lines on Android — capture, classify **strictly**, and let them only
    // corroborate. Recovery scheduling is deliberately NOT driven from log
    // lines: they are noisy, and the engine's `onDidFailLoadingMap` event is
    // the bounded retry's trigger. `return false` keeps the default console
    // behaviour so nothing is swallowed.
    const subscription = LogManager.onLog((event) => {
      const code = classifyMapLog(event.level, event.tag ?? null, event.message ?? null);
      if (code === 'styleLoad' || code === 'glyphs') controller.corroborateLog(code);
      return false;
    });

    return () => {
      controller.dispose();
      setMapRetryHandler(null);
      // `onLog` returns a handle in current builds and void in older ones.
      const handle = subscription as { remove?: () => void } | undefined;
      handle?.remove?.();
    };
  }, [styleUrl, controller]);

  /**
   * Connectivity came back. Re-run the pipeline so a dead-zone map heals
   * itself — the acceptance is explicit that turning the network back on
   * clears the notice with no app restart and no manual tap.
   *
   * Keyed on the *transition*: the first `online` after mount is the status
   * hook resolving, not a recovery, and the pipeline is already running.
   */
  const previousNetworkRef = useRef(network);
  useEffect(() => {
    const previous = previousNetworkRef.current;
    previousNetworkRef.current = network;
    if (network !== 'online') return;
    if (previous === 'online') return;
    controller.onNetworkRestored();
  }, [network, controller]);

  return {
    mapStyle,
    issues,
    onStyleLoadFailed: controller.onStyleLoadFailed,
    notifyStyleLoaded: controller.notifyStyleLoaded,
    notifyTilesRendered: controller.notifyTilesRendered,
    retryStyle: controller.retryNow,
  };
}
