import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, Switch, View } from 'react-native';
import { API_URL, fetchApi } from '../lib/api';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { BodyText, ErrorNote, HandText, JCard, Label, ReelSpinner, Screen, TapeButton, TapeInput } from '../lib/ui';

const AVATAR_SIZE = 96;

// The avatar endpoint is authenticated and an <img> can't send a bearer header, so on web fetch it
// into an object URL; native Image takes headers directly.
function Avatar({ url, token, initial }: { url?: string | null; token: string | null; initial: string }) {
  const t = useTheme();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setSrc(null);
    if (!url || !token || Platform.OS !== 'web') return;
    let objectUrl: string | undefined;
    let cancelled = false;
    fetch(`${API_URL}${url}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject()))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, token]);

  const box = { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 };
  const source =
    Platform.OS === 'web'
      ? src && { uri: src }
      : url && token && { uri: `${API_URL}${url}`, headers: { Authorization: `Bearer ${token}` } };
  if (source && !failed) {
    return <Image accessibilityLabel="Your photo" source={source} style={box} onError={() => setFailed(true)} />;
  }
  return (
    <View
      accessibilityLabel="Your photo"
      style={[box, { backgroundColor: t.shell, borderColor: t.hairline, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }]}
    >
      <HandText>{initial}</HandText>
    </View>
  );
}

export default function Account() {
  const t = useTheme();
  const { token, profile, refreshProfile } = useSession();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  async function pickAvatar() {
    if (!token || avatarBusy) return;
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] });
      if (picked.canceled) return;
      const small = await ImageManipulator.manipulateAsync(
        picked.assets[0].uri,
        [{ resize: { width: 256 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      const bytes = await (await fetch(small.uri)).blob();
      // fetchApi JSON-encodes bodies; the avatar endpoint wants the raw bytes.
      const res = await fetch(`${API_URL}/accounts/me/avatar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${token}` },
        body: bytes,
      });
      if (!res.ok) {
        setAvatarError((await res.json().catch(() => null))?.error ?? "Couldn't upload your photo. Try again.");
        return;
      }
      await refreshProfile();
    } catch {
      setAvatarError("Couldn't upload your photo. Try again.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    if (!token || avatarBusy) return;
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const res = await fetchApi('/accounts/me/avatar', { method: 'DELETE', token });
      if (!res.ok) {
        setAvatarError("Couldn't remove your photo. Try again.");
        return;
      }
      await refreshProfile();
    } catch {
      setAvatarError("Couldn't reach the server. Try again.");
    } finally {
      setAvatarBusy(false);
    }
  }

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
        <Avatar
          url={profile?.avatarUrl}
          token={token}
          initial={(profile?.displayName?.trim() || profile?.email || '?')[0].toUpperCase()}
        />
        {avatarBusy ? (
          <ReelSpinner />
        ) : (
          <>
            <TapeButton title={profile?.avatarUrl ? 'Change photo' : 'Add photo'} onPress={pickAvatar} />
            {profile?.avatarUrl && <TapeButton title="Remove photo" onPress={removeAvatar} variant="secondary" />}
          </>
        )}
        {avatarError && <ErrorNote>{avatarError}</ErrorNote>}
      </JCard>
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
