import { fireEvent, render, screen } from '@testing-library/react-native';
import { Thumb } from '../ui';

describe('Thumb', () => {
  it('shows the cover until it fails to load, then a note tile', async () => {
    await render(<Thumb url="https://i.ytimg.com/vi/x/mqdefault.jpg" title="Song" />);
    expect(screen.queryByText('♪', { includeHiddenElements: true })).toBeNull();

    await fireEvent(screen.getByTestId('thumb-image'), 'error');

    expect(screen.getByText('♪', { includeHiddenElements: true })).toBeTruthy();
  });

  it('shows a note tile when there is no url', async () => {
    await render(<Thumb url={null} title="Song" />);
    expect(screen.getByText('♪', { includeHiddenElements: true })).toBeTruthy();
  });
});
