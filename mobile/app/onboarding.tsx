import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchApi } from '../lib/api';
import { useSession } from '../lib/session';

export default function Onboarding() {
  const { token, refreshProfile } = useSession();
  const [cookie, setCookie] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  async function linkYouTubeMusic() {
    if (!token || cookie.trim().length === 0) return;
    setError(null);
    setLinking(true);
    try {
      const callback = await fetchApi('/auth/youtube-music/callback', {
        method: 'POST',
        token,
        body: { cookie: cookie.trim() },
      });
      if (!callback.ok) throw new Error('Could not link YouTube Music');

      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLinking(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Link a music service</Text>
      <Text style={styles.body}>
        Paste your YouTube Music session cookie to start making mixtapes with friends.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Session cookie"
        value={cookie}
        onChangeText={setCookie}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button
        title={linking ? 'Linking…' : 'Link YouTube Music'}
        onPress={linkYouTubeMusic}
        disabled={linking || cookie.trim().length === 0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600' },
  body: { color: '#555' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, minHeight: 80 },
  error: { color: 'red' },
});
