import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createInboundEmailRouter } from '../routes/inboundEmail.js';

const secret = 'whsec_' + Buffer.from('test-secret').toString('base64');
const payload = JSON.stringify({ type: 'email.received', data: { email_id: 'e1' } });

function sign(body: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', Buffer.from('test-secret')).update(`m1.${ts}.${body}`).digest('base64');
  return { 'svix-id': 'm1', 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}`, 'content-type': 'application/json' };
}

function setup() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('/emails/receiving/'))
      return Response.json({
        from: 'fan@x.com',
        subject: 'Hi',
        html: '<p>hi</p>',
        text: 'hi',
        attachments: [{ filename: 'a.png', content_type: 'image/png', content_id: '<cid1>', download_url: 'https://dl/a' }],
      });
    if (url === 'https://dl/a') return new Response('abc');
    return Response.json({ id: 'sent' });
  }) as typeof fetch;
  const app = express().use(
    createInboundEmailRouter({
      inboundWebhookSecret: secret,
      resendApiKey: 'key',
      emailFrom: 'Mixtape <no-reply@x.com>',
      forwardTo: 'me@gmail.com',
      fetchImpl,
    }),
  );
  return { app, calls };
}

describe('POST /webhooks/resend-inbound', () => {
  it('rejects unsigned, badly signed, and stale requests without forwarding', async () => {
    const { app, calls } = setup();
    expect((await request(app).post('/webhooks/resend-inbound').send(payload)).status).toBe(401);
    const bad = { ...sign(payload), 'svix-signature': 'v1,AAAA' };
    expect((await request(app).post('/webhooks/resend-inbound').set(bad).send(payload)).status).toBe(401);
    const stale = sign(payload, Math.floor(Date.now() / 1000) - 3600);
    expect((await request(app).post('/webhooks/resend-inbound').set(stale).send(payload)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('forwards a signed email with reply-to and attachments', async () => {
    const { app, calls } = setup();
    const res = await request(app).post('/webhooks/resend-inbound').set(sign(payload)).send(payload);
    expect(res.status).toBe(200);
    const sent = JSON.parse(String(calls.at(-1)!.init!.body));
    expect(sent).toMatchObject({ to: ['me@gmail.com'], reply_to: 'fan@x.com', subject: 'Hi', html: '<p>hi</p>' });
    expect(sent.attachments).toEqual([
      { filename: 'a.png', content: Buffer.from('abc').toString('base64'), content_type: 'image/png', content_id: 'cid1' },
    ]);
  });

  it('503s when unconfigured', async () => {
    const app = express().use(createInboundEmailRouter({}));
    expect((await request(app).post('/webhooks/resend-inbound').send('{}')).status).toBe(503);
  });
});
