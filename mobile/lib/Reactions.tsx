import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { fetchApi } from './api';
import { BodyText, TapeButton, TapeInput } from './ui';

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

const DEFAULT_REACTIONS = ['❤️', '😂', '🔥', '👏', '😮'];

/**
 * Tap a chip to react or take your reaction back; the box adds any emoji, since the API takes any
 * single one. The defaults are only a head start -- anything already in use gets its own chip.
 */
export function Reactions({ reactions, onToggle }: { reactions: Reaction[]; onToggle: (emoji: string) => void }) {
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

export function FavoriteHeart({ favorited, onPress }: { favorited: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={favorited ? 'Favorited' : 'Not favorited'}
      onPress={onPress}
      hitSlop={8}
      style={{ alignSelf: 'flex-start' }}
    >
      <BodyText>{favorited ? '♥' : '♡'}</BodyText>
    </Pressable>
  );
}

/**
 * The heart flips at once (via `setFavorited`) and goes back if the call fails. The server flips on
 * every POST, so a tap while one is pending is ignored: it would desync the rollback.
 */
export function useFavorite(token: string | null | undefined, setFavorited: (submissionId: string, on: boolean) => void) {
  const [error, setError] = useState(false);
  const pending = useRef(new Set<string>());
  async function toggle(submissionId: string, was: boolean) {
    if (pending.current.has(submissionId)) return;
    pending.current.add(submissionId);
    setError(false);
    setFavorited(submissionId, !was);
    const ok = token
      ? await fetchApi(`/submissions/${submissionId}/favorite`, { method: 'POST', token }).then((res) => res.ok, () => false)
      : false;
    if (!ok) {
      setFavorited(submissionId, was);
      setError(true);
    }
    pending.current.delete(submissionId);
  }
  return { toggle, error };
}
