import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { pickIdeas } from './themeSuggestions';
import { useTheme } from './theme';

/**
 * Tappable theme suggestions for one round. `taken` is the other rounds' themes, not this one's:
 * keep this round's own text out of it, or every keystroke would reshuffle the chips.
 */
export function ThemeIdeas({ taken, onPick }: { taken: string[]; onPick: (theme: string) => void }) {
  const t = useTheme();
  const [shuffles, setShuffles] = useState(0);
  const takenKey = taken.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- takenKey stands in for the array identity
  const ideas = useMemo(() => pickIdeas(4, taken), [shuffles, takenKey]);

  const chip = { borderWidth: 1, borderColor: t.hairline, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {ideas.map((idea) => (
        <Pressable key={idea} testID="theme-idea" accessibilityRole="button" style={chip} onPress={() => onPick(idea)}>
          <Text style={{ color: t.ink }}>{idea}</Text>
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" style={chip} onPress={() => setShuffles((n) => n + 1)}>
        <Text style={{ color: t.inkMuted }}>Shuffle</Text>
      </Pressable>
    </View>
  );
}
