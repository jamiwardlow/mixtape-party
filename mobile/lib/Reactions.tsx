import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { fetchApi } from './api';
import { useTheme } from './theme';
import { Chip, TapeInput, focusRing, type WebState } from './ui';

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

const TRAY_EMOJI = ['❤️', '😂', '🔥', '👏', '🔊', '😭', '🤘', '💀', '🎧', '🙌', '🥹', '🎉'];

/**
 * Chips for the reactions that exist (tap to react or take yours back), then one dashed button that
 * opens a tray of common emoji plus "Any emoji", since the API takes any single one. Picking closes the tray.
 */
export function Reactions({ reactions, onToggle }: { reactions: Reaction[]; onToggle: (emoji: string) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [custom, setCustom] = useState('');
  function pick(emoji: string) {
    onToggle(emoji);
    setOpen(false);
    setTyping(false);
    setCustom('');
  }
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {reactions.map((r) => (
          <Chip key={r.emoji} label={`${r.emoji} ${r.count}${r.mine ? ' ✓' : ''}`} selected={r.mine} onPress={() => onToggle(r.emoji)} />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add reaction"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          style={({ focused }: WebState) => [
            {
              borderColor: t.ink,
              borderWidth: t.border,
              borderStyle: open ? 'solid' : 'dashed',
              borderRadius: 99,
              backgroundColor: open ? t.bg : t.shell,
              paddingHorizontal: 10,
              paddingVertical: 3,
            },
            focusRing(t, focused),
          ]}
        >
          <Text style={{ color: t.ink, fontFamily: t.font.body, fontSize: 15 }}>☺+</Text>
        </Pressable>
      </View>
      {open ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderColor: t.ink, borderWidth: t.border, borderRadius: 16, padding: 6, backgroundColor: t.shell }}>
          {TRAY_EMOJI.map((emoji) => (
            <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`React ${emoji}`} onPress={() => pick(emoji)} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 22 }}>{emoji}</Text>
            </Pressable>
          ))}
          {typing ? (
            <TapeInput
              placeholder="Any emoji"
              value={custom}
              onChangeText={setCustom}
              onSubmitEditing={() => (custom.trim() ? pick(custom.trim()) : setTyping(false))}
              autoFocus
              style={{ minWidth: 120 }}
            />
          ) : (
            <Chip label="Any emoji" onPress={() => setTyping(true)} />
          )}
        </View>
      ) : null}
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
