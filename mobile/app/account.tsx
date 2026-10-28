import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { fetchApi } from '../lib/api';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { BodyText, ErrorNote, HandText, JCard, Label, ReelSpinner, Screen, TapeButton, TapeInput } from '../lib/ui';

export default function Account() {
  const t = useTheme();
  const { token, profile, refreshProfile } = useSession();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [prefs, setPrefs] = useState({ pushEnabled: true, emailEnabled: true });
  const [prefsError, setPrefsError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchApi('/notifications/settings', { token })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((s) => setPrefs({ pushEnabled: s.pushEnabled !== false, emailEnabled: s.emailEnabled !== false }))
      .catch(() => setPrefsError("Couldn't load your notification settings."));
  }, [token]);

  // Optimistic: flip now, put back the old value if the server says no.
  async function togglePref(key: 'pushEnabled' | 'emailEnabled', value: boolean) {
    if (!token) return;
    const previous = prefs[key];
    setPrefsError(null);
    setPrefs((p) => ({ ...p, [key]: value }));
    try {
      const res = await fetchApi('/notifications/settings', { method: 'PUT', token, body: { [key]: value } });
      if (res.ok) return;
    } catch {}
    setPrefs((p) => ({ ...p, [key]: previous }));
    setPrefsError("Couldn't save that setting. Try again.");
  }

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
      // The name shown everywhere else comes off the session profile, so re-read it and the change
      // lands without a sign-out.
      await refreshProfile();
      setNameSaved(true);
    } catch {
      setNameError("Couldn't reach the server. Try again.");
    } finally {
      setSavingName(false);
    }
  }

  return (
    <Screen label="My Account">
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
        <HandText>Notifications</HandText>
        <Label>Reminders and updates about your leagues. Sign-in and password emails always send.</Label>
        {(
          [
            ['pushEnabled', 'Push notifications'],
            ['emailEnabled', 'Email notifications'],
          ] as const
        ).map(([key, title]) => (
          <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <BodyText>{title}</BodyText>
            <Switch accessibilityLabel={title} value={prefs[key]} onValueChange={(v) => togglePref(key, v)} />
          </View>
        ))}
        {prefsError && <ErrorNote>{prefsError}</ErrorNote>}
      </JCard>
      <TapeButton title="Favorites" onPress={() => router.push('/favorites')} />
      <TapeButton title="Back" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}
