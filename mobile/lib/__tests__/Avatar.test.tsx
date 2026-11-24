import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import * as RN from 'react-native';
import { Avatar } from '../Avatar';

jest.mock('../session', () => ({ useSession: () => ({ token: 't' }) }));

// jest-expo's useColorScheme isn't a real hook, which would hide hook-order bugs. Production's is.
beforeEach(() => jest.spyOn(RN, 'useColorScheme').mockImplementation(() => useState<'light'>('light')[0]));
afterEach(() => jest.restoreAllMocks());

// Regression: Avatar swapping between photo and letter disc changed the hook count (#198).
it('falls back to the letter disc when the photo fails, without crashing', async () => {
  await render(<Avatar url="/a.png" initial="Z" label="pic" />);
  await fireEvent(screen.getByLabelText('pic'), 'error');
  expect(screen.getByText('Z')).toBeTruthy();
});
