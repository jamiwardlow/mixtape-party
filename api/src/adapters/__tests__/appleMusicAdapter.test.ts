import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppleMusicAdapter } from '../appleMusicAdapter.js';
import { ServiceAccountError, ServiceUnavailableError } from '../types.js';

// Search is app-credentialled -- no user link involved -- so a missing or malformed MusicKit key
// takes down catalog search for everyone. It has to read as "unavailable", not as a 500.
const throwawayKey = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppleMusicAdapter.search', () => {
  it('reports unavailable when the developer key is blank, as it is in local dev', async () => {
    const adapter = new AppleMusicAdapter({ teamId: '', keyId: '', privateKey: '' });

    await expect(adapter.search('nina simone')).rejects.toThrow(ServiceUnavailableError);
  });

  it('reports unavailable when Apple answers with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response));
    const adapter = new AppleMusicAdapter({ teamId: 'TEAM', keyId: 'KEY', privateKey: throwawayKey });

    await expect(adapter.search('nina simone')).rejects.toThrow(ServiceUnavailableError);
  });
});

// A library write goes out under the *user's* Music User Token, so its rejection has to be
// classified by who can act on it: the account holder, or nobody (#73).
describe('AppleMusicAdapter.createPlaylist', () => {
  const adapter = () => new AppleMusicAdapter({ teamId: 'TEAM', keyId: 'KEY', privateKey: throwawayKey });

  it.each([401, 403])('blames the account when Apple refuses the write with %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status }) as unknown as Response));

    await expect(adapter().createPlaylist('music-user-token', 'Round 1')).rejects.toThrow(ServiceAccountError);
  });

  it('leaves any other error status unclassified, since the account is not the problem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response));

    const err = await adapter()
      .createPlaylist('music-user-token', 'Round 1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ServiceAccountError);
  });
});
