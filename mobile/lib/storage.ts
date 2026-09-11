import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export interface SessionStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<void>;
}

// Split per platform rather than branching on Platform.OS inside one object: that way the web half
// is testable with a fake localStorage, without patching Platform.
export const webStorage: SessionStorage = {
  // Both guards are load-bearing: the Expo web bundle can evaluate this module with no
  // localStorage bound.
  async get(key) {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  },
  async set(key, value) {
    if (typeof localStorage === 'undefined') return;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  },
};

// ponytail: nothing exercises secureStorage — reaching it from a test means patching
// expo-secure-store, which is the module patching this seam exists to remove. It is four lines in
// the same shape as webStorage; the check that covers it is signing in once on a device.
export const secureStorage: SessionStorage = {
  get(key) {
    return SecureStore.getItemAsync(key);
  },
  async set(key, value) {
    if (value) await SecureStore.setItemAsync(key, value);
    else await SecureStore.deleteItemAsync(key);
  },
};

export const deviceStorage: SessionStorage = Platform.OS === 'web' ? webStorage : secureStorage;
