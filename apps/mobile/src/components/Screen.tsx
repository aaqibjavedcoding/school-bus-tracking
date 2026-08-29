import React from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@school-bus-tracking/design-tokens';

/**
 * Standard mobile screen shell: safe area, padded scrollable content and a
 * bottom gap so last rows never hide behind the gesture bar.
 */
export const Screen: React.FC<{
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scroll?: boolean;
  padded?: boolean;
}> = ({ children, style, scroll = true, padded = true }) => {
  const inner = (
    <View style={[padded && styles.padded, !scroll && styles.flex, style]}>{children}</View>
  );
  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          alwaysBounceVertical
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing['2xl'],
  },
  padded: {},
  flex: {
    flex: 1,
  },
});
