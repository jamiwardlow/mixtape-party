import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { fetchApi } from '../../../lib/api';
import { BestieGroup, type Bestie } from '../../../lib/BestieGroup';
import { type Score } from '../../../lib/rounds';
import { useSession } from '../../../lib/session';
import { StandingRows, WinnersRow } from '../../../lib/Standings';
import { BodyText, ErrorNote, HandText, JCard, Label, ReelSpinner, RoundGate, Screen, TapeButton } from '../../../lib/ui';

interface Overview {
  league: { id: string; name: string; concluded: boolean };
  standings: Score[];
  winners: Score[];
}

export default function SeasonWrapUp() {
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const { token } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [besties, setBesties] = useState<{ guessedMe: Bestie[]; iGuessed: Bestie[] } | null>(null);
  const [bestiesError, setBestiesError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    (async () => {
      const res = await fetchApi(`/leagues/${leagueId}/overview`, { token });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not load this league');
        return;
      }
      const body: Overview = await res.json();
      if (!live) return;
      setOverview(body);
      if (!body.league.concluded) return;
      fetchApi(`/leagues/${leagueId}/besties`, { token })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((b) => live && setBesties({ guessedMe: b.guessedMe ?? [], iGuessed: b.iGuessed ?? [] }))
        .catch(() => live && setBestiesError("Couldn't load your besties."));
    })().catch(() => live && setError('Could not load this league'));
    return () => {
      live = false;
    };
  }, [token, leagueId]);

  if (!overview) {
    return (
      <RoundGate label="Season" error={error} ready={false}>
        {null}
      </RoundGate>
    );
  }
  if (!overview.league.concluded) {
    return <Redirect href={{ pathname: '/league/[leagueId]', params: { leagueId } }} />;
  }

  const { league, standings, winners } = overview;
  return (
    <Screen label={league.name}>
      <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
        <JCard>
          <Label>Season complete</Label>
          <WinnersRow winners={winners} />
        </JCard>
        <JCard>
          <HandText>Final standings</HandText>
          <StandingRows standings={standings} token={token} />
        </JCard>
        <JCard>
          <HandText>Besties</HandText>
          {bestiesError ? (
            <ErrorNote>{bestiesError}</ErrorNote>
          ) : !besties ? (
            <ReelSpinner />
          ) : (
            <>
              <BestieGroup title="Gets me" caption="Correct guesses of your songs" besties={besties.guessedMe} />
              <BestieGroup title="I get them" caption="Their songs you guessed correctly" besties={besties.iGuessed} />
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
