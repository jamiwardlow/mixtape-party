import type { NotificationPayload } from './types.js';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Escaped text with newlines kept and bare URLs made clickable (auth mail carries its link in the body). */
const paragraph = (s: string) => esc(s).replace(/https?:\/\/(?:(?!&(?:lt|gt|quot|#39);)\S)+/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>');

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="background:#111111;border-radius:6px"><a href="${esc(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;font-weight:bold;text-decoration:none">${esc(label)}</a></td></tr></table>`;

/** The one layout every email renders through; table-based with inline styles for email clients. */
export function renderEmail(payload: NotificationPayload): { html: string; text: string } {
  const text = [payload.body, payload.link, payload.appLink].filter(Boolean).join('\n\n');
  const buttons = [
    payload.link && button(payload.link, 'Open link'),
    payload.appLink && button(payload.appLink, 'Open Mixtape Party'),
  ].filter(Boolean).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0;background:#f4f4f4"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:100%;background:#ffffff;border-radius:8px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#111111"><tr><td style="padding:20px 24px;font-size:20px;font-weight:bold;border-bottom:1px solid #eeeeee">Mixtape Party</td></tr><tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:18px">${esc(payload.title)}</h1><p style="margin:0">${paragraph(payload.body)}</p>${buttons}</td></tr><tr><td style="padding:16px 24px;font-size:12px;color:#888888;border-top:1px solid #eeeeee">You're getting this because you have a Mixtape Party account.</td></tr></table></td></tr></table></body></html>`;
  return { html, text };
}
