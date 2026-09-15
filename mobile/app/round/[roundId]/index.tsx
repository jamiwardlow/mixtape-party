import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import { PHASE_META, nameOf, type Player, type RoundPhase } from '../../../lib/rounds';
import { useSession } from '../../../lib/session';
import { BodyText, DeadlineRows, HandText, JCard, Label, RoundGate, Screen, TapeButton } from '../../../lib/ui';

/** The one round, as `GET /rounds/:roundId/overview` describes it — the season page's entry. */
interface RoundDetail {
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
   * narrows the pool. Its absence is the only signal this screen may branch on — the phase is
   * derived from clocks that can disagree, and a field rendered "only in the right phase" leaks
   * the first time those two drift.
   */
  submitters?: Player[];
  /** Who has answered, never what they answered — safe to name in every phase. */
  guessedPlayers: Player[];
  you: { submitted: boolean; guessesRemaining: number };
}

interface Overview {
  leagueId: string;
  leagueName: string;
  round: RoundDetail;
}

/** What the round is doing right now, in words. The CTA below says what to do about it. */
const PHASE_STATUS: Record<RoundPhase, string> = {
  submission: 'Submissions are open',
  guessing: 'Guessing is open',
  results: 'This round is over',
};

/**
 * The canonical URL for a round, in any phase. Every other round screen is a phase — a link to
 * one is only correct until its deadline passes. This page is the link that keeps working, so it
 * deliberately does not redirect into the phase screen: that would make it a render flash rather
 * than a destination. For a finished round it links to the reveal instead of restating it.
 */
export default function RoundOverview() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const { token } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const res = await fetchApi(`/rounds/${roundId}/overview`, { token });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not load this round');
        return;
      }
      setOverview(await res.json());
    })();
  }, [token, roundId]);

  if (!overview) {
    return (
      <RoundGate label="Round" error={error} ready={false}>
        {null}
      </RoundGate>
    );
  }

  const { leagueId, leagueName, round } = overview;

  return (
    <Screen label={leagueName}>
      <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
        <JCard>
          <HandText testID="round-heading">{`Round ${round.number}`}</HandText>
          {round.theme ? <BodyText>{round.theme}</BodyText> : <Label>Theme not set yet</Label>}
          <DeadlineRows
            submissionDeadline={new Date(round.submissionDeadline)}
            guessingDeadline={new Date(round.guessingDeadline)}
            testID="round"
          />
          <Label testID="round-phase">{PHASE_STATUS[round.phase]}</Label>
        </JCard>

        <JCard>
          <HandText>Where the round is</HandText>
          <Label testID="submitted-count">
            {`${round.submittedCount} track${round.submittedCount === 1 ? '' : 's'} in`}
          </Label>
          {/* Named only when the server hands over the names. During guessing it withholds them,
              and naming the stragglers then is the leak itself. */}
          {round.submitters && round.submitters.length > 0 && (
            <View style={styles.row}>
              <Label>Submitted</Label>
              <Label testID="submitters">{round.submitters.map(nameOf).join(', ')}</Label>
            </View>
          )}
          {round.guessedPlayers.length > 0 && (
            <View style={styles.row}>
              <Label>Finished guessing</Label>
              <Label testID="guessed-players">{round.guessedPlayers.map(nameOf).join(', ')}</Label>
            </View>
          )}
        </JCard>

        <JCard>
          <HandText>You</HandText>
          <BodyText testID="your-submission">
            {round.you.submitted ? 'Your track is in' : 'You have not submitted a track'}
          </BodyText>
          {/* Only while guesses are being made: before then it counts tracks nobody can guess yet,
              and afterwards it is a leftover from a window that has shut. */}
          {round.phase === 'guessing' && (
            <BodyText testID="your-guesses">
              {round.you.guessesRemaining === 0
                ? 'You have made all your guesses'
                : `${round.you.guessesRemaining} guess${round.you.guessesRemaining === 1 ? '' : 'es'} to go`}
            </BodyText>
          )}
        </JCard>

        <TapeButton
          title={PHASE_META[round.phase].label}
          onPress={() =>
            router.push({
              pathname: `/round/[roundId]/${PHASE_META[round.phase].segment}`,
              params: { roundId: round.id },
            })
          }
        />
      </ScrollView>
      <TapeButton
        title={`Back to ${leagueName}`}
        variant="secondary"
        onPress={() => router.push({ pathname: '/league/[leagueId]', params: { leagueId } })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
