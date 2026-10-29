import { router } from 'expo-router';
import { useState } from 'react';
import { BodyText, Screen, TapeButton, TapeInput } from '../../lib/ui';

export default function JoinWithCode() {
  const [code, setCode] = useState('');
  const trimmed = code.trim();

  // The code lands in a path segment, so encode it; /join/[code] does the lookup and the sign-in redirect.
  const submit = () => trimmed && router.push(`/join/${encodeURIComponent(trimmed)}`);

  return (
    <Screen label="Got a code?">
      <BodyText>Type the invite code a friend sent you.</BodyText>
      <TapeInput
        placeholder="Invite code"
        autoCapitalize="characters"
        autoCorrect={false}
        value={code}
        onChangeText={setCode}
        onSubmitEditing={submit}
      />
      <TapeButton title="Join" onPress={submit} disabled={!trimmed} />
    </Screen>
  );
}
