import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { TapeDateField } from '../ui';

// mobile/ serves the web client, and @react-native-community/datetimepicker has no
// react-native-web build -- web gets a DOM <input type="datetime-local"> instead. The jest
// preset runs as iOS, so the web branch only gets exercised if Platform.OS is forced.
const original = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
const asWeb = () => Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

afterEach(() => Object.defineProperty(Platform, 'OS', original));

const AUG_1 = new Date(2026, 7, 1, 18, 30);

describe('TapeDateField on web', () => {
  // The DOM control reads and writes local wall-clock time; formatting it with toISOString()
  // would show the host a value shifted by the UTC offset.
  it('shows the value as local wall-clock time, not UTC', async () => {
    asWeb();
    await render(<TapeDateField label="Submission deadline" value={AUG_1} onChange={jest.fn()} />);

    expect(screen.getByLabelText('Submission deadline').props.value).toBe('2026-08-01T18:30');
  });

  it('reports a picked date back as a Date', async () => {
    asWeb();
    const onChange = jest.fn();
    await render(<TapeDateField label="Submission deadline" value={AUG_1} onChange={onChange} />);

    await fireEvent(screen.getByLabelText('Submission deadline'), 'change', {
      target: { value: '2026-09-15T09:00' },
    });

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 8, 15, 9, 0));
  });

  it('opens the native picker when the field is clicked, not just the calendar icon', async () => {
    asWeb();
    const showPicker = jest.fn();
    await render(<TapeDateField label="Submission deadline" value={AUG_1} onChange={jest.fn()} />);

    await fireEvent(screen.getByLabelText('Submission deadline'), 'click', {
      currentTarget: { showPicker },
    });

    expect(showPicker).toHaveBeenCalled();
  });

  // Firefox on Android and any browser predating showPicker() still have to be clickable.
  it('survives a browser with no showPicker', async () => {
    asWeb();
    await render(<TapeDateField label="Submission deadline" value={AUG_1} onChange={jest.fn()} />);

    await fireEvent(screen.getByLabelText('Submission deadline'), 'click', { currentTarget: {} });
  });

  // Clearing the field used to be how an empty string reached the API.
  it('ignores a cleared field rather than reporting an invalid date', async () => {
    asWeb();
    const onChange = jest.fn();
    await render(<TapeDateField label="Submission deadline" value={AUG_1} onChange={onChange} />);

    await fireEvent(screen.getByLabelText('Submission deadline'), 'change', { target: { value: '' } });

    expect(onChange).not.toHaveBeenCalled();
  });
});
