import { createHash, createPrivateKey, createSign } from 'node:crypto';
import type {
  AppleMusicLinkableAdapter,
  MusicServiceAdapter,
  PlaybackLaunchHandle,
  PlaylistRef,
  TrackRef,
  TrackResult,
} from './types.js';

const API_BASE = 'https://api.music.apple.com/v1';
const DEVELOPER_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days, well under Apple's 6-month max

export interface AppleMusicAdapterConfig {
  teamId: string;
  keyId: string;
  /** PEM contents of the Apple-issued MusicKit private key (.p8). */
  privateKey: string;
  /** ponytail: single hardcoded storefront; per-account storefront via GET /v1/me/storefront if international catalogs matter. */
  storefront?: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Real Apple Music integration: developer-token JWT (app-level) plus a client-supplied Music User Token (per-user). */
export class AppleMusicAdapter implements MusicServiceAdapter, AppleMusicLinkableAdapter {
  readonly service = 'apple_music' as const;
  private readonly storefront: string;
  private developerToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: AppleMusicAdapterConfig) {
    this.storefront = config.storefront ?? 'us';
  }

  async getDeveloperToken(): Promise<string> {
    if (this.developerToken && this.developerToken.expiresAt > Date.now()) {
      return this.developerToken.value;
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + DEVELOPER_TOKEN_TTL_SECONDS;
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: this.config.keyId }));
    const payload = base64url(JSON.stringify({ iss: this.config.teamId, iat: issuedAt, exp: expiresAt }));
    const signingInput = `${header}.${payload}`;
    const key = createPrivateKey(this.config.privateKey);
    const signature = createSign('SHA256').update(signingInput).sign({ key, dsaEncoding: 'ieee-p1363' });
    const token = `${signingInput}.${base64url(signature)}`;
    this.developerToken = { value: token, expiresAt: (expiresAt - 300) * 1000 };
    return token;
  }

  async linkMusicUserToken(musicUserToken: string): Promise<{ serviceUserId: string }> {
    const developerToken = await this.getDeveloperToken();
    const res = await fetch(`${API_BASE}/me/storefront`, {
      headers: { Authorization: `Bearer ${developerToken}`, 'Music-User-Token': musicUserToken },
    });
    if (!res.ok) throw new Error('invalid_music_user_token');
    // ponytail: Apple's API exposes no stable per-user id endpoint; hash the Music User Token itself.
    // Upgrade if Apple ever adds one.
    const serviceUserId = createHash('sha256').update(musicUserToken).digest('hex').slice(0, 32);
    return { serviceUserId };
  }

  async search(query: string): Promise<TrackResult[]> {
    const token = await this.getDeveloperToken();
    const res = await fetch(
      `${API_BASE}/catalog/${this.storefront}/search?types=songs&term=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`apple music search failed: ${res.status}`);
    const body = (await res.json()) as {
      results?: { songs?: { data: Array<{ id: string; attributes: { name: string; artistName: string; isrc?: string } }> } };
    };
    const songs = body.results?.songs?.data ?? [];
    return songs.map((song) => ({
      externalId: song.id,
      title: song.attributes.name,
      artist: song.attributes.artistName,
      isrc: song.attributes.isrc,
      service: this.service,
    }));
  }

  async match(track: TrackRef): Promise<TrackResult | null> {
    const query = track.isrc ?? `${track.title} ${track.artist}`;
    const results = await this.search(query);
    return results[0] ?? null;
  }

  async createPlaylist(accessToken: string, name: string): Promise<PlaylistRef> {
    const token = await this.getDeveloperToken();
    const res = await fetch(`${API_BASE}/me/library/playlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Music-User-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ attributes: { name } }),
    });
    if (!res.ok) throw new Error(`apple music create playlist failed: ${res.status}`);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    return { externalId: body.data[0].id, service: this.service };
  }

  async appendToPlaylist(accessToken: string, playlist: PlaylistRef, tracks: TrackResult[]): Promise<void> {
    const token = await this.getDeveloperToken();
    const res = await fetch(`${API_BASE}/me/library/playlists/${playlist.externalId}/tracks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Music-User-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: tracks.map((t) => ({ id: t.externalId, type: 'songs' })) }),
    });
    if (!res.ok) throw new Error(`apple music append tracks failed: ${res.status}`);
  }

  async getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle> {
    return {
      service: this.service,
      deepLink: `music://music.apple.com/${this.storefront}/song/${track.externalId}`,
      webUrl: `https://music.apple.com/${this.storefront}/song/${track.externalId}`,
    };
  }
}
