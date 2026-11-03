import { FlatList, View } from 'react-native';
import type { ServiceName } from './rounds';
import { BodyText, JCard, Label, ServiceBadge, Sprocket, TapeButton, TrackRow } from './ui';

export interface Favorite {
  submissionId: string;
  leagueName: string;
  roundTheme: string;
  service: ServiceName;
  title: string;
  artist: string;
  thumbnailUrl?: string | null;
  /** Absent on the public profile, which can't open another player's tracks. */
  playback?: { deepLink: string; webUrl?: string };
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
    <FlatList keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
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
          <TrackRow
            thumbnailUrl={item.thumbnailUrl}
            title={item.title}
            artist={item.artist}
            href={item.playback && (item.playback.webUrl ?? item.playback.deepLink)}
            playing={editing.editable && editing.playingId === item.submissionId}
            onPlay={editing.editable ? () => editing.onPlay(item.submissionId) : undefined}
          />
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
