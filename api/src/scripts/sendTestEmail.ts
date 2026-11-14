// Sends the "results are ready" email through the real renderer and Resend channel, for eyeballing in mail clients.
// Usage: npm run email:test -- you@example.com   (needs RESEND_API_KEY and EMAIL_FROM in api/.env)
import { ResendEmailChannel } from '../notifications/channels.js';

const to = process.argv[2];
const { RESEND_API_KEY, EMAIL_FROM } = process.env;
if (!to || !RESEND_API_KEY || !EMAIL_FROM) {
  console.error('usage: npm run email:test -- <address>  (RESEND_API_KEY and EMAIL_FROM must be set)');
  process.exit(1);
}

await new ResendEmailChannel(RESEND_API_KEY, EMAIL_FROM).send(to, {
  title: 'Round 4 results are ready',
  body: 'Submitters have been revealed for “Songs for a long drive”!',
  appLink: 'https://mixtape-party.com',
});
console.log(`sent to ${to}`);
