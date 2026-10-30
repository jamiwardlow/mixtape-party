import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { API_URL, fetchApi } from '../lib/api';
import { LegalLinks } from '../lib/legal';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { Chip, ErrorNote, Label, Page, StickerBadge, TapeButton, TapeInput } from '../lib/ui';

// What /auth/google/callback bounces back here as ?error= when the flow doesn't finish.
const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_failed: 'Google sign-in failed. Try again.',
};

// Same floor as POST /accounts (api/src/routes/accounts.ts); the server stays the authority.
const MIN_PASSWORD = 8;
const BAD_EMAIL = 'Enter a valid email address';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Must match the API's NATIVE_RETURN_URL allow-list exactly.
const NATIVE_RETURN_URL = 'mixtapeparty://auth/complete';

export default function SignIn() {
  const { signIn } = useSession();
  const { error: googleError, mode: modeParam } = useLocalSearchParams<{ error?: string; mode?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'sign-up' | 'sign-in'>(modeParam === 'sign-up' ? 'sign-up' : 'sign-in');
  // Seeded from ?error= so the first edit, mode switch or submit clears it like any other error.
  const [error, setError] = useState<string | null>(googleError ? GOOGLE_ERRORS[googleError] ?? 'Google sign-in failed.' : null);
  const [linkSent, setLinkSent] = useState(false);
  const [busy, setBusy] = useState<false | 'submit' | 'link'>(false);
  const [googling, setGoogling] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);

  // The in-app browser hands back the final mixtapeparty:// URL; the token (or an error) is in its fragment.
  async function googleNative() {
    setGoogling(true);
    setError(null);
    try {
      const result = await WebBrowser.openAuthSessionAsync(
        `${API_URL}/auth/google/start?return=${encodeURIComponent(NATIVE_RETURN_URL)}`,
        NATIVE_RETURN_URL,
      );
      if (result.type !== 'success') return;
      const params = new URLSearchParams(result.url.split('#')[1] ?? '');
      const token = params.get('t');
      if (token) router.push({ pathname: '/auth/complete', params: { t: token } });
      else setError(GOOGLE_ERRORS[params.get('error') ?? ''] ?? 'Google sign-in failed.');
    } catch {
      setError('Google sign-in failed. Try again.');
    } finally {
      setGoogling(false);
    }
  }

  // Editing the address or switching mode invalidates whatever the last action said: an error
  // about the old input, or "check your email" naming an address the link never went to.
  function changeEmail(next: string) {
    setEmail(next);
    setError(null);
    setLinkSent(false);
  }

  function changeMode(next: 'sign-up' | 'sign-in') {
    setMode(next);
    setError(null);
    setLinkSent(false);
  }

  async function submit() {
    if (busy) return;
    setError(null);
    if (!email || !password) {
      setError('Enter your email and password');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError(BAD_EMAIL);
      return;
    }
    if (mode === 'sign-up' && password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    setBusy('submit');
    try {
      // Optional on purpose: an empty field means no name, exactly as before this existed. Sending
      // it only on sign-up -- /sessions has no use for it, and signing in doesn't rename you.
      const res =
        mode === 'sign-up'
          ? await fetchApi('/accounts', { method: 'POST', body: { email, password, displayName: displayName.trim() || null } })
          : await fetchApi('/sessions', { method: 'POST', body: { email, password } });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Something went wrong');
        return;
      }
      const { token } = await res.json();
      await signIn(token);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function emailSignInLink() {
    if (busy) return;
    setError(null);
    if (!email) {
      setError('Enter your email first');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError(BAD_EMAIL);
      return;
    }
    setBusy('link');
    try {
      // 204 either way — an unknown address becomes a new passwordless account rather than an
      // error, so there is nothing here to branch on.
      await fetchApi('/magic-links', { method: 'POST', body: { email } });
      setLinkSent(true);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Coming back from Google via the browser's back button can restore this page from bfcache with
  // the redirecting state frozen on; pageshow is the one signal that it happened.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const reset = () => setGoogling(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  const t = useTheme();

  return (
    <Page>
      <StickerBadge />
      <View style={styles.modes}>
        <Chip label="Sign in" selected={mode === 'sign-in'} onPress={() => changeMode('sign-in')} />
        <Chip label="Create account" selected={mode === 'sign-up'} onPress={() => changeMode('sign-up')} />
      </View>
      {/* Web: a full-page navigation, not a fetch — the OAuth redirect has to happen in the browser's
          address bar, and the state cookie is set on the API's own origin along the way. */}
      <TapeButton title={googling ? 'Redirecting to Google…' : 'Continue with Google'} variant="secondary" disabled={!!busy || googling} onPress={Platform.OS === 'web' ? () => { setGoogling(true); window.location.href = `${API_URL}/auth/google/start`; } : googleNative} />
      <View style={styles.divider}>
        <View style={[styles.rule, { backgroundColor: t.ink }]} />
        <Label>or</Label>
        <View style={[styles.rule, { backgroundColor: t.ink }]} />
      </View>
      <TapeInput
        placeholder="Email"
        accessibilityLabel="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        autoCorrect={false}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        value={email}
        onChangeText={changeEmail}
      />
      <TapeInput
        ref={passwordRef}
        placeholder="Password"
        accessibilityLabel="Password"
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
        textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
        returnKeyType={mode === 'sign-up' ? 'next' : 'go'}
        onSubmitEditing={() => (mode === 'sign-up' ? nameRef.current?.focus() : submit())}
        value={password}
        onChangeText={setPassword}
      />
      <Label style={styles.showLink} accessibilityRole="button" onPress={() => setShowPassword((v) => !v)}>
        {showPassword ? 'Hide password' : 'Show password'}
      </Label>
      {mode === 'sign-up' && <Label>Password must be at least {MIN_PASSWORD} characters.</Label>}
      {mode === 'sign-up' && (
        <TapeInput
          ref={nameRef}
          autoComplete="name"
          textContentType="name"
          returnKeyType="go"
          onSubmitEditing={submit}
          placeholder="Display name (optional)"
          accessibilityLabel="Display name (optional)"
          // The API caps a name at 40 and PATCH rejects anything longer, so stop at 40 here rather
          // than accept a name at sign-up that My Account would later refuse to save.
          maxLength={40}
          value={displayName}
          onChangeText={setDisplayName}
        />
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <TapeButton title={busy === 'submit' ? (mode === 'sign-up' ? 'Creating account…' : 'Signing in…') : 'Continue'} onPress={submit} disabled={!!busy} />
      {mode === 'sign-in' && (
        <Label style={styles.link} onPress={() => router.push('/forgot-password')}>
          Forgot password?
        </Label>
      )}

      <View style={styles.divider}>
        <View style={[styles.rule, { backgroundColor: t.ink }]} />
        <Label>or</Label>
        <View style={[styles.rule, { backgroundColor: t.ink }]} />
      </View>

      {linkSent ? (
        <>
          <Label style={styles.note}>Check {email} for a sign-in link.</Label>
          <Label style={styles.link} onPress={emailSignInLink}>
            {busy === 'link' ? 'Sending link…' : 'Resend link'}
          </Label>
          <Label style={styles.link} onPress={() => setLinkSent(false)}>
            Use a different email
          </Label>
        </>
      ) : (
        <>
          <Label style={styles.link} onPress={emailSignInLink}>
            {busy === 'link' ? 'Sending link…' : 'Email me a sign-in link'}
          </Label>
          {mode === 'sign-in' && <Label style={styles.note}>No account yet? We'll create one for this address.</Label>}
        </>
      )}
      <LegalLinks />
    </Page>
  );
}

const styles = StyleSheet.create({
  note: { textAlign: 'center' },
  // paddingVertical, not just margin: these are the tap targets, and ui.tsx holds every
  // other control in this app to a 44pt minimum.
  link: { paddingVertical: 11, textAlign: 'center', textDecorationLine: 'underline' },
  showLink: { minHeight: 44, textAlign: 'right', textDecorationLine: 'underline', textAlignVertical: 'center' },
  modes: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rule: { flex: 1, height: 3 },
});
