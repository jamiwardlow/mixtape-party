import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import RoundResults from '../round/[roundId]/results';
import * as appleMusic from '../../lib/appleMusic';

const mockOpenURL = jest.fn();
const mockPush = jest.fn();
let mockProfile: { services?: { service: string }[] } | null;

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({ roundId: 'round-1' }),
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'tok-1', profile: mockProfile }),
}));

jest.mock('expo-linking', () => ({
  openURL: (...args: unknown[]) => mockOpenURL(...args),
}));

// Only the platform flag is stubbed -- isAppleMusicLinked is the thing under test here, so it stays
// real. __esModule matters: without it babel's interop hands the test a *copy* of the module object
// and jest.replaceProperty below would patch something the screen never reads.
jest.mock('../../lib/appleMusic', () => ({
  ...jest.requireActual('../../lib/appleMusic'),
  __esModule: true,
  appleMusicLinkingSupported: true,
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

// jest.replaceProperty is not undone by clearAllMocks -- without this, every test appended after
// the native one silently runs with appleMusicLinkingSupported false.
afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = { services: [{ service: 'apple_music' }] };
});

describe('exported playlist links', () => {
  it('triggers the export and opens the link the API built for each service', async () => {
    stubApi({
      services: [
        { service: 'youtube_music', status: 'ok', playlistUrl: 'https://music.youtube.com/playlist?list=PL1' },
        { service: 'apple_music', status: 'ok', playlistUrl: 'https://music.apple.com/library/playlist/p.1' },
      ],
    });
    await render(<RoundResults />);

    await waitFor(() => expect(screen.getByText('Playlists')).toBeTruthy());
    expect(screen.getByText('YouTube Music')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rounds/round-1/export'),
      expect.objectContaining({ method: 'POST' }),
    );

    // Per #11 each service keeps its own link, so there is one button per service, never a blend.
    const [youtubeMusic, appleMusic] = screen.getAllByText('Open playlist');
    await fireEvent.press(youtubeMusic);
    expect(mockOpenURL).toHaveBeenCalledWith('https://music.youtube.com/playlist?list=PL1');
    await fireEvent.press(appleMusic);
    expect(mockOpenURL).toHaveBeenCalledWith('https://music.apple.com/library/playlist/p.1');
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
// silence -- so a non-subscriber had no way to learn why their playlist never appeared.
describe('failed export', () => {
  it('names the likely cause when Apple Music refuses the account, without asserting it', async () => {
    stubApi({ services: [{ service: 'apple_music', status: 'denied', playlistUrl: null }] });
    await render(<RoundResults />);

    // Both of Apple's refusals land here and it never says which, so the line names both causes
    // and asserts neither.
    expect(await screen.findByText(/wouldn.t save the playlist, and doesn.t say why/i)).toBeTruthy();
    expect(await screen.findByText(/no active Apple Music subscription.*or the link needs redoing/i)).toBeTruthy();
    expect(screen.getByText('Results')).toBeTruthy();
  });

  // YouTube Music exports through one app-owned account, so its failure is not the user's to fix.
  it('does not tell a user to fix the app-owned YouTube Music account', async () => {
    stubApi({ services: [{ service: 'youtube_music', status: 'denied', playlistUrl: null }] });
    await render(<RoundResults />);

    expect(await screen.findByText(/couldn.t build the YouTube Music playlist/i)).toBeTruthy();
    expect(screen.queryByText(/subscription/i)).toBeNull();
  });

  it('reports a generic failure as retryable', async () => {
    stubApi({ services: [{ service: 'apple_music', status: 'failed', playlistUrl: null }] });
    await render(<RoundResults />);

    expect(await screen.findByText(/couldn.t build the Apple Music playlist/i)).toBeTruthy();
  });

  // The Link Apple Music card below already covers this one; a second line would just nag twice.
  it('stays quiet about a service that was never linked', async () => {
    mockProfile = { services: [] };
    stubApi({ services: [{ service: 'apple_music', status: 'not_linked', playlistUrl: null }] });
    await render(<RoundResults />);

    expect(await screen.findByText('Link Apple Music')).toBeTruthy();
    expect(screen.queryByText(/couldn.t build/i)).toBeNull();
  });

  // Still #67: whatever the export reports, it never stands between the user and the scores.
  it('keeps the other service’s link when one leg fails', async () => {
    stubApi({
      services: [
        { service: 'apple_music', status: 'denied', playlistUrl: null },
        { service: 'youtube_music', status: 'ok', playlistUrl: 'https://music.youtube.com/playlist?list=PL1' },
      ],
    });
    await render(<RoundResults />);

    expect(await screen.findByText('Playlists')).toBeTruthy();
    expect(screen.getByText(/Apple Music wouldn.t save the playlist/i)).toBeTruthy();
  });
});

describe('Apple Music prompt', () => {
  beforeEach(() => {
    mockProfile = { services: [] };
    stubApi({ services: [] });
  });

  // An offer, not a gate (#67): the results render alongside it, not instead of it.
  it('points an unlinked account at the linking screen without displacing the results', async () => {
    await render(<RoundResults />);

    expect(await screen.findByText('Results')).toBeTruthy();
    await fireEvent.press(await screen.findByText('Link Apple Music'));
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('stays quiet once Apple Music is linked', async () => {
    mockProfile = { services: [{ service: 'apple_music' }] };

    await render(<RoundResults />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Link Apple Music')).toBeNull();
  });

  // The profile lands after the token does, so a linked user would otherwise watch the prompt
  // appear and vanish.
  it('waits for the profile rather than assuming an unlinked account', async () => {
    mockProfile = null;

    await render(<RoundResults />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Link Apple Music')).toBeNull();
  });

  // /settings can only link on web, so off web the button would send the user to a dead end.
  it('stays off native, where the screen it points at cannot link', async () => {
    jest.replaceProperty(appleMusic, 'appleMusicLinkingSupported', false);

    await render(<RoundResults />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Link Apple Music')).toBeNull();
    expect(screen.getByText('Results')).toBeTruthy();
  });
});
