import { render, screen } from '@testing-library/react-native';
import SeasonWrapUp from '../league/[leagueId]/final';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ leagueId: 'league-1' }),
  Redirect: ({ href }: { href: unknown }) => {
    const { Text } = require('react-native');
    return <Text testID="redirect">{JSON.stringify(href)}</Text>;
  },
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'tok-1' }),
}));

const ada = { accountId: 'a', displayName: 'Ada' };
const bo = { accountId: 'b', displayName: 'Bo' };

const overview = (concluded: boolean) => ({
  league: { id: 'league-1', name: 'Office League', concluded },
  standings: [
    { ...ada, score: 5 },
    { ...bo, score: 2 },
  ],
  winners: concluded ? [{ ...ada, score: 5 }] : [],
});

function stub(concluded: boolean) {
  globalThis.fetch = jest.fn(async (url: string) =>
    new Response(
      JSON.stringify(
        String(url).endsWith('/besties')
          ? { guessedMe: [{ ...bo, count: 3 }], iGuessed: [] }
          : overview(concluded),
      ),
      { status: 200 },
    ),
  ) as unknown as typeof fetch;
}

it('shows winners, final standings and both Besties groups for a concluded league', async () => {
  stub(true);
  await render(<SeasonWrapUp />);

  expect((await screen.findByTestId('winners')).props.children).toBe('Ada');
  expect(screen.getByTestId('standings-a').props.children).toBe(5);
  expect(screen.getByTestId('standings-b').props.children).toBe(2);
  expect(await screen.findByText('Gets me')).toBeTruthy();
  expect(screen.getByText('I get them')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
});

it('redirects to the season hub when the league is not concluded', async () => {
  stub(false);
  await render(<SeasonWrapUp />);

  expect(JSON.parse((await screen.findByTestId('redirect')).props.children)).toEqual({
    pathname: '/league/[leagueId]',
    params: { leagueId: 'league-1' },
  });
  expect(screen.queryByTestId('winners')).toBeNull();
});

it('shows an error instead of spinning forever when the network is down', async () => {
  globalThis.fetch = jest.fn(async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  await render(<SeasonWrapUp />);

  expect(await screen.findByText('Could not load this league')).toBeTruthy();
});
