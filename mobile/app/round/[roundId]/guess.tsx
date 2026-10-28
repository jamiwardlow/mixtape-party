import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
// react-native's Linking, not expo-linking's: on web only this one opens a new tab.
import { FlatList, Linking, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import { usePreview } from '../../../lib/preview';
import type { Player, ServiceName } from '../../../lib/rounds';
import { useSession } from '../../../lib/session';
import { BodyText, HandText, JCard, Label, RoundGate, Screen, ServiceBadge, Sprocket, TapeButton, TapeInput, Thumb } from '../../../lib/ui';

interface Track {
  submissionId: string;
  service: ServiceName;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
  playback: { deepLink: string; webUrl?: string };
  guessedAccountId: string | null;
  comment: string | null;
  /** Your own track: a note box, no player buttons. */
  mine?: boolean;
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
    // Changing a guess leaves the saved comment alone (Save comment owns it); a first guess carries the draft.
    const changing = tracks?.find((t) => t.submissionId === submissionId)?.guessedAccountId != null;
    const res = await fetchApi(`/rounds/${roundId}/submissions/${submissionId}/guesses`, {
      method: 'POST',
      token,
      body: changing ? { guessedAccountId } : { guessedAccountId, comment: drafts[submissionId] },
    });
    if (res.ok) {
      setTracks((prev) =>
        prev?.map((t) =>
          t.submissionId !== submissionId
            ? t
            : { ...t, guessedAccountId, comment: changing ? t.comment : drafts[submissionId]?.trim() || null },
        ) ?? null,
      );
    }
  }

  async function saveComment(submissionId: string) {
    if (!token) return;
    const mine = tracks?.find((t) => t.submissionId === submissionId)?.mine;
    const res = await fetchApi(
      mine ? `/rounds/${roundId}/submissions/mine/note` : `/rounds/${roundId}/submissions/${submissionId}/guesses/comment`,
      { method: 'PUT', token, body: mine ? { note: drafts[submissionId] } : { comment: drafts[submissionId] } },
    );
    if (res.ok) {
      const body = await res.json();
      const comment = mine ? body.note : body.comment;
      setTracks((prev) => prev?.map((t) => (t.submissionId === submissionId ? { ...t, comment } : t)) ?? null);
    }
  }

  // No in-app preview for a track: open it in its service instead.
  const openInService = useCallback(
    (submissionId: string) => {
      const track = tracks?.find((t) => t.submissionId === submissionId);
      if (track) Linking.openURL(track.playback.webUrl ?? track.playback.deepLink);
    },
    [tracks],
  );
  const previewPath = useCallback((id: string) => `/rounds/${roundId}/submissions/${id}/preview`, [roundId]);
  const { playingId, toggle } = usePreview(previewPath, token, openInService);

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
                <TapeButton
                  title={playingId === item.submissionId ? 'Stop' : 'Play'}
                  onPress={() => toggle(item.submissionId)}
                  variant="secondary"
                />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Thumb url={item.thumbnailUrl} />
                <BodyText style={{ flex: 1 }}>
                  {item.title} — {item.artist}
                </BodyText>
              </View>
              <TapeInput
                placeholder={item.mine ? 'Your track — add a note (optional), shown with the results' : 'Add a comment (optional) — shown with the results'}
                value={drafts[item.submissionId] ?? ''}
                onChangeText={(text) => setDrafts((prev) => ({ ...prev, [item.submissionId]: text }))}
                maxLength={500}
                multiline
              />
              {(item.mine || item.guessedAccountId) && (drafts[item.submissionId] ?? '').trim() !== (item.comment ?? '') ? (
                <TapeButton title="Save comment" onPress={() => saveComment(item.submissionId)} variant="secondary" />
              ) : null}
              {item.guessedAccountId ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Label>Guessed:</Label>
                  <HandText>{players.find((p) => p.accountId === item.guessedAccountId)?.displayName ?? 'a player'}</HandText>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(item.mine ? [] : players)
                  .filter((player) => player.accountId !== item.guessedAccountId)
                  .map((player) => (
                    <TapeButton
                      key={player.accountId}
                      title={player.displayName ?? 'A player'}
                      onPress={() => guess(item.submissionId, player.accountId)}
                      variant="secondary"
                    />
                  ))}
              </View>
            </JCard>
          )}
        />
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    </RoundGate>
  );
}
