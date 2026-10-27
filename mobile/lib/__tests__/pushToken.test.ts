import { Platform } from 'react-native';
import { registerPushToken, unregisterPushToken } from '../pushToken';

let mockStatus = 'granted';
jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'proj-1' } } } }));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: async () => ({ status: mockStatus }),
  requestPermissionsAsync: async () => ({ status: mockStatus }),
  getExpoPushTokenAsync: async () => ({ data: 'ExpoPushToken[abc]' }),
}));

beforeEach(() => {
  mockStatus = 'granted';
  Platform.OS = 'ios';
  globalThis.fetch = jest.fn(async () => new Response('{}', { status: 201 })) as unknown as typeof fetch;
});

it('POSTs the token once with platform expo when permission is granted', async () => {
  await registerPushToken('tok-abc');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('/notifications/push-tokens'),
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ platform: 'expo', token: 'ExpoPushToken[abc]' }) }),
  );
});

it('makes no request when permission is denied', async () => {
  mockStatus = 'denied';
  await expect(registerPushToken('tok-abc')).resolves.toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it('makes no request on web', async () => {
  Platform.OS = 'web';
  await expect(registerPushToken('tok-abc')).resolves.toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it('removes the registered token on unregister', async () => {
  await registerPushToken('tok-abc');
  (fetch as jest.Mock).mockClear();
  await unregisterPushToken('tok-abc');
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('/notifications/push-tokens'),
    expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ token: 'ExpoPushToken[abc]' }) }),
  );
});
