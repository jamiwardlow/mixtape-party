import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { fetchApi } from '../lib/api';
import { useSession } from '../lib/session';
import { BodyText, HandText, JCard, Label, ReelHoles, Screen, TapeButton } from '../lib/ui';
import { useTheme } from '../lib/theme';

interface RoundSummary {
  id: string;
  number: number;
  theme: string;
  phase: 'submission' | 'guessing' | 'results';
}

interface LeagueSummary {
  id: string;
  name: string;
  round: RoundSummary | null;
}

const PHASE_META: Record<RoundSummary['phase'], { label: string; segment: 'submit' | 'guess' | 'results' }> = {
  submission: { label: 'Submit your track', segment: 'submit' },
  guessing: { label: 'Guess the submitters', segment: 'guess' },
  results: { label: 'See results', segment: 'results' },
};

function roundHref(round: RoundSummary) {
  return { pathname: `/round/[roundId]/${PHASE_META[round.phase].segment}`, params: { roundId: round.id } } as const;
}

export default function Home() {
  const t = useTheme();
  const { profile, token, signOut, pendingInviteCode, setPendingInviteCode } = useSession();
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);

  async function loadLeagues() {
    if (!token) return;
    const res = await fetchApi('/leagues/mine', { token });
    if (res.ok) setLeagues((await res.json()).leagues);
  }

  useEffect(() => {
    loadLeagues();
  }, [token]);

  useEffect(() => {
    if (!token || !pendingInviteCode) return;
    const code = pendingInviteCode;
    (async () => {
      const res = await fetchApi(`/leagues/invite/${code}/join`, { method: 'POST', token });
      // Cleared only once the server has answered — the code is persisted now, so a request that
      // never lands (offline, API down) leaves it in place to retry on the next load instead of
      // silently dropping the join the invite link was opened for.
      setPendingInviteCode(null);
      setJoinMessage(res.ok ? "You're in! Check the invite to see your new league." : "Couldn't finish joining that league.");
      if (res.ok) await loadLeagues();
    })().catch(() => setJoinMessage("Couldn't reach the server to finish joining. We'll try again next time."));
  }, [token, pendingInviteCode]);

  return (
    <Screen label="Mixtape Party">
      <BodyText style={{ color: t.inkMuted }}>Signed in as {profile?.email}</BodyText>
      {joinMessage && <BodyText>{joinMessage}</BodyText>}
      <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
        {leagues.length === 0 && <Label>No leagues yet.</Label>}
        {leagues.map((league) => (
          <JCard key={league.id}>
            <ReelHoles color={t.reel} />
            <HandText>{league.name}</HandText>
            {league.round ? (
              <TapeButton
                title={`${league.round.theme}: ${PHASE_META[league.round.phase].label}`}
                onPress={() => router.push(roundHref(league.round!))}
              />
            ) : (
              <Label>Between rounds</Label>
            )}
          </JCard>
        ))}
      </ScrollView>
      <TapeButton title="Create a league" onPress={() => router.push('/create-league')} variant="secondary" />
      <Pressable onPress={signOut} hitSlop={8} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
        <Label style={{ textDecorationLine: 'underline' }}>Sign out</Label>
      </Pressable>
    </Screen>
  );
}
