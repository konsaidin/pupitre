import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ProfileProvider } from './state/ProfileContext';
import { BackendSetupBanner } from './components/BackendSetupBanner';
import { VocalShell } from './components/VocalShell';
import { MobileLandscape } from './components/MobileLandscape';
import { getSavedLang } from './lib/i18n';
import { GUITAR_ENABLED } from './guitarFlag';
import { HomeScreen } from './screens/HomeScreen';
import { LanguagePicker } from './screens/LanguagePicker';
import { RangeWizard } from './screens/RangeWizard';
import { ExercisesScreen } from './screens/ExercisesScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
// «Рампа» — дизайн-система обоих режимов (с 2026-10-25): во входном чанке
import './guitar/ui/rampa.css';

// раздел до первого кадра — без вспышки без стилей (Chrome уточнит при смене маршрута)
if (!document.documentElement.dataset.section) document.documentElement.dataset.section = /^#\/guitar(\/|$)/.test(location.hash) ? 'guitar' : 'vocal';

/** Игра и живой шаг визарда занимают всю высоту — там топбар не рисуем. */
const BARE_ROUTES = new Set(['/play', '/range']);
/** Гитарный раздел — ленивый чанк со своей оболочкой («Рампа»): вокальный топбар в нём не рисуем. */
const GuitarApp = lazy(() => import('./guitar/GuitarApp'));
const isGuitar = (path: string) => GUITAR_ENABLED && (path === '/guitar' || path.startsWith('/guitar/'));
const isBare = (pathname: string) => BARE_ROUTES.has(pathname) || isGuitar(pathname);

/** Плашка бэкенда — вокальная: в гитарном разделе не рисуется. Путь — из роутера (navigate() не шлёт hashchange). */
function BackendBannerGate() {
  const { pathname } = useLocation();
  return isGuitar(pathname) ? null : <BackendSetupBanner />;
}

function Chrome({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const guitar = isGuitar(pathname);
  useEffect(() => {
    window.scrollTo(0, 0);
    // на телефоне прокручивается рамка 16:9 (MobileLandscape), а не окно
    document.querySelector('.app-frame')?.scrollTo(0, 0);
    // раздел — на <html>: фон, «поверни телефон» и рамка телефона Рампы (гитарный раздел ставит своё значение сам)
    if (!guitar) document.documentElement.dataset.section = 'vocal';
  }, [pathname, guitar]);
  if (guitar) return <>{children}</>;
  // игра и живой шаг визарда — на всю высоту, без панели
  return (
    <div className="rampa" data-ui="vocal-root">
      {isBare(pathname) ? <main className="rp-main" id="main-content">{children}</main> : <VocalShell>{children}</VocalShell>}
    </div>
  );
}

export default function App() {
  // язык выбирается один раз при первом старте; дальше живёт в localStorage
  const [lang, setLangState] = useState(getSavedLang());

  return (
    <ProfileProvider>
      <MobileLandscape>
        {lang === null ? (
          <LanguagePicker onPick={setLangState} />
        ) : (
          <>
            <HashRouter>
              <BackendBannerGate />
              <Chrome>
                <Routes>
                  <Route path="/" element={<HomeScreen />} />
                  <Route path="/range" element={<RangeWizard />} />
                  <Route path="/exercises" element={<ExercisesScreen />} />
                  <Route path="/songs" element={<LibraryScreen />} />
                  <Route path="/play" element={<GameScreen />} />
                  <Route path="/results" element={<ResultsScreen />} />
                  <Route path="/settings" element={<SettingsScreen />} />
                  {GUITAR_ENABLED && (
                    <Route
                      path="/guitar/*"
                      element={
                        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#040509' }} />}>
                          <GuitarApp />
                        </Suspense>
                      }
                    />
                  )}
                </Routes>
              </Chrome>
            </HashRouter>
          </>
        )}
      </MobileLandscape>
    </ProfileProvider>
  );
}
