import { afterEach, describe, expect, it, vi } from 'vitest';
import { findDeezerPreview } from '../deezerPreview.js';

function stubDeezer(data: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data }) }) as unknown as Response));
}

const hit = (title: string, artist: string, extra = {}) => ({ title, artist: { name: artist }, preview: `https://p/${title}.mp3`, ...extra });

afterEach(() => vi.unstubAllGlobals());

describe('findDeezerPreview', () => {
  it('takes the result whose title and artist agree, skipping covers and live cuts', async () => {
    stubDeezer([hit('Creep (Live)', 'Radiohead'), hit('Creep', 'Some Cover Band'), hit('Creep', 'Radiohead')]);
    expect(await findDeezerPreview({ title: 'Creep', artist: 'Radiohead' })).toBe('https://p/Creep.mp3');
  });

  it('is null when nothing agrees closely', async () => {
    stubDeezer([hit('Creep (Live)', 'Radiohead')]);
    expect(await findDeezerPreview({ title: 'Creep', artist: 'Radiohead' })).toBeNull();
  });

  it('prefers an ISRC match even when the title differs', async () => {
    stubDeezer([hit('Creep - Remastered', 'Radiohead', { isrc: 'GB1' })]);
    expect(await findDeezerPreview({ title: 'Creep', artist: 'Radiohead', isrc: 'GB1' })).toBe('https://p/Creep - Remastered.mp3');
  });

  it('does not treat names with no latin characters as agreeing', async () => {
    stubDeezer([hit('夜に駆ける', 'YOASOBI')]);
    expect(await findDeezerPreview({ title: '夜に駆ける', artist: 'YOASOBI' })).toBeNull();
  });

  it('is null when Deezer is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await findDeezerPreview({ title: 'Creep', artist: 'Radiohead' })).toBeNull();
  });
});
