import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { loginSchema } from '@school-bus-tracking/validation';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../src/features/auth';
import { Button, Field } from '../src/components';
import {
  emptyToNull,
  fieldErrorsFromZod,
  formErrorsFromZod,
  getApiErrorMessage,
} from '../src/lib/errors';
import { homeRoute } from '../src/lib/roles';

/**
 * Sign-in against the existing `POST /auth/login`.
 *
 * School users (driver, conductor, parent, school admin) are tenant-scoped:
 * the API requires the school's tenant id — either its UUID or its human
 * tenant code (e.g. `lincoln-high`). Platform super admins sign in without a
 * school and are shown a notice screen (the platform console is web-only).
 */
export default function LoginScreen() {
  const { status, user, login } = useAuth();
  const router = useRouter();
  const [schoolId, setSchoolId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && user) {
      router.replace(homeRoute(user.role));
    }
  }, [status, user, router]);

  const onSubmit = async () => {
    setFormError(null);
    const parsed = loginSchema.safeParse({
      school_id: emptyToNull(schoolId),
      email: email.trim(),
      password,
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      setFormError(formErrorsFromZod(parsed.error)[0] ?? null);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await login(parsed.data);
    } catch (error) {
      setFormError(getApiErrorMessage(error, 'Could not sign in'));
    } finally {
      setBusy(false);
    }
  };

  if (status === 'authenticated' && user) {
    return <Redirect href={homeRoute(user.role)} />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>SBT</Text>
          </View>
          <Text style={styles.title}>School Bus Tracking</Text>
          <Text style={styles.subtitle}>Sign in with your school account</Text>
        </View>

        <View style={styles.card}>
          <Field
            label="School code"
            value={schoolId}
            onChangeText={setSchoolId}
            placeholder="e.g. lincoln-high"
            autoCapitalize="none"
            error={fieldErrors.school_id}
            hint="Your school's tenant code. Leave empty only for platform admins."
          />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@school.edu"
            keyboardType="email-address"
            error={fieldErrors.email}
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            error={fieldErrors.password}
          />

          {formError ? <Text style={styles.formError}>{formError}</Text> : null}

          <Button label="Sign in" onPress={() => void onSubmit()} busy={busy} disabled={busy} />
        </View>

        <View>
          <Text style={styles.footer}>
            Drivers, conductors, parents and school admins all sign in here — the app adapts to your
            role.
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.neutral[900],
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  brandMark: {
    width: 64,
    height: 64,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  brandMarkText: {
    color: colors.neutral[900],
    fontSize: typography.fontSizes['2xl'],
    fontWeight: '800',
  },
  title: {
    color: '#ffffff',
    fontSize: typography.fontSizes['2xl'],
    fontWeight: '800',
  },
  subtitle: {
    color: colors.neutral[400],
    fontSize: typography.fontSizes.sm,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
  },
  formError: {
    color: colors.status.danger,
    fontSize: typography.fontSizes.sm,
    marginBottom: spacing.md,
  },
  footerHit: {
    alignSelf: 'stretch',
  },
  footer: {
    color: colors.neutral[500],
    fontSize: typography.fontSizes.xs,
    textAlign: 'center',
    lineHeight: 18,
  },
});
