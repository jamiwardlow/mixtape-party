import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import { appleMusicLinkingSupported, isAppleMusicLinked } from '../../../lib/appleMusic';
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

/** One service's exported playlist for this round. Null until the export builds one, or forever if nothing matched. */
interface PlaylistLink {
  service: ServiceName;
  playlistUrl: string | null;
}

export default function RoundResults() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const { token, profile } = useSession();
  const [results, setResults] = useState<Results | null>(null);
  const [playlists, setPlaylists] = useState<Array<PlaylistLink & { playlistUrl: string }>>([]);
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

      // First view of the results is what triggers the export; the route builds each playlist once
      // per round, so a revisit -- or another player's first view -- reads back the same one. It can
      // take a while (every track is matched into each service's catalog), so the links land after
      // the results rather than holding them up, and a failed export simply shows no links.
      const exported = await fetchApi(`/rounds/${roundId}/export`, { method: 'POST', token });
      if (!exported.ok) return;
      const { services } = (await exported.json()) as { services: PlaylistLink[] };
      setPlaylists(services.flatMap((s) => (s.playlistUrl ? [{ ...s, playlistUrl: s.playlistUrl }] : [])));
    })();
  }, [token, roundId]);

  // Apple Music is the only linkable service, and its playlists are created under the user's own
  // library token (#70) -- so an unlinked account gets no playlist and, until now, no hint why.
  // Read off the session profile rather than asking the API again.
  //
  // Withheld until the profile arrives (null while /accounts/me is in flight, which outlives the
  // results fetch) or a linked user watches the prompt flash and vanish. Web-only, because the
  // /settings it points at can only link there -- on native the button would be a dead end.
  const promptAppleMusic = appleMusicLinkingSupported && profile !== null && !isAppleMusicLinked(profile);

  const winnerNames = results?.winners.map((w) => w.displayName ?? 'A player').join(', ') ?? '';

  return (
    <RoundGate label="Results" error={error} ready={results !== null}>
      <Screen label="Results">
        <JCard>
          {winnerNames ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <BodyText>Winners:</BodyText>
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
        {playlists.length > 0 ? (
          <JCard>
            <Label>Playlists</Label>
            {playlists.map((playlist) => (
              <View
                key={playlist.service}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <ServiceBadge service={playlist.service} />
                <TapeButton
                  title="Open playlist"
                  onPress={() => Linking.openURL(playlist.playlistUrl)}
                  variant="secondary"
                />
              </View>
            ))}
          </JCard>
        ) : null}
        {promptAppleMusic ? (
          // An offer, not a gate (#67): the results above render the same either way.
          //
          // ponytail: shows on every results view, with no way to dismiss it. Persisting a
          // "not interested" flag is the upgrade if it turns out to nag.
          <JCard>
            <Label>Want this round’s playlist in your Apple Music library? Link your account.</Label>
            <TapeButton title="Link Apple Music" onPress={() => router.push('/settings')} variant="secondary" />
          </JCard>
        ) : null}
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
                <Label>Submitted by</Label>
                <HandText>{item.submitter.displayName ?? 'a player'}</HandText>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <Label>Correctly guessed by</Label>
                {item.correctGuessers.length > 0 ? (
                  <HandText>{item.correctGuessers.map((g) => g.displayName ?? 'a player').join(', ')}</HandText>
                ) : (
                  <Label>Nobody</Label>
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
