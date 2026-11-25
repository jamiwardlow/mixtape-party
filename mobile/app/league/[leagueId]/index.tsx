import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../../lib/Avatar';
import { ResourceGate, useApi, useResource } from '../../../lib/client';
import { confirmDestructive } from '../../../lib/confirm';
import { PlayerLink } from '../../../lib/PlayerLink';
import { hasSubmitted, nameOf, nextStep, seasonEntry, submissionMark, type Player, type RoundSummary, type SeasonResult } from '../../../lib/rounds';
import { useSession } from '../../../lib/session';
import { useTheme } from '../../../lib/theme';
import { StandingRows, WinnersRow } from '../../../lib/Standings';
import {
  BodyText,
  HandText,
  JCard,
  Label,
  Screen,
  Sprocket,
  TapeButton,
  focusRing,
  type WebState,
} from '../../../lib/ui';
import { DeadlineRows } from '../../../lib/deadlines';

/** One round of the season, as `GET /leagues/:leagueId/overview` describes it. */
interface OverviewRound extends RoundSummary {
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
  const { profile } = useSession();
  const api = useApi();
  // Refetches on every focus: coming back from submit leaves this screen mounted, so it'd show stale state.
  const { data: overview, error, reload } = useResource<Overview>(`/leagues/${leagueId}/overview`, 'Could not load this league');

  function confirmRemove(member: Player) {
    const name = nameOf(member);
    const remove = async () => {
      // ponytail: a failure here has no on-screen note (it never had one); add one if hosts hit it.
      if ((await api(`/leagues/${leagueId}/members/${member.accountId}`, { method: 'DELETE' })).ok) await reload();
    };
    const msg = `${name}'s track and guesses in this league will be deleted.`;
    confirmDestructive(`Remove ${name}?`, msg, 'Remove', remove);
  }

  if (!overview) {
    return (
      <ResourceGate label="Season" error={error} ready={false}>
        {null}
      </ResourceGate>
    );
  }

  const { league, members, standings, scoredRoundCount, winners, rounds } = overview;
  // The API marks exactly one round current, and keeps marking the last one between seasons.
  const current = rounds.find((round) => round.isCurrent);
  const step = current && nextStep(current, hasSubmitted(current, profile?.id));

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
          {league.concluded && <WinnersRow winners={winners} />}
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
            {step && <TapeButton title={step.label} onPress={() => router.push(step.href)} />}
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
              <StandingRows standings={standings} />
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
            const mark = current && submissionMark(current, member.accountId);
            const guessed = current?.guessedPlayers.some((g) => g.accountId === member.accountId);
            return (
              <View key={member.accountId} testID={`roster-${member.accountId}`} style={styles.row}>
                <View style={styles.inline}>
                  <PlayerLink accountId={member.accountId}>
                    <View style={styles.inline}>
                      <Avatar size={28} label="" url={member.avatarUrl} initial={nameOf(member)[0]} />
                      <BodyText>{nameOf(member)}</BodyText>
                    </View>
                  </PlayerLink>
                  {member.accountId === overview.host.accountId && <Label>host</Label>}
                </View>
                <View style={styles.inline}>
                  {mark && <Label>{mark}</Label>}
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
        {rounds.map((round) => {
          const entry = seasonEntry(round);
          return (
            <JCard key={round.id}>
              <HandText>{`Round ${round.number}`}</HandText>
              {entry === 'see above' ? (
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
                  {entry === 'no tracks' && <Label>No tracks were submitted</Label>}
                  {entry === 'results' && (
                    <TapeButton
                      title={`Round ${round.number} results`}
                      variant="secondary"
                      onPress={() => router.push({ pathname: '/round/[roundId]/results', params: { roundId: round.id } })}
                    />
                  )}
                </>
              )}
            </JCard>
          );
        })}

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
              if ((await api(`/leagues/${league.id}`, { method: 'DELETE' })).ok) router.replace('/home');
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
