import { renderHook } from '@testing-library/react-native';
import { useOpenTappedNotification } from '../notificationTap';

const mockPush = jest.fn();
let mockResponse: unknown = null;

jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('expo-notifications', () => ({ useLastNotificationResponse: () => mockResponse }));

const tapped = (data: object) => ({ notification: { request: { content: { data } } } });

beforeEach(() => {
  mockPush.mockClear();
  mockResponse = null;
});

it('opens the guess screen for a tapped notification with a round id', async () => {
  mockResponse = tapped({ roundId: 'round-1' });
  await renderHook(() => useOpenTappedNotification(true));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/round/[roundId]/guess', params: { roundId: 'round-1' } });
});

it('does nothing without a round id or while signed out', async () => {
  mockResponse = tapped({});
  await renderHook(() => useOpenTappedNotification(true));
  mockResponse = tapped({ roundId: 'round-1' });
  await renderHook(() => useOpenTappedNotification(false));
  expect(mockPush).not.toHaveBeenCalled();
});

it('routes a second tap on the same round, but does not replay one when re-enabled', async () => {
  mockResponse = tapped({ roundId: 'round-1' });
  const { rerender } = await renderHook(({ on }: { on: boolean }) => useOpenTappedNotification(on), { initialProps: { on: true } });
  mockResponse = tapped({ roundId: 'round-1' });
  await rerender({ on: true });
  expect(mockPush).toHaveBeenCalledTimes(2);
  await rerender({ on: false });
  await rerender({ on: true });
  expect(mockPush).toHaveBeenCalledTimes(2);
});
