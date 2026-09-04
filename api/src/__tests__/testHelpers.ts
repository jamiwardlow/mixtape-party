import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createApp } from '../app.js';
import { FakeMusicServiceAdapter } from '../adapters/fakeAdapter.js';

export function buildApp(pool: Pool) {
  const spotifyAdapter = new FakeMusicServiceAdapter();
  const app = createApp({ pool, sessionSecret: 'test-secret', spotifyAdapter });
  return { app, spotifyAdapter };
}

export async function signUp(app: Express, email: string) {
  const res = await request(app).post('/accounts').send({ email, password: 'password123' });
  return { accountId: res.body.accountId as string, token: res.body.token as string };
}

export async function linkFakeSpotify(app: Express, spotifyAdapter: FakeMusicServiceAdapter, token: string) {
  const authorize = await request(app)
    .get('/auth/spotify/authorize-url')
    .query({ redirectUri: 'mixtapeparty://spotify-callback' })
    .set('Authorization', `Bearer ${token}`);
  const code = `code-${token}`;
  spotifyAdapter.validAuthCodes.set(code, { serviceUserId: `spotify-${token}` });
  await request(app)
    .post('/auth/spotify/callback')
    .set('Authorization', `Bearer ${token}`)
    .send({ code, state: authorize.body.state });
}

export const round1 = {
  theme: 'One-hit wonders',
  submissionDeadline: '2030-01-10T00:00:00.000Z',
  guessingDeadline: '2030-01-17T00:00:00.000Z',
};

export async function createLeagueWithPlayers(
  app: Express,
  spotifyAdapter: FakeMusicServiceAdapter,
  playerCount: number,
  roundOverrides: Partial<typeof round1> = {},
) {
  const host = await signUp(app, `host-${Date.now()}-${Math.random()}@example.com`);
  const created = await request(app)
    .post('/leagues')
    .set('Authorization', `Bearer ${host.token}`)
    .send({ name: 'Office League', seasonLength: 8, ...round1, ...roundOverrides });
  const roundId = created.body.round.id as string;
  const inviteCode = created.body.inviteCode as string;

  const members = [host];
  for (let i = 1; i < playerCount; i++) {
    const player = await signUp(app, `player-${i}-${Date.now()}-${Math.random()}@example.com`);
    await linkFakeSpotify(app, spotifyAdapter, player.token);
    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${player.token}`);
    members.push(player);
  }

  const submissions: Array<{ accountId: string; submissionId: string }> = [];
  for (const member of members) {
    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ externalId: `track-${member.accountId}`, title: `Song by ${member.accountId}`, artist: 'Artist' });
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
