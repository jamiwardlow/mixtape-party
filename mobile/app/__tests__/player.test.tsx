import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Player from '../player/[id]';

const mockPush = jest.fn();
let mockMe = 'me-id';
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: (...a: unknown[]) => mockPush(...a) },
  useLocalSearchParams: () => ({ id: 'p1' }),
}));
jest.mock('../../lib/session', () => ({ useSession: () => ({ token: 'tok', profile: { id: mockMe } }) }));

const body = {
  accountId: 'p1',
  displayName: 'Sam',
  avatarUrl: null,
  pronouns: 'they/them',
  aboutMe: 'Hello there',
  leagues: [{ name: 'Mix Club', concluded: false, seasonLength: 5, joinedAt: '2026-01-01T00:00:00Z' }],
  favorites: [{ submissionId: 's1', leagueName: 'Mix Club', roundTheme: 'Rain', service: 'youtube_music', title: 'Song', artist: 'Artist' }],
  besties: { guessedMe: [{ accountId: 'b1', displayName: 'Bo', count: 2 }], iGuessed: [] },
};

const stub = (status: number, json: unknown = body) => {
  globalThis.fetch = jest.fn(async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = 'me-id';
});

it('renders every section read-only for another player', async () => {
  stub(200);
  await render(<Player />);
  await waitFor(() => expect(screen.getByText('Sam')).toBeTruthy());
  expect(screen.getByText('they/them')).toBeTruthy();
  expect(screen.getByText('Hello there')).toBeTruthy();
  expect(screen.getByText('Song — Artist')).toBeTruthy();
  expect(screen.getByText(/Mix Club · 5 rounds/)).toBeTruthy();
  expect(screen.getByText('Bo')).toBeTruthy();
  expect(screen.queryByText('Unfavorite')).toBeNull();
  expect(screen.queryByText('Play')).toBeNull();
  expect(screen.queryByText('Edit on My Account')).toBeNull();
});

it('shows empty states', async () => {
  stub(200, { ...body, aboutMe: null, pronouns: null, leagues: [], favorites: [] });
  await render(<Player />);
  await waitFor(() => expect(screen.getByText('No favorites yet.')).toBeTruthy());
  expect(screen.getByText('Nothing here yet.')).toBeTruthy();
  expect(screen.getByText('No active leagues.')).toBeTruthy();
  expect(screen.getByText('No past leagues yet.')).toBeTruthy();
});

it('links your own profile to My Account', async () => {
  mockMe = 'p1';
  stub(200);
  await render(<Player />);
  fireEvent.press(await screen.findByText('Edit on My Account'));
  expect(mockPush).toHaveBeenCalledWith('/account');
});

it('opens a bestie\'s profile', async () => {
  stub(200);
  await render(<Player />);
  fireEvent.press(await screen.findByText('Bo'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/player/[id]', params: { id: 'b1' } });
});

it('says so when the player is not found', async () => {
  stub(404, { error: 'player not found' });
  await render(<Player />);
  await waitFor(() => expect(screen.getByText("Couldn't find that player.")).toBeTruthy());
});
