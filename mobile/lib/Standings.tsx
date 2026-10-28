import { StyleSheet, View } from 'react-native';
import { Avatar } from './Avatar';
import { nameOf, type Score } from './rounds';
import { BodyText, HandText } from './ui';

export function WinnersRow({ winners }: { winners: Score[] }) {
  if (winners.length === 0) return null;
  return (
    <View style={styles.inline}>
      <BodyText>Winners:</BodyText>
      <HandText testID="winners">{winners.map(nameOf).join(', ')}</HandText>
    </View>
  );
}

export function StandingRows({ standings, token }: { standings: Score[]; token: string | null }) {
  return (
    <>
      {standings.map((player) => (
        <View key={player.accountId} style={styles.row}>
          <View style={styles.inline}>
            <Avatar size={28} label="" url={player.avatarUrl} token={token} initial={nameOf(player)[0]} />
            <BodyText>{nameOf(player)}</BodyText>
          </View>
          <BodyText testID={`standings-${player.accountId}`}>{player.score}</BodyText>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
});
