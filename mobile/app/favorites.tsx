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

const previewPath = (submissionId: string) => `/submissions/${submissionId}/preview`;

export default function Favorites() {
  const { token } = useSession();
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noPreview, setNoPreview] = useState<string | null>(null);
  // /favorites carries no playback link, so a track with no preview just says so.
  const { playingId, toggle } = usePreview(previewPath, token, setNoPreview);

  useEffect(() => {
    if (!token) return;
    fetchApi('/favorites', { token })
      .then(async (res) => {
        if (!res.ok) return setError("Couldn't load your favorites.");
        setFavorites((await res.json()).favorites);
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

  return (
    <Screen label="Favorites">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
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
