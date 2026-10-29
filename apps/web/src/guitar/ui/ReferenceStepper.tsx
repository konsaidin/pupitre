// Эталон строя A4 — одно место для пределов и степпера: «Вход и звук» и тюнер. Шаг 1 Гц в пределах A4_MIN…A4_MAX,
// запись — reference.a4Hz настроек раздела (судья игры и тюнер считают высоту от него).
import { t } from '../../lib/i18n';
import { updateGuitarSettings, useGuitarSettings } from '../store/settings';
import { GuitarIcon } from './GuitarIcon';

export const A4_MIN = 430;
export const A4_MAX = 450;

export function setA4Hz(hz: number): void {
  updateGuitarSettings((s) => ({ ...s, reference: { ...s.reference, a4Hz: Math.min(A4_MAX, Math.max(A4_MIN, hz)) } }));
}

/** Степпер «A4 440 Гц» с −/+; подпись — снаружи (labelledBy). */
export function ReferenceStepper({ labelledBy, ui }: { labelledBy: string; ui: string }) {
  const [settings] = useGuitarSettings();
  const a4 = settings.reference.a4Hz;
  return (
    <div className="rp-stepper" role="group" aria-labelledby={labelledBy} data-ui={ui}>
      <button type="button" aria-label={t('Lower')} disabled={a4 <= A4_MIN} onClick={() => setA4Hz(a4 - 1)}>
        <GuitarIcon name="minus" size="sm" />
      </button>
      <output>
        A4 {a4} {t('Hz')}
      </output>
      <button type="button" aria-label={t('Higher')} disabled={a4 >= A4_MAX} onClick={() => setA4Hz(a4 + 1)}>
        <GuitarIcon name="plus" size="sm" />
      </button>
    </div>
  );
}
