import {
  BUS_MARKER_ART_ID,
  BUS_MARKER_BOX,
  BUS_MARKER_SVG as SHARED_BUS_MARKER_SVG,
} from '@school-bus-tracking/map-assets';

/**
 * Web marker geometry is owned by the shared map-assets package. Keeping these
 * aliases preserves the focused geometry tests and makes the MapLibre anchor
 * math explicit at the call site.
 */
export const BUS_MARKER_WIDTH = BUS_MARKER_BOX.width;
export const BUS_MARKER_HEIGHT = BUS_MARKER_BOX.height;
export const BUS_MARKER_ROTATION_BOX = BUS_MARKER_BOX.rotationBox;
export const BUS_MARKER_SVG = SHARED_BUS_MARKER_SVG;

/** Plain data kept testable without a MapLibre / DOM runtime. */
export interface BusIconOptions {
  className: string;
  /** Structural preview only; marker creation builds this with DOM APIs. */
  html: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
  popupAnchor: [number, number];
}

export function busIconOptions(): BusIconOptions {
  return {
    className: 'bus-marker',
    // This string is never assigned to innerHTML. The actual SVG definition is
    // mounted once in MapViewInner's `<defs>` and marker instances use `<use>`.
    html: `<div class="bus-marker-anchor"><div class="bus-marker-rotor"><svg><use href="#${BUS_MARKER_ART_ID}"/></svg></div></div>`,
    iconSize: [BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT],
    iconAnchor: [BUS_MARKER_WIDTH / 2, BUS_MARKER_HEIGHT / 2],
    popupAnchor: [0, -BUS_MARKER_HEIGHT / 2],
  };
}

type QueryRoot = {
  querySelector: (selector: string) => { style: { transform: string } } | null;
};

/** The minimum host setBusIconHeading needs — a MapLibre marker element or host. */
export interface IconHost {
  getElement(): QueryRoot | null | undefined;
}

/**
 * Rotates one already-created inner element. The map marker DOM and the shared
 * SVG source never need to be rebuilt while the bus is moving.
 */
export function setBusIconHeading(
  host: IconHost | QueryRoot | null,
  headingDeg: number | null,
): void {
  if (!host) return;
  let element: QueryRoot | null | undefined;
  if (typeof (host as { querySelector?: unknown }).querySelector === 'function') {
    element = host as QueryRoot;
  } else if (typeof (host as IconHost).getElement === 'function') {
    try {
      element = (host as IconHost).getElement();
    } catch {
      return;
    }
  }
  const rotor = element?.querySelector('.bus-marker-rotor');
  if (rotor) rotor.style.transform = `rotate(${headingDeg ?? 0}deg)`;
}

export interface BusMarkerVisualState {
  /** Fresh GPS data only — stale/last-known state is deliberately slate. */
  live: boolean;
  /** Already speed-gated in the caller with bus-motion's 3 km/h threshold. */
  moving: boolean;
  /** Motion preference removes the pulse, never the status card's information. */
  reducedMotion: boolean;
}

/** Apply lightweight classes only; all drawing stays in the shared SVG/CSS. */
export function setBusMarkerVisualState(
  element: HTMLElement | null,
  state: BusMarkerVisualState,
): void {
  if (!element) return;
  element.classList.toggle('is-stale', !state.live);
  element.classList.toggle('is-live-moving', state.live && state.moving);
  element.classList.toggle('is-reduced-motion', state.reducedMotion);
}
