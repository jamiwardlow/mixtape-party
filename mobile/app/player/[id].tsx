import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { fetchApi } from '../../lib/api';
import { Avatar } from '../../lib/Avatar';
import { BestieGroup, type Bestie } from '../../lib/BestieGroup';
import { FavoritesList, type Favorite } from '../../lib/FavoritesList';
import { ReportBlock } from '../../lib/Moderation';
import { nameOf } from '../../lib/rounds';
import { useSession } from '../../lib/session';
import { BodyText, ErrorNote, HandText, JCard, Label, PressScale, ReelSpinner, Screen, TapeButton } from '../../lib/ui';

interface PlayerProfile {
  accountId: string;
  displayName: string | null;
  avatarUrl: string | null;
  pronouns: string | null;
  aboutMe: string | null;
  leagues: { id?: string; name: string; concluded: boolean; seasonLength: number; joinedAt: string }[];
  favorites: Favorite[];
  besties: { guessedMe: Bestie[]; iGuessed: Bestie[] };
}

function LeagueGroup({ title, empty, leagues }: { title: string; empty: string; leagues: PlayerProfile['leagues'] }) {
  return (
    <>
      <Label>{title}</Label>
      {leagues.length === 0 && <BodyText>{empty}</BodyText>}
      {leagues.map((l, i) => {
        const text = `${l.name} · ${l.seasonLength} rounds · joined ${new Date(l.joinedAt).toLocaleDateString()}`;
        const id = l.id;
        return id ? (
          <PressScale key={i} accessibilityRole="link" onPress={() => router.push({ pathname: '/league/[leagueId]', params: { leagueId: id } })}>
            <BodyText>{text}</BodyText>
          </PressScale>
        ) : (
          <BodyText key={i}>{text}</BodyText>
        );
      })}
    </>
  );
}

export default function Player() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, profile: me } = useSession();
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    fetchApi(`/players/${id}`, { token })
      .then(async (res) => {
        if (res.ok) setPlayer(await res.json());
        else setError(res.status === 404 ? "Couldn't find that player." : "Couldn't load this profile.");
      })
      .catch(() => setError("Couldn't reach the server. Try again."));
  }, [token, id]);

  return (
    <Screen label="Player">
      <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
        {error ? <ErrorNote>{error}</ErrorNote> : !player ? <ReelSpinner /> : (
          <>
            <JCard>
              <Avatar url={player.avatarUrl} token={token} label={nameOf(player)} initial={nameOf(player)[0].toUpperCase()} />
              <HandText>{nameOf(player)}</HandText>
              {player.pronouns ? <Label>{player.pronouns}</Label> : null}
              <BodyText>{player.aboutMe || 'Nothing here yet.'}</BodyText>
              {me?.id === player.accountId ? (
                <TapeButton title="Edit on My Account" onPress={() => router.push('/account')} />
              ) : (
                <ReportBlock author={player} onBlocked={() => router.back()} />
              )}
            </JCard>
            <JCard>
              <HandText>Favorites</HandText>
              <FavoritesList favorites={player.favorites} empty="No favorites yet." />
            </JCard>
            <JCard>
              <HandText>League history</HandText>
              <LeagueGroup title="Active" empty="No active leagues." leagues={player.leagues.filter((l) => !l.concluded)} />
              <LeagueGroup title="Past" empty="No past leagues yet." leagues={player.leagues.filter((l) => l.concluded)} />
            </JCard>
            <JCard>
              <HandText>Besties</HandText>
              <BestieGroup caption="Players who guess their songs correctly" besties={player.besties.guessedMe} />
              <BestieGroup caption="Players whose songs they guess correctly" besties={player.besties.iGuessed} />
            </JCard>
          </>
        )}
        <TapeButton title="Back" onPress={() => router.back()} variant="secondary" />
      </ScrollView>
    </Screen>
  );
}
