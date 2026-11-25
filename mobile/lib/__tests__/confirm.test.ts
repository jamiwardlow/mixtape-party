import { Alert, Platform } from 'react-native';
import { confirmDestructive } from '../confirm';

const original = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', original);
  jest.restoreAllMocks();
});

it('asks through window.confirm on web and acts only on yes', () => {
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  const ask = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  window.confirm = ask;
  const onConfirm = jest.fn();

  confirmDestructive('Remove Ana?', 'Gone for good.', 'Remove', onConfirm);
  expect(ask).toHaveBeenCalledWith('Remove Ana? Gone for good.');
  expect(onConfirm).not.toHaveBeenCalled();

  confirmDestructive('Remove Ana?', 'Gone for good.', 'Remove', onConfirm);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it('asks through a native alert whose destructive button acts', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onConfirm = jest.fn();

  confirmDestructive('Delete round 2?', 'Gone for good.', 'Delete', onConfirm);
  const [title, msg, buttons] = alert.mock.calls[0];
  expect([title, msg]).toEqual(['Delete round 2?', 'Gone for good.']);
  expect(buttons?.map((b) => [b.text, b.style])).toEqual([['Cancel', 'cancel'], ['Delete', 'destructive']]);
  buttons?.[1].onPress?.();
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
