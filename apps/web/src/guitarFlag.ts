// Гитарный раздел виден в dev и в сборках с VITE_PUPITRE_GUITAR=1 (e2e, ELECTRON, СБОРКА-ОК). Релизы desktop.yml
// собираются без флага, пока раздел не принят человеком (HUMAN-CHECKLIST).
import { RU } from './lib/i18n';

export const GUITAR_ENABLED = import.meta.env.DEV || import.meta.env.VITE_PUPITRE_GUITAR === '1';

// Пункт вокального меню подписан до загрузки гитарного чанка: словарь раздела приходит только вместе с ним.
if (GUITAR_ENABLED) RU.Guitar ??= 'Гитара';
