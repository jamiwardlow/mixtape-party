/**
 * A round's track list and what a player does to it, as state transitions: each takes the list
 * and returns the next one, applied once the API has said yes. Every screen showing a track list
 * (guess, results) goes through these, so a mutation behaves the same on each.
 */
import { useEffect, useState } from 'react';
import { useReconnectEpoch } from './api';
import { useApi } from './client';
import { useFavorite, type Reaction } from './Reactions';
import type { ServiceName } from './rounds';

type Keyed = { submissionId: string };
type Guessable = Keyed & { guessedAccountId: string | null; comment: string | null };

const patch = <T extends Keyed>(tracks: T[], submissionId: string, update: (t: T) => T) =>
  tracks.map((t) => (t.submissionId === submissionId ? update(t) : t));

/** Changing a guess leaves the saved comment alone (Save comment owns it); a first guess carries the draft. */
export const guessed = <T extends Guessable>(tracks: T[], submissionId: string, guessedAccountId: string, draft = '') =>
  patch(tracks, submissionId, (t) => ({
    ...t,
    guessedAccountId,
    comment: t.guessedAccountId != null ? t.comment : draft.trim() || null,
  }));

/** The server drops the comment with the guess. */
export const unguessed = <T extends Guessable>(tracks: T[], submissionId: string) =>
  patch(tracks, submissionId, (t) => ({ ...t, guessedAccountId: null, comment: null }));

export const commentSaved = <T extends Keyed & { comment: string | null }>(tracks: T[], submissionId: string, comment: string | null) =>
  patch(tracks, submissionId, (t) => ({ ...t, comment }));

/** `on` is the server's answer (`reacted`): yours is added to the count or taken off it. */
export function toggledReaction(reactions: Reaction[], emoji: string, on: boolean): Reaction[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) return on ? [...reactions, { emoji, count: 1, mine: true }] : reactions;
  if (existing.mine === on) return reactions;
  const count = existing.count + (on ? 1 : -1);
  return count > 0
    ? reactions.map((r) => (r.emoji === emoji ? { emoji, count, mine: on } : r))
    : reactions.filter((r) => r.emoji !== emoji);
}

export const reacted = <T extends Keyed & { reactions: Reaction[] }>(tracks: T[], submissionId: string, emoji: string, on: boolean) =>
  patch(tracks, submissionId, (t) => ({ ...t, reactions: toggledReaction(t.reactions, emoji, on) }));

export const favorited = <T extends Keyed & { favorited: boolean }>(tracks: T[], submissionId: string, on: boolean) =>
  patch(tracks, submissionId, (t) => ({ ...t, favorited: on }));

type Reactable = Keyed & { reactions: Reaction[]; favorited: boolean };

/** Reacting to and hearting a track, the same on every screen: patched in place, no refetch. */
export function useTrackReactions<T extends Reactable>(setTracks: (update: (prev: T[]) => T[]) => void) {
  const api = useApi();
  const favorite = useFavorite((submissionId, on) => setTracks((prev) => favorited(prev, submissionId, on)));
  async function react(submissionId: string, emoji: string) {
    const res = await api<{ reacted: boolean }>(`/submissions/${submissionId}/reactions`, { method: 'POST', body: { emoji } });
    if (res.ok) setTracks((prev) => reacted(prev, submissionId, emoji, !!res.data?.reacted));
  }
  return { react, favorite };
}

/**
 * One service's leg of this round's export, as the API reports it (#73). `playlistUrl` is null for
 * every status but `ok`, so the status is the only thing that tells a missing playlist apart from
 * a broken one.
 */
export interface ServiceExport {
  service: ServiceName;
  status: 'ok' | 'no_matches' | 'failed';
  playlistUrl: string | null;
}

/**
 * The round's playlists, once `loaded`. The sweep builds them when submissions close and the route
 * builds any it hasn't, once per round, so every caller reads back the same ones. Matching every
 * track into each catalog can take a while, so the links land after the screen rather than holding
 * it up; a request that dies leaves none, and never takes the screen down.
 */
export function useRoundExport(roundId: string, loaded: boolean) {
  const api = useApi();
  const [exports, setExports] = useState<ServiceExport[]>([]);
  const epoch = useReconnectEpoch();
  useEffect(() => {
    if (!loaded) return;
    void api<{ services: ServiceExport[] }>(`/rounds/${roundId}/export`, { method: 'POST' }).then((r) => {
      if (r.ok) setExports(r.data.services);
    });
    // Not on `api`: its identity follows the session's, and one export per load is the point.
  }, [loaded, roundId, epoch]);
  return exports;
}
