import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import { PHASE_META, nameOf, type Player, type RoundPhase } from '../../../lib/rounds';
import { useSession } from '../../../lib/session';
import {
  BodyText,
  DeadlineRows,
  HandText,
  JCard,
  Label,
  RoundGate,
  Screen,
  Sprocket,
  TapeButton,
} from '../../../lib/ui';

interface Score extends Player {
  score: number;
}

/** One round of the season, as `GET /leagues/:leagueId/overview` describes it. */
interface OverviewRound {
  id: string;
  number: number;
  /** Null until someone names it — #74 schedules the season before its themes exist. */
  theme: string | null;
  submissionDeadline: string;
  guessingDeadline: string;
  phase: RoundPhase;
  submittedCount: number;
  /**
   * Optional because the server *omits* it while guessing is open: naming who has not submitted
   * narrows the pool. Its absence is the only signal this screen is allowed to branch on — the
   * phase is derived from clocks that can disagree, and a field we render "only in the right
   * phase" is a field that leaks the first time those two drift.
   */
  submitters?: Player[];
  /** Who has answered, never what they answered — safe to name in every phase. */
  guessedPlayers: Player[];
  isCurrent: boolean;
}

interface Overview {
  league: {
    id: string;
    name: string;
    seasonLength: number;
    inviteCode: string;
    isHost: boolean;
    concluded: boolean;
  };
  host: Player;
  members: Array<Player & { joinedAt: string }>;
  standings: Score[];
  scoredRoundCount: number;
  winners: Score[];
  rounds: OverviewRound[];
}

/**
 * Guessing refuses to run below this (`api/src/routes/guessing.ts:10`), and until now a host
 * found that out only when the phase quietly did nothing. Duplicated rather than shared: there is
 * no module the API and the app both import, and a wrong number here under-promises rather than
 * breaking anything.
 */
const MIN_PLAYERS = 4;

export default function LeagueOverview() {
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const { token } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const res = await fetchApi(`/leagues/${leagueId}/overview`, { token });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not load this league');
        return;
      }
      setOverview(await res.json());
    })();
  }, [token, leagueId]);

  if (!overview) {
    return (
      <RoundGate label="Season" error={error} ready={false}>
        {null}
      </RoundGate>
    );
  }

  const { league, members, standings, scoredRoundCount, winners, rounds } = overview;
  // The API marks exactly one round current, and keeps marking the last one between seasons.
  const current = rounds.find((round) => round.isCurrent);
  const shortBy = MIN_PLAYERS - members.length;

  return (
    <Screen label={league.name}>
      <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
        <JCard>
          <Label testID="season-progress">
            {league.concluded ? 'Season complete' : `Round ${current?.number ?? 1} of ${league.seasonLength}`}
          </Label>
          {league.concluded && winners.length > 0 && (
            <View style={styles.inline}>
              <BodyText>Winners:</BodyText>
              <HandText testID="winners">{winners.map(nameOf).join(', ')}</HandText>
            </View>
          )}
        </JCard>

        {current && (
          <JCard>
            <HandText testID="current-round-heading">{`Round ${current.number}`}</HandText>
            {current.theme ? (
              <BodyText>{current.theme}</BodyText>
            ) : (
              <Label>{league.isHost ? 'Set a theme' : 'Theme not set yet'}</Label>
            )}
            <DeadlineRows
              submissionDeadline={new Date(current.submissionDeadline)}
              guessingDeadline={new Date(current.guessingDeadline)}
              testID="current-round"
            />
            <TapeButton
              title={PHASE_META[current.phase].label}
              onPress={() =>
                router.push({
                  pathname: `/round/[roundId]/${PHASE_META[current.phase].segment}`,
                  params: { roundId: current.id },
                })
              }
            />
          </JCard>
        )}

        <JCard>
          <HandText>Standings</HandText>
          {/* A table of zeroes reads as a result. Nothing has been scored, so say that instead. */}
          {scoredRoundCount === 0 && !league.concluded ? (
            <Label>No rounds have been scored yet.</Label>
          ) : (
            <>
              {/* Mid-season standings are a snapshot; say what they count so nobody reads them as final. */}
              <Label testID="standings-caption">
                {league.concluded ? 'Final standings' : `After ${scoredRoundCount} of ${league.seasonLength} rounds`}
              </Label>
              {standings.map((player) => (
                <View key={player.accountId} style={styles.row}>
                  <BodyText>{nameOf(player)}</BodyText>
                  <BodyText testID={`standings-${player.accountId}`}>{player.score}</BodyText>
                </View>
              ))}
            </>
          )}
        </JCard>

        <JCard>
          <HandText>Players</HandText>
          {current && (
            <Label testID="submitted-count">{`${current.submittedCount} of ${members.length} submitted`}</Label>
          )}
          {members.map((member) => {
            const submitters = current?.submitters;
            const submitted = submitters?.some((s) => s.accountId === member.accountId);
            const guessed = current?.guessedPlayers.some((g) => g.accountId === member.accountId);
            return (
              <View key={member.accountId} testID={`roster-${member.accountId}`} style={styles.row}>
                <View style={styles.inline}>
                  <BodyText>{nameOf(member)}</BodyText>
                  {member.accountId === overview.host.accountId && <Label>host</Label>}
                </View>
                <View style={styles.inline}>
                  {/* Named only when the server hands over the names. During guessing it withholds
                      them, and a roster that names the stragglers then is the leak itself. */}
                  {submitters && <Label>{submitted ? 'Submitted' : 'No track yet'}</Label>}
                  {guessed && <Label>Guessed</Label>}
                </View>
              </View>
            );
          })}
        </JCard>

        <Sprocket />
        <HandText>The season</HandText>
        {rounds.map((round) => (
          <JCard key={round.id}>
            <HandText>{`Round ${round.number}`}</HandText>
            {/* The current round has its own card above — theme, deadlines and the CTA. Printing
                all three again here would just be that card twice; the list only keeps its place. */}
            {round.isCurrent ? (
              <Label>In progress — see above</Label>
            ) : (
              <>
                {round.theme ? (
                  <BodyText>{round.theme}</BodyText>
                ) : (
                  <Label>{league.isHost ? 'Set a theme' : 'Theme not set yet'}</Label>
                )}
                <DeadlineRows
                  submissionDeadline={new Date(round.submissionDeadline)}
                  guessingDeadline={new Date(round.guessingDeadline)}
                  testID={`round-${round.number}`}
                />
                {/* Only a round that is over has results to read — and the server's phase, not this
                    device's clock, is what decides that. A skewed phone would otherwise link into a
                    round the standings above still count as unscored. */}
                {round.phase === 'results' && (
                  <TapeButton
                    title={`Round ${round.number} results`}
                    variant="secondary"
                    onPress={() =>
                      router.push({ pathname: '/round/[roundId]/results', params: { roundId: round.id } })
                    }
                  />
                )}
              </>
            )}
          </JCard>
        ))}

        <Sprocket />
        <JCard>
          <BodyText>Invite code: {league.inviteCode}</BodyText>
          {shortBy > 0 && (
            <Label testID="min-players-note">
              {`${shortBy} more player${shortBy === 1 ? '' : 's'} needed before guessing can start`}
            </Label>
          )}
          <TapeButton
            title="Share invite"
            onPress={() =>
              Share.share({
                message: `Join my mixtape league: ${Linking.createURL(`join/${league.inviteCode}`)}`,
              })
            }
          />
        </JCard>

        {/* schedule.tsx already refuses a non-host its edit buttons; the way in should agree. */}
        {league.isHost && (
          <TapeButton
            title="Edit the season schedule"
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/league/[leagueId]/schedule', params: { leagueId: league.id } })
            }
          />
        )}
      </ScrollView>
      <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
});
