import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { computeBottomBarMetrics, type BottomBarMetrics } from './bottom-bar-metrics';

/**
 * Live, orientation- and inset-aware tab-bar metrics for the current device.
 *
 * The tab bar must never sit underneath the Android navigation bar / gesture
 * pill or the iOS home indicator, so its height and inner padding derive from
 * the live safe-area insets instead of a hardcoded height.
 */
export function useBottomBarMetrics(): BottomBarMetrics {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  return computeBottomBarMetrics({ width, height, bottomInset: insets.bottom });
}

export {
  computeBottomBarMetrics,
  MIN_BOTTOM_PADDING,
  TABLET_MIN_WIDTH,
} from './bottom-bar-metrics';
export type { BottomBarMetrics } from './bottom-bar-metrics';
