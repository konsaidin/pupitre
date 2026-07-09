// Плашка о развёртывании встроенного бэкенда (только в десктоп-приложении):
// при первом запуске докачиваются Python-окружение и ffmpeg — показываем этапы.

import { useEffect, useState } from 'react';
import { desktopBridge } from '../lib/api';

interface Status {
  stage: string;
  detail?: string;
  progress?: number;
}

const STAGE_LABEL: Record<string, string> = {
  starting: 'Запускаю сервер обработки песен…',
  'download-uv': 'Скачиваю менеджер окружения…',
  'install-python': 'Устанавливаю Python…',
  'install-deps': 'Устанавливаю зависимости (около 2.5 ГБ, один раз)…',
  'download-ffmpeg': 'Скачиваю ffmpeg…',
  error: 'Не удалось развернуть сервер обработки',
};

export function BackendSetupBanner() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => desktopBridge()?.onBackendStatus(setStatus) ?? undefined, []);

  if (!status || status.stage === 'ready') return null;
  const isError = status.stage === 'error';

  return (
    <div className={isError ? 'backend-banner error' : 'backend-banner'}>
      {!isError && <span className="backend-spinner" aria-hidden="true" />}
      <span className="backend-banner-text">
        {STAGE_LABEL[status.stage] ?? status.stage}
        {status.progress != null && ` ${status.progress}%`}
        {status.detail && <span className="dim small"> · {status.detail}</span>}
      </span>
      <span className="dim small">Распевки и упражнения уже работают</span>
    </div>
  );
}
