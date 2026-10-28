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

describe('guess screen editing', () => {
  it('lets a player change an existing guess without resending the comment', async () => {
    const track = {
      submissionId: 's1', service: 'youtube_music', title: 'Song', artist: 'Artist',
      playback: { deepLink: 'ytm://s1' }, guessedAccountId: 'a1', comment: 'groovy',
    };
    const players = [{ accountId: 'a1', displayName: 'Ann' }, { accountId: 'a2', displayName: 'Bo' }];
    globalThis.fetch = jest.fn(async (url: string, init?: { method?: string }) =>
      String(url).includes('/export')
        ? new Response(JSON.stringify({ services: [] }), { status: 200 })
        : init?.method === 'POST'
          ? new Response(JSON.stringify({ guessId: 'g1' }), { status: 200 })
          : new Response(JSON.stringify({ tracks: [track], players }), { status: 200 }),
    ) as unknown as typeof fetch;
    await render(<GuessRound />);

    await fireEvent.press(await screen.findByText('Bo'));

    await waitFor(() => expect(screen.getByText('Guessed:')).toBeTruthy());
    expect(screen.getAllByText('Bo').length).toBeGreaterThan(0);
    const post = (fetch as jest.Mock).mock.calls.find(([url, init]) => String(url).endsWith('/guesses') && init?.method === 'POST');
    expect(JSON.parse(post[1].body)).toEqual({ guessedAccountId: 'a2' });
  });
});

describe('guess screen own track', () => {
  it('shows your track with a note box and no player buttons, and saves the note', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/export')) return new Response(JSON.stringify({ services: [] }), { status: 200 });
      if (String(url).endsWith('/mine/note')) return new Response(JSON.stringify({ note: 'hint' }), { status: 200 });
      return new Response(
        JSON.stringify({
          tracks: [
            {
              submissionId: 's1',
              service: 'youtube_music',
              title: 'Mine',
              artist: 'Me',
              thumbnailUrl: null,
              playback: { deepLink: 'x' },
              guessedAccountId: null,
              comment: null,
              mine: true,
            },
          ],
          players: [{ accountId: 'p1', displayName: 'Pat' }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    await render(<GuessRound />);

    await fireEvent.changeText(await screen.findByPlaceholderText(/Your track/), 'hint');
    await fireEvent.press(await screen.findByText('Save comment'));

    expect(screen.queryByText('Pat')).toBeNull();
    await waitFor(() => {
      const put = calls.find((c) => c.url.endsWith('/rounds/round-1/submissions/mine/note'));
      expect(put?.init?.method).toBe('PUT');
      expect(JSON.parse(String(put?.init?.body))).toEqual({ note: 'hint' });
    });
  });
});
