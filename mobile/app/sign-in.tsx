import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { API_URL, fetchApi } from '../lib/api';
import { useSession } from '../lib/session';

// What /auth/google/callback bounces back here as ?error= when the flow doesn't finish.
const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_failed: 'Google sign-in failed. Try again.',
};

export default function SignIn() {
  const { signIn } = useSession();
  const { error: googleError } = useLocalSearchParams<{ error?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-up' | 'sign-in'>('sign-up');
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  async function submit() {
    setError(null);
    const path = mode === 'sign-up' ? '/accounts' : '/sessions';
    const res = await fetchApi(path, { method: 'POST', body: { email, password } });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? 'Something went wrong');
      return;
    }
    const { token } = await res.json();
    await signIn(token);
  }

  async function emailSignInLink() {
    setError(null);
    if (!email) {
      setError('Enter your email first');
      return;
    }
    try {
      // 204 either way — an unknown address becomes a new passwordless account rather than an
      // error, so there is nothing here to branch on.
      await fetchApi('/magic-links', { method: 'POST', body: { email } });
      setLinkSent(true);
    } catch {
      setError("Couldn't reach the server. Try again.");
    }
  }

  const message = error ?? (googleError ? GOOGLE_ERRORS[googleError] ?? 'Google sign-in failed.' : null);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mixtape Party</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {message && <Text style={styles.error}>{message}</Text>}
      <Button title={mode === 'sign-up' ? 'Sign up' : 'Sign in'} onPress={submit} />
      <Text style={styles.toggle} onPress={() => setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up')}>
        {mode === 'sign-up' ? 'Already have an account? Sign in' : "Need an account? Sign up"}
      </Text>
      {linkSent ? (
        <Text style={styles.note}>Check {email} for a sign-in link.</Text>
      ) : (
        <Text style={styles.toggle} onPress={emailSignInLink}>
          Email me a sign-in link
        </Text>
      )}
      <Text style={styles.toggle} onPress={() => router.push('/forgot-password')}>
        Forgot password?
      </Text>
      {Platform.OS === 'web' && (
        // A full-page navigation, not a fetch: the OAuth redirect has to happen in the browser's
        // address bar, and the state cookie is set on the API's own origin along the way.
        <Button title="Continue with Google" onPress={() => { window.location.href = `${API_URL}/auth/google/start`; }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  error: { color: 'red' },
  note: { marginTop: 12, textAlign: 'center', color: '#555' },
  // paddingVertical, not just margin: these are the tap targets, and ui.tsx holds every
  // other control in this app to a 44pt minimum.
  toggle: { marginTop: 2, paddingVertical: 11, textAlign: 'center', color: '#1e90ff' },
});
