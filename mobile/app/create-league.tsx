import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Button, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { fetchApi } from '../lib/api';
import { useSession } from '../lib/session';

export default function CreateLeague() {
  const { token } = useSession();
  const [name, setName] = useState('');
  const [seasonLength, setSeasonLength] = useState('8');
  const [theme, setTheme] = useState('');
  const [submissionDeadline, setSubmissionDeadline] = useState('');
  const [guessingDeadline, setGuessingDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  async function submit() {
    if (!token) return;
    setError(null);
    setCreating(true);
    try {
      const res = await fetchApi('/leagues', {
        method: 'POST',
        token,
        body: { name, seasonLength: Number(seasonLength), theme, submissionDeadline, guessingDeadline },
      });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not create the league');
        return;
      }
      const body = await res.json();
      setInviteCode(body.inviteCode);
    } finally {
      setCreating(false);
    }
  }

  async function shareInvite() {
    if (!inviteCode) return;
    const url = Linking.createURL(`join/${inviteCode}`);
    await Share.share({ message: `Join my mixtape league: ${url}` });
  }

  if (inviteCode) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>League created!</Text>
        <Text style={styles.body}>Invite code: {inviteCode}</Text>
        <Button title="Share invite" onPress={shareInvite} />
        <Button title="Done" onPress={() => router.replace('/home')} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create a league</Text>
      <TextInput style={styles.input} placeholder="League name" value={name} onChangeText={setName} />
      <TextInput
        style={styles.input}
        placeholder="Season length (rounds)"
        keyboardType="number-pad"
        value={seasonLength}
        onChangeText={setSeasonLength}
      />
      <Text style={styles.subtitle}>Round 1</Text>
      <TextInput style={styles.input} placeholder="Theme" value={theme} onChangeText={setTheme} />
      <TextInput
        style={styles.input}
        placeholder="Submission deadline (ISO date)"
        value={submissionDeadline}
        onChangeText={setSubmissionDeadline}
      />
      <TextInput
        style={styles.input}
        placeholder="Guessing deadline (ISO date)"
        value={guessingDeadline}
        onChangeText={setGuessingDeadline}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={creating ? 'Creating…' : 'Create league'} onPress={submit} disabled={creating} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600' },
  subtitle: { fontSize: 16, fontWeight: '600', marginTop: 8 },
  body: { color: '#555' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  error: { color: 'red' },
});
