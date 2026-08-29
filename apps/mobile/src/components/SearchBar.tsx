import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';

export const SearchBar: React.FC<{
  placeholder?: string;
  onSearch: (value: string) => void;
  debounceMs?: number;
  autoFocus?: boolean;
}> = ({ placeholder = 'Search…', onSearch, debounceMs = 350, autoFocus }) => {
  const [value, setValue] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onSearch);
  latest.current = onSearch;

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => latest.current(value.trim()), debounceMs);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [value, debounceMs]);

  return (
    <View style={styles.wrap}>
      <TextInput
        accessibilityLabel={placeholder}
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.neutral[400]}
        value={value}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onChangeText={setValue}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => setValue('')}
          hitSlop={10}
          style={styles.clear}
        >
          <View style={styles.clearDot}>
            <View style={styles.clearInner} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    backgroundColor: '#ffffff',
    color: colors.neutral[900],
    fontSize: 15,
  },
  clear: {
    position: 'absolute',
    right: spacing.sm,
    padding: spacing.sm,
  },
  clearDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.neutral[400],
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearInner: {
    width: 8,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#ffffff',
    transform: [{ rotate: '45deg' }],
  },
});
