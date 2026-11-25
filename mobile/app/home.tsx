import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useResource } from "../lib/client";
import { useProfile } from "../lib/profile";
import { useSession } from "../lib/session";
import { deviceStorage } from "../lib/storage";
import { phaseLabel, type RoundPhase } from "../lib/rounds";
import {
  ErrorNote,
  HandText,
  JCard,
  Label,
  PressScale,
  Screen,
  TapeButton,
  TapeInput,
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

const NAME_SKIPPED_KEY = "name_prompt_skipped";

export default function Home() {
  const t = useTheme();
  const { token, signOut, pendingInviteCode } = useSession();
  const { profile, update, joinInvite } = useProfile();
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  // Refetches on every focus and on reconnect; a failed load leaves the list empty and the
  // offline banner explains.
  const { data, reload: loadLeagues } = useResource<{ leagues: LeagueSummary[] }>("/leagues/mine", "");
  const leagues = data?.leagues ?? [];
  // Magic-link and social signups never see a name field, so ask once here. Skip is remembered.
  const [name, setName] = useState("");
  const [nameSkipped, setNameSkipped] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);

  // Session-only collapse state; undefined means "use the default".
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const inProgress = leagues.filter((l) => !l.concluded);
  const finished = leagues.filter((l) => l.concluded);
  const sections = [
    { key: "progress", title: "In progress", items: inProgress, finished: false },
    { key: "finished", title: "Finished", items: finished, finished: true },
  ];
  const isOpen = (key: string) => open[key] ?? (key === "progress" || inProgress.length === 0);

  useEffect(() => {
    deviceStorage.get(NAME_SKIPPED_KEY).then((v) => setNameSkipped(!!v), () => {});
  }, []);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setNameError(null);
    const res = await update({ displayName: trimmed }, "Couldn't save your name. Try again.");
    if (!res.ok) setNameError(res.status === 0 ? "Couldn't reach the server. Try again." : res.error);
  }

  function skipName() {
    setNameSkipped(true);
    void deviceStorage.set(NAME_SKIPPED_KEY, "1").catch(() => {});
  }

  useEffect(() => {
    if (!token || !pendingInviteCode) return;
    void joinInvite(pendingInviteCode).then(async (res) => {
      // joinInvite keeps the code when offline, so the next load retries.
      if (!res.ok && res.status === 0) {
        return setJoinMessage("Couldn't reach the server to finish joining. We'll try again next time.");
      }
      setJoinMessage(res.ok ? "You're in! Check the invite to see your new league." : "Couldn't finish joining that league.");
      if (res.ok) await loadLeagues();
    });
  }, [token, pendingInviteCode]);

  return (
    <Screen label="Mixtape Party" wide>
      <Label>Signed in as {profile?.email}</Label>
      {joinMessage && <Toast>{joinMessage}</Toast>}
      {profile?.displayName === null && !nameSkipped && (
        <JCard>
          <Label>What should your friends call you?</Label>
          {/* The API caps a name at 40, same as My Account. */}
          <TapeInput placeholder="Display name" accessibilityLabel="Display name" maxLength={40} autoComplete="name" textContentType="name" returnKeyType="go" onSubmitEditing={saveName} value={name} onChangeText={setName} />
          {nameError && <ErrorNote>{nameError}</ErrorNote>}
          <TapeButton title="Save name" onPress={saveName} disabled={!name.trim()} />
          <Label accessibilityRole="button" style={{ minHeight: 44, textAlign: "center", textDecorationLine: "underline" }} onPress={skipName}>Skip</Label>
        </JCard>
      )}
      <ScrollView style={{ margin: -6 }} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: 12,
          padding: 6,
          flexDirection: "row",
          flexWrap: "wrap",
        }}
        showsVerticalScrollIndicator={false}
      >
        {leagues.length === 0 && (
          <View style={{ width: "100%", gap: 12 }}>
            <Label>No leagues yet.</Label>
          </View>
        )}
        {/* One tap, into the season page — it owns the phase CTA and links on to the schedule
            editor. The phase stays here as text so the shelf still reads at a glance. */}
        {sections.map(({ key, title, items, finished }) =>
          items.length === 0 ? null : (
            <View key={key} style={{ width: "100%", gap: 12 }}>
              <Pressable
                onPress={() => setOpen((o) => ({ ...o, [key]: !isOpen(key) }))}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen(key) }}
                style={({ focused }: WebState) => [
                  { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
                  focusRing(t, focused),
                ]}
              >
                <Label style={{ textTransform: "uppercase" }}>{`${isOpen(key) ? "▾" : "▸"} ${title}`}</Label>
                <Label>{items.length}</Label>
              </Pressable>
              {isOpen(key) && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                  {items.map((league) => (
                    <View key={league.id} style={{ flexGrow: 1, flexBasis: 280 }}>
                      <PressScale
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({
                            pathname: league.concluded ? "/league/[leagueId]/final" : "/league/[leagueId]",
                            params: { leagueId: league.id },
                          })
                        }
                      >
                        {finished ? (
                          <View
                            style={{
                              backgroundColor: t.shellPressed,
                              borderColor: t.ink,
                              borderWidth: t.border,
                              borderStyle: "dashed",
                              borderRadius: t.radius,
                              padding: 16,
                              gap: 6,
                            }}
                          >
                            <HandText style={{ color: t.inkMuted }}>{league.name}</HandText>
                            <Label>Finished</Label>
                          </View>
                        ) : (
                          <JCard>
                            <HandText>{league.name}</HandText>
                            {league.round && (
                              <Label>
                                {`${league.round.theme ?? `Round ${league.round.number}`}: ${phaseLabel(league.round.phase, league.round.submitted)}`}
                              </Label>
                            )}
                          </JCard>
                        )}
                      </PressScale>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ),
        )}
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
