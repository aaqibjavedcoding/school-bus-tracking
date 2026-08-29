import React from 'react';
import { FlatList, RefreshControl, StyleSheet, View, type FlatListProps } from 'react-native';
import { spacing } from '@school-bus-tracking/design-tokens';
import { EmptyState, ErrorBanner, LoadingView, SkeletonList } from './Feedback';

export interface RefreshListProps<T> extends Omit<FlatListProps<T>, 'data' | 'refreshControl'> {
  data: T[] | null;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  skeleton?: boolean;
}

/**
 * Pull-to-refresh list with first-class loading / empty / error states so
 * every screen looks and behaves identically (Task 23 §L).
 */
export function RefreshList<T extends { id: string }>({
  data,
  loading = false,
  refreshing = false,
  error = null,
  onRefresh,
  emptyTitle = 'Nothing here yet',
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  skeleton = false,
  renderItem,
  ...rest
}: RefreshListProps<T>): React.ReactElement {
  if (loading && !data) {
    return (
      <View style={styles.wrap}>
        {error ? <ErrorBanner message={error} onRetry={onRefresh} /> : null}
        {skeleton ? <SkeletonList /> : <LoadingView />}
      </View>
    );
  }

  const items = data ?? [];
  return (
    <View style={styles.wrap}>
      {error && items.length > 0 ? <ErrorBanner message={error} onRetry={onRefresh} /> : null}
      {error && items.length === 0 && !loading ? (
        <ErrorBanner message={error} onRetry={onRefresh} />
      ) : null}
      {!error && items.length === 0 && !loading ? (
        <EmptyState
          title={emptyTitle}
          message={emptyMessage}
          actionLabel={emptyActionLabel}
          onAction={onEmptyAction}
        />
      ) : null}
      {items.length > 0 ? (
        <FlatList
          {...rest}
          data={items}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f59e0b" />
            ) : undefined
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.md,
  },
});
