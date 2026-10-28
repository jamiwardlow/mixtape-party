import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { fetchApi } from '../lib/api';
import { usePreview } from '../lib/preview';
import type { ServiceName } from '../lib/rounds';
import { useSession } from '../lib/session';
import { BodyText, ErrorNote, HandText, JCard, Label, ReelSpinner, Screen, ServiceBadge, Sprocket, TapeButton } from '../lib/ui';

interface Favorite {
  submissionId: string;
  leagueName: string;
  roundTheme: string;
  service: ServiceName;
  title: string;
  artist: string;
}

interface Skipped {
  submissionId: string;
  title: string;
  artist: string;
  playback: { deepLink: string; webUrl?: string };
}

interface ExportLeg {
  status: 'ok' | 'no_matches' | 'failed';
  playlistUrl: string | null;
  skipped: Skipped[];
}

const previewPath = (submissionId: string) => `/submissions/${submissionId}/preview`;

export default function Favorites() {
  const { token } = useSession();
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [exportLeg, setExportLeg] = useState<ExportLeg | null>(null);
  const [exporting, setExporting] = useState(false);
  const [noPreview, setNoPreview] = useState<string | null>(null);
  // /favorites carries no playback link, so a track with no preview just says so.
  const { playingId, toggle } = usePreview(previewPath, token, setNoPreview);

  useEffect(() => {
    if (!token) return;
    fetchApi('/favorites', { token })
      .then(async (res) => {
        if (!res.ok) return setError("Couldn't load your favorites.");
        const body = await res.json();
        setFavorites(body.favorites);
        setPlaylistUrl(body.playlistUrl);
      })
      .catch(() => setError("Couldn't reach the server. Try again."));
  }, [token]);

  async function unfavorite(submissionId: string) {
    if (!token) return;
    setError(null);
    const ok = await fetchApi(`/submissions/${submissionId}/favorite`, { method: 'POST', token }).then(
      (res) => res.ok,
      () => false,
    );
    if (ok) setFavorites((prev) => prev?.filter((f) => f.submissionId !== submissionId) ?? null);
    else setError("Couldn't update your favorite. Try again.");
  }

  async function exportFavorites() {
    if (!token) return;
    setError(null);
    setExporting(true);
    try {
      const res = await fetchApi('/favorites/export', { method: 'POST', token });
      const legs: Array<ExportLeg & { service: string }> = res.ok ? ((await res.json()).services ?? []) : [];
      const leg = legs.find((l) => l.service === 'youtube_music');
      if (!leg) return setError("Couldn't export your favorites. Try again.");
      setExportLeg(leg);
      if (leg.playlistUrl) setPlaylistUrl(leg.playlistUrl);
    } catch {
      setError("Couldn't export your favorites. Try again.");
    } finally {
      setExporting(false);
    }
  }

  const exportNote =
    exportLeg?.status === 'no_matches'
      ? 'None of your favorites were on YouTube Music.'
      : exportLeg?.status === 'failed'
        ? 'Couldn’t build the YouTube Music playlist this time. Try exporting again.'
        : null;

  return (
    <Screen label="Favorites">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {favorites && favorites.length > 0 ? (
        <JCard>
          <Label>YouTube Music</Label>
          <TapeButton
            title={playlistUrl ? 'Export again' : 'Export to YouTube Music'}
            onPress={exportFavorites}
            disabled={exporting}
            variant="secondary"
          />
          {playlistUrl ? (
            <>
              <TapeButton title="Open playlist" onPress={() => Linking.openURL(playlistUrl)} variant="secondary" />
              <Label>Removing a favorite does not remove it from an exported playlist.</Label>
            </>
          ) : null}
          {exportNote ? <Label>{exportNote}</Label> : null}
          {exportLeg?.skipped.map((s) => (
            <View key={s.submissionId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <BodyText>
                {s.title} — {s.artist}
              </BodyText>
              <TapeButton title="Open track" onPress={() => Linking.openURL(s.playback.webUrl ?? s.playback.deepLink)} variant="secondary" />
            </View>
          ))}
        </JCard>
      ) : null}
      {favorites === null ? (
        error ? null : <ReelSpinner />
      ) : favorites.length === 0 ? (
        <BodyText>
          No favorites yet. Tap the heart on a track on a round's results screen to save it here.
        </BodyText>
      ) : (
        <FlatList
          data={favorites}
          keyExtractor={(item) => item.submissionId}
          ItemSeparatorComponent={Sprocket}
          renderItem={({ item }) => (
            <JCard>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <ServiceBadge service={item.service} />
                <TapeButton
                  title={playingId === item.submissionId ? 'Stop' : 'Play'}
                  onPress={() => {
                    setNoPreview(null);
                    toggle(item.submissionId);
                  }}
                  variant="secondary"
                />
              </View>
              <HandText>
                {item.title} — {item.artist}
              </HandText>
              <Label>
                {item.leagueName} · {item.roundTheme}
              </Label>
              {noPreview === item.submissionId ? <Label>No preview available for this track.</Label> : null}
              <TapeButton title="Unfavorite" onPress={() => unfavorite(item.submissionId)} variant="secondary" />
            </JCard>
          )}
        />
      )}
      <TapeButton title="Back" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}
