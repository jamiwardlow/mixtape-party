import type {
  MusicServiceAdapter,
  OAuthLinkableAdapter,
  PlaybackLaunchHandle,
  PlaylistRef,
  TrackRef,
  TrackResult,
} from './types.js';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

export interface SpotifyAdapterConfig {
  clientId: string;
  clientSecret: string;
}

/** Real Spotify integration: Client Credentials for search, user-scoped OAuth for playlist writes. */
export class SpotifyAdapter implements MusicServiceAdapter, OAuthLinkableAdapter {
  readonly service = 'spotify' as const;

  private clientCredentialsToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: SpotifyAdapterConfig) {}

  private async getClientCredentialsToken(): Promise<string> {
    if (this.clientCredentialsToken && this.clientCredentialsToken.expiresAt > Date.now()) {
      return this.clientCredentialsToken.value;
    }
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`spotify client_credentials failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.clientCredentialsToken = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in - 60) * 1000,
    };
    return body.access_token;
  }

  async search(query: string): Promise<TrackResult[]> {
    const token = await this.getClientCredentialsToken();
    const res = await fetch(`${API_BASE}/search?type=track&q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`spotify search failed: ${res.status}`);
    const body = (await res.json()) as {
      tracks: { items: Array<{ id: string; name: string; artists: Array<{ name: string }>; external_ids?: { isrc?: string } }> };
    };
    return body.tracks.items.map((item) => ({
      externalId: item.id,
      title: item.name,
      artist: item.artists.map((a) => a.name).join(', '),
      isrc: item.external_ids?.isrc,
      service: this.service,
    }));
  }

  async match(track: TrackRef): Promise<TrackResult | null> {
    const query = track.isrc ? `isrc:${track.isrc}` : `${track.title} artist:${track.artist}`;
    const results = await this.search(query);
    return results[0] ?? null;
  }

  async createPlaylist(accessToken: string, name: string): Promise<PlaylistRef> {
    const meRes = await fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!meRes.ok) throw new Error(`spotify /me failed: ${meRes.status}`);
    const me = (await meRes.json()) as { id: string };
    const res = await fetch(`${API_BASE}/users/${me.id}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, public: false }),
    });
    if (!res.ok) throw new Error(`spotify create playlist failed: ${res.status}`);
    const body = (await res.json()) as { id: string };
    return { externalId: body.id, service: this.service };
  }

  async appendToPlaylist(accessToken: string, playlist: PlaylistRef, tracks: TrackResult[]): Promise<void> {
    const uris = tracks.map((t) => `spotify:track:${t.externalId}`);
    const res = await fetch(`${API_BASE}/playlists/${playlist.externalId}/tracks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris }),
    });
    if (!res.ok) throw new Error(`spotify append tracks failed: ${res.status}`);
  }

  async getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle> {
    return {
      service: this.service,
      deepLink: `spotify:track:${track.externalId}`,
      webUrl: `https://open.spotify.com/track/${track.externalId}`,
    };
  }

  getAuthorizeUrl(params: { codeChallenge: string; redirectUri: string; state: string; scope: string }): string {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      scope: params.scope,
      redirect_uri: params.redirectUri,
      state: params.state,
      code_challenge_method: 'S256',
      code_challenge: params.codeChallenge,
    });
    return `${AUTHORIZE_URL}?${query.toString()}`;
  }

  async exchangeAuthorizationCode(params: { code: string; codeVerifier: string; redirectUri: string }) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.code,
        redirect_uri: params.redirectUri,
        client_id: this.config.clientId,
        code_verifier: params.codeVerifier,
      }).toString(),
    });
    if (!res.ok) throw new Error(`spotify token exchange failed: ${res.status}`);
    const body = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresIn: body.expires_in,
      scope: body.scope,
    };
  }

  async getProfile(accessToken: string) {
    const res = await fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`spotify /me failed: ${res.status}`);
    const body = (await res.json()) as { id: string; email?: string; product?: string };
    return { serviceUserId: body.id, email: body.email, product: body.product };
  }
}
