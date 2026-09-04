import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { fetchApi } from '../lib/api';
import { useSession } from '../lib/session';

export default function Onboarding() {
  const { token, refreshProfile } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  async function linkSpotify() {
    if (!token) return;
    setError(null);
    setLinking(true);
    try {
      const redirectUri = Linking.createURL('spotify-callback');
      const authorize = await fetchApi(
        `/auth/spotify/authorize-url?redirectUri=${encodeURIComponent(redirectUri)}`,
        { token },
      );
      if (!authorize.ok) throw new Error('Could not start Spotify link');
      const { url } = await authorize.json();

      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
      if (result.type !== 'success' || !result.url) {
        setError('Spotify linking was cancelled');
        return;
      }

      const { queryParams } = Linking.parse(result.url);
      const code = queryParams?.code;
      const state = queryParams?.state;
      if (typeof code !== 'string' || typeof state !== 'string') {
        throw new Error('Spotify did not return a valid response');
      }

      const callback = await fetchApi('/auth/spotify/callback', {
        method: 'POST',
        token,
        body: { code, state },
      });
      if (!callback.ok) throw new Error('Could not finish linking Spotify');

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
      <Text style={styles.body}>Connect Spotify to start making mixtapes with friends.</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={linking ? 'Linking…' : 'Link Spotify'} onPress={linkSpotify} disabled={linking} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600' },
  body: { color: '#555' },
  error: { color: 'red' },
});
