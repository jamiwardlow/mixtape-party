import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { fetchApi } from '../lib/api';
import { BodyText, ErrorNote, Label, Screen, TapeButton, TapeInput } from '../lib/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSending(true);
    try {
      // The API answers 204 whether or not the address exists — deliberately, so the response
      // can't be used to probe for registered emails. So the confirmation is unconditional.
      await fetchApi('/password-resets', { method: 'POST', body: { email } });
      setSent(true);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <Screen label="Check your inbox">
        <BodyText>If {email} has an account, a reset link is on its way.</BodyText>
        <Label>The link expires in an hour.</Label>
        <TapeButton title="Back to sign in" onPress={() => router.replace('/sign-in')} variant="secondary" />
      </Screen>
    );
  }

  return (
    <Screen label="Forgot password">
      <BodyText>Enter your email and we'll send you a link to set a new password.</BodyText>
      <TapeInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      <TapeButton title={sending ? 'Sending…' : 'Send reset link'} onPress={submit} disabled={sending || !email} />
      <Pressable onPress={() => router.replace('/sign-in')} hitSlop={8} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
        <Label style={{ textDecorationLine: 'underline' }}>Back to sign in</Label>
      </Pressable>
    </Screen>
  );
}
