import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createApp } from '../app.js';
import { FakeBandcampAdapter, FakeMusicServiceAdapter } from '../adapters/fakeAdapter.js';
import { FakeEmailChannel, FakePushChannel } from '../notifications/fakeChannels.js';
import type { GoogleProfile } from '../routes/googleAuth.js';

/** In-memory stand-in for Google's token endpoint: hand it a code, get back the profile it maps to. */
export class FakeGoogleTokenExchange {
  private readonly profiles = new Map<string, GoogleProfile>();

  /** Registers an authorization code. Verified and nameless unless the test says otherwise. */
  issue(code: string, profile: Pick<GoogleProfile, 'sub' | 'email'> & Partial<GoogleProfile>): void {
    this.profiles.set(code, { emailVerified: true, name: null, ...profile });
  }

  exchange = async (code: string): Promise<GoogleProfile> => {
    const profile = this.profiles.get(code);
    if (!profile) throw new Error(`no fake google profile registered for code ${code}`);
    return profile;
  };
}

export function buildApp(
  pool: Pool,
  {
    youtubeMusicCookie = 'fake-youtube-music-cookie',
    googleConfigured = true,
    appBaseUrl = 'https://app.test',
  }: { youtubeMusicCookie?: string; googleConfigured?: boolean; appBaseUrl?: string } = {},
) {
  const appleMusicAdapter = new FakeMusicServiceAdapter('apple_music');
  const youtubeMusicAdapter = new FakeMusicServiceAdapter('youtube_music');
  const bandcampAdapter = new FakeBandcampAdapter();
  const pushChannel = new FakePushChannel();
  const emailChannel = new FakeEmailChannel();
  const googleTokenExchange = new FakeGoogleTokenExchange();
  const app = createApp({
    pool,
    sessionSecret: 'test-secret',
    appBaseUrl,
    // Left genuinely undefined when opted out, matching an unset env var rather than a blank one.
    googleClientId: googleConfigured ? 'test-google-client-id' : undefined,
    googleRedirectUri: googleConfigured ? 'https://api.test/auth/google/callback' : undefined,
    googleTokenExchange: googleTokenExchange.exchange,
    appleMusicAdapter,
    youtubeMusicAdapter,
    youtubeMusicCookie,
    bandcampAdapter,
    pushChannel,
    emailChannel,
  });
  return { app, appleMusicAdapter, youtubeMusicAdapter, bandcampAdapter, pushChannel, emailChannel, googleTokenExchange };
}

export async function signUp(app: Express, email: string) {
  const res = await request(app).post('/accounts').send({ email, password: 'password123' });
  return { accountId: res.body.accountId as string, token: res.body.token as string };
}

export async function linkFakeAppleMusic(app: Express, appleMusicAdapter: FakeMusicServiceAdapter, token: string) {
  const musicUserToken = `mut-${token}`;
  appleMusicAdapter.validMusicUserTokens.set(musicUserToken, { serviceUserId: `apple-music-${token}` });
  await request(app)
    .post('/auth/apple-music/callback')
    .set('Authorization', `Bearer ${token}`)
    .send({ musicUserToken });
}

export const round1 = {
  theme: 'One-hit wonders',
  submissionDeadline: '2030-01-10T00:00:00.000Z',
  guessingDeadline: '2030-01-17T00:00:00.000Z',
};

export async function createLeagueWithPlayers(
  app: Express,
  appleMusicAdapter: FakeMusicServiceAdapter,
  playerCount: number,
  overrides: Partial<typeof round1 & { seasonLength: number }> = {},
) {
  const host = await signUp(app, `host-${Date.now()}-${Math.random()}@example.com`);
  const created = await request(app)
    .post('/leagues')
    .set('Authorization', `Bearer ${host.token}`)
    .send({ name: 'Office League', seasonLength: 8, ...round1, ...overrides });
  const roundId = created.body.round.id as string;
  const inviteCode = created.body.inviteCode as string;

  const members = [host];
  for (let i = 1; i < playerCount; i++) {
    const player = await signUp(app, `player-${i}-${Date.now()}-${Math.random()}@example.com`);
    await linkFakeAppleMusic(app, appleMusicAdapter, player.token);
    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${player.token}`);
    members.push(player);
  }

  const submissions: Array<{ accountId: string; submissionId: string }> = [];
  for (const member of members) {
    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({
        externalId: `track-${member.accountId}`,
        title: `Song by ${member.accountId}`,
        artist: 'Artist',
        service: 'apple_music',
      });
    submissions.push({ accountId: member.accountId, submissionId: res.body.submissionId });
  }

  return { roundId, leagueId: created.body.leagueId as string, members, submissions };
}

export async function closeSubmissionWindow(pool: Pool, roundId: string) {
  await pool.query("UPDATE rounds SET submission_deadline = '2000-01-01T00:00:00Z' WHERE id = $1", [roundId]);
}

export async function closeGuessingWindow(pool: Pool, roundId: string) {
  await pool.query("UPDATE rounds SET guessing_deadline = '2000-01-01T00:00:00Z' WHERE id = $1", [roundId]);
}

function tokenFrom(body: string, pattern: RegExp): string {
  const match = pattern.exec(body);
  if (!match) throw new Error(`no token matching ${pattern} in emailed body: ${body}`);
  return match[1];
}

/** Reset links carry the token as a query param... */
export const resetTokenFrom = (body: string) => tokenFrom(body, /\?token=([A-Za-z0-9_-]+)/);
/** ...and sign-in links as a fragment, never a query param — see #49. Kept strict so a link that
 *  switched form fails the test rather than quietly passing. */
export const signInTokenFrom = (body: string) => tokenFrom(body, /#t=([A-Za-z0-9_-]+)/);
