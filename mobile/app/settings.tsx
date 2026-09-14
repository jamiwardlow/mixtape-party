import { router } from 'expo-router';
import { useState } from 'react';
import { appleMusicLinkingSupported, linkAppleMusic } from '../lib/appleMusic';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { BodyText, ErrorNote, HandText, JCard, Label, ReelSpinner, Screen, TapeButton } from '../lib/ui';

export default function Settings() {
  const t = useTheme();
  const { token, profile, refreshProfile } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = profile?.services?.some((s) => s.service === 'apple_music') ?? false;

  async function link() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await linkAppleMusic(token);
      // The linked state is read off /accounts/me, so re-read it rather than tracking it locally.
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't link Apple Music. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen label="Settings">
      <BodyText style={{ color: t.inkMuted }}>Signed in as {profile?.email}</BodyText>
      <JCard>
        <HandText>Apple Music</HandText>
        <Label>
          Optional. Link your account and a round’s playlist can be saved straight to your Apple Music library.
          Needs an active Apple Music subscription — without one, linking still works but the playlist won’t
          save. Everything else works without it.
        </Label>
        {linked && <BodyText>Apple Music is linked.</BodyText>}
        {!appleMusicLinkingSupported ? (
          <Label>Linking runs in the browser for now — open Mixtape Party on the web to link Apple Music.</Label>
        ) : busy ? (
          <ReelSpinner />
        ) : (
          // Always offered, linked or not: a Music User Token expires and Apple has no refresh
          // flow, so re-linking is the only way back.
          <TapeButton title={linked ? 'Relink Apple Music' : 'Link Apple Music'} onPress={link} />
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </JCard>
      <TapeButton title="Back" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}
