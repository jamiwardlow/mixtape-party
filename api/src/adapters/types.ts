export type ServiceName = 'youtube_music' | 'bandcamp';

export interface TrackRef {
  isrc?: string;
  title: string;
  artist: string;
}

export interface TrackResult extends TrackRef {
  externalId: string;
  service: ServiceName;
  /** Bandcamp cover art id, for building the thumbnail URL. */
  artId?: number;
  /** Bandcamp's real track/album page, for the playback link. */
  pageUrl?: string;
}

export interface PlaybackLaunchHandle {
  service: ServiceName;
  deepLink: string;
  webUrl?: string;
}

/** The fields of a submit request (`POST /rounds/:roundId/submissions`) as the client sent them, unvalidated. */
export type SubmissionRequest = Record<string, unknown>;

/** A submit request turned into the track to store, or the status and message to answer with instead. */
export type SubmissionResolution = { track: TrackResult } | { status: 400 | 503; error: string };

/**
 * Shared contract every per-service music adapter must satisfy (Seam 2). Routes ask an adapter what
 * it can do -- search, export, build a playlist link -- and never compare service names.
 */
export interface MusicServiceAdapter {
  readonly service: ServiceName;
  /** Catalog search. Absent for a paste-a-URL service (Bandcamp), which has no search API. */
  search?(query: string, accessToken?: string): Promise<TrackResult[]>;
  /** Finds `track` in this catalog, for verifying a submit and for cross-service export. Absent with `search`. */
  match?(track: TrackRef, accessToken?: string): Promise<TrackResult | null>;
  /** Whether a submission on this service goes into the round's playlists; one that doesn't is shown as excluded. */
  readonly exportable: boolean;
  /** Web address of a playlist built from the comma-joined ids an export stored. Absent where no playlist can be built. */
  playlistUrl?(playlistExternalId: string): string;
  /** Whether `externalId` is shaped like a real track id here; export skips one that isn't rather than sink the whole playlist. */
  isTrackId(externalId: string): boolean;
  /** Turns a submit request into the track to store: verifying a searched pick, or resolving a pasted link. */
  resolveSubmission(request: SubmissionRequest): Promise<SubmissionResolution>;
  thumbnailUrl(track: TrackResult): string | null;
  getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle>;
  getPreviewUrl(track: TrackResult): Promise<string | null>;
  /** Extra fields for a preview response whose url came back null, so the client can resolve it itself. */
  previewFallback?(track: TrackResult): Record<string, string>;
}

/** A service a round's playlist can be built on: it can match other services' tracks and link the result. */
export type PlaylistService = MusicServiceAdapter & Required<Pick<MusicServiceAdapter, 'match' | 'playlistUrl'>>;

/**
 * Thrown by an adapter whose underlying API can go down, change shape without notice, or be
 * missing the app-level credentials it needs -- YouTube Music's unofficial innertube API.
 * Callers must catch this specifically and surface an explicit "unavailable" state, not a generic 500.
 */
export class ServiceUnavailableError extends Error {
  constructor(
    readonly service: ServiceName,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ServiceUnavailableError';
  }
}
