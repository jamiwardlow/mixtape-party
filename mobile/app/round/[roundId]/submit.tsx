import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { ScrollView, Linking, Platform, Text, View } from 'react-native';
import { usePreview } from '../../../lib/preview';
import { resolveBandcampUrl } from '../../../lib/bandcamp';
import { fetchApi } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useTheme } from '../../../lib/theme';
import { playbackHref, type Playback, type ServiceName } from '../../../lib/rounds';
import { BodyText, Chip, ErrorNote, JCard, Label, ReelSpinner, Screen, ServiceBadge, Sprocket, TapeButton, TapeInput, TrackRow } from '../../../lib/ui';

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
  playback: Playback;
}

export default function SubmitTrack() {
  const { roundId, edit } = useLocalSearchParams<{ roundId: string; edit?: string }>();
  const { token } = useSession();
  const t = useTheme();
  // "Change" on the Your pick card brings the search back.
  const [changing, setChanging] = useState(false);
  const [service, setServiceRaw] = useState<ServiceName | null>('youtube_music');
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
  const [current, setCurrent] = useState<{ submissionId: string; playback: Playback; service: ServiceName; title: string; artist: string; thumbnailUrl?: string | null } | null>(null);
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
  // Your own track previews before guessing opens; with no preview it opens in its service.
  const openInService = useCallback(() => current && Linking.openURL(playbackHref(current.playback)), [current]);
  const { playingId, toggle } = usePreview(useCallback((id: string) => `/submissions/${id}/preview`, []), token, openInService);
  // Already has a track in this round (the entry screens say so), or has just sent one.
  const title = edit || submitted ? 'Edit your track' : 'Submit your track';

  // Search results have no submission id yet: previews are keyed by externalId and resolved from the result itself.
  const resultPreviewPath = useCallback(
    (externalId: string) => {
      const r = results.find((x) => x.externalId === externalId);
      const q = new URLSearchParams({ externalId, title: r?.title ?? '', artist: r?.artist ?? '', ...(r?.isrc ? { isrc: r.isrc } : {}) });
      return `/search/preview?${q}`;
    },
    [results],
  );
  const openResult = useCallback(
    (externalId: string) => {
      const r = results.find((x) => x.externalId === externalId);
      if (r) Linking.openURL(playbackHref(r.playback));
    },
    [results],
  );
  const resultPreview = usePreview(resultPreviewPath, token, openResult);

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
      const post = (extra: Record<string, unknown>) =>
        fetchApi(`/rounds/${roundId}/submissions`, { method: 'POST', token, body: { service, comment, ...extra } });
      let res = await post(body);
      // Bandcamp blocks our server's fetch; a native device isn't blocked (web can't: CORS), so read
      // the page here and send what it says.
      if (res.status === 503 && service === 'bandcamp' && Platform.OS !== 'web' && typeof body.url === 'string') {
        const resolved = await resolveBandcampUrl(body.url);
        if (resolved) res = await post({ ...resolved });
      }
      if (res.status === 503 && service === 'bandcamp') {
        setError('Bandcamp blocked that link. On the track page tap Share → Embed, then paste the embed code here instead.');
        return;
      }
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Could not submit that track');
        return;
      }
      setSubmitted(true);
      setChanging(false);
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
      <ScrollView style={{ margin: -6 }} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, padding: 6 }} showsVerticalScrollIndicator={false}>
      {current && !changing && (
        <>
          <Text accessibilityRole="header" style={{ color: t.ink, fontFamily: t.font.display, fontSize: 24, transform: [{ rotate: '-2deg' }] }}>Your pick</Text>
          <JCard>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <ServiceBadge service={current.service} />
              <TapeButton title="Change" onPress={() => setChanging(true)} variant="secondary" />
            </View>
            <TrackRow
              testID="current-track"
              stacked
              thumbnailUrl={current.thumbnailUrl}
              title={current.title}
              artist={current.artist}
              href={playbackHref(current.playback)}
              playing={playingId === current.submissionId}
              onPlay={() => toggle(current.submissionId)}
            />
          </JCard>
          {commentField}
        </>
      )}
      {(!current || changing) && (
        <>
      {changing && <TapeButton title="Keep my pick" onPress={() => setChanging(false)} variant="secondary" />}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SERVICES.map((s) => (
          <Chip key={s} label={BUTTON_LABEL[s] ?? s} selected={s === service} onPress={() => setService(s)} />
        ))}
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
          {results.map((item, i) => (
            <Fragment key={item.externalId}>
              {i > 0 && <Sprocket />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <TrackRow
                  testID="result-text"
                  thumbnailUrl={item.thumbnailUrl}
                  title={item.title}
                  artist={item.artist}
                  href={playbackHref(item.playback)}
                  playing={resultPreview.playingId === item.externalId}
                  onPlay={() => resultPreview.toggle(item.externalId)}
                  stacked
                  style={{ minWidth: 0 }}
                />
                <View style={{ flexShrink: 0 }}>
                  <TapeButton
                    title={submitting ? '…' : 'Submit'}
                    disabled={submitting}
                    onPress={() => submitTrack({ externalId: item.externalId, title: item.title, artist: item.artist, isrc: item.isrc })}
                  />
                </View>
              </View>
            </Fragment>
          ))}
        </>
      )}
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <TapeButton title="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/round/[roundId]', params: { roundId } }))} variant="secondary" />
      </ScrollView>
    </Screen>
  );
}
