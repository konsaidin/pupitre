// Представление входа на всех состояниях сессии: предупреждение карточки (в том числе «доступа ещё нет», «отключено»
// при скрытых метках, «браузер не даёт звука»), вид пилюли (тишина — без цвета, перегруз — словом), подписи
// псевдоустройств в списке, совет по уровню, ключ замера фона.
import { describe, expect, it } from 'vitest';
import type { InputLevel, InputSnapshot, InputState } from '../../audio/instrument/session';
import { accessOf, adviceOf, listDeviceLabel, noiseKeyOf, pillView, shortDeviceLabel } from './inputView';

const snap = (state: InputState, patch: Partial<InputSnapshot> = {}): InputSnapshot => ({
  state, backend: 'web', deviceId: 'a', label: 'Interface A', channels: 2, sampleRate: 48000, bufferFrames: 0, requestedFrames: 0, xruns: 0,
  engineError: '', outputLabel: '', ...patch,
});
const labelled = [{ id: 'a', label: 'Interface A' }];
const hidden = [{ id: '', label: '' }];

describe('предупреждение карточки входа', () => {
  it.each([
    ['unsupported', labelled, true, 'unsupported'],
    ['off', labelled, false, 'unsupported'],
    ['permission-denied', hidden, true, 'denied'],
    ['unavailable', labelled, true, 'busy'],
    ['device-lost', hidden, true, 'lost'],
    ['not-found', [], true, 'none'],
    ['off', [], true, 'none'],
    ['off', hidden, true, 'ask'],
    ['opening', hidden, true, null],
    ['no-signal', hidden, true, null],
    ['ok', labelled, true, null],
    ['off', labelled, true, null],
    ['off', null, true, null],
  ] as const)('%s, устройства %j, звук есть: %s → %s', (state, devices, supported, want) => {
    expect(accessOf(snap(state), devices ? [...devices] : null, supported)).toBe(want);
  });
});

describe('пилюля', () => {
  it.each([
    ['ok', 'rp-led--ok', 'Interface A'],
    ['no-signal', '', 'Interface A'],
    ['clipping', 'rp-led--bad', 'Overload'],
    ['opening', '', 'Interface A'],
    ['device-lost', 'rp-led--warn', 'Device disconnected'],
    ['permission-denied', 'rp-led--warn', 'No access to the input'],
    ['not-found', 'rp-led--warn', 'No inputs found'],
    ['unavailable', 'rp-led--bad', 'The input did not open'],
    ['unsupported', 'rp-led--warn', 'No sound access'],
  ] as const)('%s → LED «%s», имя «%s»', (state, led, name) => {
    expect(pillView(snap(state), true, '')).toMatchObject({ led, name });
  });

  it('закрыт: не выбран — warn «No input selected»; выбран — имя из настроек без цвета', () => {
    expect(pillView(snap('off', { label: '' }), false, '')).toMatchObject({ led: 'rp-led--warn', name: 'No input selected' });
    expect(pillView(snap('off', { label: '' }), true, 'Default - Scarlett 2i2 USB (1235:8210)')).toMatchObject({ led: '', name: 'Scarlett 2i2 USB' });
  });
});

describe('подписи устройств', () => {
  it('в списке псевдоустройство подписано, в пилюле — коротко', () => {
    expect(listDeviceLabel({ id: 'default', label: 'Default - Scarlett 2i2 USB (1235:8210)' }, 0)).toBe('Scarlett 2i2 USB · system default');
    expect(listDeviceLabel({ id: 'communications', label: 'Communications - Scarlett 2i2 USB' }, 1)).toBe('Scarlett 2i2 USB · communications');
    expect(listDeviceLabel({ id: 'x', label: 'Scarlett 2i2 USB (1235:8210)' }, 2)).toBe('Scarlett 2i2 USB');
    expect(listDeviceLabel({ id: 'y', label: '' }, 3)).toBe('Device 4');
    expect(shortDeviceLabel('По умолчанию – USB AUDIO CODEC')).toBe('USB AUDIO CODEC');
  });
});

describe('совет по уровню и ключ фона', () => {
  const level = (playDb: number, clipping = false): InputLevel => ({
    rmsDb: -20, peakDb: -12, barDb: -12, holdDb: -12, playDb, clipping, channelDb: [-12, -Infinity],
  });
  it('перегруз, ещё не играли, тихо, хорошо, почти перегруз', () => {
    expect(adviceOf(level(-12, true))).toBe('clip');
    expect(adviceOf(level(-Infinity))).toBe('play');
    expect(adviceOf(level(-30))).toBe('quiet');
    expect(adviceOf(level(-12))).toBe('good');
    expect(adviceOf(level(-2))).toBe('hot');
  });
  it('ключ фона — устройство и канал', () => {
    expect(noiseKeyOf('a', -1)).toBe('a|-1');
    expect(noiseKeyOf(null, 0)).toBe('|0');
  });
});
