import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { appleMusicLinkingSupported, isAppleMusicLinked, linkAppleMusic } from '../lib/appleMusic';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { BodyText, ErrorNote, HandText, JCard, Label, ReelSpinner, Screen, TapeButton, TapeInput } from '../lib/ui';

export default function Settings() {
  const t = useTheme();
  const { token, profile, refreshProfile } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(profile?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const linked = isAppleMusicLinked(profile);

  // The profile arrives asynchronously and is re-read after a save, so seed from the effect rather
  // than useState's initial value alone -- which runs once, often before there is a profile to read.
  useEffect(() => {
    setName(profile?.displayName ?? '');
  }, [profile?.displayName]);

  async function saveName() {
    if (!token || savingName) return;
    const trimmed = name.trim();
    setNameError(null);
    setNameSaved(false);
    if (!trimmed) {
      setNameError('Enter a name first.');
      return;
    }
    setSavingName(true);
    try {
      const res = await fetchApi('/accounts/me', { method: 'PATCH', token, body: { displayName: trimmed } });
      if (!res.ok) {
        setNameError((await res.json().catch(() => null))?.error ?? "Couldn't save your name. Try again.");
        return;
      }
      // Same reason as the Apple Music link below: the name shown everywhere else comes off the
      // session profile, so re-read it and the change lands without a sign-out.
      await refreshProfile();
      setNameSaved(true);
    } catch {
      setNameError("Couldn't reach the server. Try again.");
    } finally {
      setSavingName(false);
    }
  }

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
        <HandText>Your name</HandText>
        <Label>
          What the rest of your league sees on rosters, guesses and results. Leave it blank and you show up
          as “A player”.
        </Label>
        <TapeInput
          placeholder="Display name"
          maxLength={40}
          value={name}
          onChangeText={(next) => {
            setName(next);
            setNameError(null);
            setNameSaved(false);
          }}
        />
        {savingName ? <ReelSpinner /> : <TapeButton title="Save name" onPress={saveName} />}
        {nameSaved && <BodyText>Saved.</BodyText>}
        {nameError && <ErrorNote>{nameError}</ErrorNote>}
      </JCard>
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
