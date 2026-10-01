import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { loginText } from '../src/theme';
import { Button, Field, KeyboardForm } from '../src/components';
import { useTranslation } from '../src/lib/i18n-provider';
import { fieldErrorsFromUnknown, fieldErrorsFromZod, submitErrorMessage } from '../src/lib/errors';
import { pickFieldLabels } from '../src/lib/field-errors';
import { apiClient, getApiConfigurationError } from '../src/services/api';
import {
  FORGOT_PASSWORD_FIELDS,
  errorStatus,
  forgotPasswordErrorIsVisible,
  parseForgotPasswordForm,
} from '../src/features/auth/forgot-password.ts';

/**
 * `/forgot-password` on the phone — step 1 of the school administrator's
 * self-service password reset, and the mobile port of
 * `web/src/app/forgot-password/page.tsx`.
 *
 * ### Scope: request the link here, set the password on the web
 *
 * [DECISION 2]: this app has the **request** screen only. The email contains
 * a link to the web console's `/reset-password`, which already exists and
 * works in any browser — so there is no `reset-password.tsx` here, no deep
 * link to register, and no App Links / associated-domains setup to get
 * wrong. A reset started on the bus is finished by tapping the link in the
 * mail app.
 *
 * ### Who it is for
 *
 * [DECISION 3]: self-service reset is SCHOOL_ADMIN-only on the server. The
 * link is shown to everyone on the email path of the login screen — hiding
 * it would be its own enumeration hint, and a parent who taps it deserves an
 * answer rather than a dead end — with an explicit note that it is for
 * school administrators and that crew and parents should ask their school
 * office. The school code is therefore required here, unlike on login where
 * a blank field means the platform admin.
 *
 * ### It says the same thing every time
 *
 * After a submit the screen shows one fixed sentence (`forgotPassword.sent`,
 * byte-identical to the API's `FORGOT_PASSWORD_GENERIC_MESSAGE` in English),
 * whether the email belonged to an admin, to a driver, or to nobody, and
 * whether the school code exists. The server deliberately refuses to tell
 * the client which case applied; a screen that appeared to know would be a
 * better account-enumeration oracle than the endpoint ever was. Only a 400
 * (the shape check) and a 429 (the reset rate limit) show something else,
 * and both describe the request, not the account —
 * {@link forgotPasswordErrorIsVisible}.
 *
 * Nothing about the backend or the API client changed for this screen; it is
 * a second caller of an endpoint that was already there.
 */

/** This form's inputs, so a message naming one lands under it. */
const FIELD_LABELS = pickFieldLabels([...FORGOT_PASSWORD_FIELDS]);

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const t = useTranslation();
  const [schoolId, setSchoolId] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const [configError] = useState<string | null>(() => getApiConfigurationError()?.message ?? null);

  const onSubmit = async () => {
    setFormError(null);
    const parsed = parseForgotPasswordForm({ schoolId, email });
    if (!parsed.ok) {
      setFieldErrors(fieldErrorsFromZod(parsed.error, FIELD_LABELS));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await apiClient.forgotPassword(parsed.value);
      // The response body is deliberately ignored: it is the same sentence
      // for every outcome, and reading it would invite a future change that
      // renders something account-specific.
      setSubmitted(true);
    } catch (error) {
      const status = errorStatus(error);
      if (forgotPasswordErrorIsVisible(status)) {
        setFieldErrors(fieldErrorsFromUnknown(error, FIELD_LABELS));
        setFormError(submitErrorMessage(error, FIELD_LABELS));
      } else {
        // Anything else (offline, 500, timeout) shows the same confirmation
        // as success. See the note above: distinguishing them here would
        // leak what the endpoint refuses to say.
        setSubmitted(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardForm contentContainerStyle={styles.scrollContent} style={styles.flex}>
      <View style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.title}>{t('forgotPassword.title')}</Text>
          <Text style={styles.subtitle}>{t('forgotPassword.adminOnly')}</Text>
        </View>

        <View style={styles.card}>
          {submitted ? (
            <View style={styles.sentBlock}>
              <Text style={styles.sentMessage} accessibilityLiveRegion="polite">
                {t('forgotPassword.sent')}
              </Text>
              <Text style={styles.sentHint}>{t('forgotPassword.sentHint')}</Text>
            </View>
          ) : (
            <>
              <Field
                label={t('login.schoolLabel')}
                value={schoolId}
                onChangeText={setSchoolId}
                placeholder={t('login.schoolPlaceholder')}
                autoCapitalize="none"
                autoCorrect={false}
                error={fieldErrors.school_id}
                hint={t('forgotPassword.schoolHint')}
                style={styles.fieldInput}
                containerStyle={styles.fieldBlock}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailRef.current?.focus()}
                editable={!busy}
              />
              <Field
                ref={emailRef}
                label={t('login.email')}
                value={email}
                onChangeText={setEmail}
                placeholder={t('login.emailPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="username"
                error={fieldErrors.email}
                style={styles.fieldInput}
                containerStyle={styles.fieldBlock}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (!busy) void onSubmit();
                }}
                editable={!busy}
              />
              {configError ? <Text style={styles.formError}>{configError}</Text> : null}
              {formError ? (
                <Text style={styles.formError} accessibilityLiveRegion="polite">
                  {formError}
                </Text>
              ) : null}
              <Button
                label={t('forgotPassword.submit')}
                onPress={() => void onSubmit()}
                busy={busy}
                disabled={busy || configError !== null}
              />
            </>
          )}

          <Button
            variant="ghost"
            label={t('forgotPassword.back')}
            onPress={() => router.replace('/login')}
            disabled={busy}
          />
        </View>
      </View>
    </KeyboardForm>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.neutral[900],
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  container: {
    gap: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    color: '#ffffff',
    fontSize: typography.fontSizes['2xl'],
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    // neutral-400 on neutral-900 = 6.97:1 (AA), the same pairing the login
    // footer uses for its one explanatory sentence.
    color: colors.neutral[400],
    fontSize: loginText.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  fieldInput: {
    fontSize: loginText.inputValue,
  },
  fieldBlock: {
    marginBottom: spacing.none,
  },
  formError: {
    color: colors.status.danger,
    fontSize: loginText.secondary,
    lineHeight: 20,
  },
  sentBlock: {
    gap: spacing.sm,
  },
  sentMessage: {
    color: colors.neutral[900],
    fontSize: loginText.cardTitle,
    fontWeight: '700',
    lineHeight: 24,
  },
  sentHint: {
    color: colors.neutral[700],
    fontSize: loginText.secondary,
    lineHeight: 20,
  },
});
