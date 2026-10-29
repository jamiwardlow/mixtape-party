import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { API_URL, fetchApi } from '../lib/api';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { Chip, ErrorNote, Label, Page, StickerBadge, TapeButton, TapeInput } from '../lib/ui';

// What /auth/google/callback bounces back here as ?error= when the flow doesn't finish.
const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_failed: 'Google sign-in failed. Try again.',
};

export default function SignIn() {
  const { signIn } = useSession();
  const { error: googleError, mode: modeParam } = useLocalSearchParams<{ error?: string; mode?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'sign-up' | 'sign-in'>(modeParam === 'sign-up' ? 'sign-up' : 'sign-in');
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
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
    setBusy(true);
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

  const t = useTheme();
  const message = error ?? (googleError ? GOOGLE_ERRORS[googleError] ?? 'Google sign-in failed.' : null);

  return (
    <Page>
      <StickerBadge />
      <View style={styles.modes}>
        <Chip label="Sign in" selected={mode === 'sign-in'} onPress={() => changeMode('sign-in')} />
        <Chip label="Create account" selected={mode === 'sign-up'} onPress={() => changeMode('sign-up')} />
      </View>
      {Platform.OS === 'web' && (
        // A full-page navigation, not a fetch: the OAuth redirect has to happen in the browser's
        // address bar, and the state cookie is set on the API's own origin along the way.
        <TapeButton title="Continue with Google" variant="secondary" disabled={busy} onPress={() => { window.location.href = `${API_URL}/auth/google/start`; }} />
      )}
      {Platform.OS === 'web' && (
        <View style={styles.divider}>
          <View style={[styles.rule, { backgroundColor: t.ink }]} />
          <Label>or</Label>
          <View style={[styles.rule, { backgroundColor: t.ink }]} />
        </View>
      )}
      <TapeInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={changeEmail}
      />
      <TapeInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {mode === 'sign-up' && (
        <TapeInput
          placeholder="Display name (optional)"
          // The API caps a name at 40 and PATCH rejects anything longer, so stop at 40 here rather
          // than accept a name at sign-up that My Account would later refuse to save.
          maxLength={40}
          value={displayName}
          onChangeText={setDisplayName}
        />
      )}
      {message && <ErrorNote>{message}</ErrorNote>}
      <TapeButton title="Continue" onPress={submit} disabled={busy} />
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
        <Label style={styles.note}>Check {email} for a sign-in link.</Label>
      ) : (
        <Label style={styles.link} onPress={emailSignInLink}>
          Email me a sign-in link
        </Label>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  note: { textAlign: 'center' },
  // paddingVertical, not just margin: these are the tap targets, and ui.tsx holds every
  // other control in this app to a 44pt minimum.
  link: { paddingVertical: 11, textAlign: 'center', textDecorationLine: 'underline' },
  modes: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rule: { flex: 1, height: 3 },
});
