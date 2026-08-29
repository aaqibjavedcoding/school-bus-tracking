import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StudentListResponse, StudentResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  SearchBar,
} from '../../src/components';

/**
 * Pocket student directory for the school admin: server-side search over
 * `/students` (the same endpoint the web roster uses), read-only on mobile —
 * full student management (guardians, home stops) stays on the web console.
 */
export default function AdminStudentsScreen() {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 350);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, loading, error, reload } = useLoad<StudentListResponse>(async () => {
    return unwrapEnvelope(
      await apiClient.listStudents({ page: 1, limit: 25, search: debounced || undefined }),
    );
  }, [debounced]);

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <SearchBar
        value={term}
        onChangeText={setTerm}
        placeholder="Search by name or admission number…"
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : loading && !data ? (
        <LoadingView label="Searching students…" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title={debounced ? 'No students match' : 'No students yet'}
          description={
            debounced
              ? `Nothing matched “${debounced}”.`
              : 'Students appear here once they are registered in the web console.'
          }
        />
      ) : (
        <>
          <Text style={styles.count}>
            {data.meta.total} students · showing {data.items.length}
          </Text>
          {data.items.map((student: StudentResponse) => (
            <View key={student.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {student.first_name} {student.last_name}
                  </Text>
                  <Text style={styles.meta}>
                    {student.admission_number}
                    {student.grade_level ? ` · ${student.grade_level}` : ''}
                  </Text>
                </View>
                <Badge
                  label={student.is_active ? 'Active' : 'Inactive'}
                  tone={student.is_active ? 'success' : 'neutral'}
                />
              </View>
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  count: {
    color: colors.neutral[500],
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  meta: {
    fontSize: 12,
    color: colors.neutral[500],
    marginTop: 2,
  },
});
