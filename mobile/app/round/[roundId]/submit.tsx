import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import type { ServiceName } from '../../../lib/rounds';
import { SERVICE_META, useTheme } from '../../../lib/theme';
import { BodyText, ErrorNote, JCard, Label, PressScale, ReelSpinner, Screen, ServiceBadge, Sprocket, TapeButton, TapeInput } from '../../../lib/ui';

// Every service is offered to every player: searching a catalog needs no per-user credential.
// A service_links row authorizes writing to a user's library, which only export cares about.
const SERVICES: ServiceName[] = ['apple_music', 'youtube_music', 'bandcamp'];

interface TrackResult {
  externalId: string;
  title: string;
  artist: string;
  isrc?: string;
}

export default function SubmitTrack() {
  const t = useTheme();
  const { roundId, edit } = useLocalSearchParams<{ roundId: string; edit?: string }>();
  const { token } = useSession();
  const [service, setServiceRaw] = useState<ServiceName | null>(null);
  function setService(s: ServiceName) {
    setServiceRaw(s);
    setQuery('');
    setResults([]);
    setError(null);
  }
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [comment, setComment] = useState('');
  const [results, setResults] = useState<TrackResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [current, setCurrent] = useState<{ service: ServiceName; title: string; artist: string } | null>(null);
  const [commentSaved, setCommentSaved] = useState(false);

  // Editing: show the track already in, and start the comment box from what is saved.
  useEffect(() => {
    if (!edit || !token) return;
    (async () => {
      const res = await fetchApi(`/rounds/${roundId}/overview`, { token });
      if (!res.ok) return;
      const mine = (await res.json()).round.you.submission;
      if (!mine) return;
      setCurrent(mine);
      setComment(mine.comment ?? '');
    })();
  }, [edit, token, roundId]);
  // Already has a track in this round (the entry screens say so), or has just sent one.
  const title = edit || submitted ? 'Edit your track' : 'Submit your track';

  async function search() {
    if (!token || !service || service === 'bandcamp' || !query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetchApi(`/search?q=${encodeURIComponent(query)}&service=${service}`, { token });
      if (!res.ok) {
        setError('Search unavailable right now');
        return;
      }
      setResults((await res.json()).results);
    } finally {
      setSearching(false);
    }
  }

  async function saveComment() {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    setCommentSaved(false);
    try {
      const res = await fetchApi(`/rounds/${roundId}/submissions/mine`, { method: 'PATCH', token, body: { comment } });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not save your comment');
        return;
      }
      setCommentSaved(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitTrack(body: Record<string, unknown>) {
    if (!token || !service) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetchApi(`/rounds/${roundId}/submissions`, { method: 'POST', token, body: { service, comment, ...body } });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not submit that track');
        return;
      }
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Screen label={title}>
        <JCard>
          <BodyText style={{ fontSize: 18 }}>Track submitted.</BodyText>
        </JCard>
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    );
  }

  return (
    <Screen label={title}>
      {/* Outside the FlatList, so it stays on screen however long the results get. */}
      {edit && <TapeButton title="Cancel" onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/round/[roundId]', params: { roundId } }))} variant="secondary" />}
      {current && (
        <JCard>
          <Label>Your current track</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ServiceBadge service={current.service} />
            <BodyText testID="current-track" style={{ flex: 1 }}>{`${current.title} — ${current.artist}`}</BodyText>
          </View>
        </JCard>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SERVICES.map((s) => {
          const active = s === service;
          return (
            <PressScale
              key={s}
              onPress={() => setService(s)}
              disabled={active}
              style={{
                borderWidth: 1,
                borderRadius: 6,
                paddingVertical: 6,
                paddingHorizontal: 10,
                minHeight: 44,
                justifyContent: 'center',
                backgroundColor: active ? t.accent : t.shell,
                borderColor: active ? t.accent : t.hairline,
              }}
            >
              <Label style={{ color: active ? t.accentInk : t.inkMuted }}>{SERVICE_META[s]?.label ?? s}</Label>
            </PressScale>
          );
        })}
      </View>
      <TapeInput
        placeholder="Add a comment (optional) — hidden until results"
        value={comment}
        onChangeText={(text) => {
          setComment(text);
          setCommentSaved(false);
        }}
        maxLength={500}
        multiline
      />
      {current && (
        <TapeButton title={commentSaved ? 'Comment saved' : 'Save comment only'} onPress={saveComment} disabled={submitting} variant="secondary" />
      )}
      <Sprocket />
      {!service ? (
        <BodyText>Pick a service to submit from.</BodyText>
      ) : service === 'bandcamp' ? (
        <>
          <TapeInput placeholder="Bandcamp track/album URL" value={url} onChangeText={setUrl} />
          <TapeButton title={submitting ? 'Submitting…' : 'Submit'} onPress={() => submitTrack({ url })} disabled={submitting || !url.trim()} />
        </>
      ) : (
        <>
          <TapeInput placeholder="Search for a track" value={query} onChangeText={setQuery} />
          <TapeButton title={searching ? 'Searching…' : 'Search'} onPress={search} disabled={searching || !query.trim()} variant="secondary" />
          {searching && <ReelSpinner />}
          <FlatList
            data={results}
            keyExtractor={(item) => item.externalId}
            ItemSeparatorComponent={Sprocket}
            renderItem={({ item }) => (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                {service && <ServiceBadge service={service} />}
                <BodyText style={{ flex: 1 }}>
                  {item.title} — {item.artist}
                </BodyText>
                <TapeButton
                  title={submitting ? '…' : 'Submit'}
                  disabled={submitting}
                  onPress={() => submitTrack({ externalId: item.externalId, title: item.title, artist: item.artist, isrc: item.isrc })}
                />
              </View>
            )}
          />
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Screen>
  );
}
