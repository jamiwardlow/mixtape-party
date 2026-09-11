import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { fetchApi } from '../../lib/api';
import { useSession } from '../../lib/session';

interface InvitePreview {
  league: { name: string; seasonLength: number };
  host: { displayName: string | null };
  currentRound: { theme: string; submissionDeadline: string; guessingDeadline: string } | null;
  players: { displayName: string | null }[];
  playerCount: number;
}

export default function JoinLeague() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { token, setPendingInviteCode } = useSession();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    // The param is not guaranteed to be populated on a pre-rendered route's first render, and
    // fetching `/invite/undefined` would 404 and call a perfectly good invite invalid. Hold the
    // spinner instead of latching an error: the effect re-runs when `code` arrives.
    if (!code) return;
    (async () => {
      try {
        const res = await fetchApi(`/leagues/invite/${code}`);
        if (!res.ok) {
          // 404 is the API's only answer for "no such code" — an invite has no expiry to hit
          // (schema.sql has no expires_at/used_at/revoked), so every other status is us failing,
          // not the invite. One message for both is how a routing bug looked like an invite bug.
          setError(res.status === 404 ? 'This invite is no longer valid' : "Couldn't load this invite. Try again.");
          return;
        }
        setPreview(await res.json());
      } catch {
        setError("Couldn't reach the server. Try again.");
      }
    })();
  }, [code]);

  const canJoin = token !== null;

  async function join() {
    if (!token) return;
    setJoining(true);
    setError(null);
    try {
      const res = await fetchApi(`/leagues/invite/${code}/join`, { method: 'POST', token });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not join the league');
        return;
      }
      setJoined(true);
    } finally {
      setJoining(false);
    }
  }

  function continueToJoin() {
    setPendingInviteCode(code);
    router.push('/sign-in');
  }

  if (joined) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>You're in!</Text>
        <Button title="Go to home" onPress={() => router.replace('/home')} />
      </View>
    );
  }

  if (!preview) {
    return (
      <View style={styles.container}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{preview.league.name}</Text>
      <Text style={styles.body}>Hosted by {preview.host.displayName ?? 'a friend'}</Text>
      {preview.currentRound && <Text style={styles.body}>Current theme: {preview.currentRound.theme}</Text>}
      <Text style={styles.body}>{preview.playerCount} player(s) already joined</Text>
      {preview.players.map((player, i) => (
        <Text key={i} style={styles.body}>
          • {player.displayName ?? 'A player'}
        </Text>
      ))}
      {error && <Text style={styles.error}>{error}</Text>}
      {canJoin ? (
        <Button title={joining ? 'Joining…' : 'Join league'} onPress={join} disabled={joining} />
      ) : (
        <Button title="Sign up to join" onPress={continueToJoin} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600' },
  body: { color: '#555' },
  error: { color: 'red' },
});
