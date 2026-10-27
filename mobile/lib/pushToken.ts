import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { fetchApi } from './api';

// The token this install last registered, so sign-out can remove exactly it without asking the OS again.
let registered: string | null = null;

/** Asks permission, fetches the Expo push token and registers it. Never throws: no push is not an error. */
export async function registerPushToken(authToken: string): Promise<void> {
  if (Platform.OS === 'web') return; // web push is not delivered yet
  try {
    // Android 13+ shows no permission prompt, and issues no token, until a channel exists.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const res = await fetchApi('/notifications/push-tokens', {
      method: 'POST',
      token: authToken,
      body: { platform: 'expo', token: data },
    });
    if (res.ok) registered = data;
  } catch {
    // Simulators, no network, no FCM config: the next app start retries.
  }
}

/** Sign-out: stop the previous account's pushes reaching a shared device. Best effort, like the session revoke. */
export async function unregisterPushToken(authToken: string): Promise<void> {
  const token = registered;
  registered = null;
  if (!token) return;
  await fetchApi('/notifications/push-tokens', { method: 'DELETE', token: authToken, body: { token } }).catch(() => {});
}

/** Re-runs on every app start while signed in: tokens can change, and the endpoint dedupes. */
export function useRegisterPushToken(authToken: string | null) {
  useEffect(() => {
    if (authToken) void registerPushToken(authToken);
  }, [authToken]);
}
