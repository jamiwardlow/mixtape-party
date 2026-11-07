import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SubmitTrack from '../round/[roundId]/submit';

const mockReplace = jest.fn();
let mockParams: Record<string, string> = { roundId: 'round-1' };

jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'tok-1' }),
}));

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

const searchResults = {
  results: [{ externalId: 'vid-1', title: 'Feeling Good', artist: 'Nina Simone', playback: { service: 'youtube_music', deepLink: 'https://music.youtube.com/watch?v=vid-1' } }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { roundId: 'round-1' };
  globalThis.fetch = jest.fn(async (url: string) =>
    ok(
      String(url).includes('/search')
        ? searchResults
        : String(url).includes('/overview')
          ? { round: { you: { submission: { submissionId: 's1', playback: { deepLink: 'https://music.youtube.com/watch?v=x' }, service: 'youtube_music', title: 'Feeling Good', artist: 'Nina Simone' } } } }
          : { submissionId: 'sub-1' },
    ),
  ) as unknown as typeof fetch;
});

function lastPost() {
  const posts = (fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'POST');
  return JSON.parse(posts[posts.length - 1][1].body);
}

// The chip row used to be built from the player's linked services, which are always none -- so
// the search branch below this never rendered and only Bandcamp was ever offered.
describe('service chips', () => {
  it('offers both services without asking what the player has linked', async () => {
    await render(<SubmitTrack />);

    expect(screen.getByText('Search YouTube Music')).toBeTruthy();
    expect(screen.getByText('Paste a link from Bandcamp')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  // PRODUCT.md principle 3: the app picks no side between services.
  it('preselects nothing, so neither input is on screen at mount', async () => {
    await render(<SubmitTrack />);

    expect(screen.queryByPlaceholderText('Search for a track')).toBeNull();
    expect(screen.queryByPlaceholderText('Bandcamp track/album URL')).toBeNull();
    expect(screen.getByText('Pick a service to submit from.')).toBeTruthy();
  });
});

describe('search and submit', () => {
  it('searches the chosen service and lists what comes back', async () => {
    await render(<SubmitTrack />);

    await fireEvent.press(screen.getByText('Search YouTube Music'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search for a track'), 'nina simone');
    await fireEvent.press(screen.getByText('Search'));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/search?q=nina%20simone&service=youtube_music'),
      expect.anything(),
    );
    await waitFor(() => expect(screen.getByText('Feeling Good')).toBeTruthy());
    expect(screen.getByText('Nina Simone')).toBeTruthy();
  });

  it('submits a search result under the service it came from', async () => {
    await render(<SubmitTrack />);

    await fireEvent.press(screen.getByText('Search YouTube Music'));
    await fireEvent.changeText(screen.getByPlaceholderText(/Add a comment/), 'my fave');
    await fireEvent.changeText(screen.getByPlaceholderText('Search for a track'), 'nina simone');
    await fireEvent.press(screen.getByText('Search'));
    await waitFor(() => expect(screen.getAllByText('Submit').at(-1)!).toBeTruthy());
    await fireEvent.press(screen.getAllByText('Submit').at(-1)!);

    expect(lastPost()).toEqual({
      service: 'youtube_music',
      comment: 'my fave',
      externalId: 'vid-1',
      title: 'Feeling Good',
      artist: 'Nina Simone',
    });
  });

  it('stays on the screen after submitting and shows the new track as current', async () => {
    await render(<SubmitTrack />);

    await fireEvent.press(screen.getByText('Search YouTube Music'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search for a track'), 'nina simone');
    await fireEvent.press(screen.getByText('Search'));
    await waitFor(() => expect(screen.getAllByText('Submit').at(-1)!).toBeTruthy());
    await fireEvent.press(screen.getAllByText('Submit').at(-1)!);

    await waitFor(() => expect(screen.getByTestId('current-track')).toBeTruthy());
    expect(screen.getByText('Your pick')).toBeTruthy();
    expect(screen.getByText('Preview', { exact: false })).toBeTruthy();
    expect(screen.getByText('Edit your track')).toBeTruthy();
  });

  // A search that dies reports a 503. The player gets told, rather than staring at an empty result list.
  it('says so when the service reports search unavailable', async () => {
    (fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ error: 'search unavailable' }), { status: 503 }));
    await render(<SubmitTrack />);

    await fireEvent.press(screen.getByText('Search YouTube Music'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search for a track'), 'nina simone');
    await fireEvent.press(screen.getByText('Search'));

    await waitFor(() => expect(screen.getByText('Search unavailable right now')).toBeTruthy());
  });

  it('still takes a pasted Bandcamp URL', async () => {
    await render(<SubmitTrack />);

    await fireEvent.press(screen.getByText('Paste a link from Bandcamp'));
    await fireEvent.changeText(
      screen.getByPlaceholderText('Bandcamp track/album URL'),
      'https://band.bandcamp.com/track/song',
    );
    await fireEvent.press(screen.getAllByText('Submit').at(-1)!);

    expect(lastPost()).toEqual({ service: 'bandcamp', comment: '', url: 'https://band.bandcamp.com/track/song' });
  });

  it('tells the player to paste the embed code when Bandcamp is blocked', async () => {
    globalThis.fetch = jest.fn(async () => new Response('{"error":"bandcamp unavailable"}', { status: 503 })) as unknown as typeof fetch;
    await render(<SubmitTrack />);

    await fireEvent.press(screen.getByText('Paste a link from Bandcamp'));
    await fireEvent.changeText(screen.getByPlaceholderText('Bandcamp track/album URL'), 'https://band.example.org/x');
    await fireEvent.press(screen.getAllByText('Submit').at(-1)!);

    await waitFor(() => expect(screen.getByText(/paste the embed code/)).toBeTruthy());
  });

  it('reads the Bandcamp page on the device when the server is bot-walled (503)', async () => {
    const tralbum = JSON.stringify({ id: 7, item_type: 'track', art_id: 9, artist: 'Band &amp; Co', current: { title: 'Song' } }).replace(/"/g, '&quot;');
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('https://band.bandcamp.com')) return new Response(`<div data-tralbum="${tralbum}"></div>`);
      if (String(url).includes('/overview')) return ok({ round: { you: { submission: null } } });
      const sent = JSON.parse(String(init?.body ?? '{}'));
      return sent.url ? new Response('{"error":"bandcamp unavailable"}', { status: 503 }) : ok({ submissionId: 's' });
    }) as unknown as typeof fetch;
    await render(<SubmitTrack />);

    await fireEvent.press(screen.getByText('Paste a link from Bandcamp'));
    await fireEvent.changeText(screen.getByPlaceholderText('Bandcamp track/album URL'), 'https://band.bandcamp.com/track/song');
    await fireEvent.press(screen.getAllByText('Submit').at(-1)!);

    await waitFor(() =>
      expect(lastPost()).toEqual({ service: 'bandcamp', comment: '', externalId: 'track=7', title: 'Song', artist: 'Band & Co', artId: 9 }),
    );
  });
});

describe('result rows', () => {
  // iPhone Safari pushed Submit off-screen: a flex child won't shrink below its longest word without minWidth: 0.
  it('lets a long title shrink and keeps Submit on screen', async () => {
    const long = 'Everything In Its Right Place — Radiohead (Remastered 2009) [Official Video]' + 'x'.repeat(80);
    (fetch as jest.Mock).mockImplementation(async () => ok({ results: [{ externalId: 'v', title: long, artist: 'Radiohead', playback: { service: 'youtube_music', deepLink: 'https://music.youtube.com/watch?v=v' } }] }));
    await render(<SubmitTrack />);

    await fireEvent.press(screen.getByText('Search YouTube Music'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search for a track'), 'radiohead');
    await fireEvent.press(screen.getByText('Search'));

    await waitFor(() => expect(screen.getByTestId('result-text')).toBeTruthy());
    expect(StyleSheet.flatten(screen.getByTestId('result-text').props.style)).toMatchObject({ flex: 1, minWidth: 0 });
    expect(screen.getAllByText('Submit').length).toBeGreaterThan(0);
    expect(screen.queryByText('YouTube Music')).toBeNull();
  });
});

describe('Your pick', () => {
  it('Change brings the search back and a new submit posts again', async () => {
    mockParams = { roundId: 'round-1', edit: '1' };
    await render(<SubmitTrack />);
    await waitFor(() => expect(screen.getByText('Your pick')).toBeTruthy());
    expect(screen.queryByPlaceholderText('Search for a track')).toBeNull();

    await fireEvent.press(screen.getByText('Change'));
    await fireEvent.press(screen.getByText('Search YouTube Music'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search for a track'), 'nina');
    await fireEvent.press(screen.getByText('Search'));
    await waitFor(() => expect(screen.getAllByText('Submit').at(-1)!).toBeTruthy());
    await fireEvent.press(screen.getAllByText('Submit').at(-1)!);

    expect(lastPost()).toMatchObject({ service: 'youtube_music', externalId: 'vid-1' });
  });
});

describe('Your pick, backing out', () => {
  it('Keep my pick returns to the card without submitting', async () => {
    mockParams = { roundId: 'round-1', edit: '1' };
    await render(<SubmitTrack />);
    await waitFor(() => expect(screen.getByText('Your pick')).toBeTruthy());

    await fireEvent.press(screen.getByText('Change'));
    await fireEvent.press(screen.getByText('Keep my pick'));

    expect(screen.getByText('Your pick')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Search for a track')).toBeNull();
  });
});

describe('editing', () => {
  it('shows the current track and saves just the comment', async () => {
    mockParams = { roundId: 'round-1', edit: '1' };
    const mine = { submissionId: 's2', playback: { deepLink: 'https://old.bandcamp.com/track/old' }, service: 'bandcamp', title: 'Old Song', artist: 'Old Band', comment: 'first take' };
    globalThis.fetch = jest.fn(async (_url: string, init?: { method?: string }) =>
      ok(init?.method === 'PATCH' ? {} : { round: { you: { submission: mine } } }),
    ) as unknown as typeof fetch;
    await render(<SubmitTrack />);

    await waitFor(() => expect(screen.getByText('Old Song')).toBeTruthy());
    const box = screen.getByPlaceholderText(/Add a comment/);
    expect(box.props.value).toBe('first take');
    await fireEvent.changeText(box, 'second take');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    const [url, init] = (fetch as jest.Mock).mock.calls.at(-1);
    expect(url).toContain('/rounds/round-1/submissions/mine');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ comment: 'second take' });
  });
});
