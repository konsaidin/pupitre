// Клиент настоящего воркера разбора (?worker&inline — под file:// воркер из блоба). Модуль грузится отдельным чанком
// при первом импорте (store/library.ts): с воркером в нём alphaTab, ≈ 1.3 МБ.
import ScoreWorker from './scoreWorker?worker&inline';
import { createScoreClient } from './workerClient';

export const scoreClient = createScoreClient(() => new ScoreWorker());
