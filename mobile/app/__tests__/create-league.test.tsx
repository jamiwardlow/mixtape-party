import { fireEvent, render, screen } from '@testing-library/react-native';
import CreateLeague from '../create-league';

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
