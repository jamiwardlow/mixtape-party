import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { fetchApi } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import type { ServiceName } from '../../../lib/rounds';
import { SERVICE_META, useTheme } from '../../../lib/theme';
import { BodyText, ErrorNote, JCard, Label, PressScale, ReelSpinner, Screen, ServiceBadge, Sprocket, TapeButton, TapeInput } from '../../../lib/ui';

interface TrackResult {
  externalId: string;
  title: string;
  artist: string;
  isrc?: string;
}

export default function SubmitTrack() {
  const t = useTheme();
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const { token } = useSession();
  const [services, setServices] = useState<ServiceName[]>([]);
  const [service, setServiceRaw] = useState<ServiceName | null>(null);
  function setService(s: ServiceName) {
    setServiceRaw(s);
    setQuery('');
    setResults([]);
    setError(null);
  }
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [results, setResults] = useState<TrackResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const res = await fetchApi('/accounts/me', { token });
      if (!res.ok) return;
      const linked: ServiceName[] = (await res.json()).services.map((s: { service: ServiceName }) => s.service);
      setServices([...linked, 'bandcamp']);
      setService(linked[0] ?? 'bandcamp');
    })();
  }, [token]);

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

  async function submitTrack(body: Record<string, unknown>) {
    if (!token || !service) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetchApi(`/rounds/${roundId}/submissions`, { method: 'POST', token, body: { service, ...body } });
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
      <Screen label="Submit a track">
        <JCard>
          <BodyText style={{ fontSize: 18 }}>Track submitted — side A logged.</BodyText>
        </JCard>
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    );
  }

  return (
    <Screen label="Submit a track">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {services.map((s) => {
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
      <Sprocket />
      {service === 'bandcamp' ? (
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
