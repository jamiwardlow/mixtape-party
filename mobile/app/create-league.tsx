import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Share } from 'react-native';
import { router } from 'expo-router';
import { fetchApi } from '../lib/api';
import { useSession } from '../lib/session';
import {
  BodyText,
  ErrorNote,
  HandText,
  Screen,
  Sprocket,
  TapeButton,
  TapeDateField,
  TapeInput,
} from '../lib/ui';

const DAY_MS = 24 * 60 * 60 * 1000;

const inDays = (from: Date, days: number) => new Date(from.getTime() + days * DAY_MS);

// A week out, on the hour. Round 1's two dates seed the whole season schedule (#74), so the
// form opens on a window that already works instead of on an empty field.
function defaultSubmissionDeadline(): Date {
  const deadline = inDays(new Date(), 7);
  deadline.setMinutes(0, 0, 0);
  return deadline;
}

export default function CreateLeague() {
  const { token } = useSession();
  const [name, setName] = useState('');
  const [seasonLength, setSeasonLength] = useState('8');
  const [theme, setTheme] = useState('');
  const [submissionDeadline, setSubmissionDeadline] = useState(defaultSubmissionDeadline);
  // null means "derive it" -- the host has not overridden the default week of guessing time.
  const [chosenGuessingDeadline, setChosenGuessingDeadline] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const guessingDeadline = chosenGuessingDeadline ?? inDays(submissionDeadline, 7);

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
          submissionDeadline: submissionDeadline.toISOString(),
          guessingDeadline: guessingDeadline.toISOString(),
        },
      });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not create the league');
        return;
      }
      const body = await res.json();
      setInviteCode(body.inviteCode);
    } finally {
      setCreating(false);
    }
  }

  async function shareInvite() {
    if (!inviteCode) return;
    const url = Linking.createURL(`join/${inviteCode}`);
    await Share.share({ message: `Join my mixtape league: ${url}` });
  }

  if (inviteCode) {
    return (
      <Screen label="League created!">
        <BodyText>Invite code: {inviteCode}</BodyText>
        <TapeButton title="Share invite" onPress={shareInvite} />
        <TapeButton title="Done" onPress={() => router.replace('/home')} variant="secondary" />
      </Screen>
    );
  }

  return (
    <Screen label="Create a league">
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
      {error && <ErrorNote>{error}</ErrorNote>}
      <TapeButton title={creating ? 'Creating…' : 'Create league'} onPress={submit} disabled={creating} />
    </Screen>
  );
}
