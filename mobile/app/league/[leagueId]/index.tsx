import * as Linking from 'expo-linking';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import { Avatar } from '../../../lib/Avatar';
import { PlayerLink } from '../../../lib/PlayerLink';
import {
  PHASE_META,
  phaseLabel,
  nameOf,
  type Player,
  type SeasonResult,
  type RoundPhase,
} from '../../../lib/rounds';
import { useSession } from '../../../lib/session';
import { useTheme } from '../../../lib/theme';
import { StandingRows, WinnersRow } from '../../../lib/Standings';
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
  focusRing,
  type WebState,
} from '../../../lib/ui';

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
  /** False while the league is too small to guess in, even though the clock says guessing. */
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

interface Overview extends SeasonResult {
  league: SeasonResult['league'] & {
    seasonLength: number;
    inviteCode: string;
    isHost: boolean;
  };
  host: Player;
  members: Array<Player & { joinedAt: string }>;
  scoredRoundCount: number;
  rounds: OverviewRound[];
}

/** Quiet link at the end of the page; one tap opens an inline confirm card (#183). */
function DeleteLeague({ name, roundCount, onDelete }: { name: string; roundCount: number; onDelete: () => void }) {
  const t = useTheme();
  const [confirming, setConfirming] = useState(false);
  return (
    <View style={{ gap: 12, marginTop: 12 }}>
      <View style={{ borderTopWidth: 2, borderStyle: 'dashed', borderColor: t.ink, opacity: 0.25 }} />
      {confirming ? (
        <JCard>
          <HandText>Delete "{name}"?</HandText>
          <BodyText>
            {roundCount} {roundCount === 1 ? 'round' : 'rounds'} and all submissions go with it. This can't be undone.
          </BodyText>
          <View style={styles.inline}>
            <TapeButton title="Keep it" variant="secondary" onPress={() => setConfirming(false)} />
            <TapeButton title="Delete" variant="danger" onPress={onDelete} />
          </View>
        </JCard>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete league"
          onPress={() => setConfirming(true)}
          style={({ focused }: WebState) => [
            { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
            focusRing(t, focused),
          ]}
        >
          <Text style={{ color: t.ink, opacity: 0.75, fontFamily: t.font.body, fontSize: 14, textDecorationLine: 'underline' }}>
            Delete league
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export default function LeagueOverview() {
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const { token, profile } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetchApi(`/leagues/${leagueId}/overview`, { token: token ?? undefined });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? 'Could not load this league');
      return;
    }
    setOverview(await res.json());
  }
  // Refetch on every focus: coming back from submit leaves this screen mounted, so it'd show stale state.
  useFocusEffect(
    useCallback(() => {
      if (token) load();
    }, [token, leagueId]),
  );

  function confirmRemove(member: Player) {
    const name = nameOf(member);
    const remove = async () => {
      const res = await fetchApi(`/leagues/${leagueId}/members/${member.accountId}`, { method: 'DELETE', token: token! });
      if (res.ok) load();
      else setError((await res.json().catch(() => null))?.error ?? 'Could not remove this player');
    };
    const msg = `${name}'s track and guesses in this league will be deleted.`;
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${name}? ${msg}`)) remove();
    } else {
      Alert.alert(`Remove ${name}?`, msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: remove },
      ]);
    }
  }

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
  const iSubmitted = !!current?.submitters?.some((s) => s.accountId === profile?.id);

  return (
    <Screen label={league.name} wide>
      <ScrollView style={{ margin: -6 }} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, padding: 6 }} showsVerticalScrollIndicator={false}>
        <View style={styles.cols}>
        <View style={styles.col}>
        <JCard>
          <Label testID="season-progress">
            {league.concluded ? 'Season complete' : `Round ${current?.number ?? 1} of ${league.seasonLength}`}
          </Label>
          {league.concluded && (
            <TapeButton
              title="Season wrap-up"
              onPress={() => router.push({ pathname: '/league/[leagueId]/final', params: { leagueId: league.id } })}
            />
          )}
          {league.concluded && <WinnersRow winners={winners} token={token} />}
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
              title={phaseLabel(current.phase, iSubmitted)}
              onPress={() =>
                router.push({
                  pathname: `/round/[roundId]/${PHASE_META[current.phase].segment}`,
                  params: current.phase === 'submission' && iSubmitted ? { roundId: current.id, edit: '1' } : { roundId: current.id },
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
              <StandingRows standings={standings} token={token} />
            </>
          )}
        </JCard>

        </View>
        <View style={styles.col}>
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
                  <PlayerLink accountId={member.accountId}>
                    <View style={styles.inline}>
                      <Avatar size={28} label="" url={member.avatarUrl} token={token} initial={nameOf(member)[0]} />
                      <BodyText>{nameOf(member)}</BodyText>
                    </View>
                  </PlayerLink>
                  {member.accountId === overview.host.accountId && <Label>host</Label>}
                </View>
                <View style={styles.inline}>
                  {/* Named only when the server hands over the names. During guessing it withholds
                      them, and a roster that names the stragglers then is the leak itself. */}
                  {submitters && <Label>{submitted ? 'Submitted' : 'No track yet'}</Label>}
                  {guessed && <Label>Guessed</Label>}
                  {league.isHost && member.accountId !== overview.host.accountId && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${nameOf(member)}`}
                      onPress={() => confirmRemove(member)}
                    >
                      <Label>Remove</Label>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </JCard>
        </View>
        </View>

        <Sprocket />
        <HandText>The season</HandText>
        {rounds.map((round) => (
          <JCard key={round.id}>
            <HandText>{`Round ${round.number}`}</HandText>
            {/* The current round has its own card above — theme, deadlines and the CTA. Printing
                all three again here would just be that card twice; the list only keeps its place. */}
            {round.isCurrent && round.phase !== 'results' ? (
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
                {round.phase === 'results' &&
                  (round.submittedCount === 0 ? (
                    <Label>No tracks were submitted</Label>
                  ) : (
                    <TapeButton
                      title={`Round ${round.number} results`}
                      variant="secondary"
                      onPress={() =>
                        router.push({ pathname: '/round/[roundId]/results', params: { roundId: round.id } })
                      }
                    />
                  ))}
              </>
            )}
          </JCard>
        ))}

        <Sprocket />
        <JCard>
          <BodyText>Invite code: {league.inviteCode}</BodyText>
          <TapeButton
            title="Share invite"
            onPress={() =>
              Share.share({
                message: `Join my Mixtape Party! ${Linking.createURL(`join/${league.inviteCode}`)}`,
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

        {league.isHost && (
          <DeleteLeague
            name={league.name}
            roundCount={rounds.length}
            onDelete={async () => {
              const res = await fetchApi(`/leagues/${league.id}`, { method: 'DELETE', token: token! });
              if (res.ok) router.replace('/home');
              else setError((await res.json().catch(() => null))?.error ?? 'Could not delete this league');
            }}
          />
        )}
      </ScrollView>
      <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cols: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  col: { flexGrow: 1, flexBasis: 320, gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
});
