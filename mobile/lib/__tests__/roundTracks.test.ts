import { commentSaved, favorited, guessed, reacted, unguessed } from '../roundTracks';

const track = (over: object = {}) => ({
  submissionId: 's1',
  guessedAccountId: null as string | null,
  comment: null as string | null,
  reactions: [] as { emoji: string; count: number; mine: boolean }[],
  favorited: false,
  ...over,
});
const other = { ...track(), submissionId: 's2' };

it('a first guess saves the draft as the comment', () => {
  const [t] = guessed([track()], 's1', 'u1', '  so Sam ');
  expect(t).toMatchObject({ guessedAccountId: 'u1', comment: 'so Sam' });
});

it('changing a guess keeps the saved comment', () => {
  const [t] = guessed([track({ guessedAccountId: 'u1', comment: 'saved' })], 's1', 'u2', 'unsaved draft');
  expect(t).toMatchObject({ guessedAccountId: 'u2', comment: 'saved' });
});

it('unguess clears the comment', () => {
  const [t] = unguessed([track({ guessedAccountId: 'u1', comment: 'saved' })], 's1');
  expect(t).toMatchObject({ guessedAccountId: null, comment: null });
});

it('saving a comment sets only that track', () => {
  const [t, o] = commentSaved([track(), other], 's1', 'hi');
  expect(t.comment).toBe('hi');
  expect(o).toBe(other);
});

it('react toggles mine and keeps the counts', () => {
  const start = track({ reactions: [{ emoji: '🔥', count: 2, mine: false }] });
  const [on] = reacted([start], 's1', '🔥', true);
  expect(on.reactions).toEqual([{ emoji: '🔥', count: 3, mine: true }]);
  const [off] = reacted([on], 's1', '🔥', false);
  expect(off.reactions).toEqual([{ emoji: '🔥', count: 2, mine: false }]);
});

it('a new reaction is added, and taking back the last one removes it', () => {
  const [on] = reacted([track()], 's1', '🎧', true);
  expect(on.reactions).toEqual([{ emoji: '🎧', count: 1, mine: true }]);
  expect(reacted([on], 's1', '🎧', false)[0].reactions).toEqual([]);
});

it('favorite sets the heart', () => {
  expect(favorited([track()], 's1', true)[0].favorited).toBe(true);
});
