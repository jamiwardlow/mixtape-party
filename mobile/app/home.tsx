import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { fetchApi, onOfflineChange } from "../lib/api";
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
  const { profile, token, signOut, refreshProfile, pendingInviteCode, setPendingInviteCode } =
    useSession();
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
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
    if (!token || !trimmed) return;
    setNameError(null);
    try {
      const res = await fetchApi("/accounts/me", { method: "PATCH", token, body: { displayName: trimmed } });
      if (!res.ok) return setNameError((await res.json().catch(() => null))?.error ?? "Couldn't save your name. Try again.");
      await refreshProfile();
    } catch {
      setNameError("Couldn't reach the server. Try again.");
    }
  }

  function skipName() {
    setNameSkipped(true);
    void deviceStorage.set(NAME_SKIPPED_KEY, "1").catch(() => {});
  }

  async function loadLeagues() {
    if (!token) return;
    try {
      const res = await fetchApi("/leagues/mine", { token });
      if (res.ok) setLeagues((await res.json()).leagues);
    } catch {
      // offline: the banner explains; the next focus retries
    }
  }

  // Refetch on every focus: home stays mounted under pushed screens, so a one-shot load on token
  // change never retries after a failed (offline) first load.
  useFocusEffect(
    useCallback(() => {
      loadLeagues();
    }, [token]),
  );

  // Reload when connectivity returns while staying on home (focus won't fire). Only the
  // offline -> online edge, since every successful request notifies false.
  useEffect(() => {
    let wasOffline = false;
    return onOfflineChange((offline) => {
      if (wasOffline && !offline) loadLeagues();
      wasOffline = offline;
    });
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
