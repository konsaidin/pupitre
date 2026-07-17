import { useState, type ReactNode } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ProfileProvider } from './state/ProfileContext';
import { BackendSetupBanner } from './components/BackendSetupBanner';
import { TopBar } from './components/TopBar';
import { getSavedLang } from './lib/i18n';
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

function Chrome({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <>
      {!BARE_ROUTES.has(pathname) && <TopBar />}
      {children}
    </>
  );
}

export default function App() {
  // язык выбирается один раз при первом старте; дальше живёт в localStorage
  const [lang, setLangState] = useState(getSavedLang());

  return (
    <ProfileProvider>
      {lang === null ? (
        <LanguagePicker onPick={setLangState} />
      ) : (
        <>
          <BackendSetupBanner />
          <HashRouter>
            <Chrome>
              <Routes>
                <Route path="/" element={<HomeScreen />} />
                <Route path="/range" element={<RangeWizard />} />
                <Route path="/exercises" element={<ExercisesScreen />} />
                <Route path="/songs" element={<LibraryScreen />} />
                <Route path="/play" element={<GameScreen />} />
                <Route path="/results" element={<ResultsScreen />} />
                <Route path="/settings" element={<SettingsScreen />} />
              </Routes>
            </Chrome>
          </HashRouter>
        </>
      )}
    </ProfileProvider>
  );
}
