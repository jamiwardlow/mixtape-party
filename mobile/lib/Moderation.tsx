import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { fetchApi } from './api';
import { CONTACT_EMAIL } from './legal';
import type { Player } from './rounds';
import { useSession } from './session';
import { BodyText, ErrorNote, HandText, Label, TapeButton, TapeInput } from './ui';

const REASONS = [
  ['spam', 'Spam'],
  ['harassment', 'Harassment'],
  ['inappropriate', 'Inappropriate'],
  ['other', 'Something else'],
] as const;

/**
 * Report and Block for someone else's comment or reply (#144). Their name and photo can be reported
 * from here too, and blocking hides everything of theirs from your results. `onBlocked` re-reads
 * the results so it disappears straight away.
 */
export function ReportBlock({
  author,
  targetType,
  targetId,
  onBlocked,
}: {
  author: Player;
  targetType: 'comment' | 'reply';
  targetId: string;
  onBlocked: () => void;
}) {
  const { token } = useSession();
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState<{ type: string; id: string }>({ type: targetType, id: targetId });
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');

  async function send() {
    const res = await fetchApi('/reports', { method: 'POST', token: token ?? undefined, body: { targetType: what.type, targetId: what.id, reason, note } });
    setStatus(res.ok ? 'sent' : 'error');
  }

  async function block() {
    const res = await fetchApi(`/blocks/${author.accountId}`, { method: 'PUT', token: token ?? undefined });
    if (res.ok) onBlocked();
    else setStatus('error');
  }

  if (status === 'sent') return <Label>Thanks, we’ll take a look.</Label>;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <TapeButton title="Report" variant="secondary" onPress={() => setOpen(!open)} />
        <TapeButton title="Block" variant="secondary" onPress={block} />
      </View>
      {open ? (
        <View style={{ gap: 6 }}>
          <HandText>What are you reporting?</HandText>
          {[
            [targetType, targetId, `This ${targetType}`],
            ['display_name', author.accountId, 'Their name'],
            ['avatar', author.accountId, 'Their photo'],
          ].map(([type, id, title]) => (
            <TapeButton key={type} title={`${what.type === type ? '✓ ' : ''}${title}`} variant="secondary" onPress={() => setWhat({ type, id })} />
          ))}
          <HandText>Why?</HandText>
          {REASONS.map(([value, title]) => (
            <TapeButton key={value} title={`${reason === value ? '✓ ' : ''}${title}`} variant="secondary" onPress={() => setReason(value)} />
          ))}
          <TapeInput placeholder="Anything else we should know? (optional)" value={note} onChangeText={setNote} maxLength={500} multiline />
          {reason ? <TapeButton title="Send report" onPress={send} /> : null}
          <Label accessibilityRole="link" onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}>
            Or email {CONTACT_EMAIL}
          </Label>
        </View>
      ) : null}
      {status === 'error' ? <ErrorNote>Something went wrong. Try again.</ErrorNote> : null}
    </View>
  );
}

/** Who you've blocked, each with an Unblock; renders nothing until there's someone. */
export function BlockedPlayers() {
  const { token } = useSession();
  const [blocked, setBlocked] = useState<Player[]>([]);

  async function load() {
    const res = await fetchApi('/blocks', { token: token ?? undefined });
    if (res.ok) setBlocked((await res.json()).blocked ?? []);
  }
  useEffect(() => {
    if (token) load();
  }, [token]);

  if (blocked.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <HandText>Blocked players</HandText>
      {blocked.map((p) => (
        <View key={p.accountId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <BodyText>{p.displayName ?? 'A player'}</BodyText>
          <TapeButton
            title="Unblock"
            variant="secondary"
            onPress={async () => {
              await fetchApi(`/blocks/${p.accountId}`, { method: 'DELETE', token: token ?? undefined });
              await load();
            }}
          />
        </View>
      ))}
    </View>
  );
}
