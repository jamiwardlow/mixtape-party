// react-native's Linking, not expo-linking's: on web only this one opens a new tab.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Linking, Pressable, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import { Avatar } from '../../../lib/Avatar';
import type { Player, ServiceName } from '../../../lib/rounds';
import { useSession } from '../../../lib/session';
import { SERVICE_META } from '../../../lib/theme';
import {
  BodyText,
  ErrorNote,
  HandText,
  JCard,
  Label,
  RoundGate,
  Screen,
  ServiceBadge,
  Thumb,
  Sprocket,
  TapeButton,
  TapeInput,
} from '../../../lib/ui';

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

interface Reply {
  replyId: string;
  parentReplyId: string | null;
  mine: boolean;
  author: Player;
  body: string;
  reactions: Reaction[];
}

interface Comment {
  guessId: string;
  guesser: Player;
  mine: boolean;
  comment: string;
  reactions: Reaction[];
  replies: Reply[];
}

const DEFAULT_REACTIONS = ['❤️', '😂', '🔥', '👏', '😮'];

interface Track {
  submissionId: string;
  service: ServiceName;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
  comment: string | null;
  note: string | null;
  submitter: Player;
  correctGuessers: Player[];
  reactions: Reaction[];
  comments: Comment[];
  favorited: boolean;
  yourGuess: { comment: string | null } | null;
}

interface Score extends Player {
  score: number;
}

interface Results {
  tracks: Track[];
  scores: Score[];
  winners: Player[];
}

/**
 * One service's leg of this round's export, as the API reports it (#73). `playlistUrl` is null for
 * every status but `ok`, so the status is the only thing that tells a missing playlist apart from
 * a broken one.
 */
interface ServiceExport {
  service: ServiceName;
  status: 'ok' | 'no_matches' | 'failed';
  playlistUrl: string | null;
}

/**
 * A line explaining a leg that produced no playlist, or null where there is nothing worth saying.
 *
 * YouTube Music runs on one app-owned account, so there is nothing for a user to fix and the copy
 * does not pretend otherwise.
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

/**
 * Tap a chip to react or take your reaction back; the box adds any emoji, since the API takes any
 * single one. The defaults are only a head start -- anything already in use gets its own chip.
 */
function Reactions({ reactions, onToggle }: { reactions: Reaction[]; onToggle: (emoji: string) => void }) {
  const [custom, setCustom] = useState('');
  const emojis = [...new Set([...DEFAULT_REACTIONS, ...reactions.map((r) => r.emoji)])];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {emojis.map((emoji) => {
        const reaction = reactions.find((r) => r.emoji === emoji);
        return (
          <TapeButton
            key={emoji}
            title={reaction ? `${emoji} ${reaction.count}${reaction.mine ? ' ✓' : ''}` : emoji}
            onPress={() => onToggle(emoji)}
            variant="secondary"
          />
        );
      })}
      <TapeInput
        placeholder="Any emoji"
        value={custom}
        onChangeText={setCustom}
        onSubmitEditing={() => {
          if (custom.trim()) onToggle(custom.trim());
          setCustom('');
        }}
        style={{ minWidth: 90 }}
      />
    </View>
  );
}

interface ThreadActions {
  reply: (guessId: string, body: string, parentReplyId?: string) => Promise<void>;
  editReply: (replyId: string, body: string) => Promise<void>;
  deleteReply: (replyId: string) => Promise<void>;
  react: (path: string, emoji: string) => Promise<void>;
  /** Comment or reply a link or push pointed at; drawn with a marker. */
  focus?: string;
}

/** A reply, the replies under it, and the controls its viewer is allowed: anyone replies, only its author edits or deletes. */
function ReplyNode({
  reply,
  guessId,
  replies,
  actions,
  depth,
}: {
  reply: Reply;
  guessId: string;
  replies: Reply[];
  actions: ThreadActions;
  depth: number;
}) {
  const { token } = useSession();

  const [mode, setMode] = useState<'view' | 'reply' | 'edit'>('view');
  const [draft, setDraft] = useState('');
  const children = replies.filter((r) => r.parentReplyId === reply.replyId);

  async function submit() {
    if (!draft.trim()) return;
    if (mode === 'edit') await actions.editReply(reply.replyId, draft);
    else await actions.reply(guessId, draft, reply.replyId);
    setMode('view');
    setDraft('');
  }

  return (
    // Indent stops growing after a few levels so a long back-and-forth stays on screen.
    <View
      style={{
        marginLeft: depth < 4 ? 16 : 0,
        gap: 6,
        ...(actions.focus === reply.replyId && { borderLeftWidth: 3, paddingLeft: 6 }),
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {reply.mine ? null : <Avatar size={20} label="" url={reply.author.avatarUrl} token={token} initial={(reply.author.displayName ?? '?')[0]} />}
        <HandText>{reply.mine ? 'You' : (reply.author.displayName ?? 'A player')}</HandText>
        <BodyText>{reply.body}</BodyText>
      </View>
      <Reactions reactions={reply.reactions} onToggle={(e) => actions.react(`/replies/${reply.replyId}/reactions`, e)} />
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <TapeButton title="Reply" variant="secondary" onPress={() => { setDraft(''); setMode(mode === 'reply' ? 'view' : 'reply'); }} />
        {reply.mine ? (
          <>
            <TapeButton title="Edit" variant="secondary" onPress={() => { setDraft(reply.body); setMode(mode === 'edit' ? 'view' : 'edit'); }} />
            <TapeButton title="Delete" variant="secondary" onPress={() => actions.deleteReply(reply.replyId)} />
          </>
        ) : null}
      </View>
      {mode !== 'view' ? (
        <>
          <TapeInput placeholder={mode === 'edit' ? 'Edit your reply' : 'Your reply'} value={draft} onChangeText={setDraft} maxLength={500} />
          <TapeButton title={mode === 'edit' ? 'Save reply' : 'Send reply'} variant="secondary" onPress={submit} />
        </>
      ) : null}
      {children.map((child) => (
        <ReplyNode key={child.replyId} reply={child} guessId={guessId} replies={replies} actions={actions} depth={depth + 1} />
      ))}
    </View>
  );
}

function CommentThread({ comment, actions }: { comment: Comment; actions: ThreadActions }) {
  const { token } = useSession();
  const [reply, setReply] = useState('');
  return (
    <View style={{ gap: 6, ...(actions.focus === comment.guessId && { borderLeftWidth: 3, paddingLeft: 6 }) }}>
      {/* Your own comment is already on screen in its editor. */}
      {comment.mine ? null : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Avatar size={20} label="" url={comment.guesser.avatarUrl} token={token} initial={(comment.guesser.displayName ?? '?')[0]} />
          <HandText>{comment.guesser.displayName ?? 'A player'}</HandText>
          <BodyText>“{comment.comment}”</BodyText>
        </View>
      )}
      <Reactions reactions={comment.reactions} onToggle={(e) => actions.react(`/guesses/${comment.guessId}/reactions`, e)} />
      {comment.replies
        .filter((r) => r.parentReplyId === null)
        .map((r) => (
          <ReplyNode key={r.replyId} reply={r} guessId={comment.guessId} replies={comment.replies} actions={actions} depth={1} />
        ))}
      <TapeInput placeholder="Reply" value={reply} onChangeText={setReply} maxLength={500} />
      {reply.trim() ? (
        <TapeButton
          title="Send reply"
          variant="secondary"
          onPress={async () => {
            await actions.reply(comment.guessId, reply);
            setReply('');
          }}
        />
      ) : null}
    </View>
  );
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

export default function RoundResults() {
  const { roundId, focus } = useLocalSearchParams<{ roundId: string; focus?: string }>();
  const list = useRef<FlatList<Track>>(null);
  const { token } = useSession();
  const [results, setResults] = useState<Results | null>(null);
  const [exports, setExports] = useState<ServiceExport[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadResults(): Promise<boolean> {
    if (!token) return false;
    const res = await fetchApi(`/rounds/${roundId}/results`, { token });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? 'Results are not available for this round');
      return false;
    }
    setResults(await res.json());
    return true;
  }

  // Each comment action posts, then re-reads the results so counts and threads match the server.
  async function act(path: string, method: string, body?: object) {
    if (!token) return;
    await fetchApi(path, { method, token, body });
    await loadResults();
  }

  // The heart flips at once and goes back if the call fails. act() can't say whether the call worked, so this posts itself.
  const [favoriteError, setFavoriteError] = useState(false);
  const favoriting = useRef(new Set<string>());
  async function toggleFavorite(submissionId: string) {
    // The server flips on every POST, so a tap while one is pending would desync a rollback; ignore it.
    if (favoriting.current.has(submissionId)) return;
    favoriting.current.add(submissionId);
    const flip = (on: boolean) =>
      setResults((r) => r && { ...r, tracks: r.tracks.map((t) => (t.submissionId === submissionId ? { ...t, favorited: on } : t)) });
    const was = results?.tracks.find((t) => t.submissionId === submissionId)?.favorited ?? false;
    setFavoriteError(false);
    flip(!was);
    const ok = token
      ? await fetchApi(`/submissions/${submissionId}/favorite`, { method: 'POST', token }).then((res) => res.ok, () => false)
      : false;
    if (!ok) {
      flip(was);
      setFavoriteError(true);
    }
    favoriting.current.delete(submissionId);
  }
  const saveComment = (submissionId: string, comment: string) =>
    act(`/rounds/${roundId}/submissions/${submissionId}/guesses/comment`, 'PUT', { comment });
  const actions: ThreadActions = {
    reply: (guessId, body, parentReplyId) => act(`/guesses/${guessId}/replies`, 'POST', { body, parentReplyId }),
    editReply: (replyId, body) => act(`/replies/${replyId}`, 'PUT', { body }),
    deleteReply: (replyId) => act(`/replies/${replyId}`, 'DELETE'),
    react: (path, emoji) => act(path, 'POST', { emoji }),
    focus,
  };

  // Scroll to the track holding the linked comment/reply once, on first load -- not after each reaction.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!focus || !results || scrolled.current) return;
    scrolled.current = true;
    const index = results.tracks.findIndex(
      (t) =>
        t.submissionId === focus || t.comments.some((c) => c.guessId === focus || c.replies.some((r) => r.replyId === focus)),
    );
    if (index > 0) list.current?.scrollToIndex({ index });
  }, [focus, results]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      if (!(await loadResults())) return;

      // First view of the results is what triggers the export; the route builds each playlist once
      // per round, so a revisit -- or another player's first view -- reads back the same one. It can
      // take a while (every track is matched into each service's catalog), so the links land after
      // the results rather than holding them up.
      //
      // The route settles each service on its own now (#73), so a non-2xx here means the request
      // itself died -- nothing per-service to report, and still not a reason to gate the scores.
      const exported = await fetchApi(`/rounds/${roundId}/export`, { method: 'POST', token });
      if (!exported.ok) return;
      const { services } = (await exported.json()) as { services: ServiceExport[] };
      setExports(services);
    })();
  }, [token, roundId]);

  const playlists = exports.flatMap((e) => (e.playlistUrl ? [{ ...e, playlistUrl: e.playlistUrl }] : []));
  const problems = exports.flatMap((e) => {
    const note = exportProblem(e);
    return note ? [{ service: e.service, note }] : [];
  });

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
            <View key={score.accountId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Avatar size={28} label="" url={score.avatarUrl} token={token} initial={(score.displayName ?? '?')[0]} />
                <HandText>{score.displayName ?? 'A player'}</HandText>
              </View>
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
        {problems.length > 0 ? (
          <JCard>
            {problems.map((problem) => (
              <Label key={problem.service}>{problem.note}</Label>
            ))}
          </JCard>
        ) : null}
        {favoriteError ? <ErrorNote>Couldn’t update your favorite. Try again.</ErrorNote> : null}
        <FlatList
          ref={list}
          // ponytail: rows vary in height, so a miss (not yet laid out) just stays at the top.
          onScrollToIndexFailed={() => {}}
          data={results?.tracks ?? []}
          keyExtractor={(item) => item.submissionId}
          ItemSeparatorComponent={Sprocket}
          renderItem={({ item }) => (
            <JCard>
              <ServiceBadge service={item.service} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Thumb url={item.thumbnailUrl} />
                <BodyText style={{ flex: 1 }}>
                  {item.title} — {item.artist}
                </BodyText>
              </View>
              {item.comment && <BodyText>“{item.comment}”</BodyText>}
              {item.note && <BodyText>“{item.note}”</BodyText>}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Label>Submitted by</Label>
                <Avatar size={20} label="" url={item.submitter.avatarUrl} token={token} initial={(item.submitter.displayName ?? '?')[0]} />
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
              <Reactions reactions={item.reactions} onToggle={(e) => actions.react(`/submissions/${item.submissionId}/reactions`, e)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.favorited ? 'Favorited' : 'Not favorited'}
                onPress={() => toggleFavorite(item.submissionId)}
                hitSlop={8}
                style={{ alignSelf: 'flex-start' }}
              >
                <BodyText>{item.favorited ? '♥' : '♡'}</BodyText>
              </Pressable>
              {item.yourGuess ? (
                <MyComment
                  key={item.yourGuess.comment ?? ''}
                  saved={item.yourGuess.comment}
                  onSave={(comment) => saveComment(item.submissionId, comment)}
                />
              ) : null}
              {item.comments.map((c) => (
                <CommentThread key={c.guessId} comment={c} actions={actions} />
              ))}
            </JCard>
          )}
        />
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    </RoundGate>
  );
}
