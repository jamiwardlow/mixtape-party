import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import type { Player, ServiceName } from '../../../lib/rounds';
import { useSession } from '../../../lib/session';
import { BodyText, HandText, JCard, Label, RoundGate, Screen, ServiceBadge, Sprocket, TapeButton, TapeInput } from '../../../lib/ui';

interface Track {
  submissionId: string;
  service: ServiceName;
  title: string;
  artist: string;
  playback: { deepLink: string; webUrl?: string };
  guessedAccountId: string | null;
  comment: string | null;
}

export default function GuessRound() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const { token } = useSession();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  // Per-track comment drafts, sent with the guess and editable (saved separately) after it.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token) return;
    (async () => {
      const res = await fetchApi(`/rounds/${roundId}/guessing`, { token });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Guessing is not available for this round');
        return;
      }
      const body = await res.json();
      setTracks(body.tracks);
      setDrafts(Object.fromEntries(body.tracks.map((t: Track) => [t.submissionId, t.comment ?? ''])));
      setPlayers(body.players);

      // The sweep builds the playlist when submissions close; this reads its url back (the route
      // builds it if the sweep hasn't yet). A failure or a Bandcamp-only round leaves no link.
      try {
        const exported = await fetchApi(`/rounds/${roundId}/export`, { method: 'POST', token });
        if (!exported.ok) return;
        const { services } = (await exported.json()) as { services: { playlistUrl: string | null }[] };
        setPlaylistUrl(services.find((s) => s.playlistUrl)?.playlistUrl ?? null);
      } catch {
        // The link is a convenience; the guessing screen already works without it.
      }
    })();
  }, [token, roundId]);

  async function guess(submissionId: string, guessedAccountId: string) {
    if (!token) return;
    const res = await fetchApi(`/rounds/${roundId}/submissions/${submissionId}/guesses`, {
      method: 'POST',
      token,
      body: { guessedAccountId, comment: drafts[submissionId] },
    });
    if (res.ok) {
      setTracks((prev) => prev?.map((t) => (t.submissionId === submissionId ? { ...t, guessedAccountId, comment: drafts[submissionId]?.trim() || null } : t)) ?? null);
    }
  }

  async function saveComment(submissionId: string) {
    if (!token) return;
    const res = await fetchApi(`/rounds/${roundId}/submissions/${submissionId}/guesses/comment`, {
      method: 'PUT',
      token,
      body: { comment: drafts[submissionId] },
    });
    if (res.ok) {
      const { comment } = await res.json();
      setTracks((prev) => prev?.map((t) => (t.submissionId === submissionId ? { ...t, comment } : t)) ?? null);
    }
  }

  function play(track: Track) {
    Linking.openURL(track.playback.webUrl ?? track.playback.deepLink);
  }

  return (
    <RoundGate label="Guess the submitters" error={error} ready={tracks !== null}>
      <Screen label="Guess the submitters">
        {playlistUrl ? <TapeButton title="Open playlist" onPress={() => Linking.openURL(playlistUrl)} /> : null}
        <FlatList
          data={tracks ?? []}
          keyExtractor={(item) => item.submissionId}
          ItemSeparatorComponent={Sprocket}
          renderItem={({ item }) => (
            <JCard>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <ServiceBadge service={item.service} />
                <TapeButton title="Play" onPress={() => play(item)} variant="secondary" />
              </View>
              <BodyText>
                {item.title} — {item.artist}
              </BodyText>
              <TapeInput
                placeholder="Add a comment (optional) — shown with the results"
                value={drafts[item.submissionId] ?? ''}
                onChangeText={(text) => setDrafts((prev) => ({ ...prev, [item.submissionId]: text }))}
                maxLength={500}
                multiline
              />
              {item.guessedAccountId && (drafts[item.submissionId] ?? '').trim() !== (item.comment ?? '') ? (
                <TapeButton title="Save comment" onPress={() => saveComment(item.submissionId)} variant="secondary" />
              ) : null}
              {item.guessedAccountId ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Label>Guessed:</Label>
                  <HandText>{players.find((p) => p.accountId === item.guessedAccountId)?.displayName ?? 'a player'}</HandText>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {players.map((player) => (
                    <TapeButton
                      key={player.accountId}
                      title={player.displayName ?? 'A player'}
                      onPress={() => guess(item.submissionId, player.accountId)}
                      variant="secondary"
                    />
                  ))}
                </View>
              )}
            </JCard>
          )}
        />
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    </RoundGate>
  );
}
