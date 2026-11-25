import { useState } from 'react';
import { View } from 'react-native';
import { Avatar } from './Avatar';
import { ReportBlock } from './Moderation';
import { PlayerLink } from './PlayerLink';
import { Reactions, type Reaction } from './Reactions';
import { nameOf, type Player } from './rounds';
import { BodyText, HandText, TapeButton, TapeInput } from './ui';

export interface Reply {
  replyId: string;
  parentReplyId: string | null;
  mine: boolean;
  author: Player;
  body: string;
  reactions: Reaction[];
}

export interface Comment {
  guessId: string;
  guesser: Player;
  mine: boolean;
  comment: string;
  reactions: Reaction[];
  replies: Reply[];
}

export interface ThreadActions {
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
        {reply.mine ? (
          <HandText>You</HandText>
        ) : (
          <PlayerLink accountId={reply.author.accountId}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Avatar size={20} label="" url={reply.author.avatarUrl} initial={reply.author.displayName?.[0] ?? '?'} />
              <HandText>{nameOf(reply.author)}</HandText>
            </View>
          </PlayerLink>
        )}
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
        ) : (
          <ReportBlock author={reply.author} targetType="reply" targetId={reply.replyId} />
        )}
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

export function CommentThread({ comment, actions }: { comment: Comment; actions: ThreadActions }) {
  const [reply, setReply] = useState('');
  return (
    <View style={{ gap: 6, ...(actions.focus === comment.guessId && { borderLeftWidth: 3, paddingLeft: 6 }) }}>
      {/* Your own comment is already on screen in its editor. */}
      {comment.mine ? null : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <PlayerLink accountId={comment.guesser.accountId}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Avatar size={20} label="" url={comment.guesser.avatarUrl} initial={comment.guesser.displayName?.[0] ?? '?'} />
              <HandText>{nameOf(comment.guesser)}</HandText>
            </View>
          </PlayerLink>
          <BodyText>“{comment.comment}”</BodyText>
        </View>
      )}
      {comment.mine ? null : <ReportBlock author={comment.guesser} targetType="comment" targetId={comment.guessId} />}
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
