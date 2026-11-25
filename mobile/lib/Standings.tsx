import { StyleSheet, View } from 'react-native';
import { Avatar } from './Avatar';
import { PlayerLink } from './PlayerLink';
import { nameOf, type Score } from './rounds';
import { BodyText, LeaderboardRow } from './ui';

function Who({ player }: { player: Score }) {
  return (
    <View style={styles.inline}>
      <Avatar size={28} label="" url={player.avatarUrl} initial={nameOf(player)[0]} />
      <BodyText>{nameOf(player)}</BodyText>
    </View>
  );
}

export function WinnersRow({ winners }: { winners: Score[] }) {
  if (winners.length === 0) return null;
  return (
    <View testID="winners" style={styles.inline}>
      <BodyText>Winners:</BodyText>
      {winners.map((w) => (
        <Who key={w.accountId} player={w} />
      ))}
    </View>
  );
}

export function StandingRows({ standings, firstRank = 1 }: { standings: Score[]; firstRank?: number }) {
  return (
    <>
      {standings.map((player, i) => (
        <PlayerLink key={player.accountId} accountId={player.accountId}>
        <LeaderboardRow
          rank={i + firstRank}
          name={nameOf(player)}
          points={player.score}
          pointsTestID={`standings-${player.accountId}`}
          avatar={<Avatar size={28} label="" url={player.avatarUrl} initial={nameOf(player)[0]} />}
        />
        </PlayerLink>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
});
