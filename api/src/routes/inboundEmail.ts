import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';

export interface InboundEmailDeps {
  /** Resend's Svix signing secret ("whsec_..."). Unset disables the endpoint (503), never allow-all. */
  inboundWebhookSecret?: string;
  resendApiKey?: string;
  /** Verified sending domain; Resend refuses to send from anywhere else. */
  emailFrom?: string;
  /** Where inbound mail is forwarded. */
  forwardTo?: string;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

const TOLERANCE_SECONDS = 300;

// Svix: HMAC-SHA256 over `${id}.${timestamp}.${body}`, keyed by the base64 part of the secret.
function validSignature(secret: string, id: string, timestamp: string, body: string, header: string): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest();
  return header.split(' ').some((part) => {
    const given = Buffer.from(part.split(',')[1] ?? '', 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// Resend's error body says why (e.g. restricted API key), so it goes in the thrown message and the logs.
async function failure(what: string, r: Response): Promise<Error> {
  return new Error(`${what} failed with ${r.status}: ${(await r.text().catch(() => '')).slice(0, 500)}`);
}

interface ReceivedEmail {
  from: string;
  subject?: string;
  html?: string | null;
  text?: string | null;
  attachments?: { filename: string; content_type?: string; content_id?: string | null; download_url: string }[];
}

/**
 * Forwards mail received by Resend to a personal inbox (#166). Mounted before express.json():
 * the signature covers the exact bytes, so the body must stay raw.
 *
 * ponytail: forwards Resend's parsed html/text, not the raw RFC 5322 message, so no mailparser.
 * Switch to the raw download if parsed bodies ever drop content.
 */
export function createInboundEmailRouter(deps: InboundEmailDeps): Router {
  const router = Router();
  const doFetch = deps.fetchImpl ?? fetch;

  router.post('/webhooks/resend-inbound', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const { inboundWebhookSecret, resendApiKey, emailFrom, forwardTo } = deps;
    if (!inboundWebhookSecret || !resendApiKey || !emailFrom || !forwardTo) {
      res.status(503).json({ error: 'inbound email not configured' });
      return;
    }
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const id = req.get('svix-id') ?? '';
    const timestamp = req.get('svix-timestamp') ?? '';
    if (!validSignature(inboundWebhookSecret, id, timestamp, body, req.get('svix-signature') ?? '')) {
      res.status(401).json({ error: 'invalid signature' });
      return;
    }

    let event: { type?: string; data?: { email_id?: string } };
    try {
      event = JSON.parse(body);
    } catch {
      res.status(400).json({ error: 'bad json' });
      return;
    }
    const emailId = event.data?.email_id;
    if (event.type !== 'email.received' || !emailId) {
      res.json({ ok: true, ignored: true });
      return;
    }

    // Any failure below is a 500 so Resend retries the webhook.
    const auth = { Authorization: `Bearer ${resendApiKey}` };
    const got = await doFetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { headers: auth });
    if (!got.ok) throw await failure('resend receiving get', got);
    const email = (await got.json()) as ReceivedEmail;

    const attachments = await Promise.all(
      (email.attachments ?? []).map(async (a) => {
        const file = await doFetch(a.download_url);
        if (!file.ok) throw await failure('attachment download', file);
        return {
          filename: a.filename,
          content: Buffer.from(await file.arrayBuffer()).toString('base64'),
          content_type: a.content_type,
          content_id: a.content_id?.replace(/^<|>$/g, ''),
        };
      }),
    );

    const sent = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: emailFrom,
        to: [forwardTo],
        reply_to: email.from,
        subject: email.subject ?? '(no subject)',
        html: email.html ?? undefined,
        text: email.text ?? undefined,
        attachments,
      }),
    });
    if (!sent.ok) throw await failure('resend forward', sent);
    res.json({ ok: true });
  });

  return router;
}
