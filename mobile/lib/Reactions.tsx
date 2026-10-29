import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { fetchApi } from './api';
import { useTheme } from './theme';
import { Chip, TapeInput, focusRing, type WebState } from './ui';

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
          <Chip
            key={emoji}
            label={reaction ? `${emoji} ${reaction.count}${reaction.mine ? ' ✓' : ''}` : emoji}
            selected={reaction?.mine}
            onPress={() => onToggle(emoji)}
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
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={favorited ? 'Favorited' : 'Not favorited'}
      onPress={onPress}
      hitSlop={8}
      style={({ focused }: WebState) => [{ alignSelf: 'flex-start' }, focusRing(t, focused)]}
    >
      <Svg width={28} height={28} viewBox="0 0 24 24">
        <Path
          d="M12 21s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.7-8 11-8 11z"
          fill={favorited ? t.accent : t.shell}
          stroke={t.ink}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </Svg>
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
