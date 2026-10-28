import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import type { ServiceName } from '../../../lib/rounds';
import { useTheme } from '../../../lib/theme';
import { BodyText, ErrorNote, JCard, Label, PressScale, ReelSpinner, Screen, ServiceBadge, Sprocket, TapeButton, TapeInput, Thumb } from '../../../lib/ui';

// Every service is offered to every player: searching a catalog needs no per-user credential.
const SERVICES: ServiceName[] = ['youtube_music', 'bandcamp'];
const BUTTON_LABEL: Record<ServiceName, string> = {
  youtube_music: 'Search YouTube Music',
  bandcamp: 'Paste a link from Bandcamp',
};

interface TrackResult {
  externalId: string;
  title: string;
  artist: string;
  isrc?: string;
  thumbnailUrl?: string | null;
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
  const [current, setCurrent] = useState<{ service: ServiceName; title: string; artist: string; thumbnailUrl?: string | null } | null>(null);
  const [commentSaved, setCommentSaved] = useState(false);

  // Editing: show the track already in, and start the comment box from what is saved.
  async function loadCurrent() {
    if (!token) return;
    const res = await fetchApi(`/rounds/${roundId}/overview`, { token });
    if (!res.ok) return;
    const mine = (await res.json()).round.you.submission;
    if (!mine) return;
    setCurrent(mine);
    setComment(mine.comment ?? '');
  }
  useEffect(() => {
    if (edit && token) loadCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setResults([]);
      setCommentSaved(false);
      await loadCurrent();
    } finally {
      setSubmitting(false);
    }
  }

  const commentField = (
    <>
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
          <TapeButton title={commentSaved ? 'Saved' : 'Save'} onPress={saveComment} disabled={submitting} variant="secondary" />
        )}
    </>
  );

  return (
    <Screen label={title}>
      {/* Outside the FlatList, so it stays on screen however long the results get. */}
      <TapeButton title="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/round/[roundId]', params: { roundId } }))} variant="secondary" />
      {current && (
        <JCard>
          <Label>{submitted ? 'Track submitted — your current track' : 'Your current track'}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Thumb url={current.thumbnailUrl} />
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
              <Label style={{ color: active ? t.accentInk : t.inkMuted }}>{BUTTON_LABEL[s] ?? s}</Label>
            </PressScale>
          );
        })}
      </View>
      <Sprocket />
      {!service ? (
        <>
          <BodyText>Pick a service to submit from.</BodyText>
          {commentField}
        </>
      ) : service === 'bandcamp' ? (
        <>
          <TapeInput placeholder="Bandcamp track/album URL" value={url} onChangeText={setUrl} />
          {commentField}
          <TapeButton title={submitting ? 'Submitting…' : 'Submit'} onPress={() => submitTrack({ url })} disabled={submitting || !url.trim()} />
        </>
      ) : (
        <>
          <TapeInput placeholder="Search for a track" value={query} onChangeText={setQuery} />
          <TapeButton title={searching ? 'Searching…' : 'Search'} onPress={search} disabled={searching || !query.trim()} variant="secondary" />
          {commentField}
          {searching && <ReelSpinner />}
          <FlatList
            data={results}
            keyExtractor={(item) => item.externalId}
            ItemSeparatorComponent={Sprocket}
            renderItem={({ item }) => (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <Thumb url={item.thumbnailUrl} />
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
