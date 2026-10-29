import { fireEvent, render, screen } from '@testing-library/react-native';
import JoinWithCode from '../join/index';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

beforeEach(() => jest.clearAllMocks());

it('navigates to the invite route for the typed code', async () => {
  await render(<JoinWithCode />);
  await fireEvent.changeText(screen.getByPlaceholderText('Invite code'), '  ABC123 ');
  await fireEvent.press(screen.getByText('Join'));
  expect(mockPush).toHaveBeenCalledWith('/join/ABC123');
});

it('does nothing for an empty code', async () => {
  await render(<JoinWithCode />);
  await fireEvent.press(screen.getByText('Join'));
  expect(mockPush).not.toHaveBeenCalled();
});
