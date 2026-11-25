// react-native's Linking, not expo-linking's: on web only this one opens a new tab.
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useApi, useResource } from '../lib/client';
import { FavoritesList, type Favorite } from '../lib/FavoritesList';
import { submissionPreviewPath, usePreview } from '../lib/preview';
import { playbackHref } from '../lib/rounds';
import { BodyText, ErrorNote, JCard, Label, ReelSpinner, Screen, TapeButton } from '../lib/ui';

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

export default function Favorites() {
  const api = useApi();
  const { data, status, setData } = useResource<{ favorites: Favorite[]; playlistUrl: string | null }>('/favorites', '');
  const favorites = data?.favorites ?? null;
  const [actionError, setError] = useState<string | null>(null);
  const error =
    actionError ?? (status === null ? null : status === 0 ? "Couldn't reach the server. Try again." : "Couldn't load your favorites.");
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);
  const playlistUrl = exportedUrl ?? data?.playlistUrl ?? null;
  const [exportLeg, setExportLeg] = useState<ExportLeg | null>(null);
  const [exporting, setExporting] = useState(false);
  // /favorites carries no playback link, so a track with no preview just says so.
  const { playingId, unavailableId: noPreview, toggle } = usePreview(submissionPreviewPath, null);

  async function unfavorite(submissionId: string) {
    setError(null);
    const { ok } = await api(`/submissions/${submissionId}/favorite`, { method: 'POST' });
    if (ok) setData((d) => ({ ...d, favorites: d.favorites.filter((f) => f.submissionId !== submissionId) }));
    else setError("Couldn't update your favorite. Try again.");
  }

  async function exportFavorites() {
    setError(null);
    setExporting(true);
    const res = await api<{ services?: Array<ExportLeg & { service: string }> }>('/favorites/export', { method: 'POST' });
    setExporting(false);
    const leg = res.ok ? res.data.services?.find((l) => l.service === 'youtube_music') : undefined;
    if (!leg) return setError("Couldn't export your favorites. Try again.");
    setExportLeg(leg);
    if (leg.playlistUrl) setExportedUrl(leg.playlistUrl);
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
              <TapeButton title="Open track" onPress={() => Linking.openURL(playbackHref(s.playback))} variant="secondary" />
            </View>
          ))}
        </JCard>
      ) : null}
      {favorites === null ? (
        error ? null : <ReelSpinner />
      ) : (
        <FavoritesList
          editable
          favorites={favorites}
          empty="No favorites yet. Tap the heart on a track on a round's results screen to save it here."
          playingId={playingId}
          noPreview={noPreview}
          onPlay={toggle}
          onUnfavorite={unfavorite}
        />
      )}
      <TapeButton title="Back" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}
