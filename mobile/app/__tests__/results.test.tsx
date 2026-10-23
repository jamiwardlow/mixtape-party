import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import RoundResults from '../round/[roundId]/results';

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
    expect(screen.getByText('Results')).toBeTruthy();
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
    expect(screen.getByText('Results')).toBeTruthy();
  });
});
