import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Favorites from '../favorites';

const mockToggle = jest.fn();
let mockFallback: (id: string) => void;

const mockOpenURL = jest.fn();
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpenURL(url) }));
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('../../lib/session', () => ({ useSession: () => ({ token: 'tok-1' }) }));
jest.mock('../../lib/preview', () => ({
  usePreview: (_path: (id: string) => string, _token: string, fallback: (id: string) => void) => {
    mockFallback = fallback;
    return { playingId: null, toggle: mockToggle };
  },
}));

const fav = (n: number) => ({
  submissionId: `s${n}`,
  leagueName: `League ${n}`,
  roundTheme: `Theme ${n}`,
  service: 'youtube_music',
  title: `Song ${n}`,
  artist: `Artist ${n}`,
});

function stubApi(favorites: unknown[], favoriteStatus = 200, playlistUrl: string | null = null, exportBody?: unknown) {
  globalThis.fetch = jest.fn(async (url: string) => {
    if (String(url).endsWith('/favorites/export'))
      return exportBody
        ? new Response(JSON.stringify(exportBody), { status: 200 })
        : new Response('{}', { status: 500 });
    return String(url).endsWith('/favorite')
      ? new Response(JSON.stringify({ favorited: false }), { status: favoriteStatus })
      : new Response(JSON.stringify({ favorites, playlistUrl }), { status: 200 });
  }) as unknown as typeof fetch;
}

const exported = (leg: object) => ({
  services: [{ service: 'youtube_music', status: 'ok', playlistUrl: null, matchedCount: 0, skipped: [], ...leg }],
});

beforeEach(() => jest.clearAllMocks());

it('lists favorites with league and round theme', async () => {
  stubApi([fav(1), fav(2)]);
  await render(<Favorites />);

  await waitFor(() => expect(screen.getByText('Song 1 — Artist 1')).toBeTruthy());
  expect(screen.getByText('League 1 · Theme 1')).toBeTruthy();
  expect(screen.getByText('Song 2 — Artist 2')).toBeTruthy();
});

it('points the player at the results screen when there are none', async () => {
  stubApi([]);
  await render(<Favorites />);

  await waitFor(() => expect(screen.getByText(/No favorites yet/)).toBeTruthy());
  expect(screen.getByText(/results screen/)).toBeTruthy();
});

it('plays a favorite, and says so when it has no preview', async () => {
  stubApi([fav(1)]);
  await render(<Favorites />);
  await waitFor(() => screen.getByText('Play'));

  await fireEvent.press(screen.getByText('Play'));
  expect(mockToggle).toHaveBeenCalledWith('s1');

  mockFallback('s1');
  await waitFor(() => expect(screen.getByText('No preview available for this track.')).toBeTruthy());
});

it('removes a row when unfavorited', async () => {
  stubApi([fav(1), fav(2)]);
  await render(<Favorites />);
  await waitFor(() => screen.getByText('Song 1 — Artist 1'));

  await fireEvent.press(screen.getAllByText('Unfavorite')[0]);
  await waitFor(() => expect(screen.queryByText('Song 1 — Artist 1')).toBeNull());
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/submissions/s1/favorite'), expect.anything());
  expect(screen.getByText('Song 2 — Artist 2')).toBeTruthy();
});

it('keeps the row when unfavoriting fails', async () => {
  stubApi([fav(3)], 500);
  await render(<Favorites />);
  await waitFor(() => screen.getByText('Song 3 — Artist 3'));
  await fireEvent.press(screen.getByText('Unfavorite'));
  await waitFor(() => expect(screen.getByText(/Couldn't update your favorite/)).toBeTruthy());
  expect(screen.getByText('Song 3 — Artist 3')).toBeTruthy();
});

it('exports, then shows a link to the playlist and the removal caveat', async () => {
  stubApi([fav(1)], 200, null, exported({ playlistUrl: 'https://music.youtube.com/playlist?list=PL1' }));
  await render(<Favorites />);
  await waitFor(() => screen.getByText('Export to YouTube Music'));
  expect(screen.queryByText('Open playlist')).toBeNull();

  await fireEvent.press(screen.getByText('Export to YouTube Music'));
  await waitFor(() => screen.getByText('Open playlist'));
  await fireEvent.press(screen.getByText('Open playlist'));
  expect(mockOpenURL).toHaveBeenCalledWith('https://music.youtube.com/playlist?list=PL1');
  expect(screen.getByText(/does not remove it from/)).toBeTruthy();
  expect(screen.getByText('Export again')).toBeTruthy();
});

it('offers the existing playlist before any export', async () => {
  stubApi([fav(1)], 200, 'https://music.youtube.com/playlist?list=PL0');
  await render(<Favorites />);
  await waitFor(() => screen.getByText('Open playlist'));
  expect(screen.getByText('Export again')).toBeTruthy();
});

it('says so when the export fails', async () => {
  stubApi([fav(1)], 200, null, exported({ status: 'failed' }));
  await render(<Favorites />);
  await waitFor(() => screen.getByText('Export to YouTube Music'));
  await fireEvent.press(screen.getByText('Export to YouTube Music'));
  await waitFor(() => expect(screen.getByText(/Couldn’t build the YouTube Music playlist/)).toBeTruthy());
});

it('says so when nothing matched', async () => {
  stubApi([fav(1)], 200, null, exported({ status: 'no_matches' }));
  await render(<Favorites />);
  await waitFor(() => screen.getByText('Export to YouTube Music'));
  await fireEvent.press(screen.getByText('Export to YouTube Music'));
  await waitFor(() => expect(screen.getByText(/None of your favorites were on YouTube Music/)).toBeTruthy());
});

it('lists skipped tracks with their playback links', async () => {
  stubApi(
    [fav(1)],
    200,
    null,
    exported({
      playlistUrl: 'https://music.youtube.com/playlist?list=PL1',
      skipped: [
        { submissionId: 's9', title: 'Lost', artist: 'Band', playback: { service: 'bandcamp', deepLink: 'https://b.example/lost' } },
      ],
    }),
  );
  await render(<Favorites />);
  await waitFor(() => screen.getByText('Export to YouTube Music'));
  await fireEvent.press(screen.getByText('Export to YouTube Music'));
  await waitFor(() => screen.getByText('Lost — Band'));
  await fireEvent.press(screen.getByText('Open track'));
  expect(mockOpenURL).toHaveBeenCalledWith('https://b.example/lost');
});

it('shows an error when the export request dies', async () => {
  stubApi([fav(1)]);
  await render(<Favorites />);
  await waitFor(() => screen.getByText('Export to YouTube Music'));
  await fireEvent.press(screen.getByText('Export to YouTube Music'));
  await waitFor(() => expect(screen.getByText(/Couldn't export your favorites/)).toBeTruthy());
});
