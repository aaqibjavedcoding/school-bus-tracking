import React from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  type ListRenderItemInfo,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@school-bus-tracking/design-tokens';

/**
 * Virtualized list screen — the FlatList twin of `<Screen />`.
 *
 * List screens render their search bar, filter chips, summary strip and count
 * as a header, each row via `renderItem`, pagination as a footer and the
 * loading / error / empty states as the empty component. Everything scrolls
 * and refreshes exactly like the old ScrollView, but rows are mounted lazily,
 * so a school with hundreds/thousands of records stays smooth.
 *
 * Pass `header` / `footer` / `empty` as **elements** (not inline component
 * functions): React then reconciles them by type and a `TextInput` inside the
 * header keeps focus while the user types in the search box.
 */
export interface ListScreenProps<T> {
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (info: ListRenderItemInfo<T>) => React.ReactElement | null;
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
  empty?: React.ReactElement | null;
  refresh?: (() => void) | null;
  refreshing?: boolean;
  padded?: boolean;
  /** Extra bottom space, e.g. to clear a floating action button. */
  extraBottomSpace?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * `react-native`'s `FlatList` types transitively import
 * `@react-native/virtualized-lists`, which this monorepo hoists to the root
 * `node_modules` where it resolves `@types/react@18` (and cannot resolve
 * `react-native` itself). Under React 19 that yields an incompatible and
 * incomplete `FlatListProps`, so we narrow the boundary to a small, fully
 * typed component surface instead of propagating the broken types.
 */
const FlatListView = FlatList as unknown as React.ComponentType<
  Record<string, unknown>
>;

export function ListScreen<T>({
  data,
  keyExtractor,
  renderItem,
  header = null,
  footer = null,
  empty = null,
  refresh = null,
  refreshing = false,
  padded = true,
  extraBottomSpace = 0,
  contentContainerStyle,
}: ListScreenProps<T>) {
  const insets = useSafeAreaInsets();
  const bottomPadding = spacing.xl + insets.bottom + extraBottomSpace;

  return (
    <FlatListView
      data={data}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={empty}
      style={styles.screen}
      contentContainerStyle={[
        padded ? styles.padded : null,
        styles.grow,
        { paddingBottom: bottomPadding },
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        refresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.primary[600]}
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  padded: {
    padding: spacing.md,
  },
  grow: {
    flexGrow: 1,
  },
});
