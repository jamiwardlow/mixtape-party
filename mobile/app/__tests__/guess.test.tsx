import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import GuessRound from '../round/[roundId]/guess';

const mockOpenURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({ roundId: 'round-1' }),
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'tok-1' }),
}));

// The native audio module isn't available under jest; lib/__tests__/preview.test.ts covers the player.
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn() }));

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

describe('guess screen preview', () => {
  it('looks the preview up under the round, and opens the service when there is none', async () => {
    const track = {
      submissionId: 's1', service: 'youtube_music', title: 'Song', artist: 'Artist',
      playback: { deepLink: 'ytm://s1', webUrl: 'https://music.youtube.com/s1' }, guessedAccountId: null, comment: null,
    };
    globalThis.fetch = jest.fn(async (url: string) =>
      String(url).includes('/export')
        ? new Response(JSON.stringify({ services: [] }), { status: 200 })
        : String(url).includes('/preview')
          ? new Response(JSON.stringify({ url: null }), { status: 200 })
          : new Response(JSON.stringify({ tracks: [track], players: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    await render(<GuessRound />);

    await fireEvent.press(await screen.findByText('Play'));

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledWith('https://music.youtube.com/s1'));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rounds/round-1/submissions/s1/preview'),
      expect.anything(),
    );
  });
});
