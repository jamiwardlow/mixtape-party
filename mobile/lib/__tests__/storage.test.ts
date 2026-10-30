import * as SecureStore from 'expo-secure-store';
import { secureStorage, webStorage } from '../storage';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// The web half is the reason this seam exists: under the default jest-expo preset `Platform.OS`
// is never 'web', so nothing else in the suite reaches these guards.
function bindLocalStorage(value: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

// defineProperty rather than assignment: an environment that binds localStorage may bind it as a
// non-writable accessor.
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('webStorage', () => {
  it('round-trips a value', async () => {
    bindLocalStorage(fakeLocalStorage());

    await webStorage.set('session_token', 'tok-abc');

    expect(await webStorage.get('session_token')).toBe('tok-abc');
  });

  // A stored "null" would read back as a truthy token on the next page load.
  it('removes the key on a null value rather than storing "null"', async () => {
    bindLocalStorage(fakeLocalStorage());
    await webStorage.set('session_token', 'tok-abc');

    await webStorage.set('session_token', null);

    expect(await webStorage.get('session_token')).toBeNull();
  });

  // The Expo web bundle can evaluate this module with no localStorage bound.
  it('reads null and swallows writes when localStorage is unbound', async () => {
    bindLocalStorage(undefined);

    await expect(webStorage.set('session_token', 'tok-abc')).resolves.toBeUndefined();
    await expect(webStorage.get('session_token')).resolves.toBeNull();
  });
});

describe('secureStorage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads through to the keychain', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('tok-abc');

    expect(await secureStorage.get('session_token')).toBe('tok-abc');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('session_token');
  });

  it('writes a value', async () => {
    await secureStorage.set('session_token', 'tok-abc');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('session_token', 'tok-abc');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  // SecureStore rejects a null value, so clearing must delete the key.
  it('deletes the key on a null value', async () => {
    await secureStorage.set('session_token', null);

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('session_token');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});
