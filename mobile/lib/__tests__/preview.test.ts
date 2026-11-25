import { act, renderHook } from '@testing-library/react-native';
import { fetchBandcampPreview, openPlaybackLink } from '../bandcamp';
import { PREVIEW_SECONDS, usePreview } from '../preview';

const mockPlayer = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(), addListener: jest.fn() };
const mockCreate = jest.fn((_url: string) => mockPlayer);
jest.mock('expo-audio', () => ({
  createAudioPlayer: (url: string) => mockCreate(url),
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
}));
const mockApi = jest.fn();
jest.mock('../client', () => ({ useApi: () => mockApi }));
jest.mock('../bandcamp', () => ({ fetchBandcampPreview: jest.fn(), openPlaybackLink: jest.fn() }));

const path = (id: string) => `/rounds/r1/submissions/${id}/preview`;
const tracks = [{ submissionId: 's1', playback: { deepLink: 'x://s1', webUrl: 'https://s1' } }];
const previewIs = (url: string | null) =>
  mockApi.mockResolvedValue({ ok: true, data: { url } });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

it('plays the preview in the app, not the link', async () => {
  previewIs('https://cdn/p.mp3');
  const { result } = await renderHook(() => usePreview(path, tracks));

  await act(() => result.current.toggle('s1'));

  expect(mockApi).toHaveBeenCalledWith('/rounds/r1/submissions/s1/preview');
  expect(mockCreate).toHaveBeenCalledWith('https://cdn/p.mp3');
  expect(mockPlayer.play).toHaveBeenCalled();
  expect(result.current.playingId).toBe('s1');
  expect(openPlaybackLink).not.toHaveBeenCalled();
});

it('opens the track in its service when there is no preview', async () => {
  previewIs(null);
  const { result } = await renderHook(() => usePreview(path, tracks));

  await act(() => result.current.toggle('s1'));

  expect(openPlaybackLink).toHaveBeenCalledWith('https://s1');
  expect(mockCreate).not.toHaveBeenCalled();
});

it('reports a track with no preview and no link as unavailable', async () => {
  previewIs(null);
  const { result } = await renderHook(() => usePreview(path, null));

  await act(() => result.current.toggle('s1'));

  expect(result.current.unavailableId).toBe('s1');
  expect(openPlaybackLink).not.toHaveBeenCalled();
});

it('pauses before removing when stopped', async () => {
  previewIs('https://cdn/p.mp3');
  const { result } = await renderHook(() => usePreview(path, tracks));
  await act(async () => result.current.toggle('s1'));
  await act(async () => result.current.toggle('s1'));
  expect(mockPlayer.pause).toHaveBeenCalled();
});

it('stops when toggled again, and cuts a full-length track at the preview length', async () => {
  previewIs('https://cdn/p.mp3');
  const { result } = await renderHook(() => usePreview(path, tracks));

  await act(() => result.current.toggle('s1'));
  await act(() => result.current.toggle('s1'));
  expect(result.current.playingId).toBeNull();

  await act(() => result.current.toggle('s1'));
  await act(async () => void jest.advanceTimersByTime(PREVIEW_SECONDS * 1000));
  expect(result.current.playingId).toBeNull();
  expect(mockPlayer.remove).toHaveBeenCalledTimes(2);
});

it('reads the Bandcamp embed on the device when the server is bot-walled', async () => {
  mockApi.mockResolvedValue({ ok: true, data: { url: null, bandcampEmbedId: 'track=9' } });
  (fetchBandcampPreview as jest.Mock).mockResolvedValue('https://bc/p.mp3');
  const { result } = await renderHook(() => usePreview(path, tracks));

  await act(() => result.current.toggle('s1'));

  expect(fetchBandcampPreview).toHaveBeenCalledWith('track=9');
  expect(mockCreate).toHaveBeenCalledWith('https://bc/p.mp3');
});

it('ignores a slow lookup that a later tap has superseded', async () => {
  let resolveFirst!: (r: unknown) => void;
  mockApi
    .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
    .mockResolvedValueOnce({ ok: true, data: { url: 'https://cdn/second.mp3' } });
  const { result } = await renderHook(() => usePreview(path, tracks));

  let first!: Promise<void>;
  act(() => void (first = result.current.toggle('s1')));
  await act(() => result.current.toggle('s2'));
  await act(async () => {
    resolveFirst({ ok: true, data: { url: 'https://cdn/first.mp3' } });
    await first;
  });

  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledWith('https://cdn/second.mp3');
});
