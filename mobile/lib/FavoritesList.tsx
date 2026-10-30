import { FlatList, View } from 'react-native';
import type { ServiceName } from './rounds';
import { BodyText, HandText, JCard, Label, ServiceBadge, Sprocket, TapeButton } from './ui';

export interface Favorite {
  submissionId: string;
  leagueName: string;
  roundTheme: string;
  service: ServiceName;
  title: string;
  artist: string;
}

/**
 * The favorites list, shared by the editable /favorites screen and the read-only public profile.
 * Editable adds Play and Unfavorite; read-only has neither, since a preview is gated on the viewer
 * belonging to the track's league.
 */
export function FavoritesList({
  favorites,
  empty,
  ...editing
}: { favorites: Favorite[]; empty: string } & (
  | { editable?: false }
  | {
      editable: true;
      playingId: string | null;
      noPreview: string | null;
      onPlay: (submissionId: string) => void;
      onUnfavorite: (submissionId: string) => void;
    }
)) {
  if (favorites.length === 0) return <BodyText>{empty}</BodyText>;
  return (
    <FlatList
      data={favorites}
      keyExtractor={(item) => item.submissionId}
      ItemSeparatorComponent={Sprocket}
      scrollEnabled={editing.editable === true}
      renderItem={({ item }) => (
        <JCard>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <ServiceBadge service={item.service} />
            {editing.editable && (
              <TapeButton
                title={editing.playingId === item.submissionId ? 'Stop' : 'Play'}
                onPress={() => editing.onPlay(item.submissionId)}
                variant="secondary"
              />
            )}
          </View>
          <HandText>
            {item.title} — {item.artist}
          </HandText>
          <Label>
            {item.leagueName} · {item.roundTheme}
          </Label>
          {editing.editable && editing.noPreview === item.submissionId ? <Label>No preview available for this track.</Label> : null}
          {editing.editable && <TapeButton title="Unfavorite" onPress={() => editing.onUnfavorite(item.submissionId)} variant="secondary" />}
        </JCard>
      )}
    />
  );
}
