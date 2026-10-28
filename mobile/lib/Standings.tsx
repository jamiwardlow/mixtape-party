import { StyleSheet, View } from 'react-native';
import { Avatar } from './Avatar';
import { nameOf, type Score } from './rounds';
import { BodyText } from './ui';

function Who({ player, token }: { player: Score; token: string | null }) {
  return (
    <View style={styles.inline}>
      <Avatar size={28} label="" url={player.avatarUrl} token={token} initial={nameOf(player)[0]} />
      <BodyText>{nameOf(player)}</BodyText>
    </View>
  );
}

export function WinnersRow({ winners, token }: { winners: Score[]; token: string | null }) {
  if (winners.length === 0) return null;
  return (
    <View testID="winners" style={styles.inline}>
      <BodyText>Winners:</BodyText>
      {winners.map((w) => (
        <Who key={w.accountId} player={w} token={token} />
      ))}
    </View>
  );
}

export function StandingRows({ standings, token }: { standings: Score[]; token: string | null }) {
  return (
    <>
      {standings.map((player) => (
        <View key={player.accountId} style={styles.row}>
          <Who player={player} token={token} />
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
