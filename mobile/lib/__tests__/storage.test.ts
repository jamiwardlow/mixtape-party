import { webStorage } from '../storage';

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
