import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
// react-native's Linking, not expo-linking's: on web only this one opens a new tab.
import { FlatList, Linking, View } from 'react-native';
import { ResourceGate, useApi, useResource } from '../../../lib/client';
import { FavoriteHeart, Reactions, type Reaction } from '../../../lib/Reactions';
import { usePreview } from '../../../lib/preview';
import { commentSaved, guessed, unguessed, useRoundExport, useTrackReactions } from '../../../lib/roundTracks';
import { nameOf, playbackHref, type Playback, type Player, type ServiceName } from '../../../lib/rounds';
import { BodyText, Chip, ErrorNote, JCard, Screen, ServiceBadge, Sprocket, TapeButton, TapeInput, TrackRow } from '../../../lib/ui';

interface Track {
  submissionId: string;
  service: ServiceName;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
  playback: Playback;
  guessedAccountId: string | null;
  comment: string | null;
  /** Only your own reactions come back; the counts are for the results. */
  reactions: Reaction[];
  favorited: boolean;
  /** Your own track: a note box, no player buttons. */
  mine?: boolean;
}

const previewPath = (roundId: string) => (id: string) => `/rounds/${roundId}/submissions/${id}/preview`;

export default function GuessRound() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const api = useApi();
  const { data, error, setData } = useResource<{ tracks: Track[]; players: Player[] }>(
    `/rounds/${roundId}/guessing`,
    'Guessing is not available for this round',
  );
  const tracks = data?.tracks ?? null;
  const players = data?.players ?? [];
  const setTracks = (update: (prev: Track[]) => Track[]) => setData((d) => ({ ...d, tracks: update(d.tracks) }));
  // A failure or a Bandcamp-only round leaves no link.
  const playlistUrl = useRoundExport(roundId, data !== null).find((s) => s.playlistUrl)?.playlistUrl ?? null;
  // Per-track comment drafts, sent with the guess and editable (saved separately) after it. A
  // refetch seeds new tracks only: what's typed in a box survives it.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (tracks) setDrafts((d) => ({ ...Object.fromEntries(tracks.map((t) => [t.submissionId, t.comment ?? ''])), ...d }));
  }, [tracks]);

  async function guess(submissionId: string, guessedAccountId: string) {
    // Changing a guess leaves the saved comment alone (Save comment owns it); a first guess carries the draft.
    const changing = tracks?.find((t) => t.submissionId === submissionId)?.guessedAccountId != null;
    const res = await api(`/rounds/${roundId}/submissions/${submissionId}/guesses`, {
      method: 'POST',
      body: changing ? { guessedAccountId } : { guessedAccountId, comment: drafts[submissionId] },
    });
    if (res.ok) setTracks((prev) => guessed(prev, submissionId, guessedAccountId, drafts[submissionId]));
  }

  async function unguess(submissionId: string) {
    const res = await api(`/rounds/${roundId}/submissions/${submissionId}/guesses`, { method: 'DELETE' });
    // The draft stays in the box to re-send with the next guess.
    if (res.ok) setTracks((prev) => unguessed(prev, submissionId));
  }

  async function saveComment(submissionId: string) {
    const mine = tracks?.find((t) => t.submissionId === submissionId)?.mine;
    const res = await api<{ note?: string | null; comment?: string | null }>(
      mine ? `/rounds/${roundId}/submissions/mine/note` : `/rounds/${roundId}/submissions/${submissionId}/guesses/comment`,
      { method: 'PUT', body: mine ? { note: drafts[submissionId] } : { comment: drafts[submissionId] } },
    );
    if (res.ok) setTracks((prev) => commentSaved(prev, submissionId, (mine ? res.data.note : res.data.comment) ?? null));
  }

  // Same reactions and favorites as the results screen: a track you react to or heart here shows there too.
  const { react, favorite } = useTrackReactions(setTracks);
  const { playingId, toggle } = usePreview(useMemo(() => previewPath(roundId), [roundId]), tracks);

  // Each player can be guessed on one track only.
  const guessedIds = new Set((tracks ?? []).map((t) => t.guessedAccountId).filter(Boolean));

  return (
    <ResourceGate label="Guess the submitters" error={error} ready={tracks !== null}>
      <Screen label="Guess the submitters">
        {favorite.error ? <ErrorNote>Couldn’t update your favorite. Try again.</ErrorNote> : null}
        {playlistUrl ? <TapeButton title="Open playlist" onPress={() => Linking.openURL(playlistUrl)} /> : null}
        <FlatList keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
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
              <TrackRow
                thumbnailUrl={item.thumbnailUrl}
                title={item.title}
                artist={item.artist}
                href={playbackHref(item.playback)}
                playing={playingId === item.submissionId}
                onPlay={() => toggle(item.submissionId)}
                stacked
              />
              {item.mine ? null : (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Reactions reactions={item.reactions} onToggle={(emoji) => react(item.submissionId, emoji)} />
                  </View>
                  <FavoriteHeart favorited={item.favorited} onPress={() => favorite.toggle(item.submissionId, item.favorited)} />
                </View>
              )}
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
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(item.mine ? [] : players).map((player) => {
                  const here = player.accountId === item.guessedAccountId;
                  return (
                    <Chip
                      key={player.accountId}
                      avatar={nameOf(player)}
                      label={nameOf(player)}
                      selected={here}
                      taken={!here && guessedIds.has(player.accountId)}
                      onPress={() => (here ? unguess(item.submissionId) : guess(item.submissionId, player.accountId))}
                    />
                  );
                })}
              </View>
            </JCard>
          )}
        />
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    </ResourceGate>
  );
}
