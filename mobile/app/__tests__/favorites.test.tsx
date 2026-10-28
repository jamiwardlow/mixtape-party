import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Favorites from '../favorites';

const mockToggle = jest.fn();
let mockFallback: (id: string) => void;

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

function stubApi(favorites: unknown[], favoriteStatus = 200) {
  globalThis.fetch = jest.fn(async (url: string) =>
    String(url).endsWith('/favorite')
      ? new Response(JSON.stringify({ favorited: false }), { status: favoriteStatus })
      : new Response(JSON.stringify({ favorites }), { status: 200 }),
  ) as unknown as typeof fetch;
}

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
