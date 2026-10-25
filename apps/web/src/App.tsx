import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ProfileProvider } from './state/ProfileContext';
import { BackendSetupBanner } from './components/BackendSetupBanner';
import { TopBar } from './components/TopBar';
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
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className={isBare(pathname) ? 'app-shell bare' : 'app-shell'}>
      {!isBare(pathname) && <TopBar />}
      <main className="app-main" id="main-content" ref={mainRef}>
        {children}
      </main>
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
