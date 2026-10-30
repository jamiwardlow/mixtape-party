import { router, useLocalSearchParams } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { API_URL, fetchApi } from '../lib/api';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { BodyText, ErrorNote, HandText, Label, Page, StickerBadge, TapeButton, TapeInput } from '../lib/ui';

// What /auth/google/callback bounces back here as ?error= when the flow doesn't finish.
const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_failed: 'Google sign-in failed. Try again.',
  apple_cancelled: 'Apple sign-in was cancelled.',
  apple_failed: 'Apple sign-in failed. Try again.',
};

// Same floor as POST /accounts (api/src/routes/accounts.ts); the server stays the authority.
const MIN_PASSWORD = 8;
const BAD_EMAIL = 'Enter a valid email address';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Must match the API's NATIVE_RETURN_URL allow-list exactly.
const NATIVE_RETURN_URL = 'mixtapeparty://auth/complete';

type Step = 'email' | 'sent' | 'password';

export default function SignIn() {
  const { signIn } = useSession();
  const { error: googleError, mode: modeParam } = useLocalSearchParams<{ error?: string; mode?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  // ?mode=sign-up deep links land on the password screen in create-account mode.
  const [step, setStep] = useState<Step>(modeParam === 'sign-up' ? 'password' : 'email');
  const [mode, setMode] = useState<'sign-up' | 'sign-in'>(modeParam === 'sign-up' ? 'sign-up' : 'sign-in');
  // Seeded from ?error= so the first edit, mode switch or submit clears it like any other error.
  const [error, setError] = useState<string | null>(googleError ? GOOGLE_ERRORS[googleError] ?? 'Google sign-in failed.' : null);
  const [busy, setBusy] = useState<false | 'submit' | 'link'>(false);
  const [googling, setGoogling] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);

  // Shared by both providers. The in-app browser hands back the final mixtapeparty:// URL; the token (or an error) is in its fragment.
  async function providerNative(provider: 'google' | 'apple') {
    setGoogling(true);
    setError(null);
    try {
      // PKCE: another app can claim mixtapeparty:// and read the token off the redirect, but only
      // this call holds the verifier the token is bound to.
      const codeVerifier = Crypto.getRandomBytes(32).reduce((s, b) => s + String.fromCharCode(b), '');
      const verifier = btoa(codeVerifier).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const challenge = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const result = await WebBrowser.openAuthSessionAsync(
        `${API_URL}/auth/${provider}/start?return=${encodeURIComponent(NATIVE_RETURN_URL)}&code_challenge=${challenge}`,
        NATIVE_RETURN_URL,
      );
      if (result.type !== 'success') return;
      const params = new URLSearchParams(result.url.split('#')[1] ?? '');
      const token = params.get('t');
      if (token) router.push({ pathname: '/auth/complete', params: { t: token, v: verifier } });
      else setError(GOOGLE_ERRORS[params.get('error') ?? ''] ?? `${provider === 'apple' ? 'Apple' : 'Google'} sign-in failed.`);
    } catch {
      setError(`${provider === 'apple' ? 'Apple' : 'Google'} sign-in failed. Try again.`);
    } finally {
      setGoogling(false);
    }
  }

  // iOS: the system sheet, no web view. It hands back a signed identity token the API verifies;
  // the name only comes on the very first sign-in, so send it along.
  async function appleNative() {
    setGoogling(true);
    setError(null);
    try {
      const { identityToken, fullName } = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      const res = await fetchApi('/auth/apple/native', {
        method: 'POST',
        body: { identityToken, fullName: [fullName?.givenName, fullName?.familyName].filter(Boolean).join(' ') || null },
      });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Apple sign-in failed. Try again.');
        return;
      }
      await signIn((await res.json()).token);
    } catch (e) {
      setError((e as { code?: string }).code === 'ERR_REQUEST_CANCELED' ? GOOGLE_ERRORS.apple_cancelled : GOOGLE_ERRORS.apple_failed);
    } finally {
      setGoogling(false);
    }
  }

  // Editing the address or switching screen invalidates whatever the last action said: an error
  // about the old input, or "check your inbox" naming an address the link never went to.
  function changeEmail(next: string) {
    setEmail(next);
    setError(null);
  }

  function go(next: Step, nextMode: 'sign-up' | 'sign-in' = 'sign-in') {
    setStep(next);
    setMode(nextMode);
    setError(null);
  }

  function checkEmail() {
    if (!email) {
      setError('Enter your email first');
      return false;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError(BAD_EMAIL);
      return false;
    }
    return true;
  }

  async function submit() {
    if (busy) return;
    setError(null);
    if (!password) {
      setError('Enter your password');
      return;
    }
    if (!checkEmail()) return;
    if (mode === 'sign-up' && password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    setBusy('submit');
    try {
      // Optional on purpose: an empty field means no name. Sent only on sign-up -- /sessions has
      // no use for it, and signing in doesn't rename you.
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
    if (!checkEmail()) return;
    setBusy('link');
    try {
      // 204 either way — an unknown address becomes a new passwordless account rather than an
      // error, so there is nothing here to branch on.
      await fetchApi('/magic-links', { method: 'POST', body: { email } });
      setStep('sent');
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

  const emailInput = (
    <TapeInput
      placeholder="Email"
      accessibilityLabel="Email"
      autoCapitalize="none"
      keyboardType="email-address"
      autoComplete="email"
      textContentType="emailAddress"
      autoCorrect={false}
      returnKeyType="go"
      onSubmitEditing={step === 'password' ? () => passwordRef.current?.focus() : emailSignInLink}
      value={email}
      onChangeText={changeEmail}
    />
  );
  const errorNote = error && <ErrorNote>{error}</ErrorNote>;

  if (step === 'sent') {
    return (
      <Page>
        <StickerBadge />
        <HandText style={styles.title}>Check your inbox.</HandText>
        <BodyText>
          We sent a sign-in link to <BodyText style={styles.bold}>{email}</BodyText>. Tap it on this device and you're in.
        </BodyText>
        {errorNote}
        <Label style={styles.link} onPress={emailSignInLink}>
          {busy === 'link' ? 'Sending link…' : 'Resend link'}
        </Label>
        <Label style={styles.link} onPress={() => go('email')}>
          Use a different email
        </Label>
      </Page>
    );
  }

  if (step === 'password') {
    const creating = mode === 'sign-up';
    return (
      <Page>
        <StickerBadge />
        <HandText style={styles.title}>{creating ? 'Make a password.' : 'Password time.'}</HandText>
        {EMAIL_RE.test(email.trim()) ? <Label>{creating ? 'Creating an account for' : 'Signing in as'} {email}</Label> : emailInput}
        <TapeInput
          ref={passwordRef}
          placeholder="Password"
          accessibilityLabel="Password"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete={creating ? 'new-password' : 'current-password'}
          textContentType={creating ? 'newPassword' : 'password'}
          returnKeyType={creating ? 'next' : 'go'}
          onSubmitEditing={() => (creating ? nameRef.current?.focus() : submit())}
          value={password}
          onChangeText={setPassword}
        />
        <Label style={styles.showLink} accessibilityRole="button" onPress={() => setShowPassword((v) => !v)}>
          {showPassword ? 'Hide password' : 'Show password'}
        </Label>
        {creating && <Label>Password must be at least {MIN_PASSWORD} characters.</Label>}
        {creating && (
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
        {errorNote}
        <TapeButton title={busy === 'submit' ? (creating ? 'Creating account…' : 'Signing in…') : creating ? 'Create account' : 'Sign in'} onPress={submit} disabled={!!busy} />
        {!creating && (
          <Label style={styles.link} onPress={() => router.push('/forgot-password')}>
            Forgot password?
          </Label>
        )}
        <Label style={styles.link} onPress={() => go('password', creating ? 'sign-in' : 'sign-up')}>
          {creating ? 'I already have a password' : 'Create account with a password'}
        </Label>
        <Label style={styles.link} onPress={emailSignInLink}>
          {busy === 'link' ? 'Sending link…' : 'Email me a link instead'}
        </Label>
      </Page>
    );
  }

  return (
    <Page>
      <StickerBadge />
      <HandText style={styles.title}>Join the party.</HandText>
      <BodyText>New or returning, same door.</BodyText>
      {emailInput}
      {errorNote}
      <TapeButton title={busy === 'link' ? 'Sending link…' : 'Email me a link'} onPress={emailSignInLink} disabled={!!busy || googling} />
      <View style={styles.divider}>
        <View style={[styles.rule, { backgroundColor: t.ink }]} />
        <Label>or</Label>
        <View style={[styles.rule, { backgroundColor: t.ink }]} />
      </View>
      {/* Web: a full-page navigation, not a fetch — the OAuth redirect has to happen in the browser's
          address bar, and the state cookie is set on the API's own origin along the way. */}
      <View style={styles.pair}>
        <View style={styles.half}>
          <TapeButton title={googling ? 'Redirecting…' : 'Google'} variant="secondary" disabled={!!busy || googling} onPress={Platform.OS === 'web' ? () => { setGoogling(true); window.location.href = `${API_URL}/auth/google/start`; } : () => providerNative('google')} />
        </View>
        <View style={styles.half}>
          <TapeButton title={googling ? 'Redirecting…' : 'Apple'} variant="secondary" disabled={!!busy || googling} onPress={Platform.OS === 'web' ? () => { setGoogling(true); window.location.href = `${API_URL}/auth/apple/start`; } : Platform.OS === 'ios' ? appleNative : () => providerNative('apple')} />
        </View>
      </View>
      <Label style={styles.link} onPress={() => go('password')}>
        Use a password instead
      </Label>
      <Label style={styles.note}>
        By continuing you agree to the{' '}
        <Label accessibilityRole="link" style={styles.underline} onPress={() => router.push('/terms')}>Terms of Use</Label> and{' '}
        <Label accessibilityRole="link" style={styles.underline} onPress={() => router.push('/privacy')}>Privacy Policy</Label>.
      </Label>
    </Page>
  );
}

const styles = StyleSheet.create({
  note: { textAlign: 'center' },
  underline: { textDecorationLine: 'underline' },
  // paddingVertical, not just margin: these are the tap targets, and ui.tsx holds every
  // other control in this app to a 44pt minimum.
  link: { paddingVertical: 11, textAlign: 'center', textDecorationLine: 'underline' },
  showLink: { minHeight: 44, textAlign: 'right', textDecorationLine: 'underline', textAlignVertical: 'center' },
  title: { fontSize: 30, transform: [{ rotate: '-2deg' }] },
  bold: { fontWeight: '700' },
  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rule: { flex: 1, height: 3 },
});
