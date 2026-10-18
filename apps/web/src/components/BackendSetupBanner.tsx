// Плашка о развёртывании встроенного бэкенда (только в десктоп-приложении):
// при первом запуске докачиваются Python-окружение и ffmpeg — показываем этапы.

import { useEffect, useState } from 'react';
import { desktopBridge } from '../lib/api';
import { t } from '../lib/i18n';

interface Status {
  stage: string;
  detail?: string;
  progress?: number;
}

const STAGE_LABEL: Record<string, string> = {
  starting: 'Starting the song processing server…',
  'download-uv': 'Downloading the environment manager…',
  'install-python': 'Installing Python…',
  'install-deps': 'Installing dependencies (~2.5 GB, one time)…',
  'download-ffmpeg': 'Downloading ffmpeg…',
  error: 'Could not set up the processing server',
};

export function BackendSetupBanner() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => desktopBridge()?.onBackendStatus(setStatus) ?? undefined, []);

  if (!status || status.stage === 'ready' || status.stage === 'idle') return null;
  const isError = status.stage === 'error';

  return (
    <div className={isError ? 'backend-banner error' : 'backend-banner'}>
      {!isError && <span className="backend-spinner" aria-hidden="true" />}
      <span className="backend-banner-text">
        {t(STAGE_LABEL[status.stage] ?? status.stage)}
        {status.progress != null && ` ${status.progress}%`}
        {status.detail && <span className="dim small"> · {status.detail}</span>}
      </span>
      {isError && desktopBridge()?.retrySetup && (
        <button className="btn tiny" onClick={() => desktopBridge()?.retrySetup?.()}>{t('Retry')}</button>
      )}
      <span className="dim small">{t('Warm-ups and exercises already work')}</span>
    </div>
  );
}
