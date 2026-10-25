// Представление входа без React: подписи устройств, вид пилюли, предупреждение карточки входа, совет по уровню, ключ
// замера фона. Чистые функции — проверяются юнит-тестами на всех состояниях сессии.
import type { InputDevice, InputLevel, InputSnapshot } from '../../audio/instrument/session';
import { t } from '../../lib/i18n';

/** Вход открыт и даёт звук (сигнал, тишина или перегруз). */
export const inputOpen = (state: InputSnapshot['state']) => state === 'ok' || state === 'no-signal' || state === 'clipping';

/** Ключ замера фона: у другого устройства или канала фон другой. */
export const noiseKeyOf = (deviceId: string | null, channel: number) => `${deviceId ?? ''}|${channel}`;

// Префиксы системных псевдоустройств Chromium («Default - …», «Communications - …»; в русском интерфейсе — свои).
const PSEUDO = /^(Default|Communications|По умолчанию|Связь)\s+[-–]\s+/i;
const USB_ID = /\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i;

/** Имя в пилюле: без префикса псевдоустройства и хвоста USB-идентификатора «(1235:8210)». */
export const shortDeviceLabel = (label: string) => label.replace(PSEUDO, '').replace(USB_ID, '').trim();

/** Имя в списке: псевдоустройство подписано — иначе «по умолчанию» и само устройство неразличимы. */
export function listDeviceLabel(device: InputDevice, index: number): string {
  if (!device.label) return `${t('Device')} ${index + 1}`;
  const pseudo = PSEUDO.exec(device.label);
  const name = device.label.replace(PSEUDO, '').replace(USB_ID, '').trim();
  if (!pseudo) return name;
  return `${name} · ${/^(Communications|Связь)/i.test(pseudo[1]) ? t('communications') : t('system default')}`;
}

export type Access = 'ask' | 'denied' | 'none' | 'busy' | 'lost' | 'unsupported' | null;

/**
 * Предупреждение карточки входа: браузер не даёт звука, доступа нет (ещё не спрашивали или запрещён), входов нет, не
 * открылся, отключён. devices — null, пока список не прочитан.
 */
export function accessOf(snap: InputSnapshot, devices: InputDevice[] | null, supported: boolean): Access {
  if (!supported || snap.state === 'unsupported') return 'unsupported';
  if (snap.state === 'permission-denied') return 'denied';
  if (snap.state === 'unavailable') return 'busy';
  if (snap.state === 'device-lost') return 'lost';
  if (snap.state === 'not-found' || devices?.length === 0) return 'none';
  if (devices && !devices.some((d) => d.label) && !inputOpen(snap.state) && snap.state !== 'opening') return 'ask';
  return null;
}

/** LED, имя и подсказка пилюли. Тишина — без цвета: красный — только перегруз (ui-spec §11.1; см. артефакт 21b). */
export function pillView(snap: InputSnapshot, chosen: boolean, savedLabel: string): { led: string; name: string; title: string } {
  const name = shortDeviceLabel(snap.label || savedLabel) || t('Input');
  switch (snap.state) {
    case 'ok':
      return { led: 'rp-led--ok', name, title: t('The input works. Settings — Input and sound') };
    case 'no-signal':
      return { led: '', name, title: t('The input is open, no sound yet — play something') };
    case 'clipping':
      return { led: 'rp-led--bad', name: t('Overload'), title: t('Input overload: turn the gain down on the interface') };
    case 'opening':
      return { led: '', name, title: t('Opening the input…') };
    case 'device-lost':
      return { led: 'rp-led--warn', name: t('Device disconnected'), title: t('Plug the device back in or choose another one in Input and sound') };
    case 'permission-denied':
      return { led: 'rp-led--warn', name: t('No access to the input'), title: t('Allow access to the input in Input and sound') };
    case 'not-found':
      return { led: 'rp-led--warn', name: t('No inputs found'), title: t('Connect a sound card or a guitar interface') };
    case 'unavailable':
      return { led: 'rp-led--bad', name: t('The input did not open'), title: t('The device is busy with another program or unavailable') };
    case 'unsupported':
      return { led: 'rp-led--warn', name: t('No sound access'), title: t('Open Pupitre via localhost or https — the browser gives no sound on this address') };
    default:
      return chosen
        ? { led: '', name, title: t('Opening the input…') }
        : { led: 'rp-led--warn', name: t('No input selected'), title: t('Choose the input device in Input and sound') };
  }
}

export type Advice = 'closed' | 'play' | 'quiet' | 'good' | 'hot' | 'clip';

export function adviceOf(level: InputLevel): Advice {
  if (level.clipping) return 'clip';
  if (!Number.isFinite(level.playDb)) return 'play';
  if (level.playDb < -24) return 'quiet';
  if (level.playDb > -3) return 'hot';
  return 'good';
}

/** Замер фона громче этого — звучали струны или гудит: не запоминаем. */
export const NOISE_TOO_LOUD_DB = -35;
