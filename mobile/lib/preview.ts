import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from './api';

// Bandcamp previews are the full track, so every preview is cut at the length Deezer's are.
export const PREVIEW_SECONDS = 30;

/**
 * One in-app preview at a time for the guess screen. `toggle` plays a track's preview (or stops it
 * if it's the one playing); when the API has no preview it calls `fallback` -- the existing "open in
 * the service" link. The URL is fetched per play because Bandcamp's expire.
 */
export function usePreview(roundId: string, token: string | null, fallback: (submissionId: string) => void) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by every tap and stop, so a slow lookup that's been superseded doesn't start playing.
  const request = useRef(0);

  const stop = useCallback(() => {
    request.current++;
    if (timer.current) clearTimeout(timer.current);
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
      let url: string | null = null;
      try {
        const res = await fetchApi(`/rounds/${roundId}/submissions/${submissionId}/preview`, { token });
        if (res.ok) url = (await res.json()).url;
      } catch {
        // Treated as "no preview": the link still works.
      }
      if (mine !== request.current) return;
      if (!url) return fallback(submissionId);
      const p = createAudioPlayer(url);
      player.current = p;
      p.addListener('playbackStatusUpdate', (s) => s.didJustFinish && player.current === p && stop());
      p.play();
      timer.current = setTimeout(stop, PREVIEW_SECONDS * 1000);
      setPlayingId(submissionId);
    },
    [playingId, roundId, token, stop, fallback],
  );

  return { playingId, toggle };
}
