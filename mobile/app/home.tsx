import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { fetchApi } from '../lib/api';
import { useSession } from '../lib/session';

export default function Home() {
  const { profile, token, signOut, pendingInviteCode, setPendingInviteCode } = useSession();
  const [joinMessage, setJoinMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !pendingInviteCode) return;
    const code = pendingInviteCode;
    setPendingInviteCode(null);
    (async () => {
      const res = await fetchApi(`/leagues/invite/${code}/join`, { method: 'POST', token });
      setJoinMessage(res.ok ? "You're in! Check the invite to see your new league." : "Couldn't finish joining that league.");
    })();
  }, [token, pendingInviteCode]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>You're in, {profile?.email}</Text>
      {joinMessage && <Text style={styles.body}>{joinMessage}</Text>}
      <Button title="Create a league" onPress={() => router.push('/create-league')} />
      <Button title="Sign out" onPress={signOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '600' },
  body: { color: '#555' },
});
