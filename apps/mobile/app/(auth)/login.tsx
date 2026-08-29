import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../../src/auth/auth-context';
import { homeRouteForUser } from '../../src/auth/role-routing';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { ErrorBanner } from '../../src/components/Feedback';
import { StatusBadge } from '../../src/components/StatusBadge';

/**
 * School-code + email + password sign-in against the existing
 * `POST /auth/login`. Role and tenant are read back from the verified
 * session; nothing here asserts who the caller is — the API decides that.
 */
export default function LoginScreen() {
  const { status, user, login, networkError } = useAuth();
  const [schoolCode, setSchoolCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (status === 'authenticated') {
    return <Redirect href={homeRouteForUser(user) ?? '/'} />;
  }

  const submit = async (): Promise<void> => {
    setFormError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const outcome = await login({ school_id: schoolCode, email, password });
      if (!outcome.ok) {
        setFormError(outcome.message ?? 'Sign in failed.');
        setFieldErrors(outcome.fieldErrors ?? {});
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.brandRow}>
              <Text style={styles.mark}>SBT</Text>
              <StatusBadge
                tone="info"
                label="SCHOOL BUS TRACKING"
                compact
                style={styles.heroBadge}
              />
            </View>
            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.subtitle}>
              Use the account your school created for you. Your role decides what you can see —
              admins manage, crew operate, parents follow.
            </Text>
          </View>

          {(networkError || formError) && (
            <ErrorBanner
              message={
                formError ??
                'The API is unreachable right now. Check your connection and try again.'
              }
            />
          )}

          <TextField
            label="School code"
            placeholder="lincoln-high (or your school UUID)"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="organizationName"
            autoComplete="organization"
            value={schoolCode}
            error={fieldErrors.school_id}
            hint="Platform logins leave this empty."
            onChangeText={(value) => {
              setSchoolCode(value);
              setFormError(null);
            }}
            testID="login-school"
          />
          <TextField
            label="Email"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="username"
            value={email}
            error={fieldErrors.email}
            onChangeText={setEmail}
            testID="login-email"
          />
          <TextField
            label="Password"
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            value={password}
            error={fieldErrors.password}
            onChangeText={setPassword}
            testID="login-password"
          />

          <Button
            label={busy ? 'Signing in…' : 'Sign in'}
            onPress={() => void submit()}
            busy={busy}
            fullWidth
            testID="login-submit"
          />

          <Pressable
            accessibilityRole="link"
            onPress={() => setSchoolCode('')}
            style={styles.helper}
          >
            <Text style={styles.helperText}>Forgot access? Your school admin can reset it.</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  hero: {
    backgroundColor: colors.neutral[900],
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderLeftWidth: 5,
    borderLeftColor: colors.primary[500],
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  mark: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.primary[500],
    letterSpacing: 2,
  },
  heroBadge: {
    marginTop: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
  },
  subtitle: {
    color: colors.neutral[300],
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  helper: {
    alignSelf: 'center',
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  helperText: {
    color: colors.neutral[500],
    fontSize: 12,
  },
});
