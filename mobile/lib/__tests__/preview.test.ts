import { act, renderHook } from '@testing-library/react-native';
import { fetchApi } from '../api';
import { PREVIEW_SECONDS, usePreview } from '../preview';

const mockPlayer = { play: jest.fn(), remove: jest.fn(), addListener: jest.fn() };
const mockCreate = jest.fn((_url: string) => mockPlayer);
jest.mock('expo-audio', () => ({ createAudioPlayer: (url: string) => mockCreate(url) }));
jest.mock('../api', () => ({ fetchApi: jest.fn() }));

const path = (id: string) => `/rounds/r1/submissions/${id}/preview`;
const previewIs = (url: string | null) =>
  (fetchApi as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ url }) });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

it('plays the preview in the app, not the link', async () => {
  previewIs('https://cdn/p.mp3');
  const fallback = jest.fn();
  const { result } = await renderHook(() => usePreview(path, 'tok', fallback));

  await act(() => result.current.toggle('s1'));

  expect(fetchApi).toHaveBeenCalledWith('/rounds/r1/submissions/s1/preview', { token: 'tok' });
  expect(mockCreate).toHaveBeenCalledWith('https://cdn/p.mp3');
  expect(mockPlayer.play).toHaveBeenCalled();
  expect(result.current.playingId).toBe('s1');
  expect(fallback).not.toHaveBeenCalled();
});

it('falls back to the link when there is no preview', async () => {
  previewIs(null);
  const fallback = jest.fn();
  const { result } = await renderHook(() => usePreview(path, 'tok', fallback));

  await act(() => result.current.toggle('s1'));

  expect(fallback).toHaveBeenCalledWith('s1');
  expect(mockCreate).not.toHaveBeenCalled();
});

it('stops when toggled again, and cuts a full-length track at the preview length', async () => {
  previewIs('https://cdn/p.mp3');
  const { result } = await renderHook(() => usePreview(path, 'tok', jest.fn()));

  await act(() => result.current.toggle('s1'));
  await act(() => result.current.toggle('s1'));
  expect(result.current.playingId).toBeNull();

  await act(() => result.current.toggle('s1'));
  await act(async () => void jest.advanceTimersByTime(PREVIEW_SECONDS * 1000));
  expect(result.current.playingId).toBeNull();
  expect(mockPlayer.remove).toHaveBeenCalledTimes(2);
});

it('ignores a slow lookup that a later tap has superseded', async () => {
  let resolveFirst!: (r: unknown) => void;
  (fetchApi as jest.Mock)
    .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://cdn/second.mp3' }) });
  const { result } = await renderHook(() => usePreview(path, 'tok', jest.fn()));

  let first!: Promise<void>;
  act(() => void (first = result.current.toggle('s1')));
  await act(() => result.current.toggle('s2'));
  await act(async () => {
    resolveFirst({ ok: true, json: async () => ({ url: 'https://cdn/first.mp3' }) });
    await first;
  });

  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledWith('https://cdn/second.mp3');
});
