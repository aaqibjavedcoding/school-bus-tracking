import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type KeyboardEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import {
  keyboardBehavior,
  keyboardTopEdge,
  scrollOffsetToRevealInput,
} from '../src/lib/keyboard-aware';

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

  // --- Keyboard-aware form plumbing -------------------------------------
  // `KeyboardAvoidingView` alone never scrolls a *specific* input into view,
  // so on short screens the password field stayed behind the keyboard. We
  // track the live keyboard height and, whenever a field gains focus (or the
  // keyboard resizes while a field is focused), measure that input and scroll
  // it just above the keyboard — but only when it is actually obscured, so
  // tapping between two already-visible fields causes no jump at all.
  const scrollRef = useRef<ScrollView>(null);
  const schoolRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const focusedRef = useRef<React.RefObject<TextInput | null> | null>(null);
  const scrollYRef = useRef(0);
  const keyboardHeightRef = useRef(0);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const revealFocusedInput = useCallback(() => {
    const target = focusedRef.current?.current;
    const scroller = scrollRef.current;
    if (!target || !scroller || typeof target.measureInWindow !== 'function') return;
    target.measureInWindow((_x: number, y: number, _width: number, height: number) => {
      const offset = scrollOffsetToRevealInput({
        inputTop: y,
        inputBottom: y + height,
        keyboardTop: keyboardTopEdge(windowHeight, keyboardHeightRef.current),
        viewportTop: insets.top,
        scrollY: scrollYRef.current,
      });
      if (offset === null) return;
      scroller.scrollTo({ y: offset, animated: true });
    });
  }, [windowHeight, insets.top]);

  const onFocusField = useCallback(
    (ref: React.RefObject<TextInput | null>) => () => {
      focusedRef.current = ref;
      // Wait a frame so the keyboard metrics/layout have settled before we
      // measure — otherwise the first tap measures against a stale height.
      requestAnimationFrame(revealFocusedInput);
    },
    [revealFocusedInput],
  );

  useEffect(() => {
    // `Will*` fires before the animation on iOS (smoothest); Android only
    // emits `Did*`, so both are subscribed and the handler is idempotent.
    const showEvents: Array<'keyboardWillShow' | 'keyboardDidShow'> =
      Platform.OS === 'ios' ? ['keyboardWillShow'] : ['keyboardDidShow'];
    const hideEvents: Array<'keyboardWillHide' | 'keyboardDidHide'> =
      Platform.OS === 'ios' ? ['keyboardWillHide'] : ['keyboardDidHide'];

    const subs = [
      ...showEvents.map((event) =>
        Keyboard.addListener(event, (payload: KeyboardEvent) => {
          keyboardHeightRef.current = payload.endCoordinates?.height ?? 0;
          revealFocusedInput();
        }),
      ),
      ...hideEvents.map((event) =>
        Keyboard.addListener(event, () => {
          keyboardHeightRef.current = 0;
        }),
      ),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, [revealFocusedInput]);

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
    <KeyboardAvoidingView style={styles.flex} behavior={keyboardBehavior(Platform.OS)}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        // `flexGrow: 1` + `justifyContent: 'center'` keeps the original
        // vertically-centred design on tall screens, while still allowing the
        // form to scroll once the keyboard shrinks the viewport.
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: spacing.lg + insets.top, paddingBottom: spacing.lg + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        onScroll={(event) => {
          scrollYRef.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
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
            ref={schoolRef}
            label="School code"
            value={schoolId}
            onChangeText={setSchoolId}
            placeholder="e.g. lincoln-high"
            autoCapitalize="none"
            error={fieldErrors.school_id}
            hint="Your school's tenant code. Leave empty only for platform admins."
            returnKeyType="next"
            submitBehavior="submit"
            onFocus={onFocusField(schoolRef)}
            onSubmitEditing={() => emailRef.current?.focus()}
          />
          <Field
            ref={emailRef}
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@school.edu"
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            error={fieldErrors.email}
            returnKeyType="next"
            submitBehavior="submit"
            onFocus={onFocusField(emailRef)}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Field
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            error={fieldErrors.password}
            returnKeyType="done"
            onFocus={onFocusField(passwordRef)}
            onSubmitEditing={() => {
              if (!busy) void onSubmit();
            }}
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
      </ScrollView>
    </KeyboardAvoidingView>
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
