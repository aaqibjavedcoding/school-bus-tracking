/**
 * Responsive bottom-bar metrics — pure, dependency-free math so it can be
 * unit-tested under `node --test`. The React binding lives in `layout.ts`.
 */

export const TABLET_MIN_WIDTH = 600;

export interface BottomBarMetrics {
  /** True when the shortest screen edge is tablet sized. */
  isTablet: boolean;
  /** True when the window is wider than it is tall. */
  isLandscape: boolean;
  /** Safe-area inset reported for the bottom edge (nav bar / home indicator). */
  bottomInset: number;
  /** Total height of the tab bar including the safe-area padding. */
  tabBarHeight: number;
  /** Padding reserved at the bottom of the bar for the device nav area. */
  tabBarPaddingBottom: number;
  /** Padding above the icons. */
  tabBarPaddingTop: number;
  /** Icon size that keeps a comfortable touch target on every form factor. */
  iconSize: number;
  /** Tab label font size. */
  labelFontSize: number;
  /**
   * Distance from the bottom of the screen a floating element (FAB) must keep
   * so it clears the device navigation area.
   */
  floatingOffset: number;
}

/**
 * A minimum bottom padding is applied even when the OS reports `0` (older
 * Android devices with hardware keys report no inset but still overlay a
 * 3-button bar in some skins).
 */
export const MIN_BOTTOM_PADDING = 8;

/**
 * Pure metric computation (unit-tested): given the window size and the
 * reported bottom safe-area inset, produce every dimension the tab bar needs.
 */
export function computeBottomBarMetrics(input: {
  width: number;
  height: number;
  bottomInset: number;
}): BottomBarMetrics {
  const { width, height } = input;

  const shortestEdge = Math.min(width, height);
  const isTablet = shortestEdge >= TABLET_MIN_WIDTH;
  const isLandscape = width > height;

  const bottomInset = Math.max(input.bottomInset, 0);
  const tabBarPaddingBottom = Math.max(bottomInset, MIN_BOTTOM_PADDING);
  const tabBarPaddingTop = isTablet ? 10 : 6;
  // Compact bar in landscape on phones (little vertical room), roomier on tablets.
  const barContentHeight = isTablet ? 64 : isLandscape ? 48 : 56;

  return {
    isTablet,
    isLandscape,
    bottomInset,
    tabBarHeight: barContentHeight + tabBarPaddingBottom,
    tabBarPaddingBottom,
    tabBarPaddingTop,
    iconSize: isTablet ? 26 : 22,
    labelFontSize: isTablet ? 13 : 11,
    floatingOffset: tabBarPaddingBottom,
  };
}

