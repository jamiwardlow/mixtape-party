import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { createElement, useEffect, useRef, useState } from 'react';
import { Image, PanResponder, Platform, ScrollView, Switch, View } from 'react-native';
import { API_URL, fetchApi } from '../lib/api';
import { Avatar } from '../lib/Avatar';
import { BestieGroup, type Bestie } from '../lib/BestieGroup';
import { LegalLinks } from '../lib/legal';
import { BlockedPlayers } from '../lib/Moderation';
import { useSession } from '../lib/session';
import { BodyText, ErrorNote, HandText, JCard, Label, PressScale, ReelSpinner, Screen, TapeButton, TapeInput } from '../lib/ui';

const CROP_VIEW = 240;

interface CropAsset {
  uri: string;
  width: number;
  height: number;
}

// Web only: expo-image-picker ignores allowsEditing there, so zoom and reposition happen here.
// Native gets the OS crop editor instead.
function AvatarCropper({ asset, onDone, onCancel }: { asset: CropAsset; onDone: (crop: ImageManipulator.Action) => void; onCancel: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const start = useRef(pan);

  // Display px per source px at zoom 1: the shorter side exactly fills the viewport.
  const base = CROP_VIEW / Math.min(asset.width, asset.height);
  const scale = base * zoom;
  const limit = (side: number) => Math.max(0, (side * scale - CROP_VIEW) / 2);
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.max(-limit(asset.width), Math.min(limit(asset.width), p.x)),
    y: Math.max(-limit(asset.height), Math.min(limit(asset.height), p.y)),
  });
  const clampRef = useRef(clamp);
  clampRef.current = clamp;

  // Zooming out can leave the old pan out of bounds, so re-clamp.
  useEffect(() => {
    setPan((p) => (panRef.current = clampRef.current(p)));
  }, [zoom]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => (start.current = panRef.current),
      onPanResponderMove: (_, g) =>
        setPan((panRef.current = clampRef.current({ x: start.current.x + g.dx, y: start.current.y + g.dy }))),
    }),
  ).current;

  function confirm() {
    const size = CROP_VIEW / scale;
    onDone({
      crop: {
        originX: (asset.width * scale - CROP_VIEW) / 2 / scale - pan.x / scale,
        originY: (asset.height * scale - CROP_VIEW) / 2 / scale - pan.y / scale,
        width: size,
        height: size,
      },
    });
  }

  return (
    <>
      <View
        {...responder.panHandlers}
        accessibilityLabel="Drag to reposition your photo"
        style={{ width: CROP_VIEW, height: CROP_VIEW, borderRadius: CROP_VIEW / 2, overflow: 'hidden', alignSelf: 'center', cursor: 'grab' } as object}
      >
        <View pointerEvents="none" style={{ flex: 1 }}>
        <Image
          source={{ uri: asset.uri }}
          style={{
            position: 'absolute',
            width: asset.width * scale,
            height: asset.height * scale,
            left: (CROP_VIEW - asset.width * scale) / 2 + pan.x,
            top: (CROP_VIEW - asset.height * scale) / 2 + pan.y,
          }}
        />
        </View>
      </View>
      {/* The cropper is web-only, so a native <input> is fine and saves a slider dependency. */}
      {createElement('input', {
        type: 'range',
        min: 1,
        max: 4,
        step: 0.05,
        value: zoom,
        'aria-label': 'Zoom',
        onChange: (e: { target: { value: string } }) => setZoom(Number(e.target.value)),
        style: { width: CROP_VIEW, alignSelf: 'center' },
      })}
      <TapeButton title="Use photo" onPress={confirm} />
      <TapeButton title="Cancel" variant="secondary" onPress={onCancel} />
    </>
  );
}

interface LeagueRow {
  id: string;
  name: string;
  concluded: boolean;
  seasonLength: number;
  joinedAt: string;
}

function LeagueGroup({ title, empty, leagues }: { title: string; empty: string; leagues: LeagueRow[] }) {
  return (
    <>
      <Label>{title}</Label>
      {leagues.length === 0 && <BodyText>{empty}</BodyText>}
      {leagues.map((l) => (
        <PressScale
          key={l.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/league/[leagueId]', params: { leagueId: l.id } })}
        >
          <BodyText>{l.name}</BodyText>
          <Label>{`${l.seasonLength} rounds · joined ${new Date(l.joinedAt).toLocaleDateString()}`}</Label>
        </PressScale>
      ))}
    </>
  );
}

export default function Account() {
  const { token, profile, refreshProfile, signOut } = useSession();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [cropping, setCropping] = useState<CropAsset | null>(null);

  async function pickAvatar() {
    if (!token || avatarBusy) return;
    setAvatarError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (Platform.OS === 'web') setCropping(asset);
      else await uploadAvatar(asset.uri, []);
    } catch {
      setAvatarError("Couldn't open your photos. Try again.");
    }
  }

  async function uploadAvatar(uri: string, actions: ImageManipulator.Action[]) {
    if (!token) return;
    setCropping(null);
    setAvatarBusy(true);
    try {
      const small = await ImageManipulator.manipulateAsync(
        uri,
        [...actions, { resize: { width: 256 } }],
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

  const [leagues, setLeagues] = useState<LeagueRow[] | null>(null);
  const [leaguesError, setLeaguesError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchApi('/leagues/mine', { token })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => setLeagues(body.leagues))
      .catch(() => setLeaguesError("Couldn't load your leagues."));
  }, [token]);

  const [besties, setBesties] = useState<{ guessedMe: Bestie[]; iGuessed: Bestie[] } | null>(null);
  const [bestiesError, setBestiesError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchApi('/accounts/me/besties', { token })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((b) => setBesties({ guessedMe: b.guessedMe ?? [], iGuessed: b.iGuessed ?? [] }))
      .catch(() => setBestiesError("Couldn't load your besties."));
  }, [token]);

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

  const [pronouns, setPronouns] = useState(profile?.pronouns ?? '');
  const [aboutMe, setAboutMe] = useState(profile?.aboutMe ?? '');
  const [savingAbout, setSavingAbout] = useState(false);
  const [aboutError, setAboutError] = useState<string | null>(null);
  const [aboutSaved, setAboutSaved] = useState(false);

  useEffect(() => {
    setPronouns(profile?.pronouns ?? '');
    setAboutMe(profile?.aboutMe ?? '');
  }, [profile?.pronouns, profile?.aboutMe]);

  async function saveAbout() {
    if (!token || savingAbout) return;
    setAboutError(null);
    setAboutSaved(false);
    setSavingAbout(true);
    try {
      const res = await fetchApi('/accounts/me', { method: 'PATCH', token, body: { pronouns, aboutMe } });
      if (!res.ok) {
        setAboutError((await res.json().catch(() => null))?.error ?? "Couldn't save that. Try again.");
        return;
      }
      await refreshProfile();
      setAboutSaved(true);
    } catch {
      setAboutError("Couldn't reach the server. Try again.");
    } finally {
      setSavingAbout(false);
    }
  }

  const [favorites, setFavorites] = useState<{ title: string; artist: string }[] | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchApi('/favorites', { token })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((b) => setFavorites(b.favorites ?? []))
      .catch(() => {});  // leave the count out rather than claim 0
  }, [token]);

  const [confirming, setConfirming] = useState(false);
  const [proof, setProof] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteAccount() {
    if (!token || deleting) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      // One field serves both kinds of account: the server reads the password, or for accounts
      // without one the email, and ignores the other.
      const res = await fetchApi('/accounts/me', { method: 'DELETE', token, body: { password: proof, confirmEmail: proof } });
      if (!res.ok) {
        setDeleteError((await res.json().catch(() => null))?.error ?? "Couldn't delete your account. Try again.");
        return;
      }
      await signOut();
    } catch {
      setDeleteError("Couldn't reach the server. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Screen label="My Account">
      <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
      <Label>Signed in as {profile?.email}</Label>
      <JCard>
        <Avatar
          url={profile?.avatarUrl}
          token={token}
          initial={(profile?.displayName?.trim() || profile?.email || '?')[0].toUpperCase()}
        />
        {cropping ? (
          <AvatarCropper asset={cropping} onDone={(crop) => uploadAvatar(cropping.uri, [crop])} onCancel={() => setCropping(null)} />
        ) : avatarBusy ? (
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
        <HandText>About you</HandText>
        <Label>Optional.</Label>
        <TapeInput
          placeholder="Pronouns / pronunciation (e.g. she/her · JAH-mee)"
          maxLength={40}
          value={pronouns}
          onChangeText={(next) => {
            setPronouns(next);
            setAboutSaved(false);
          }}
        />
        <TapeInput
          placeholder="About me"
          maxLength={500}
          multiline
          style={{ minHeight: 96, textAlignVertical: 'top' }}
          value={aboutMe}
          onChangeText={(next) => {
            setAboutMe(next);
            setAboutSaved(false);
          }}
        />
        {savingAbout ? <ReelSpinner /> : <TapeButton title="Save about you" onPress={saveAbout} />}
        {aboutSaved && <BodyText>Saved.</BodyText>}
        {aboutError && <ErrorNote>{aboutError}</ErrorNote>}
      </JCard>
      <JCard>
        <HandText>Favorites</HandText>
        <Label>
          Tracks you hearted on a results screen, saved here so you can hear them again or export them as a playlist.
        </Label>
        {favorites && (
          <>
            <BodyText>{favorites.length === 1 ? '1 favorite' : `${favorites.length} favorites`}</BodyText>
            {favorites.slice(0, 3).map((f, i) => (
              <Label key={i}>{`${f.title} · ${f.artist}`}</Label>
            ))}
          </>
        )}
        <TapeButton title="Open favorites" onPress={() => router.push('/favorites')} />
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
      <JCard>
        <HandText>League history</HandText>
        {leaguesError ? (
          <ErrorNote>{leaguesError}</ErrorNote>
        ) : !leagues ? (
          <ReelSpinner />
        ) : (
          <>
            <LeagueGroup title="Active" empty="No active leagues." leagues={leagues.filter((l) => !l.concluded)} />
            <LeagueGroup title="Past" empty="No past leagues yet." leagues={leagues.filter((l) => l.concluded)} />
          </>
        )}
      </JCard>
      <JCard>
        <HandText>Besties</HandText>
        {bestiesError ? (
          <ErrorNote>{bestiesError}</ErrorNote>
        ) : !besties ? (
          <ReelSpinner />
        ) : (
          <>
            <BestieGroup caption="Players who guess your songs correctly" besties={besties.guessedMe} />
            <BestieGroup caption="Players whose songs you guess correctly" besties={besties.iGuessed} />
          </>
        )}
      </JCard>
      <JCard>
        <BlockedPlayers />
        <Label>Report or block someone from their profile.</Label>
      </JCard>
      <JCard>
        <HandText>Delete account</HandText>
        {confirming ? (
          <>
            <Label>
              This can’t be undone. Your email, name, photo and settings are erased; your songs and guesses stay
              in your leagues as “A player”. Enter your password (or your email, if you sign in without one) to confirm.
            </Label>
            <TapeInput placeholder="Password or email" secureTextEntry value={proof} onChangeText={setProof} autoCapitalize="none" />
            {deleting ? <ReelSpinner /> : <TapeButton title="Delete my account" onPress={deleteAccount} />}
            <TapeButton title="Keep my account" variant="secondary" onPress={() => { setConfirming(false); setProof(''); setDeleteError(null); }} />
          </>
        ) : (
          <TapeButton title="Delete account" variant="secondary" onPress={() => setConfirming(true)} />
        )}
        {deleteError && <ErrorNote>{deleteError}</ErrorNote>}
      </JCard>
      <TapeButton title="Back" onPress={() => router.back()} variant="secondary" />
      <LegalLinks />
      </ScrollView>
    </Screen>
  );
}
