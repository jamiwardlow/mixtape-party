import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';
import { ResourceGate, useResource } from '../../../lib/client';
import { BestieGroup, type Bestie } from '../../../lib/BestieGroup';
import { type SeasonResult as Overview } from '../../../lib/rounds';
import { StandingRows, WinnersRow } from '../../../lib/Standings';
import { BodyText, ErrorNote, HandText, JCard, Label, ReelSpinner, Screen, TapeButton } from '../../../lib/ui';

export default function SeasonWrapUp() {
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const { data: overview, error } = useResource<Overview>(`/leagues/${leagueId}/overview`, 'Could not load this league');
  const { data: bestiesBody, error: bestiesError } = useResource<{ guessedMe?: Bestie[]; iGuessed?: Bestie[] }>(
    overview?.league.concluded ? `/leagues/${leagueId}/besties` : null,
    "Couldn't load your besties.",
  );
  const besties = bestiesBody && { guessedMe: bestiesBody.guessedMe ?? [], iGuessed: bestiesBody.iGuessed ?? [] };

  if (!overview) {
    return (
      <ResourceGate label="Season" error={error} ready={false}>
        {null}
      </ResourceGate>
    );
  }
  if (!overview.league.concluded) {
    return <Redirect href={{ pathname: '/league/[leagueId]', params: { leagueId } }} />;
  }

  const { league, standings, winners } = overview;
  return (
    <Screen label={league.name}>
      <ScrollView style={{ margin: -6 }} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, padding: 6 }} showsVerticalScrollIndicator={false}>
        <JCard>
          <Label>Season complete</Label>
          <WinnersRow winners={winners} />
        </JCard>
        <JCard>
          <HandText>Final standings</HandText>
          <StandingRows standings={standings} />
        </JCard>
        <JCard>
          <HandText>Besties</HandText>
          {bestiesError ? (
            <ErrorNote>{bestiesError}</ErrorNote>
          ) : !besties ? (
            <ReelSpinner />
          ) : (
            <>
              <BestieGroup caption="Players who guess your songs correctly" besties={besties.guessedMe} />
              <BestieGroup caption="Players whose songs you guess correctly" besties={besties.iGuessed} />
            </>
          )}
        </JCard>
      </ScrollView>
      <TapeButton
        title="Season details"
        variant="secondary"
        onPress={() => router.push({ pathname: '/league/[leagueId]', params: { leagueId } })}
      />
      <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
    </Screen>
  );
}
