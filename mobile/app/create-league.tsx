import * as Linking from 'expo-linking';
import { useState } from 'react';
import { ScrollView, Share } from 'react-native';
import { router } from 'expo-router';
import { fetchApi } from '../lib/api';
import { useSession } from '../lib/session';
import {
  BodyText,
  DeadlineRows,
  ErrorNote,
  HandText,
  JCard,
  Label,
  Screen,
  Sprocket,
  TapeButton,
  TapeDateField,
  TapeInput,
} from '../lib/ui';

const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors MAX_SEASON_LENGTH in `api/src/routes/leagues.ts` -- the preview must not draw rows the
// API would refuse to create.
const MAX_SEASON_LENGTH = 52;

const inDays = (from: Date, days: number) => new Date(from.getTime() + days * DAY_MS);

// A week out, on the hour. Round 1's two dates seed the whole season schedule (#74), so the
// form opens on a window that already works instead of on an empty field.
function defaultSubmissionDeadline(): Date {
  const deadline = inDays(new Date(), 7);
  deadline.setMinutes(0, 0, 0);
  return deadline;
}

/**
 * The season the API will derive from round 1's two deadlines (#74), computed here so the host
 * sees it before they agree to it. With W the gap between them, round N runs from G1 + (N-2)W to
 * G1 + (N-1)W -- every round's submissions close as the previous round's guessing does.
 *
 * Kept in step with the INSERT in `api/src/routes/leagues.ts` by hand: a preview that drifts from
 * the rule is worse than no preview.
 */
function derivedSchedule(submissionDeadline: Date, guessingDeadline: Date, rounds: number) {
  const windowMs = guessingDeadline.getTime() - submissionDeadline.getTime();
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_SEASON_LENGTH || windowMs <= 0) return [];
  // Round 1 is the form above; the preview starts at 2. It is still generated here so the
  // arithmetic reads as the API's own rule rather than as an off-by-one.
  return Array.from({ length: rounds }, (_, i) => ({
    number: i + 1,
    submissionDeadline: new Date(guessingDeadline.getTime() + (i - 1) * windowMs),
    guessingDeadline: new Date(guessingDeadline.getTime() + i * windowMs),
  })).slice(1);
}

export default function CreateLeague() {
  const { token } = useSession();
  const [name, setName] = useState('');
  const [seasonLength, setSeasonLength] = useState('8');
  const [theme, setTheme] = useState('');
  // Themes for rounds 2..N, keyed by round number. Sparse on purpose: a round nobody named stays
  // unthemed, which the schedule screen can fill in later.
  const [laterThemes, setLaterThemes] = useState<Record<number, string>>({});
  const [submissionDeadline, setSubmissionDeadline] = useState(defaultSubmissionDeadline);
  // null means "derive it" -- the host has not overridden the default week of guessing time.
  const [chosenGuessingDeadline, setChosenGuessingDeadline] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Both arrive together from POST /leagues; the success screen shares one and links to the other.
  const [created, setCreated] = useState<{
    leagueId: string;
    inviteCode: string;
  } | null>(null);

  const guessingDeadline = chosenGuessingDeadline ?? inDays(submissionDeadline, 7);
  // Rounds 2..N, as the API will derive them.
  const laterRounds = derivedSchedule(submissionDeadline, guessingDeadline, Number(seasonLength));

  async function submit() {
    if (!token) return;
    // Number('') is 0 and Number('two') is NaN -- both used to be posted straight through.
    const rounds = Number(seasonLength);
    if (!Number.isInteger(rounds) || rounds < 1) {
      setError('Season length must be a whole number of rounds');
      return;
    }
    // The guessing field's minimumDate is only an affordance -- Android bounds the date dialog
    // but not the time one, and a DOM `min` outside a <form> isn't enforced. Moving the
    // submission deadline past an already-chosen guessing deadline gets past both. The API 400s
    // on the inverted pair; say so here instead of spending a round trip on it.
    if (guessingDeadline <= submissionDeadline) {
      setError('Guessing deadline must be after the submission deadline');
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const res = await fetchApi('/leagues', {
        method: 'POST',
        token,
        body: {
          name,
          seasonLength: rounds,
          theme,
          // themes[n - 1] is round n's theme; round 1's is the `theme` field above.
          themes: Array.from({ length: rounds }, (_, i) => laterThemes[i + 1] ?? null),
          submissionDeadline: submissionDeadline.toISOString(),
          guessingDeadline: guessingDeadline.toISOString(),
        },
      });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not create the league');
        return;
      }
      const body = await res.json();
      setCreated({ leagueId: body.leagueId, inviteCode: body.inviteCode });
    } finally {
      setCreating(false);
    }
  }

  async function shareInvite() {
    if (!created) return;
    const url = Linking.createURL(`join/${created.inviteCode}`);
    await Share.share({ message: `Join my mixtape league: ${url}` });
  }

  if (created) {
    return (
      <Screen label="League created!">
        <BodyText>Invite code: {created.inviteCode}</BodyText>
        <TapeButton title="Share invite" onPress={shareInvite} />
        <TapeButton
          title="View the schedule"
          onPress={() =>
            router.push({
              pathname: '/league/[leagueId]/schedule',
              params: { leagueId: created.leagueId },
            })
          }
          variant="secondary"
        />
        <TapeButton title="Done" onPress={() => router.replace('/home')} variant="secondary" />
      </Screen>
    );
  }

  return (
    <Screen label="Create a league">
      <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
        <TapeInput placeholder="League name" value={name} onChangeText={setName} />
        <TapeInput
          placeholder="Season length (rounds)"
          keyboardType="number-pad"
          value={seasonLength}
          onChangeText={setSeasonLength}
        />
        <Sprocket />
        <HandText>Round 1</HandText>
        <TapeInput placeholder="Theme" value={theme} onChangeText={setTheme} />
        <TapeDateField
          label="Submission deadline"
          testID="submission-deadline"
          value={submissionDeadline}
          onChange={setSubmissionDeadline}
        />
        <TapeDateField
          label="Guessing deadline"
          testID="guessing-deadline"
          value={guessingDeadline}
          onChange={setChosenGuessingDeadline}
          minimumDate={submissionDeadline}
        />
        {laterRounds.length > 0 && (
          <>
            <Sprocket />
            <HandText>The rest of the season</HandText>
            <Label>
              Each round opens as the one before it closes. Themes are optional — you can change any of
              this later.
            </Label>
            {laterRounds.map((round) => (
              <JCard key={round.number}>
                <HandText>Round {round.number}</HandText>
                <TapeInput
                  placeholder="Theme"
                  testID={`preview-round-${round.number}-theme`}
                  value={laterThemes[round.number] ?? ''}
                  onChangeText={(text) => setLaterThemes((prev) => ({ ...prev, [round.number]: text }))}
                />
                <DeadlineRows
                  submissionDeadline={round.submissionDeadline}
                  guessingDeadline={round.guessingDeadline}
                  testID={`preview-round-${round.number}`}
                />
              </JCard>
            ))}
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <TapeButton title={creating ? 'Creating…' : 'Create league'} onPress={submit} disabled={creating} />
      </ScrollView>
    </Screen>
  );
}
