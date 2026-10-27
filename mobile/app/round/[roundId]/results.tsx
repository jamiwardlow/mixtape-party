import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import type { Player, ServiceName } from '../../../lib/rounds';
import { useSession } from '../../../lib/session';
import { SERVICE_META } from '../../../lib/theme';
import {
  BodyText,
  HandText,
  JCard,
  Label,
  RoundGate,
  Screen,
  ServiceBadge,
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

// Mirrors the API's REACTION_EMOJI.
const REACTION_EMOJI = ['❤️', '😂', '🔥', '👏', '😮'];

interface Track {
  submissionId: string;
  service: ServiceName;
  title: string;
  artist: string;
  comment: string | null;
  submitter: Player;
  correctGuessers: Player[];
  comments: Comment[];
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

/** Tap an emoji to react, tap again to take it back; counts for every emoji already in use. */
function Reactions({ reactions, onToggle }: { reactions: Reaction[]; onToggle: (emoji: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {REACTION_EMOJI.map((emoji) => {
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
    </View>
  );
}

function CommentThread({
  comment,
  onReply,
  onReact,
}: {
  comment: Comment;
  onReply: (guessId: string, body: string) => Promise<void>;
  onReact: (path: string, emoji: string) => Promise<void>;
}) {
  const [reply, setReply] = useState('');
  return (
    <View style={{ gap: 6 }}>
      {/* Your own comment is already on screen in its editor. */}
      {comment.mine ? null : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <HandText>{comment.guesser.displayName ?? 'A player'}</HandText>
          <BodyText>“{comment.comment}”</BodyText>
        </View>
      )}
      <Reactions reactions={comment.reactions} onToggle={(e) => onReact(`/guesses/${comment.guessId}/reactions`, e)} />
      {comment.replies.map((r) => (
        <View key={r.replyId} style={{ marginLeft: 16, gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <HandText>{r.author.displayName ?? 'A player'}</HandText>
            <BodyText>{r.body}</BodyText>
          </View>
          <Reactions reactions={r.reactions} onToggle={(e) => onReact(`/replies/${r.replyId}/reactions`, e)} />
        </View>
      ))}
      <TapeInput placeholder="Reply" value={reply} onChangeText={setReply} maxLength={500} />
      {reply.trim() ? (
        <TapeButton
          title="Send reply"
          variant="secondary"
          onPress={async () => {
            await onReply(comment.guessId, reply);
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
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
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
  async function act(path: string, method: string, body: object) {
    if (!token) return;
    await fetchApi(path, { method, token, body });
    await loadResults();
  }
  const saveComment = (submissionId: string, comment: string) =>
    act(`/rounds/${roundId}/submissions/${submissionId}/guesses/comment`, 'PUT', { comment });
  const reply = (guessId: string, body: string) => act(`/guesses/${guessId}/replies`, 'POST', { body });
  const react = (path: string, emoji: string) => act(path, 'POST', { emoji });

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
        {problems.length > 0 ? (
          <JCard>
            {problems.map((problem) => (
              <Label key={problem.service}>{problem.note}</Label>
            ))}
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
              {item.comment && <BodyText>“{item.comment}”</BodyText>}
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
              {item.yourGuess ? (
                <MyComment
                  key={item.yourGuess.comment ?? ''}
                  saved={item.yourGuess.comment}
                  onSave={(comment) => saveComment(item.submissionId, comment)}
                />
              ) : null}
              {item.comments.map((c) => (
                <CommentThread
                  key={c.guessId}
                  comment={c}
                  onReply={reply}
                  onReact={react}
                />
              ))}
            </JCard>
          )}
        />
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    </RoundGate>
  );
}
