// Своя партия в аккомпанементе — синт играет её как гайд: не слышно, тихо или громко. Сегмент для подготовки песни и
// экрана игры; пишет mix.guide, игра применяет его к слою гайда на лету (клавиша M — по кругу).
import { t } from '../../lib/i18n';
import { PART_LEVELS, partLevelOf, type PartLevel } from '../backing/synthBacking';
import { updateGuitarSettings, useGuitarSettings } from '../store/settings';

export const PART_LEVEL_UI: Record<PartLevel, { label: string }> = {
  off: { label: 'Off' },
  quiet: { label: 'Quiet' },
  full: { label: 'Loud' },
};
const ORDER = Object.keys(PART_LEVELS) as PartLevel[];

export function setPartLevel(level: PartLevel): void {
  updateGuitarSettings((s) => ({ ...s, mix: { ...s.mix, guide: PART_LEVELS[level] } }));
}

/** Следующий уровень по кругу: не слышно → тихо → громко → не слышно. */
export function cyclePartLevel(): void {
  updateGuitarSettings((s) => {
    const next = ORDER[(ORDER.indexOf(partLevelOf(s.mix.guide)) + 1) % ORDER.length];
    return { ...s, mix: { ...s.mix, guide: PART_LEVELS[next] } };
  });
}

export function PartLevelSeg({ className = '' }: { className?: string }) {
  const [settings] = useGuitarSettings();
  const now = partLevelOf(settings.mix.guide);
  return (
    <div className={`rp-seg ${className}`.trim()} role="radiogroup" aria-label={t('Your part in the backing')} data-ui="part-level">
      {ORDER.map((level) => (
        <button key={level} type="button" className="rp-seg__item" role="radio" aria-checked={now === level} onClick={() => setPartLevel(level)}>
          {t(PART_LEVEL_UI[level].label)}
        </button>
      ))}
    </div>
  );
}
