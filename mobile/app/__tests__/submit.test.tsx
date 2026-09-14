import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SubmitTrack from '../round/[roundId]/submit';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({ roundId: 'round-1' }),
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'tok-1' }),
}));

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

const searchResults = {
  results: [{ externalId: 'vid-1', title: 'Feeling Good', artist: 'Nina Simone' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = jest.fn(async (url: string) =>
    ok(String(url).includes('/search') ? searchResults : { submissionId: 'sub-1' }),
  ) as unknown as typeof fetch;
});

function lastPost() {
  const calls = (fetch as jest.Mock).mock.calls;
  return JSON.parse(calls[calls.length - 1][1].body);
}

// The chip row used to be built from the player's linked services, which are always none -- so
// the search branch below this never rendered and only Bandcamp was ever offered.
describe('service chips', () => {
  it('offers all three services without asking what the player has linked', async () => {
    await render(<SubmitTrack />);

    expect(screen.getByText('Apple Music')).toBeTruthy();
    expect(screen.getByText('YouTube Music')).toBeTruthy();
    expect(screen.getByText('Bandcamp')).toBeTruthy();
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

    await fireEvent.press(screen.getByText('YouTube Music'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search for a track'), 'nina simone');
    await fireEvent.press(screen.getByText('Search'));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/search?q=nina%20simone&service=youtube_music'),
      expect.anything(),
    );
    await waitFor(() => expect(screen.getByText('Feeling Good — Nina Simone')).toBeTruthy());
  });

  it('submits a search result under the service it came from', async () => {
    await render(<SubmitTrack />);

    await fireEvent.press(screen.getByText('YouTube Music'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search for a track'), 'nina simone');
    await fireEvent.press(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('Submit')).toBeTruthy());
    await fireEvent.press(screen.getByText('Submit'));

    expect(lastPost()).toEqual({
      service: 'youtube_music',
      externalId: 'vid-1',
      title: 'Feeling Good',
      artist: 'Nina Simone',
    });
  });

  // Apple Music search dies without app-level MusicKit credentials, which the API reports as a
  // 503. The player gets told, rather than staring at an empty result list.
  it('says so when the service reports search unavailable', async () => {
    (fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ error: 'search unavailable' }), { status: 503 }));
    await render(<SubmitTrack />);

    await fireEvent.press(screen.getByText('Apple Music'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search for a track'), 'nina simone');
    await fireEvent.press(screen.getByText('Search'));

    await waitFor(() => expect(screen.getByText('Search unavailable right now')).toBeTruthy());
  });

  it('still takes a pasted Bandcamp URL', async () => {
    await render(<SubmitTrack />);

    await fireEvent.press(screen.getByText('Bandcamp'));
    await fireEvent.changeText(
      screen.getByPlaceholderText('Bandcamp track/album URL'),
      'https://band.bandcamp.com/track/song',
    );
    await fireEvent.press(screen.getByText('Submit'));

    expect(lastPost()).toEqual({ service: 'bandcamp', url: 'https://band.bandcamp.com/track/song' });
  });
});
