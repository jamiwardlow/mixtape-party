import { describe, expect, it } from 'vitest';
import { findPlaylists } from '../sweepContractPlaylists.js';

// A real library browse response nests the playlist tiles several renderers deep, and that nesting
// has moved before. findPlaylists walks for the tiles instead of indexing a fixed path, so this
// pins the two things the walk has to get right: it reaches a deeply buried tile, and it only
// returns rows that are actually playlists.
const browseResponse = {
  contents: {
    singleColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    gridRenderer: {
                      items: [
                        {
                          musicTwoRowItemRenderer: {
                            title: { runs: [{ text: 'contract-test-1757000000000' }] },
                            navigationEndpoint: { browseEndpoint: { browseId: 'VLPLabc123' } },
                          },
                        },
                        {
                          musicTwoRowItemRenderer: {
                            title: { runs: [{ text: 'Round 12 — mixtape.party' }] },
                            navigationEndpoint: { browseEndpoint: { browseId: 'VLPLreal456' } },
                          },
                        },
                        // Liked Music is not a PL playlist, and the "new playlist" tile has no id.
                        {
                          musicTwoRowItemRenderer: {
                            title: { runs: [{ text: 'Liked Music' }] },
                            navigationEndpoint: { browseEndpoint: { browseId: 'VLLM' } },
                          },
                        },
                        {
                          musicTwoRowItemRenderer: {
                            title: { runs: [{ text: 'New playlist' }] },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
};

describe('findPlaylists', () => {
  it('finds playlist tiles wherever they are nested and strips the VL browse prefix', () => {
    expect(findPlaylists(browseResponse)).toEqual([
      { id: 'PLabc123', title: 'contract-test-1757000000000' },
      { id: 'PLreal456', title: 'Round 12 — mixtape.party' },
    ]);
  });

  it('ignores tiles that are not playlists, so the sweep never targets Liked Music', () => {
    const titles = findPlaylists(browseResponse).map((p) => p.title);
    expect(titles).not.toContain('Liked Music');
    expect(titles).not.toContain('New playlist');
  });

  it('returns nothing rather than throwing on a response shape it does not recognize', () => {
    expect(findPlaylists({ contents: { somethingNew: [] } })).toEqual([]);
  });
});
