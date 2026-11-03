import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import RoundResults from '../round/[roundId]/results';

// The native audio module isn't available under jest; lib/__tests__/preview.test.ts covers the player.
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn() }));

const mockOpenURL = jest.fn();
let mockFocus: string | undefined;

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({ roundId: 'round-1', focus: mockFocus }),
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'tok-1' }),
}));

jest.spyOn(Linking, 'openURL').mockImplementation((...args: [string]) => mockOpenURL(...args));

const results = { tracks: [], scores: [], winners: [] };

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

/** Answers the results GET, then the export POST the results screen fires behind it. */
function stubApi(exportBody: unknown, exportStatus = 200) {
  globalThis.fetch = jest.fn(async (url: string) =>
    String(url).includes('/export') ? new Response(JSON.stringify(exportBody), { status: exportStatus }) : ok(results),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocus = undefined;
});

describe('track row', () => {
  it('links the title out to the service and looks the preview up by submission', async () => {
    const track = {
      submissionId: 's1', service: 'youtube_music', title: 'T', artist: 'A', thumbnailUrl: 'https://img/x.jpg',
      playback: { deepLink: 'ytmusic://x', webUrl: 'https://music.youtube.com/watch?v=x' },
      comment: null, submitter: { accountId: 'u1', displayName: 'Sam' }, correctGuessers: [], reactions: [], yourGuess: null, comments: [],
    };
    globalThis.fetch = jest.fn(async (url: string) =>
      String(url).includes('/export') ? ok({ services: [] }) : String(url).includes('/preview') ? ok({ url: null }) : ok({ ...results, tracks: [track] }),
    ) as unknown as typeof fetch;
    await render(<RoundResults />);

    await fireEvent.press(await screen.findByText('T — A'));
    expect(mockOpenURL).toHaveBeenCalledWith('https://music.youtube.com/watch?v=x');

    mockOpenURL.mockClear();
    await fireEvent.press(screen.getByLabelText('Play preview of T'));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/submissions/s1/preview'), expect.anything()));
    // No preview: falls back to opening the service.
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledWith('https://music.youtube.com/watch?v=x'));
  });
});

describe('track row without art', () => {
  it('still has a play button (Bandcamp has no thumbnail)', async () => {
    const track = {
      submissionId: 's2', service: 'bandcamp', title: 'B', artist: 'A', thumbnailUrl: null, playback: { deepLink: 'x://b' },
      comment: null, submitter: { accountId: 'u1', displayName: 'Sam' }, correctGuessers: [], reactions: [], yourGuess: null, comments: [],
    };
    globalThis.fetch = jest.fn(async (url: string) =>
      String(url).includes('/export') ? ok({ services: [] }) : String(url).includes('/preview') ? ok({ url: null }) : ok({ ...results, tracks: [track] }),
    ) as unknown as typeof fetch;
    await render(<RoundResults />);
    await fireEvent.press(await screen.findByLabelText('Play preview of B'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledWith('x://b'));
  });
});

describe('exported playlist links', () => {
  it('triggers the export and opens the link the API built', async () => {
    stubApi({
      services: [
        { service: 'youtube_music', status: 'ok', playlistUrl: 'https://music.youtube.com/playlist?list=PL1' },
      ],
    });
    await render(<RoundResults />);

    await waitFor(() => expect(screen.getByText('Playlists')).toBeTruthy());
    expect(screen.getByText('YouTube Music')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rounds/round-1/export'),
      expect.objectContaining({ method: 'POST' }),
    );

    await fireEvent.press(screen.getByText('Open playlist'));
    expect(mockOpenURL).toHaveBeenCalledWith('https://music.youtube.com/playlist?list=PL1');
  });

  it('shows no link for a service whose export built no playlist', async () => {
    stubApi({ services: [{ service: 'youtube_music', status: 'no_matches', playlistUrl: null }] });
    await render(<RoundResults />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Playlists')).toBeNull();
    expect(screen.getByText(/none of this round.s tracks were on YouTube Music/i)).toBeTruthy();
  });

  // A dead export must not take the results down with it -- the scores are the point of the screen.
  it('still shows the results when the export fails', async () => {
    stubApi({ error: 'nope' }, 503);
    await render(<RoundResults />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Playlists')).toBeNull();
    expect(screen.getAllByText('Results')[0]).toBeTruthy();
  });
});

// #73: an export that fails used to render exactly like one that succeeded with nothing to show --
// silence -- so a failed export had no way to say why the playlist never appeared.
describe('failed export', () => {
  // YouTube Music exports through one app-owned account, so its failure is not the user's to fix.
  it('reports a failure as retryable', async () => {
    stubApi({ services: [{ service: 'youtube_music', status: 'failed', playlistUrl: null }] });
    await render(<RoundResults />);

    expect(await screen.findByText(/couldn.t build the YouTube Music playlist/i)).toBeTruthy();
    expect(screen.getAllByText('Results')[0]).toBeTruthy();
  });
});

describe('comment threads', () => {
  it('shows a guesser’s comment and posts a reply to it', async () => {
    const track = {
      submissionId: 's1',
      service: 'youtube_music',
      title: 'T',
      artist: 'A',
      playback: { deepLink: 'x://t' },
      comment: null,
      submitter: { accountId: 'u1', displayName: 'Sam' },
      correctGuessers: [],
      reactions: [],
      yourGuess: null,
      comments: [
        {
          guessId: 'g1',
          guesser: { accountId: 'u2', displayName: 'Kim' },
          mine: false,
          comment: 'so Sam',
          reactions: [{ emoji: '🔥', count: 2, mine: true }],
          replies: [],
        },
      ],
    };
    globalThis.fetch = jest.fn(async (url: string) =>
      String(url).includes('/export')
        ? new Response(JSON.stringify({ services: [] }), { status: 200 })
        : ok({ ...results, tracks: [track] }),
    ) as unknown as typeof fetch;
    await render(<RoundResults />);

    // Folded until asked for.
    await fireEvent.press(await screen.findByText('▸ 1 comment'));
    expect(screen.getByText('▾ 1 comment')).toBeTruthy();
    expect(screen.getByText('“so Sam”')).toBeTruthy();
    expect(screen.getByText('🔥 2 ✓')).toBeTruthy();

    // Block lives on the profile; the comment only gets a quiet Report.
    expect(screen.queryByText('Block')).toBeNull();
    await fireEvent.press(screen.getByText('Report'));
    expect(screen.getByText(/This comment/)).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText('Reply'), 'agreed');
    await fireEvent.press(screen.getByText('Send reply'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/guesses/g1/replies'),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: 'agreed' }) }),
      ),
    );
  });

  it('nests replies under replies, and lets you delete only your own', async () => {
    const reply = (replyId: string, parentReplyId: string | null, mine: boolean, body: string) => ({
      replyId, parentReplyId, mine, author: { accountId: 'u9', displayName: 'Pat' }, body, createdAt: '', reactions: [],
    });
    const track = {
      submissionId: 's1', service: 'youtube_music', title: 'T', artist: 'A', playback: { deepLink: 'x://t' }, comment: null,
      submitter: { accountId: 'u1', displayName: 'Sam' }, correctGuessers: [], reactions: [], yourGuess: null,
      comments: [{
        guessId: 'g1', guesser: { accountId: 'u2', displayName: 'Kim' }, mine: false, comment: 'so Sam', reactions: [],
        replies: [reply('r1', null, false, 'first'), reply('r2', 'r1', true, 'nested')],
      }],
    };
    globalThis.fetch = jest.fn(async (url: string) =>
      String(url).includes('/export')
        ? new Response(JSON.stringify({ services: [] }), { status: 200 })
        : ok({ ...results, tracks: [track] }),
    ) as unknown as typeof fetch;
    await render(<RoundResults />);

    await fireEvent.press(await screen.findByText('▸ 1 comment'));
    expect(await screen.findByText('nested')).toBeTruthy();
    expect(screen.getAllByText('Delete')).toHaveLength(1);
    await fireEvent.press(screen.getByText('Delete'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/replies/r2'), expect.objectContaining({ method: 'DELETE' })),
    );
  });
});

describe('favorite heart', () => {
  const track = {
    submissionId: 's1', service: 'youtube_music', title: 'T', artist: 'A', playback: { deepLink: 'x://t' }, comment: null,
    submitter: { accountId: 'u1', displayName: 'Sam' }, correctGuessers: [], reactions: [], yourGuess: null,
    comments: [], favorited: false,
  };

  /** Serves the results (with the favorite state the "server" holds) and answers the toggle with `favoriteStatus`. */
  function stubFavorite(favoriteStatus: number) {
    let favorited = track.favorited;
    globalThis.fetch = jest.fn(async (url: string, init?: { method?: string }) => {
      if (String(url).includes('/export')) return ok({ services: [] });
      if (String(url).includes('/favorite')) {
        if (favoriteStatus === 200) favorited = !favorited;
        return new Response(JSON.stringify({ favorited }), { status: favoriteStatus });
      }
      return ok({ ...results, tracks: [{ ...track, favorited }] });
    }) as unknown as typeof fetch;
  }

  it('toggles the favorite and says which state it is in', async () => {
    stubFavorite(200);
    await render(<RoundResults />);

    await fireEvent.press(await screen.findByLabelText('Not favorited'));

    expect(await screen.findByLabelText('Favorited')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/submissions/s1/favorite'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('restores the heart and says so when the call fails', async () => {
    stubFavorite(500);
    await render(<RoundResults />);

    await fireEvent.press(await screen.findByLabelText('Not favorited'));

    expect(await screen.findByText(/couldn.t update your favorite/i)).toBeTruthy();
    expect(screen.getByLabelText('Not favorited')).toBeTruthy();
  });

  it('ignores a second tap while the first is still in flight', async () => {
    stubFavorite(200);
    const answer = (fetch as jest.Mock).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    (fetch as jest.Mock).mockImplementation(async (url: string, init?: object) => {
      if (String(url).includes('/favorite')) await gate;
      return answer(url, init);
    });
    await render(<RoundResults />);
    const heart = await screen.findByLabelText('Not favorited');

    // Not awaited: the handler's promise is the gated request, and press() would wait on it.
    fireEvent.press(heart);
    await waitFor(() => expect(screen.getByLabelText('Favorited')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Favorited'));
    release();

    await waitFor(() => expect(screen.getByLabelText('Favorited')).toBeTruthy());
    const posts = (fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/favorite'));
    expect(posts).toHaveLength(1);
  });
});

describe('podium', () => {
  const p = (accountId: string, displayName: string, score: number) => ({ accountId, displayName, score });

  async function renderWith(scores: ReturnType<typeof p>[], winners: { accountId: string; displayName: string }[]) {
    globalThis.fetch = jest.fn(async (url: string) =>
      String(url).includes('/export') ? ok({ services: [] }) : ok({ tracks: [], scores, winners }),
    ) as unknown as typeof fetch;
    await render(<RoundResults />);
  }

  it('names the winner and lists players past third below the podium', async () => {
    const scores = [p('a', 'Maya', 7), p('b', 'Sam', 5), p('c', 'Jo', 3), p('d', 'Kim', 1)];
    await renderWith(scores, [scores[0]]);

    expect(await screen.findByText(/Maya takes the round/)).toBeTruthy();
    expect(screen.getByText('7 pts')).toBeTruthy();
    expect(screen.getByText('Kim')).toBeTruthy();
  });

  it('handles a tie and a lone player', async () => {
    const scores = [p('a', 'Maya', 7), p('b', 'Sam', 7)];
    await renderWith(scores, scores);
    expect(await screen.findByText(/Maya, Sam take the round/)).toBeTruthy();
  });
});

describe('reactions and the fold', () => {
  const track = {
    submissionId: 's1', service: 'youtube_music', title: 'T', artist: 'A', playback: { deepLink: 'x://t' }, comment: null,
    submitter: { accountId: 'u1', displayName: 'Sam' }, correctGuessers: [], reactions: [{ emoji: '🔥', count: 1, mine: false }],
    yourGuess: null, favorited: false,
    comments: [{
      guessId: 'g1', guesser: { accountId: 'u2', displayName: 'Kim' }, mine: false, comment: 'so Sam', reactions: [],
      replies: [{ replyId: 'r1', parentReplyId: null, mine: false, author: { accountId: 'u9', displayName: 'Pat' }, body: 'deep reply', createdAt: '', reactions: [] }],
    }],
  };
  function stub() {
    globalThis.fetch = jest.fn(async (url: string) =>
      String(url).includes('/export') ? ok({ services: [] }) : ok({ ...results, tracks: [track] }),
    ) as unknown as typeof fetch;
  }

  it('adds a reaction from the tray, then closes it', async () => {
    stub();
    await render(<RoundResults />);

    expect(screen.queryByPlaceholderText('Any emoji')).toBeNull();
    await fireEvent.press(await screen.findByLabelText('Add reaction'));
    await fireEvent.press(screen.getByLabelText('React 🎧'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/submissions/s1/reactions'),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ emoji: '🎧' }) }),
      ),
    );
    expect(screen.queryByLabelText('React 🎧')).toBeNull();
  });

  it('takes any typed emoji', async () => {
    stub();
    await render(<RoundResults />);

    await fireEvent.press(await screen.findByLabelText('Add reaction'));
    await fireEvent.press(screen.getByText('Any emoji'));
    const input = screen.getByPlaceholderText('Any emoji');
    await fireEvent.changeText(input, '🦄');
    await fireEvent(input, 'submitEditing');

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/submissions/s1/reactions'),
        expect.objectContaining({ body: JSON.stringify({ emoji: '🦄' }) }),
      ),
    );
  });

  it('keeps replies folded until the toggle, and opens on its own for a focus link', async () => {
    stub();
    const { unmount } = await render(<RoundResults />);
    await screen.findByText('▸ 1 comment');
    expect(screen.queryByText('deep reply')).toBeNull();
    unmount();

    mockFocus = 'r1';
    await render(<RoundResults />);
    expect(await screen.findByText('deep reply')).toBeTruthy();
    expect(screen.getByText('▾ 1 comment')).toBeTruthy();
  });
});
