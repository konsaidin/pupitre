// Гитарный раздел — ленивый чанк (App.tsx, маршрут /guitar/*). Подключает «Рампу» и словарь раздела, ставит
// data-section="guitar" на <html> на время пребывания (переопределения телефона и изоляция в rampa.css), маршруты
// §9.1: экраны внутри оболочки, игра — без неё. Экраны будущих этапов — заглушки. Вход инструмента держится, пока открыт
// раздел (InputSession): игра тоже внутри раздела — мониторинг себя не прерывается.
import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RU, t } from '../lib/i18n';
import { GuitarShell } from './GuitarShell';
import { HashLink } from './HashLink';
import { HighwayDev } from './dev/HighwayDev';
import { InputSession } from './input/useInput';
import { StoreDev } from './dev/StoreDev';
import { InputScreen } from './screens/Input/InputScreen';
import { LibraryScreen } from './screens/Library/LibraryScreen';
import { PlayScreen } from './screens/Play/PlayScreen';
import { SongScreen } from './screens/Song/SongScreen';
import { ToneScreen } from './screens/Tone/ToneScreen';
import { TunerScreen } from './screens/Tuner/TunerScreen';
import { GUITAR_RU } from './i18n';
import './ui/rampa.css';

// Только недостающие ключи: у вокала свои переводы общих строк, раздел их не перетирает.
for (const [key, value] of Object.entries(GUITAR_RU)) RU[key] ??= value;

function ScreenStub({ screen, title }: { screen: string; title: string }) {
  return (
    <div className="rp-page">
      <div className="rp-empty" data-ui={`stub-${screen}`}>
        <h1 className="rp-h1">{title}</h1>
        <p>{t('This screen is being built')}</p>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="rp-page">
      <div className="rp-empty" data-ui="not-found">
        <h1 className="rp-h1">{t('Not found')}</h1>
        <HashLink className="rp-btn" to="/guitar">
          {t('Back to the library')}
        </HashLink>
      </div>
    </div>
  );
}

export default function GuitarApp() {
  // StrictMode: эффект ставит атрибут, очистка снимает, повторный эффект ставит снова.
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.section = 'guitar';
    return () => {
      delete html.dataset.section;
    };
  }, []);

  return (
    <div className="rampa" data-ui="guitar-root">
      <InputSession />
      <Routes>
        <Route path="play/:songId/:arrId" element={<PlayScreen />} />
        {import.meta.env.DEV && <Route path="_dev/highway" element={<HighwayDev />} />}
        <Route
          path="*"
          element={
            <GuitarShell>
              <ShellScreens />
            </GuitarShell>
          }
        />
      </Routes>
    </div>
  );
}

// Экраны внутри оболочки — вложенные Routes (без Outlet: см. HashLink.tsx про бюджет входного чанка).
function ShellScreens() {
  return (
    <Routes>
      <Route index element={<LibraryScreen />} />
      <Route path="song/:songId" element={<SongScreen />} />
      <Route path="results/:sessionId" element={<ScreenStub screen="results" title={t('Results')} />} />
      <Route path="tuner" element={<TunerScreen />} />
      <Route path="calibrate" element={<ScreenStub screen="calibrate" title={t('Calibration')} />} />
      <Route path="sync/:songId" element={<ScreenStub screen="sync" title={t('Sync editor')} />} />
      <Route path="tone" element={<ToneScreen />} />
      <Route path="input" element={<InputScreen />} />
      <Route path="about" element={<ScreenStub screen="about" title={t('Third-party components')} />} />
      {import.meta.env.DEV && <Route path="_system" element={<ScreenStub screen="system" title={t('Design system')} />} />}
      {import.meta.env.DEV && <Route path="_dev/store" element={<StoreDev />} />}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
