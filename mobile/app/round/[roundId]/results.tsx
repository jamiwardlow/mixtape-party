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
  submitter: Player;
  correctGuessers: Player[];
}

interface Score extends Player {
  score: number;
}

interface Results {
  tracks: Track[];
  scores: Score[];
  winners: Player[];
}

export default function RoundResults() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const { token } = useSession();
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const res = await fetchApi(`/rounds/${roundId}/results`, { token });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Results are not available for this round');
        return;
      }
      setResults(await res.json());
    })();
  }, [token, roundId]);

  const winnerNames = results?.winners.map((w) => w.displayName ?? 'A player').join(', ') ?? '';

  return (
    <RoundGate label="Results" error={error} ready={results !== null}>
      <Screen label="Results">
        <JCard>
          {winnerNames ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <BodyText>Winning side:</BodyText>
              <HandText>{winnerNames}</HandText>
            </View>
          ) : null}
          {results?.scores.map((score) => (
            <View key={score.accountId} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <HandText>{score.displayName ?? 'A player'}</HandText>
              <BodyText>{score.score}</BodyText>
            </View>
          ))}
        </JCard>
        <FlatList
          data={results?.tracks ?? []}
          keyExtractor={(item) => item.submissionId}
          ItemSeparatorComponent={Sprocket}
          renderItem={({ item }) => (
            <JCard>
              <ServiceBadge service={item.service} />
              <BodyText>
                {item.title} — {item.artist}
              </BodyText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Label>submitted by</Label>
                <HandText>{item.submitter.displayName ?? 'a player'}</HandText>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <Label>correctly guessed by</Label>
                {item.correctGuessers.length > 0 ? (
                  <HandText>{item.correctGuessers.map((g) => g.displayName ?? 'a player').join(', ')}</HandText>
                ) : (
                  <Label>nobody</Label>
                )}
              </View>
            </JCard>
          )}
        />
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    </RoundGate>
  );
}
