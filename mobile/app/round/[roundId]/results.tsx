// react-native's Linking, not expo-linking's: on web only this one opens a new tab.
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Avatar } from '../../../lib/Avatar';
import { ResourceGate, useApi, useResource } from '../../../lib/client';
import { CommentThread, type Comment, type ThreadActions } from '../../../lib/CommentThread';
import { PlayerLink } from '../../../lib/PlayerLink';
import { submissionPreviewPath, usePreview } from '../../../lib/preview';
import { FavoriteHeart, Reactions, type Reaction } from '../../../lib/Reactions';
import { useRoundExport, useTrackReactions, type ServiceExport } from '../../../lib/roundTracks';
import { nameOf, playbackHref, type Playback, type Player, type Score, type ServiceName } from '../../../lib/rounds';
import { StandingRows } from '../../../lib/Standings';
import { SERVICE_META, useTheme } from '../../../lib/theme';
import {
  BodyText,
  ErrorNote,
  HandText,
  JCard,
  Label,
  Screen,
  ServiceBadge,
  TrackRow,
  Sprocket,
  TapeButton,
  TapeInput,
} from '../../../lib/ui';

// Not round-scoped: results are open to every member, so this skips the guessing-phase gate.

interface Track {
  submissionId: string;
  service: ServiceName;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
  playback: Playback;
  comment: string | null;
  note: string | null;
  submitter: Player;
  correctGuessers: Player[];
  reactions: Reaction[];
  comments: Comment[];
  favorited: boolean;
  yourGuess: { comment: string | null } | null;
}

interface Results {
  tracks: Track[];
  scores: Score[];
  winners: Player[];
}

/**
 * A line explaining a leg that produced no playlist, or null where there is nothing worth saying.
 *
 * The YouTube Music link needs no account (#215), so there is nothing for a user to fix and the
 * copy does not pretend otherwise.
 */
function exportProblem({ service, status }: ServiceExport): string | null {
  const name = SERVICE_META[service]?.label ?? service;
  const retry = `Couldn’t build the ${name} playlist this time. Reopening the results tries again.`;
  switch (status) {
    case 'no_matches':
      return `None of this round’s tracks were on ${name}.`;
    case 'failed':
      return retry;
    // 'ok' has its link above.
    default:
      return null;
  }
}

/** Your own comment on a track you guessed, editable here for as long as the results are up. */
function MyComment({ saved, onSave }: { saved: string | null; onSave: (comment: string) => Promise<void> }) {
  const [draft, setDraft] = useState(saved ?? '');
  return (
    <View style={{ gap: 6 }}>
      <TapeInput placeholder="Your comment on this track" value={draft} onChangeText={setDraft} maxLength={500} multiline />
      {draft.trim() !== (saved ?? '') ? (
        <TapeButton title="Save comment" variant="secondary" onPress={() => onSave(draft)} />
      ) : null}
    </View>
  );
}

const hasFocus = (t: Track, focus?: string) =>
  !!focus && (t.submissionId === focus || t.comments.some((c) => c.guessId === focus || c.replies.some((r) => r.replyId === focus)));

/** One track: badge, title row with heart, quotes, reactions, who, then comments folded behind a count. */
function TrackCard({
  item,
  actions,
  favorite,
  playingId,
  onPlay,
  onReact,
  onSaveComment,
}: {
  item: Track;
  playingId: string | null;
  onPlay: (submissionId: string) => void;
  actions: ThreadActions;
  favorite: ReturnType<typeof useTrackReactions>['favorite'];
  onReact: (emoji: string) => void;
  onSaveComment: (comment: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(hasFocus(item, actions.focus));
  const n = item.comments.length;
  return (
    <JCard>
      <ServiceBadge service={item.service} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TrackRow
          thumbnailUrl={item.thumbnailUrl}
          title={item.title}
          artist={item.artist}
          href={playbackHref(item.playback)}
          playing={playingId === item.submissionId}
          onPlay={() => onPlay(item.submissionId)}
        />
      </View>
      {item.comment && <BodyText>“{item.comment}”</BodyText>}
      {item.note && <BodyText>“{item.note}”</BodyText>}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Reactions reactions={item.reactions} onToggle={onReact} />
        </View>
        <FavoriteHeart favorited={item.favorited} onPress={() => favorite.toggle(item.submissionId, item.favorited)} />
      </View>
      <Sprocket />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Label>Submitted by</Label>
        <Avatar size={20} label="" url={item.submitter.avatarUrl} initial={item.submitter.displayName?.[0] ?? '?'} />
        <HandText>{nameOf(item.submitter)}</HandText>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Label>Guessed by</Label>
        {item.correctGuessers.length > 0 ? (
          <HandText>{item.correctGuessers.map(nameOf).join(', ')}</HandText>
        ) : (
          <Label>Nobody</Label>
        )}
      </View>
      {/* Your own comment is an input, not reading, so it stays above the fold. */}
      {item.yourGuess ? (
        <MyComment key={item.yourGuess.comment ?? ''} saved={item.yourGuess.comment} onSave={onSaveComment} />
      ) : null}
      {n > 0 ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}>
          <HandText style={{ fontSize: 14 }}>
            {open ? '▾' : '▸'} {n} comment{n > 1 ? 's' : ''}
          </HandText>
        </Pressable>
      ) : null}
      {open ? item.comments.map((c) => <CommentThread key={c.guessId} comment={c} actions={actions} />) : null}
    </JCard>
  );
}

const PODIUM_HEIGHT = [140, 116, 96];

/** Top 3 as blocks (1st centred and tallest); ties share a height. Everyone past 3rd gets a row below. */
function Podium({ results }: { results: Results }) {
  const t = useTheme();
  const podiumColor = [t.mint, t.tangerine, t.accent];
  const { scores, winners } = results;
  const rank = (s: Score) => Math.min(scores.filter((o) => o.score > s.score).length, 2); // ties share
  // 2nd left, 1st centre, 3rd right; with fewer players the gaps just close up.
  const order = [scores[1], scores[0], scores[2]].filter((s): s is Score => !!s);
  const names = winners.map(nameOf).join(', ');
  return (
    <JCard>
      {names ? <HandText>{names} {winners.length > 1 ? 'take' : 'takes'} the round 🏆</HandText> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        {order.map((s) => (
          <View key={s.accountId} style={{ flex: 1 }}>
            <PlayerLink accountId={s.accountId}>
              <View
                style={{
                  height: PODIUM_HEIGHT[rank(s)],
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: 4,
                  padding: 6,
                  borderWidth: 3,
                  borderColor: t.ink,
                  borderBottomWidth: 0,
                  borderTopLeftRadius: 14,
                  borderTopRightRadius: 14,
                  backgroundColor: podiumColor[rank(s)],
                }}
              >
                <Avatar size={28} label="" url={s.avatarUrl} initial={s.displayName?.[0] ?? '?'} />
                <BodyText numberOfLines={1} style={{ fontSize: 13, color: t.accentInk }}>{nameOf(s)}</BodyText>
                <BodyText style={{ fontSize: 13, color: t.accentInk }}>{s.score} pts</BodyText>
              </View>
            </PlayerLink>
          </View>
        ))}
      </View>
      <StandingRows standings={scores.slice(3)} firstRank={4} />
    </JCard>
  );
}

export default function RoundResults() {
  const { roundId, focus } = useLocalSearchParams<{ roundId: string; focus?: string }>();
  const scroller = useRef<ScrollView>(null);
  const api = useApi();
  const { data: results, error, reload, setData: setResults } = useResource<Results>(
    `/rounds/${roundId}/results`,
    'Results are not available for this round',
  );
  // Each comment action posts, then re-reads the results so counts and threads match the server.
  async function act(path: string, method: string, body?: object) {
    await api(path, { method, body });
    await reload();
  }

  const setTracks = (update: (prev: Track[]) => Track[]) => setResults((r) => ({ ...r, tracks: update(r.tracks) }));
  const { react, favorite } = useTrackReactions(setTracks);
  const { playingId, toggle } = usePreview(submissionPreviewPath, results?.tracks);
  const saveComment = (submissionId: string, comment: string) =>
    act(`/rounds/${roundId}/submissions/${submissionId}/guesses/comment`, 'PUT', { comment });
  const actions: ThreadActions = {
    reply: (guessId, body, parentReplyId) => act(`/guesses/${guessId}/replies`, 'POST', { body, parentReplyId }),
    editReply: (replyId, body) => act(`/replies/${replyId}`, 'PUT', { body }),
    deleteReply: (replyId) => act(`/replies/${replyId}`, 'DELETE'),
    react: (path, emoji) => act(path, 'POST', { emoji }),
    focus,
  };

  // Scroll to the track holding the linked comment/reply once, when it first lays out -- not after each reaction.
  // ponytail: playlists landing later can shift it a little; scroll once is good enough.
  const scrolled = useRef(false);
  const onTrackLayout = (item: Track) => (e: LayoutChangeEvent) => {
    if (scrolled.current || !hasFocus(item, focus)) return;
    scrolled.current = true;
    scroller.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: false });
  };

  const exports = useRoundExport(roundId, results !== null);

  const playlists = exports.flatMap((e) => (e.playlistUrl ? [{ ...e, playlistUrl: e.playlistUrl }] : []));
  const problems = exports.flatMap((e) => {
    const note = exportProblem(e);
    return note ? [{ service: e.service, note }] : [];
  });

  return (
    <ResourceGate label="Results" error={error} ready={results !== null}>
      <Screen label="Results">
        <ScrollView
          ref={scroller}
          style={{ margin: -6 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 12, padding: 6 }}
        >
        {results ? <Podium results={results} /> : null}
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
        {problems.length > 0 ? (
          <JCard>
            {problems.map((problem) => (
              <Label key={problem.service}>{problem.note}</Label>
            ))}
          </JCard>
        ) : null}
        {favorite.error ? <ErrorNote>Couldn’t update your favorite. Try again.</ErrorNote> : null}
        {results?.tracks.map((item, i) => (
          <View key={item.submissionId} onLayout={onTrackLayout(item)} style={{ gap: 12 }}>
            {i > 0 ? <Sprocket /> : null}
            <TrackCard
              item={item}
              actions={actions}
              favorite={favorite}
              playingId={playingId}
              onPlay={toggle}
              onReact={(emoji) => react(item.submissionId, emoji)}
              onSaveComment={(comment) => saveComment(item.submissionId, comment)}
            />
          </View>
        ))}
        </ScrollView>
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    </ResourceGate>
  );
}
