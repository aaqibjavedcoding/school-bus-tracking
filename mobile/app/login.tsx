import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { loginSchema } from '@school-bus-tracking/validation';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { loginText } from '../src/theme';
import { useAuth } from '../src/features/auth';
import { Button, Field, KeyboardForm, LanguageMenu, PasswordField } from '../src/components';
import { useTranslation } from '../src/lib/i18n-provider';
import {
  emptyToNull,
  fieldErrorsFromZod,
  formErrorsFromZod,
  getApiErrorMessage,
  isNetworkFailureError,
} from '../src/lib/errors';
import { homeRoute } from '../src/lib/roles';
import { getApiConfigurationError } from '../src/services/api';
import { CrewLoginErrorPresentation, localizeCrewLoginError } from '../src/lib/i18n.ts';
import { CrewPinPad } from '../src/features/crew/CrewPinPad';
import { feedback } from '../src/features/crew/crew-feedback.ts';
import {
  buildCrewPinDraft,
  isCrewLoginNetworkFailure,
  lockoutCountdown,
} from '../src/features/crew/crew-login-flow.ts';
import type { CrewLoginByPinRequest } from '@school-bus-tracking/shared-types';

/**
 * Whether the device can reach the internet **right now** (OS-level
 * connectivity via NetInfo — the same source of truth as the offline chips).
 * The login screen asks before spending a round trip: with data off the
 * friendly offline line appears immediately instead of after the transport
 * gives up. An *unknown* answer (the probe itself fails) returns `true` so
 * the request gets to decide — the reactive classification below is the
 * safety net either way.
 */
async function hasInternet(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

/**
 * Sign-in against the existing `POST /auth/login` plus the crew-only
 * `POST /auth/crew-login` (Mobile-UX Phase 4b).
 *
 * The two flows share the brand and the school-code field (a crew member's
 * phone is tenant-scoped too) and otherwise diverge:
 *
 * - **Email/password** — school users (driver, conductor, parent, school
 *   admin). The school code is optional here so platform super admins still
 *   work; for everyone else the API resolves a tenant id.
 * - **PIN** — DRIVER and CONDUCTOR on a phone. The PIN path asks for
 *   exactly two things: the **school code** (the API resolves the tenant the
 *   same way `LoginRequest` does) and the **4-digit PIN**. There is no user
 *   id — the server resolves which crew member that PIN belongs to, so a
 *   driver never has to read a UUID off an admin screen. The PIN is typed on
 *   the `CrewPinPad`. The PIN path is rate-limited server-side (per school).
 *
 * Platform super admins are still web-only and are told so on a notice
 * screen (the platform console is not part of the mobile app).
 *
 * Feedback is *only* fired for rejections (lockout, wrong PIN). Successful logins are silent — the user is already navigating to
 * the role's home, and the haptic would fire too late to register.
 */

type PathMode = 'email' | 'crew';

interface LockoutState {
  /** Seconds the server told us to wait; `null` when the server did not send one. */
  totalSeconds: number | null;
  /** Monotonic clock value (epoch seconds) when the lockout started. */
  startedAt: number;
}

export default function LoginScreen() {
  const { status, user, login, crewLogin } = useAuth();
  const router = useRouter();
  const t = useTranslation();
  // -- Email/password state --
  const [pathMode, setPathMode] = useState<PathMode>('email');
  const [schoolId, setSchoolId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // -- Crew state --
  const [crewSchoolId, setCrewSchoolId] = useState('');
  const [pinDraft, setPinDraft] = useState('');
  const [crewError, setCrewError] = useState<CrewLoginErrorPresentation | null>(null);
  const [lockout, setLockout] = useState<LockoutState | null>(null);
  const [nowEpochSeconds, setNowEpochSeconds] = useState(() => Math.floor(Date.now() / 1000));

  const [configError] = useState<string | null>(() => {
    const error = getApiConfigurationError();
    return error ? error.message : null;
  });

  // --- Keyboard awareness -------------------------------------------------
  // The screen renders inside the shared <KeyboardForm>, which owns the
  // KAV behaviour and the "scroll the focused input above the keyboard"
  // plumbing (every field registers itself on focus). What remains local is
  // the `Next`-key focus chaining between the three email-path fields.
  const schoolRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  // 1 Hz tick for the lockout countdown — only relevant when a lockout is
  // active. The hook runs unconditionally so React's rules-of-hooks hold;
  // the body short-circuits when there is nothing to tick.
  useEffect(() => {
    if (!lockout) return undefined;
    const handle = window.setInterval(() => {
      setNowEpochSeconds(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(handle);
  }, [lockout]);

  // Lockout expiry bookkeeping lives at the component top level — it MUST
  // not be inside the crew card's JSX branch (which only renders when the
  // crew path is shown) or the hook count changes between email/crew
  // renders and React throws "Rendered more hooks than during the previous
  // render".
  const lockoutElapsedSeconds = lockout ? nowEpochSeconds - lockout.startedAt : 0;
  const lockoutCountdownState = lockout
    ? lockoutCountdown(lockout.totalSeconds, lockoutElapsedSeconds)
    : null;
  // The countdown is `expired: true` when the total was exhausted — that
  // is the moment we drop the lockout card and let the user try again.
  const lockoutShouldClear =
    lockout !== null &&
    lockoutCountdownState !== null &&
    lockoutCountdownState.expired &&
    lockoutElapsedSeconds > 0;

  useEffect(() => {
    if (lockoutShouldClear) {
      setLockout(null);
      setCrewError(null);
    }
  }, [lockoutShouldClear]);

  // -- Routing -----------------------------------------------------------
  useEffect(() => {
    if (status === 'authenticated' && user) {
      router.replace(homeRoute(user.role));
    }
  }, [status, user, router]);

  // -- Email/password submit (unchanged) ---------------------------------
  const onSubmitEmail = async () => {
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
      if (!(await hasInternet())) {
        // Data is off: say so in the app's own words and do not spend a
        // round trip the transport cannot finish.
        setFormError(t('login.offline'));
        return;
      }
      await login(parsed.data);
    } catch (error) {
      if (isNetworkFailureError(error)) {
        // The connection dropped while the request was in flight — same
        // friendly line, never a raw transport diagnostic (on Android that
        // is a `java.net.UnknownHostException` detail).
        setFormError(t('login.offline'));
        return;
      }
      // `context: 'login'` — a 401 here means the credentials were wrong, not
      // that a session expired: "Invalid email or password…", never
      // "Request failed with status 401".
      setFormError(getApiErrorMessage(error, t('login.failed'), { context: 'login' }));
    } finally {
      setBusy(false);
    }
  };

  // -- Crew submit handlers ---------------------------------------------
  /**
   * Run a PIN login. Builds the request body through `buildCrewPinDraft`
   * (the same rule the server's DTO enforces) and maps a thrown error
   * through `localizeCrewLoginError` so a `CREW_PIN_LOCKED` carries the
   * structured retry-after seconds into the countdown.
   */
  const submitCrewPin = useCallback(
    async (pin: string) => {
      const draft = buildCrewPinDraft({ schoolId: crewSchoolId, pin });
      if ('error' in draft) {
        // The PIN pad enforces four digits, so the only way to land here is an
        // empty school code. It is checked locally rather than sent: the
        // server's lockout is **per school**, so a blank-code guess would burn
        // one of the real school's five attempts per window on a typo.
        setCrewError({
          message: t('login.crewPath.pin.schoolRequired'),
          codeNote: null,
          lockedForSeconds: null,
        });
        return;
      }
      setBusy(true);
      setCrewError(null);
      try {
        if (!(await hasInternet())) {
          // No data: the friendly offline line, and the typed PIN stays so a
          // retry is one tap once the connection is back (a failed *guess*
          // is wiped, but the network is not the driver's mistake).
          setCrewError({
            message: t('login.offline'),
            codeNote: null,
            lockedForSeconds: null,
          });
          return;
        }
        const body: CrewLoginByPinRequest = {
          method: 'pin',
          school_id: draft.schoolId,
          pin: draft.pin,
        };
        await crewLogin(body);
      } catch (error) {
        if (isCrewLoginNetworkFailure(error)) {
          // The request never reached the server (data dropped mid-flight):
          // the app's offline line, never the Java diagnostic.
          setCrewError({
            message: t('login.offline'),
            codeNote: null,
            lockedForSeconds: null,
          });
          return;
        }
        const presentation = localizeCrewLoginError(extractErrorPayload(error));
        setCrewError(presentation);
        // Wipe the PIN after every failure so a second guess never builds on
        // a partial first one. The user re-enters from scratch.
        setPinDraft('');
        if (presentation.lockedForSeconds !== null) {
          setLockout({
            totalSeconds: presentation.lockedForSeconds,
            startedAt: Math.floor(Date.now() / 1000),
          });
        }
        // Lockout is the only feedback event with voice worth playing —
        // "action rejected" is the documented mapping in `crew-voice.ts`.
        feedback.on({ type: 'action.rejected' });
      } finally {
        setBusy(false);
      }
    },
    [crewLogin, crewSchoolId, t],
  );

  // -- Render guards ------------------------------------------------------
  if (status === 'authenticated' && user) {
    return <Redirect href={homeRoute(user.role)} />;
  }

  // Both cards render inline inside the <KeyboardForm> below (no hooks in
  // the JSX — the lockout bookkeeping above stays at the component top
  // level, where React's rules of hooks require it).
  const lockoutActive = lockout !== null;
  const countdown = lockoutCountdownState ?? { expired: true, label: '0:00' };

  return (
    <KeyboardForm
      style={styles.flex}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingTop: spacing.lg + insets.top, paddingBottom: spacing.lg + insets.bottom },
      ]}
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>{t('login.brandMark')}</Text>
          </View>
          <Text style={styles.title}>{t('login.brandName')}</Text>
          <Text style={styles.subtitle}>{t('login.subtitle')}</Text>
        </View>

        {/*
         * Language lives on the login screen so a driver can pick Hindi or
         * Marathi BEFORE signing in — the app opens in English by default
         * (CREW_DEFAULT_LOCALE) and the saved choice wins from then on.
         *
         * One compact dropdown, not a row of pills: three identical buttons
         * above the card read as three separate actions and cost two extra
         * rows of vertical space on the screen a driver has to complete.
         */}
        <LanguageMenu />

        {pathMode === 'email' ? (
          // Behaviour is untouched: same three fields, same focus chaining,
          // same submit, same error mapping. Only the type scale and the
          // spacing rhythm are shared with the crew card, so the two paths
          // look like one screen.
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('login.emailTitle')}</Text>
            <Field
              ref={schoolRef}
              label={t('login.schoolLabel')}
              value={schoolId}
              onChangeText={setSchoolId}
              placeholder={t('login.schoolPlaceholder')}
              autoCapitalize="none"
              error={fieldErrors.school_id}
              hint={t('login.schoolHint')}
              style={styles.fieldInput}
              containerStyle={styles.fieldBlock}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => emailRef.current?.focus()}
            />
            <Field
              ref={emailRef}
              label={t('login.email')}
              value={email}
              onChangeText={setEmail}
              placeholder={t('login.emailPlaceholder')}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
              error={fieldErrors.email}
              style={styles.fieldInput}
              containerStyle={styles.fieldBlock}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <PasswordField
              ref={passwordRef}
              label={t('login.password')}
              value={password}
              onChangeText={setPassword}
              placeholder={t('login.passwordPlaceholder')}
              textContentType="password"
              autoComplete="current-password"
              error={fieldErrors.password}
              style={styles.fieldInput}
              containerStyle={styles.fieldBlock}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (!busy) void onSubmitEmail();
              }}
            />

            {configError ? <Text style={styles.formError}>{configError}</Text> : null}
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}

            <Button
              label={t('login.submit')}
              onPress={() => void onSubmitEmail()}
              busy={busy}
              disabled={busy || configError !== null}
            />
            <Button
              variant="secondary"
              label={t('login.crewPath.cta')}
              onPress={() => setPathMode('crew')}
              disabled={busy}
            />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('login.crewPath.pin.title')}</Text>
            <Text style={styles.cardSubtitle}>{t('login.crewPath.pin.subtitle')}</Text>
            {/*
             * The crew card asks for two things and nothing else: the
             * school code and the PIN below. A school code is the one
             * identifier a driver can be expected to remember
             * ("lincoln-high"), and the server resolves which crew member
             * the PIN belongs to — so no user id, no UUID field.
             */}
            <Field
              id="crew-school"
              label={t('login.schoolLabel')}
              value={crewSchoolId}
              onChangeText={setCrewSchoolId}
              placeholder={t('login.schoolPlaceholder')}
              autoCapitalize="none"
              hint={t('login.schoolHint')}
              autoCorrect={false}
              returnKeyType="done"
              editable={!busy && !lockoutActive}
              style={styles.fieldInput}
              containerStyle={styles.fieldBlock}
            />
            <View style={styles.pinPadWrap}>
              <CrewPinPad
                value={pinDraft}
                onChange={(next) => {
                  setPinDraft(next);
                  if (crewError) setCrewError(null);
                }}
                onSubmit={(pin) => void submitCrewPin(pin)}
                disabled={busy || lockoutActive}
              />
              {lockoutActive ? (
                <View style={styles.lockoutCard} accessible accessibilityLiveRegion="polite">
                  <Text style={styles.lockoutTitle}>{t('error.CREW_PIN_LOCKED')}</Text>
                  <Text style={styles.lockoutCountdown}>
                    {t('login.crewPath.lockout.wait', { seconds: countdown.label })}
                  </Text>
                  <Text style={styles.lockoutHint}>{t('login.crewPath.lockout.adminHint')}</Text>
                </View>
              ) : crewError ? (
                <View style={styles.errorCard}>
                  <Text style={styles.errorCardText} accessibilityLiveRegion="polite">
                    {crewError.message}
                  </Text>
                  {crewError.codeNote ? (
                    <Text style={styles.errorCardNote}>{crewError.codeNote}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            <Button
              variant="ghost"
              label={t('login.crewPath.backToAdmin')}
              onPress={() => setPathMode('email')}
              disabled={busy}
            />
          </View>
        )}

        <View>
          <Text style={styles.footer}>{t('login.footer')}</Text>
        </View>
      </View>
    </KeyboardForm>
  );
}

/**
 * Pull the error envelope the api-client throws. `ApiClientError` carries
 * `{ status, code, message, details }`; older code paths throw plain
 * `Error`. Anything we cannot read is collapsed to a generic unknown-code
 * envelope so the localize function still runs.
 */
function extractErrorPayload(error: unknown): {
  code?: string | null;
  message?: string | null;
  status?: number | null;
  details?: unknown;
} {
  if (error && typeof error === 'object') {
    const candidate = error as {
      status?: unknown;
      code?: unknown;
      message?: unknown;
      details?: unknown;
    };
    return {
      code: typeof candidate.code === 'string' ? candidate.code : null,
      message: typeof candidate.message === 'string' ? candidate.message : null,
      status: typeof candidate.status === 'number' ? candidate.status : null,
      details: candidate.details,
    };
  }
  return {};
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
    fontSize: loginText.label,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  /**
   * Card title — the standard in-app title step (`loginText.cardTitle`),
   * matching the crew/admin/parent density. One title per card, one primary
   * action per card; the rest of the card is inputs.
   */
  cardTitle: {
    fontSize: loginText.cardTitle,
    fontWeight: '800',
    color: colors.neutral[900],
    lineHeight: 22,
  },
  cardSubtitle: {
    fontSize: loginText.secondary,
    color: colors.neutral[700],
    lineHeight: 20,
  },
  /**
   * The standard-size input override for this screen. Applied to every field
   * here through the `style` prop `Field` forwards, so the login screen and
   * the rest of the app read at one density.
   */
  fieldInput: {
    fontSize: loginText.inputValue,
  },
  /**
   * The card's `gap` (spacing.md) is the only vertical rhythm on this screen,
   * so a Field's own `marginBottom` is cancelled here. Two sources of spacing
   * on one axis is how a form ends up with 32 dp between some rows and 16 dp
   * between others.
   */
  fieldBlock: {
    marginBottom: spacing.none,
  },
  formError: {
    color: colors.status.danger,
    fontSize: loginText.secondary,
    lineHeight: 20,
  },
  footerHit: {
    alignSelf: 'stretch',
  },
  footer: {
    // neutral-400 on the neutral-900 background = 6.97:1 (AA). neutral-500 was
    // 3.75:1 — fine for a light screen, short of AA on this dark hero, and the
    // footer is the sentence that tells a parent they are in the right place.
    color: colors.neutral[400],
    fontSize: loginText.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  pinPadWrap: {
    gap: spacing.md,
  },
  lockoutCard: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: '#FEF3C7',
    gap: spacing.xs,
  },
  // Amber card, kept: #92400E on #FEF3C7 = 6.37:1, #78350F on #FEF3C7 = 8.15:1.
  lockoutTitle: {
    color: '#92400E',
    fontSize: loginText.label,
    fontWeight: '700',
  },
  lockoutCountdown: {
    color: '#92400E',
    fontSize: loginText.countdown,
    fontWeight: '800',
  },
  lockoutHint: {
    color: '#78350F',
    fontSize: loginText.secondary,
    lineHeight: 20,
  },
  errorCard: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: '#FEE2E2',
    gap: spacing.xs,
  },
  // Red card, kept: #991B1B on #FEE2E2 = 6.80:1, #7F1D1D on #FEE2E2 = 8.20:1.
  errorCardText: {
    color: '#991B1B',
    fontSize: loginText.label,
    lineHeight: 22,
  },
  errorCardNote: {
    color: '#7F1D1D',
    fontSize: loginText.secondary,
    fontFamily: 'monospace',
  },
});
