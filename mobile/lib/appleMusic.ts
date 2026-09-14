import { Platform } from 'react-native';
import { fetchApi } from './api';
import type { Profile } from './session';

const MUSICKIT_SRC = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';

interface MusicKitInstance {
  authorize(): Promise<string>;
}

interface MusicKitStatic {
  configure(config: { developerToken: string; app: { name: string; build: string } }): Promise<MusicKitInstance>;
}

declare global {
  /** Set by Apple's CDN script once it loads; `var` is what a global declaration needs. */
  var MusicKit: MusicKitStatic | undefined;
}

/**
 * MusicKit JS is a browser SDK — it needs a DOM and Apple's CDN script, so linking only works on
 * web.
 *
 * ponytail: native users are sent to the web app to link. The upgrade is the MusicKit-iOS bridge in
 * docs/research/native-sdk-wrappers.md, blocked today on EAS Build not provisioning the MusicKit
 * entitlement — worth revisiting when that gap closes.
 */
export const appleMusicLinkingSupported = Platform.OS === 'web';

/**
 * Whether a round's playlist can land in this account's Apple Music library — the linked state the
 * API reports on /accounts/me, which is the only place it lives client-side.
 */
export function isAppleMusicLinked(profile: Profile | null): boolean {
  return profile?.services?.some((s) => s.service === 'apple_music') ?? false;
}

function loadMusicKit(): Promise<MusicKitStatic> {
  if (globalThis.MusicKit) return Promise.resolve(globalThis.MusicKit);
  return new Promise((resolve, reject) => {
    // Resolved from both the event and the script's load, because a second caller arriving while
    // the first is still loading has already missed the event by the time it listens.
    //
    // ponytail: no timeout — if the script loads but never sets the global (Apple changing the
    // bundle), this promise never settles and the button spins forever. Add one if that ever happens.
    const settle = () => {
      if (globalThis.MusicKit) resolve(globalThis.MusicKit);
    };
    const fail = () => reject(new Error("Couldn't reach Apple Music. Check your connection and try again."));
    document.addEventListener('musickitloaded', settle, { once: true });
    // A tag from an earlier attempt gets the same listeners rather than a second copy of the script,
    // including the error one -- a tag that already failed would otherwise never settle this promise.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${MUSICKIT_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', settle);
    script.addEventListener('error', fail);
    if (existing) return;
    script.src = MUSICKIT_SRC;
    script.async = true;
    document.head.appendChild(script);
  });
}

/**
 * Obtains a Music User Token via MusicKit JS and stores it against the account. Apple Music
 * playlists are created under `/v1/me/library/playlists`, which resolves `me` from this token, so
 * every user who wants a round's playlist in their library has to do this themselves (#70).
 *
 * Optional by design (#67): nothing in the app requires a linked service.
 *
 * Linking cannot tell whether the account has an Apple Music subscription — MusicKit JS hands out a
 * Music User Token for any Apple ID and the server's /v1/me/storefront check passes without one
 * either, so a non-subscriber links fine. The copy warns about that up front, and the export now
 * reports Apple's refusal back on the results screen (#73) rather than failing silently.
 */
export async function linkAppleMusic(sessionToken: string): Promise<void> {
  const tokenRes = await fetchApi('/auth/apple-music/developer-token', { token: sessionToken });
  if (!tokenRes.ok) throw new Error("Apple Music linking isn't available right now. Try again later.");
  const { token: developerToken } = (await tokenRes.json()) as { token: string };

  const musicKit = await loadMusicKit();
  let musicUserToken: string;
  try {
    const music = await musicKit.configure({
      developerToken,
      app: { name: 'Mixtape Party', build: '1.0.0' },
    });
    musicUserToken = await music.authorize();
  } catch {
    // Covers a closed popup and a refused authorization alike — Apple surfaces neither distinctly,
    // and neither is a subscription problem, so the message doesn't claim it is.
    throw new Error('Apple Music sign-in didn’t finish. Try again.');
  }

  const linkRes = await fetchApi('/auth/apple-music/callback', {
    method: 'POST',
    token: sessionToken,
    body: { musicUserToken },
  });
  if (!linkRes.ok) throw new Error("Apple Music couldn't verify that account. Try linking again.");
}
