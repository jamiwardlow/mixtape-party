import { redirectSystemPath } from '../+native-intent';

test('moves a magic-link fragment token into the t param', () => {
  expect(redirectSystemPath({ path: 'https://mixtape-party.com/auth/complete#t=abc_-1', initial: true })).toBe('/auth/complete?t=abc_-1');
});

test('leaves every other path alone', () => {
  expect(redirectSystemPath({ path: '/join/ABC', initial: false })).toBe('/join/ABC');
  expect(redirectSystemPath({ path: 'https://mixtape-party.com/auth/complete', initial: false })).toBe('https://mixtape-party.com/auth/complete');
});
