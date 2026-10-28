import { pickIdeas } from '../themeSuggestions';

describe('pickIdeas', () => {
  it('returns distinct ideas', () => {
    const ideas = pickIdeas(20);
    expect(ideas).toHaveLength(20);
    expect(new Set(ideas).size).toBe(20);
  });

  it('skips taken themes, ignoring case and padding', () => {
    const [first] = pickIdeas(1);
    const rest = pickIdeas(1000, [`  ${first.toUpperCase()} `]);
    expect(rest).not.toContain(first);
  });

  it('returns fewer than asked when the pool runs out', () => {
    expect(pickIdeas(10000).length).toBeLessThan(10000);
  });
});
