// Плашка о развёртывании встроенного бэкенда (только в десктоп-приложении):
// при первом запуске докачиваются Python-окружение и ffmpeg — показываем этапы.

import { useEffect, useState } from 'react';
import { desktopBridge } from '../lib/api';
import { t } from '../lib/i18n';
import { GuitarIcon } from '../guitar/ui/GuitarIcon';

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
    <div className="rampa vo-banner" data-ui="backend-banner">
      <div className={`rp-toast${isError ? ' rp-toast--bad' : ''} vo-banner__toast`} role="status">
        <GuitarIcon name={isError ? 'alert-triangle' : 'loader-2'} className={isError ? undefined : 'vo-spin'} />
        <span>
          <b>{t(STAGE_LABEL[status.stage] ?? status.stage)}</b>
          {status.progress != null && <span className="rp-num"> {status.progress}%</span>}
          {status.detail && <span className="rp-faint"> · {status.detail}</span>}
          <small>{t('Warm-ups and exercises already work')}</small>
        </span>
        {isError && desktopBridge()?.retrySetup && (
          <button className="rp-btn rp-btn--sm" onClick={() => desktopBridge()?.retrySetup?.()}>
            {t('Retry')}
          </button>
        )}
      </div>
    </div>
  );
}
