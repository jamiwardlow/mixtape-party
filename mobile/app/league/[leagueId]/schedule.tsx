import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { fetchApi } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import {
  DeadlineRows,
  ErrorNote,
  HandText,
  JCard,
  Label,
  RoundGate,
  Screen,
  TapeButton,
  TapeDateField,
  TapeInput,
} from '../../../lib/ui';

/** One round of the season, as `GET /leagues/:leagueId/rounds` serializes it. */
interface Round {
  id: string;
  number: number;
  /** Null until someone names it — #74 schedules the season before its themes exist. */
  theme: string | null;
  submissionDeadline: string;
  guessingDeadline: string;
}

interface Draft {
  /** What the round looked like when the host opened it, so the patch can name only what moved. */
  original: Round;
  theme: string;
  submissionDeadline: Date;
  guessingDeadline: Date;
  /** False once the submission window has shut: PATCH 409s a deadline that has already passed. */
  canMoveSubmission: boolean;
}

const later = (a: Date, b: Date | undefined) => (b && b > a ? b : a);

export default function LeagueSchedule() {
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const { token } = useSession();
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const res = await fetchApi(`/leagues/${leagueId}/rounds`, { token });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not load this league’s schedule');
        return;
      }
      const body = await res.json();
      setRounds(body.rounds);
      setIsHost(body.isHost);
    })();
  }, [token, leagueId]);

  async function save() {
    if (!draft || !token) return;
    // maximumDate stops the host crossing the two over but still lets them meet, and the API
    // wants strictly ordered deadlines. Say so here instead of spending a round trip on it.
    if (draft.canMoveSubmission && draft.submissionDeadline >= draft.guessingDeadline) {
      setError('Guessing deadline must be after the submission deadline');
      return;
    }
    const theme = draft.theme.trim();
    const submissionDeadline = draft.submissionDeadline.toISOString();
    const guessingDeadline = draft.guessingDeadline.toISOString();
    setSaving(true);
    try {
      const res = await fetchApi(`/rounds/${draft.original.id}`, {
        method: 'PATCH',
        token,
        // Only what the host actually moved: PATCH validates a deadline only when the body names
        // it, so echoing one back unchanged turns the preset schedule's own resting state into a
        // 400 or a 409. A shut submission window has no field to move, so it can never differ.
        // An empty theme is the absence of a change, not a change to blank — the API rejects those.
        body: {
          ...(theme && theme !== draft.original.theme ? { theme } : {}),
          ...(submissionDeadline !== draft.original.submissionDeadline ? { submissionDeadline } : {}),
          ...(guessingDeadline !== draft.original.guessingDeadline ? { guessingDeadline } : {}),
        },
      });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not save this round');
        return;
      }
      const { round } = (await res.json()) as { round: Round };
      setRounds((prev) => prev && prev.map((r) => (r.id === round.id ? round : r)));
      setError(null);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  // Read once per render rather than per round, so the whole list agrees on where "now" falls.
  const now = new Date();
  // RoundGate below never renders the list until this is non-null; the fallback is for the types.
  const season = rounds ?? [];

  return (
    <RoundGate label="Season schedule" error={rounds === null ? error : null} ready={rounds !== null}>
      <Screen label="Season schedule">
        {error && <ErrorNote>{error}</ErrorNote>}
        <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
          {season.map((round, index) => {
            const submissionAt = new Date(round.submissionDeadline);
            const guessingAt = new Date(round.guessingDeadline);
            const previous = season[index - 1];
            const next = season[index + 1];
            const editing = draft?.original.id === round.id;

            return (
              <JCard key={round.id}>
                <HandText testID={`round-${round.number}-heading`}>{`Round ${round.number}`}</HandText>
                {editing ? (
                  <>
                    <TapeInput
                      placeholder="Theme"
                      value={draft.theme}
                      onChangeText={(theme) => setDraft({ ...draft, theme })}
                    />
                    {/* Bounded by the neighbouring rounds the API would refuse to cross (#75), and
                        by now — a deadline in the past retro-closes a phase people are still in. */}
                    {draft.canMoveSubmission && (
                      <TapeDateField
                        label="Submissions due"
                        testID={`round-${round.number}-submission-field`}
                        value={draft.submissionDeadline}
                        onChange={(submissionDeadline) => setDraft({ ...draft, submissionDeadline })}
                        minimumDate={later(now, previous && new Date(previous.guessingDeadline))}
                        maximumDate={draft.guessingDeadline}
                      />
                    )}
                    <TapeDateField
                      label="Guesses due"
                      testID={`round-${round.number}-guessing-field`}
                      value={draft.guessingDeadline}
                      onChange={(guessingDeadline) => setDraft({ ...draft, guessingDeadline })}
                      minimumDate={later(now, draft.canMoveSubmission ? draft.submissionDeadline : undefined)}
                      maximumDate={next && new Date(next.submissionDeadline)}
                    />
                    <TapeButton title={saving ? 'Saving…' : 'Save'} onPress={save} disabled={saving} />
                    <TapeButton title="Cancel" onPress={() => setDraft(null)} variant="secondary" disabled={saving} />
                  </>
                ) : (
                  <>
                    {round.theme ? (
                      <HandText>{round.theme}</HandText>
                    ) : (
                      <Label>{isHost ? 'Set a theme' : 'Theme not set yet'}</Label>
                    )}
                    <DeadlineRows
                      submissionDeadline={submissionAt}
                      guessingDeadline={guessingAt}
                      testID={`round-${round.number}`}
                    />
                    {/* A finished round is frozen (#75 409s it), so it gets no affordance at all
                        — and says why, rather than leaving the host hunting for the missing one. */}
                    {guessingAt <= now ? (
                      <Label testID={`round-${round.number}-closed`}>Closed — this round is over</Label>
                    ) : (
                      isHost && (
                        <TapeButton
                          title={`Edit round ${round.number}`}
                          variant="secondary"
                          onPress={() =>
                            setDraft({
                              original: round,
                              theme: round.theme ?? '',
                              submissionDeadline: submissionAt,
                              guessingDeadline: guessingAt,
                              canMoveSubmission: submissionAt > now,
                            })
                          }
                        />
                      )
                    )}
                  </>
                )}
              </JCard>
            );
          })}
        </ScrollView>
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    </RoundGate>
  );
}
