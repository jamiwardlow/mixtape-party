import { StyleSheet, View } from 'react-native';
import { Avatar } from './Avatar';
import { nameOf, type Score } from './rounds';
import { BodyText, LeaderboardRow } from './ui';

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
      {standings.map((player, i) => (
        <LeaderboardRow
          key={player.accountId}
          rank={i + 1}
          name={nameOf(player)}
          points={player.score}
          pointsTestID={`standings-${player.accountId}`}
          avatar={<Avatar size={28} label="" url={player.avatarUrl} token={token} initial={nameOf(player)[0]} />}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
});
