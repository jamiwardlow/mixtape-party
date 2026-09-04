import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchApi } from '../lib/api';
import { useSession } from '../lib/session';

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-up' | 'sign-in'>('sign-up');
  const [error, setError] = useState<string | null>(null);

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
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={mode === 'sign-up' ? 'Sign up' : 'Sign in'} onPress={submit} />
      <Text style={styles.toggle} onPress={() => setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up')}>
        {mode === 'sign-up' ? 'Already have an account? Sign in' : "Need an account? Sign up"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  error: { color: 'red' },
  toggle: { marginTop: 12, textAlign: 'center', color: '#1e90ff' },
});
