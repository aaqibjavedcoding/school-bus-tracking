import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';

export interface SelectOption {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export const Select: React.FC<{
  label: string;
  options: SelectOption[];
  value: string | null;
  placeholder?: string;
  error?: string | null;
  searchable?: boolean;
  onPick: (id: string | null) => void;
}> = ({ label, options, value, placeholder = 'Select…', error, searchable = true, onPick }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={[styles.trigger, Boolean(error) && styles.triggerError]}
      >
        <Text style={selected ? styles.value : styles.placeholder} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} hitSlop={12}>
                <Text style={styles.closeText}>Done</Text>
              </Pressable>
            </View>
            {searchable ? (
              <TextInput
                style={styles.search}
                placeholder="Filter…"
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
              />
            ) : null}
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              ListHeaderComponent={
                <Pressable
                  style={styles.row}
                  onPress={() => {
                    onPick(null);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.rowLabel, !value && styles.rowSelected]}>None / clear</Text>
                </Pressable>
              }
              renderItem={({ item }) => (
                <Pressable
                  disabled={item.disabled}
                  style={[styles.row, item.disabled && styles.rowDisabled]}
                  onPress={() => {
                    onPick(item.id);
                    setOpen(false);
                  }}
                >
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLabel, item.id === value && styles.rowSelected]}>
                      {item.label}
                    </Text>
                    {item.hint ? <Text style={styles.rowHint}>{item.hint}</Text> : null}
                  </View>
                  {item.id === value ? <Text style={styles.tick}>✓</Text> : null}
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[700],
    marginBottom: spacing.xs,
  },
  trigger: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  triggerError: {
    borderColor: colors.status.danger,
  },
  value: {
    color: colors.neutral[900],
    fontSize: 15,
    flexShrink: 1,
  },
  placeholder: {
    color: colors.neutral[400],
    fontSize: 15,
  },
  chevron: {
    color: colors.neutral[400],
    fontSize: 18,
    marginLeft: spacing.sm,
  },
  error: {
    color: colors.status.danger,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '75%',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  closeText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary[700],
  },
  search: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    color: colors.neutral[900],
  },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.neutral[200],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    color: colors.neutral[800],
  },
  rowSelected: {
    fontWeight: '800',
    color: colors.primary[700],
  },
  rowHint: {
    fontSize: 12,
    color: colors.neutral[500],
    marginTop: 2,
  },
  tick: {
    color: colors.primary[600],
    fontWeight: '800',
    fontSize: 16,
  },
});
