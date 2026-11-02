import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from './api';

// Bandcamp previews are the full track, so every preview is cut at the length Deezer's are.
export const PREVIEW_SECONDS = 30;

/**
 * One in-app preview at a time. `previewPath` builds the preview endpoint for a submission. `toggle` plays a track's preview (or stops it
 * if it's the one playing); when the API has no preview it calls `fallback` -- the existing "open in
 * the service" link. The URL is fetched per play because Bandcamp's expire.
 */
export function usePreview(previewPath: (submissionId: string) => string, token: string | null, fallback: (submissionId: string) => void) {
  const [playingId, setPlayingId] = useState<string | null>(null);
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
      if (wasPlaying || !token) return;
      const mine = request.current;
      const t0 = Date.now();
      const dbg = (m: string) => console.log(`[DEBUG-179] +${Date.now() - t0}ms ${m}`);
      let url: string | null = null;
      try {
        const res = await fetchApi(previewPath(submissionId), { token });
        if (res.ok) url = (await res.json()).url;
        else dbg(`fetch status ${res.status}`);
      } catch (e) {
        dbg(`fetch threw ${String(e)}`);
        // Treated as "no preview": the link still works.
      }
      if (mine !== request.current) return;
      dbg(`fetched, url ${url ? 'present' : 'null'}`);
      if (!url) return fallback(submissionId);
      // iOS mutes expo-audio when the silent switch is on unless this is set.
      await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
      if (mine !== request.current) return;
      dbg('audio mode set');
      const p = createAudioPlayer(url);
      player.current = p;
      let last = '';
      p.addListener('playbackStatusUpdate', (s) => {
        const now = `playing=${s.playing} loaded=${s.isLoaded} buffering=${s.isBuffering} ${s.timeControlStatus ?? ''}`;
        if (now !== last) dbg(`status ${now}`);
        last = now;
        if (s.didJustFinish && player.current === p) stop();
      });
      p.play();
      timer.current = setTimeout(stop, PREVIEW_SECONDS * 1000);
      setPlayingId(submissionId);
    },
    [playingId, previewPath, token, stop, fallback],
  );

  return { playingId, toggle };
}
