import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppleMusicAdapter } from '../appleMusicAdapter.js';
import { ServiceUnavailableError } from '../types.js';

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
