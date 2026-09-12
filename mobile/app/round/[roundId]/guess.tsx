import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import type { Player, ServiceName } from '../../../lib/rounds';
import { useSession } from '../../../lib/session';
import { BodyText, HandText, JCard, Label, RoundGate, Screen, ServiceBadge, Sprocket, TapeButton } from '../../../lib/ui';

interface Track {
  submissionId: string;
  service: ServiceName;
  title: string;
  artist: string;
  playback: { deepLink: string; webUrl?: string };
  canPlayInApp: boolean;
  guessedAccountId: string | null;
}

export default function GuessRound() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const { token } = useSession();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      setPlayers(body.players);
    })();
  }, [token, roundId]);

  async function guess(submissionId: string, guessedAccountId: string) {
    if (!token) return;
    const res = await fetchApi(`/rounds/${roundId}/submissions/${submissionId}/guesses`, {
      method: 'POST',
      token,
      body: { guessedAccountId },
    });
    if (res.ok) {
      setTracks((prev) => prev?.map((t) => (t.submissionId === submissionId ? { ...t, guessedAccountId } : t)) ?? null);
    }
  }

  function play(track: Track) {
    Linking.openURL(track.playback.webUrl ?? track.playback.deepLink);
  }

  return (
    <RoundGate label="Guess the submitters" error={error} ready={tracks !== null}>
      <Screen label="Guess the submitters">
        <FlatList
          data={tracks ?? []}
          keyExtractor={(item) => item.submissionId}
          ItemSeparatorComponent={Sprocket}
          renderItem={({ item }) => (
            <JCard>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <ServiceBadge service={item.service} />
                {item.canPlayInApp && <TapeButton title="Play" onPress={() => play(item)} variant="secondary" />}
              </View>
              <BodyText>
                {item.title} — {item.artist}
              </BodyText>
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
