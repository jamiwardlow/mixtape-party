import { fireEvent, render, screen } from '@testing-library/react-native';
import CreateLeague from '../create-league';
import { formatDeadline } from '../../lib/ui';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'tok-1' }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = jest.fn(
    async () => new Response(JSON.stringify({ inviteCode: 'abc12' }), { status: 200 }),
  ) as unknown as typeof fetch;
});

const DAY_MS = 24 * 60 * 60 * 1000;

// The iOS picker is a native view: it reports a pick as a `change` with the chosen instant on
// the native event, which is what TapeDateField turns back into a Date.
function pick(testID: string, iso: string) {
  return fireEvent(screen.getByTestId(testID), 'change', {
    nativeEvent: { timestamp: new Date(iso).getTime(), utcOffset: 0 },
  });
}

const create = () => fireEvent.press(screen.getByText('Create league'));

function lastPost() {
  const calls = (fetch as jest.Mock).mock.calls;
  return JSON.parse(calls[calls.length - 1][1].body);
}

// The deadlines used to be two free-text boxes whose contents went to the API unparsed, so
// whatever the host typed was the server's problem. Every assertion here is on the wire body.
describe('deadlines', () => {
  it('posts the picked submission deadline as an ISO 8601 instant', async () => {
    await render(<CreateLeague />);

    await pick('submission-deadline', '2026-10-01T18:00:00.000Z');
    await create();

    expect(lastPost().submissionDeadline).toBe('2026-10-01T18:00:00.000Z');
  });

  it('defaults the guessing deadline to a week after the submission deadline', async () => {
    await render(<CreateLeague />);

    await pick('submission-deadline', '2026-10-01T18:00:00.000Z');
    await create();

    expect(lastPost().guessingDeadline).toBe('2026-10-08T18:00:00.000Z');
  });

  it('keeps an explicitly chosen guessing deadline instead of the default', async () => {
    await render(<CreateLeague />);

    await pick('submission-deadline', '2026-10-01T18:00:00.000Z');
    await pick('guessing-deadline', '2026-10-03T12:00:00.000Z');
    await create();

    expect(lastPost().guessingDeadline).toBe('2026-10-03T12:00:00.000Z');
  });

  // minimumDate stops the host picking an inverted pair, but it can't retract a choice made
  // before the submission deadline moved past it. The API 400s on guessing <= submission, so
  // catching it here is the difference between a message and a wasted round trip.
  it('refuses to post a guessing deadline the submission deadline has overtaken', async () => {
    await render(<CreateLeague />);

    await pick('guessing-deadline', '2026-10-03T12:00:00.000Z');
    await pick('submission-deadline', '2026-11-01T18:00:00.000Z');
    await create();

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Guessing deadline must be after the submission deadline')).toBeTruthy();
  });

  // Both pickers show a real instant from the first render, so an untouched form still has to
  // post a window that works -- the season schedule (#74) is derived from it.
  it('posts a week-long window without the host touching either picker', async () => {
    await render(<CreateLeague />);

    await create();

    const { submissionDeadline, guessingDeadline } = lastPost();
    expect(Date.parse(submissionDeadline)).toBeGreaterThan(Date.now());
    expect(Date.parse(guessingDeadline) - Date.parse(submissionDeadline)).toBe(7 * DAY_MS);
  });
});

describe('season length', () => {
  it('refuses to post NaN when the field is cleared', async () => {
    await render(<CreateLeague />);

    await fireEvent.changeText(screen.getByPlaceholderText('Season length (rounds)'), '');
    await create();

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Season length must be a whole number of rounds')).toBeTruthy();
  });

  it('posts the season length as a number', async () => {
    await render(<CreateLeague />);

    await fireEvent.changeText(screen.getByPlaceholderText('Season length (rounds)'), '12');
    await create();

    expect(lastPost().seasonLength).toBe(12);
  });
});

// #74 derives the whole season from round 1's two deadlines and commits it without showing the
// host a thing. These assert the host can see what they are about to agree to.
describe('season schedule preview', () => {
  const dateAt = (testID: string) => screen.getByTestId(testID).props.children as string;

  async function previewFor(seasonLength: string) {
    await render(<CreateLeague />);
    await fireEvent.changeText(screen.getByPlaceholderText('Season length (rounds)'), seasonLength);
    await pick('submission-deadline', '2026-10-01T18:00:00.000Z');
    await pick('guessing-deadline', '2026-10-08T18:00:00.000Z');
  }

  it('shows one row per round after the first, back to back', async () => {
    await previewFor('4');

    expect(screen.queryByTestId('preview-round-5-submission')).toBeNull();
    for (const n of [2, 3]) {
      expect(dateAt(`preview-round-${n + 1}-submission`)).toBe(dateAt(`preview-round-${n}-guessing`));
    }
  });

  // Round 1 is the form above the preview; repeating it under "the rest of the season" reads as
  // an extra round the host did not ask for.
  it('starts the preview at round 2, where the window the host picked ends', async () => {
    await previewFor('4');

    expect(screen.queryByTestId('preview-round-1-submission')).toBeNull();
    expect(dateAt('preview-round-2-submission')).toBe(formatDeadline(new Date('2026-10-08T18:00:00.000Z')));
    expect(dateAt('preview-round-2-guessing')).toBe(formatDeadline(new Date('2026-10-15T18:00:00.000Z')));
  });

  it('re-renders with the right row count when the season length changes', async () => {
    await previewFor('4');

    await fireEvent.changeText(screen.getByPlaceholderText('Season length (rounds)'), '2');

    expect(screen.getByTestId('preview-round-2-guessing')).toBeTruthy();
    expect(screen.queryByTestId('preview-round-3-submission')).toBeNull();
  });

  // Number('') is 0 and Number('two') is NaN; generating rows off either one is a blank list at
  // best and a hung render at worst.
  it('shows no preview while the season length is unusable', async () => {
    await previewFor('');

    expect(screen.queryByTestId('preview-round-2-submission')).toBeNull();
  });
});

// The whole season is written at creation, so a theme typed here is the difference between a
// named round and one the host has to go back and PATCH on the schedule screen.
describe('season themes', () => {
  async function formFor(seasonLength: string) {
    await render(<CreateLeague />);
    await fireEvent.changeText(screen.getByPlaceholderText('Season length (rounds)'), seasonLength);
  }

  it('posts each round’s theme at its own index, with round 1 in the theme field', async () => {
    await formFor('3');

    await fireEvent.changeText(screen.getAllByPlaceholderText('Theme')[0], 'Songs about rain');
    await fireEvent.changeText(screen.getByTestId('preview-round-3-theme'), 'Deep cuts');
    await create();

    expect(lastPost().theme).toBe('Songs about rain');
    expect(lastPost().themes).toEqual([null, null, 'Deep cuts']);
  });

  it('shortens the posted themes when the season does, dropping the rounds that went away', async () => {
    await formFor('4');

    await fireEvent.changeText(screen.getByTestId('preview-round-4-theme'), 'One hit wonders');
    await fireEvent.changeText(screen.getByPlaceholderText('Season length (rounds)'), '2');
    await create();

    expect(lastPost().themes).toEqual([null, null]);
  });
});
