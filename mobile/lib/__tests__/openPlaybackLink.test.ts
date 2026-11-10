import { Linking } from 'react-native';
import { openPlaybackLink } from '../bandcamp';

const EMBED = 'https://player.bandcamp.com/EmbeddedPlayer/track=1/size=large/';
const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
const page = (data: object) =>
  ({ ok: true, text: async () => `<div data-player-data="${JSON.stringify(data).replace(/"/g, '&quot;')}">` }) as Response;

beforeEach(() => open.mockClear());

it('opens the real page for a Bandcamp embed link', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(page({ linkback: 'https://tycho.bandcamp.com/track/awake' }));
  await openPlaybackLink(EMBED);
  expect(open).toHaveBeenCalledWith('https://tycho.bandcamp.com/track/awake');
});

it('falls back to the embed link when the page cannot be read', async () => {
  globalThis.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
  await openPlaybackLink(EMBED);
  expect(open).toHaveBeenCalledWith(EMBED);
});

it('leaves other links alone', async () => {
  globalThis.fetch = jest.fn();
  await openPlaybackLink('https://music.youtube.com/watch?v=x');
  expect(open).toHaveBeenCalledWith('https://music.youtube.com/watch?v=x');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
