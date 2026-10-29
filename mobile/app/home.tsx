import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { fetchApi } from "../lib/api";
import { useSession } from "../lib/session";
import { phaseLabel, type RoundPhase } from "../lib/rounds";
import {
  Cassette,
  HandText,
  JCard,
  Label,
  PressScale,
  Screen,
  TapeButton,
  Toast,
  focusRing,
  type WebState,
} from "../lib/ui";
import { useTheme } from "../lib/theme";

interface RoundSummary {
  id: string;
  number: number;
  /** Null until the host names the round -- the season is scheduled before its themes are. */
  theme: string | null;
  phase: RoundPhase;
  /** False while the league is too small to guess in, even though the clock says guessing. */
  submitted: boolean;
}

interface LeagueSummary {
  id: string;
  name: string;
  concluded: boolean;
  round: RoundSummary | null;
}

export default function Home() {
  const t = useTheme();
  const { profile, token, signOut, pendingInviteCode, setPendingInviteCode } =
    useSession();
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);

  async function loadLeagues() {
    if (!token) return;
    const res = await fetchApi("/leagues/mine", { token });
    if (res.ok) setLeagues((await res.json()).leagues);
  }

  useEffect(() => {
    loadLeagues();
  }, [token]);

  useEffect(() => {
    if (!token || !pendingInviteCode) return;
    const code = pendingInviteCode;
    (async () => {
      const res = await fetchApi(`/leagues/invite/${code}/join`, {
        method: "POST",
        token,
      });
      // Cleared only once the server has answered — the code is persisted now, so a request that
      // never lands (offline, API down) leaves it in place to retry on the next load instead of
      // silently dropping the join the invite link was opened for.
      setPendingInviteCode(null);
      setJoinMessage(
        res.ok
          ? "You're in! Check the invite to see your new league."
          : "Couldn't finish joining that league.",
      );
      if (res.ok) await loadLeagues();
    })().catch(() =>
      setJoinMessage(
        "Couldn't reach the server to finish joining. We'll try again next time.",
      ),
    );
  }, [token, pendingInviteCode]);

  return (
    <Screen label="Mixtape Party" wide>
      <Label>Signed in as {profile?.email}</Label>
      {joinMessage && <Toast>{joinMessage}</Toast>}
      <ScrollView
        contentContainerStyle={{
          gap: 12,
          flexDirection: "row",
          flexWrap: "wrap",
        }}
        showsVerticalScrollIndicator={false}
      >
        {leagues.length === 0 && (
          <View style={{ width: "100%", gap: 12 }}>
            <Cassette title="Your first mixtape" still />
            <Label>No leagues yet.</Label>
          </View>
        )}
        {/* One tap, into the season page — it owns the phase CTA and links on to the schedule
            editor. The phase stays here as text so the shelf still reads at a glance. */}
        {leagues.map((league) => (
          <View key={league.id} style={{ flexGrow: 1, flexBasis: 280 }}>
            <PressScale
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: league.concluded
                    ? "/league/[leagueId]/final"
                    : "/league/[leagueId]",
                  params: { leagueId: league.id },
                })
              }
            >
              <JCard>
                <HandText>{league.name}</HandText>
                {league.round && (
                  <Label>
                    {`${league.round.theme ?? `Round ${league.round.number}`}: ${phaseLabel(league.round.phase, league.round.submitted)}`}
                  </Label>
                )}
              </JCard>
            </PressScale>
          </View>
        ))}
      </ScrollView>
      <TapeButton
        title="Create a league"
        onPress={() => router.push("/create-league")}
        variant="secondary"
      />
      <TapeButton
        title="Join with a code"
        onPress={() => router.push("/join")}
        variant="secondary"
      />
      <TapeButton
        title="My Account"
        onPress={() => router.push("/account")}
        variant="secondary"
      />
      <Pressable
        onPress={signOut}
        hitSlop={8}
        accessibilityRole="button"
        style={({ focused }: WebState) => [{ alignSelf: "center", minHeight: 44, justifyContent: "center" }, focusRing(t, focused)]}
      >
        <Label style={{ textDecorationLine: "underline" }}>Sign out</Label>
      </Pressable>
    </Screen>
  );
}
