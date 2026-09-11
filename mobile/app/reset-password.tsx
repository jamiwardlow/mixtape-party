import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { fetchApi } from '../lib/api';
import { useSession } from '../lib/session';
import { BodyText, ErrorNote, Label, Screen, TapeButton, TapeInput } from '../lib/ui';

export default function ResetPassword() {
  const { token: resetToken } = useLocalSearchParams<{ token?: string }>();
  const { signIn } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkExpired, setLinkExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    // Checked at submit rather than seeded into state at mount: the param is not guaranteed to
    // be populated on a pre-rendered route's first render, and latching off an empty one would
    // show "expired" for a link that is perfectly good.
    if (!resetToken) {
      setLinkExpired(true);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetchApi('/password-resets/confirm', {
        method: 'POST',
        body: { token: resetToken, password },
      });
      if (!res.ok) {
        // 401 is the API's answer for a token that expired or was already spent — a dead end the
        // user can only escape by asking for a fresh link, not by retyping the password.
        if (res.status === 401) setLinkExpired(true);
        else setError((await res.json().catch(() => null))?.error ?? 'Could not reset your password');
        return;
      }
      await signIn((await res.json()).token);
      router.replace('/home');
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (linkExpired) {
    return (
      <Screen label="Link expired">
        <BodyText>This reset link has expired or was already used.</BodyText>
        <TapeButton title="Send me a new one" onPress={() => router.replace('/forgot-password')} />
      </Screen>
    );
  }

  return (
    <Screen label="New password">
      <BodyText>Pick a new password for your account.</BodyText>
      <TapeInput placeholder="New password" secureTextEntry value={password} onChangeText={setPassword} />
      <Label>at least 8 characters</Label>
      {error && <ErrorNote>{error}</ErrorNote>}
      <TapeButton
        title={submitting ? 'Saving…' : 'Set password and sign in'}
        onPress={submit}
        disabled={submitting || password.length < 8}
      />
    </Screen>
  );
}
