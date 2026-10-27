import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import GuessRound from '../round/[roundId]/guess';

const mockOpenURL = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({ roundId: 'round-1' }),
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'tok-1' }),
}));

jest.mock('expo-linking', () => ({
  openURL: (...args: unknown[]) => mockOpenURL(...args),
}));

const guessing = { tracks: [], players: [] };

function stubApi(playlistUrl: string | null) {
  globalThis.fetch = jest.fn(async (url: string) =>
    String(url).includes('/export')
      ? new Response(JSON.stringify({ services: [{ service: 'youtube_music', playlistUrl }] }), { status: 200 })
      : new Response(JSON.stringify(guessing), { status: 200 }),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('guess screen playlist link', () => {
  it('opens the round playlist', async () => {
    stubApi('https://music.youtube.com/playlist?list=PL1');
    await render(<GuessRound />);

    await fireEvent.press(await screen.findByText('Open playlist'));
    expect(mockOpenURL).toHaveBeenCalledWith('https://music.youtube.com/playlist?list=PL1');
  });

  it('shows no link when there is no playlist', async () => {
    stubApi(null);
    await render(<GuessRound />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Open playlist')).toBeNull();
  });
});
