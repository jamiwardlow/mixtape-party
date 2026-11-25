import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './client';
import { fetchBandcampPreview, openPlaybackLink } from './bandcamp';
import { playbackHref, type Playback } from './rounds';

// Bandcamp previews are the full track, so every preview is cut at the length Deezer's are.
export const PREVIEW_SECONDS = 30;

export const submissionPreviewPath = (submissionId: string) => `/submissions/${submissionId}/preview`;

/**
 * One in-app preview at a time, keyed by track. `previewPath` builds the preview endpoint for a
 * track's id. `toggle` plays a track's preview (or stops it if it's the one playing); when the API
 * has no preview it opens the track in its service instead, or, for a track not in `tracks`, reports
 * it as `unavailableId`. The URL is fetched per play because Bandcamp's expire.
 */
export function usePreview(
  previewPath: (submissionId: string) => string,
  tracks: readonly { submissionId: string; playback: Playback }[] | null | undefined,
) {
  const api = useApi();
  // Read at tap time, so a refetched list doesn't churn `toggle`.
  const latest = useRef(tracks);
  latest.current = tracks;
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [unavailableId, setUnavailableId] = useState<string | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by every tap and stop, so a slow lookup that's been superseded doesn't start playing.
  const request = useRef(0);

  const stop = useCallback(() => {
    request.current++;
    if (timer.current) clearTimeout(timer.current);
    // remove() alone leaves the native iOS player audible, so pause it first.
    player.current?.pause();
    player.current?.remove();
    player.current = null;
    setPlayingId(null);
  }, []);

  useEffect(() => stop, [stop]);

  const toggle = useCallback(
    async (submissionId: string) => {
      const wasPlaying = playingId === submissionId;
      stop();
      setUnavailableId(null);
      if (wasPlaying) return;
      const mine = request.current;
      let url: string | null = null;
      try {
        const r = await api<{ url?: string | null; bandcampEmbedId?: string | null }>(previewPath(submissionId));
        if (r.ok) {
          // Bandcamp bot-walls our server, so the API hands back the embed id for the device to read.
          url = r.data.url ?? (r.data.bandcampEmbedId ? await fetchBandcampPreview(r.data.bandcampEmbedId) : null);
        }
      } catch {
        // Treated as "no preview": the link still works.
      }
      if (mine !== request.current) return;
      if (!url) {
        const track = latest.current?.find((t) => t.submissionId === submissionId);
        if (track) openPlaybackLink(playbackHref(track.playback));
        else setUnavailableId(submissionId);
        return;
      }
      // iOS mutes expo-audio when the silent switch is on unless this is set.
      await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
      if (mine !== request.current) return;
      const p = createAudioPlayer(url);
      player.current = p;
      p.addListener('playbackStatusUpdate', (s) => s.didJustFinish && player.current === p && stop());
      p.play();
      timer.current = setTimeout(stop, PREVIEW_SECONDS * 1000);
      setPlayingId(submissionId);
    },
    [playingId, previewPath, api, stop],
  );

  return { playingId, unavailableId, toggle };
}
