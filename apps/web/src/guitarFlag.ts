// Гитарный раздел включён во всех сборках; VITE_PUPITRE_GUITAR=0 собирает только голос (сборка без раздела — проверка
// ленивой границы в e2e guitar-shell).
import { RU } from './lib/i18n';

export const GUITAR_ENABLED = import.meta.env.VITE_PUPITRE_GUITAR !== '0';

// Пункт вокального меню подписан до загрузки гитарного чанка: словарь раздела приходит только вместе с ним.
if (GUITAR_ENABLED) RU.Guitar ??= 'Гитара';
