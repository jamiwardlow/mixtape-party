import type { NotificationPayload } from './types.js';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Escaped text with newlines kept and bare URLs made clickable (auth mail carries its link in the body). */
const paragraph = (s: string) => esc(s).replace(/https?:\/\/(?:(?!&(?:lt|gt|quot|#39);)\S)+/g, (u) => `<a href="${u}" class="lk" style="color:#3D5AFE">${u}</a>`).replace(/\n/g, '<br>');

// Design: DESIGN.md "Email (#151)", direction B. Inline styles are the light theme; the <style> block flips it
// for clients that honor prefers-color-scheme (Apple Mail, iOS Mail). Gmail on the web ignores it and stays light.
const MONO = "'Courier New',Courier,monospace";
const BADGE_URL = 'https://mixtape-party.com';

const DARK_CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
.pg{background:#031C29!important}.band{background:#052A3D!important}.card{background:#0C3D55!important}
.bd{border-color:#FFFDF5!important}.ink{color:#FFFDF5!important}.muted{color:#A8D3E0!important}.lk{color:#8C9EFF!important}
.lt{display:none!important}.dk{display:block!important;max-height:none!important;overflow:visible!important}}`;

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px"><tr><td bgcolor="#FF4F9A" class="bd" style="background:#FF4F9A;border:3px solid #1A1033;border-bottom-width:6px;border-right-width:6px;border-radius:999px"><a href="${esc(href)}" style="display:inline-block;padding:12px 24px;font:bold 16px ${MONO};color:#1A1033;text-decoration:none">${esc(label)}</a></td></tr></table>`;

const badge = `<img class="lt" src="${BADGE_URL}/email-badge.png" width="148" height="106" alt="Mixtape Party" style="display:block;margin:0 auto;border:0"><img class="dk" src="${BADGE_URL}/email-badge-dark.png" width="148" height="106" alt="Mixtape Party" style="display:none;max-height:0;overflow:hidden;mso-hide:all;margin:0 auto;border:0">`;

/** The one layout every email renders through; table-based with inline styles for email clients. */
export function renderEmail(payload: NotificationPayload): { html: string; text: string } {
  const text = [payload.body, payload.link, payload.appLink].filter(Boolean).join('\n\n');
  const buttons = [
    payload.link && button(payload.link, 'Open playlist'),
    payload.appLink && button(payload.appLink, payload.appLinkLabel ?? 'Open Mixtape Party'),
  ].filter(Boolean).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>${DARK_CSS}</style></head><body style="margin:0;padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F1EA" class="pg" style="background:#F4F1EA;font-family:${MONO};font-size:16px;line-height:1.55;color:#1A1033"><tr><td align="center" style="padding:28px 14px"><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:100%;width:100%"><tr><td align="center" bgcolor="#FFD93D" class="band bd" style="background:#FFD93D;border:3px solid #1A1033;border-bottom:0;border-radius:20px 20px 0 0;padding:22px 0">${badge}</td></tr><tr><td bgcolor="#FFFFFF" class="card bd ink" style="background:#FFFFFF;border:3px solid #1A1033;border-radius:0 0 20px 20px;padding:28px 26px;color:#1A1033"><h1 style="margin:0 0 12px;font:bold 22px/1.25 ${MONO};color:inherit">${esc(payload.title)}</h1><p style="margin:0 0 22px">${paragraph(payload.body)}</p>${buttons}</td></tr><tr><td align="center" class="muted" style="padding:18px 8px 0;font:12px/1.5 ${MONO};color:#4A3F6B">You're getting this because you have a Mixtape Party account.</td></tr></table></td></tr></table></body></html>`;
  return { html, text };
}
