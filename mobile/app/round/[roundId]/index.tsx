import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useResource } from '../../../lib/client';
import { usePreview } from '../../../lib/preview';
import { guessesLine, nameOf, nextStep, playbackHref, roundStatus, submitterNames, type RoundOverview } from '../../../lib/rounds';
import { BodyText, DeadlineRows, HandText, JCard, Label, RoundGate, Screen, ServiceBadge, TapeButton, TrackRow } from '../../../lib/ui';
import { openPlaybackLink } from '../../../lib/bandcamp';

/**
 * The canonical URL for a round, in any phase. Every other round screen is a phase — a link to
 * one is only correct until its deadline passes. This page is the link that keeps working, so it
 * deliberately does not redirect into the phase screen: that would make it a render flash rather
 * than a destination. For a finished round it links to the reveal instead of restating it.
 */
export default function RoundOverview() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  // Refetches on every focus: this screen stays mounted under submit/guess, so a track just sent
  // would otherwise show as missing until a remount.
  const { data: overview, error } = useResource<RoundOverview>(`/rounds/${roundId}/overview`, 'Could not load this round');
  const mine = overview?.round.you.submission;
  const openInService = useCallback(() => mine && openPlaybackLink(playbackHref(mine.playback)), [mine]);
  const { playingId, toggle } = usePreview(useCallback((id: string) => `/submissions/${id}/preview`, []), openInService);

  if (!overview) {
    return (
      <RoundGate label="Round" error={error} ready={false}>
        {null}
      </RoundGate>
    );
  }

  const { leagueId, leagueName, round } = overview;
  const step = nextStep(round, !!round.you.submission);
  const guesses = guessesLine(round);
  const submitted = submitterNames(round);

  return (
    <Screen label={leagueName}>
      <ScrollView style={{ margin: -6 }} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, padding: 6 }} showsVerticalScrollIndicator={false}>
        <JCard>
          <HandText>You</HandText>
          {round.you.submission ? (
            <View style={styles.row}>
              <ServiceBadge service={round.you.submission.service} />
              <TrackRow
                testID="your-submission"
                thumbnailUrl={round.you.submission.thumbnailUrl}
                title={round.you.submission.title}
                artist={round.you.submission.artist}
                href={playbackHref(round.you.submission.playback)}
                playing={playingId === round.you.submission.submissionId}
                onPlay={() => toggle(round.you.submission!.submissionId)}
              />
            </View>
          ) : (
            <BodyText testID="your-submission">You have not submitted a track</BodyText>
          )}
          {guesses && <BodyText testID="your-guesses">{guesses}</BodyText>}
        </JCard>

        <JCard>
          <HandText testID="round-heading">{`Round ${round.number}`}</HandText>
          {round.theme ? <BodyText>{round.theme}</BodyText> : <Label>Theme not set yet</Label>}
          <DeadlineRows
            submissionDeadline={new Date(round.submissionDeadline)}
            guessingDeadline={new Date(round.guessingDeadline)}
            testID="round"
          />
          <Label testID="round-phase">{roundStatus(round.phase)}</Label>
        </JCard>

        <JCard>
          <HandText>Where the round is</HandText>
          <Label testID="submitted-count">
            {`${round.submittedCount} track${round.submittedCount === 1 ? '' : 's'} in`}
          </Label>
          {submitted && (
            <View style={styles.row}>
              <Label>Submitted</Label>
              <Label testID="submitters">{submitted}</Label>
            </View>
          )}
          {round.guessedPlayers.length > 0 && (
            <View style={styles.row}>
              <Label>Finished guessing</Label>
              <Label testID="guessed-players">{round.guessedPlayers.map(nameOf).join(', ')}</Label>
            </View>
          )}
        </JCard>

        {step && <TapeButton title={step.label} onPress={() => router.push(step.href)} />}
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
