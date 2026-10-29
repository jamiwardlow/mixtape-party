import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { pickIdeas } from './themeSuggestions';
import { Chip } from './ui';

/**
 * Tappable theme suggestions for one round. `taken` is the other rounds' themes, not this one's:
 * keep this round's own text out of it, or every keystroke would reshuffle the chips.
 */
export function ThemeIdeas({ taken, onPick }: { taken: string[]; onPick: (theme: string) => void }) {
  const [shuffles, setShuffles] = useState(0);
  const takenKey = taken.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- takenKey stands in for the array identity
  const ideas = useMemo(() => pickIdeas(4, taken), [shuffles, takenKey]);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {ideas.map((idea) => (
        <Chip key={idea} testID="theme-idea" label={idea} onPress={() => onPick(idea)} />
      ))}
      <Chip label="Shuffle" onPress={() => setShuffles((n) => n + 1)} />
    </View>
  );
}
