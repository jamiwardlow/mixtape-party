import { describe, expect, it } from 'vitest';
import { renderEmail } from '../notifications/emailHtml.js';

describe('renderEmail', () => {
  const { html, text } = renderEmail({ title: 'Round <4> ready', body: 'See https://x.test/a?b=1\nbye', link: 'https://x.test/p', appLink: 'https://x.test/app' });

  it('escapes content and links bare URLs', () => {
    expect(html).toContain('Round &lt;4&gt; ready');
    expect(html).toContain('<a href="https://x.test/a?b=1" class="lk"');
  });
  it('renders one button per link, both badge themes, and a dark media query', () => {
    expect(html).toContain('Open playlist');
    expect(html).toContain('Open Mixtape Party');
    expect(html).toContain('email-badge.png');
    expect(html).toContain('email-badge-dark.png');
    expect(html).toContain('prefers-color-scheme:dark');
  });
  it('keeps a plain-text part', () => {
    expect(text).toBe('See https://x.test/a?b=1\nbye\n\nhttps://x.test/p\n\nhttps://x.test/app');
  });
});
