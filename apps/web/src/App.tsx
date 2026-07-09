import { useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { ProfileProvider } from './state/ProfileContext';
import { BackendSetupBanner } from './components/BackendSetupBanner';
import { LightRays } from './components/fx/LightRays';
import { getSavedLang } from './lib/i18n';
import { HomeScreen } from './screens/HomeScreen';
import { LanguagePicker } from './screens/LanguagePicker';
import { RangeWizard } from './screens/RangeWizard';
import { ExercisesScreen } from './screens/ExercisesScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export default function App() {
  // язык выбирается один раз при первом старте; дальше живёт в localStorage
  const [lang, setLangState] = useState(getSavedLang());

  return (
    <ProfileProvider>
      <div className="app-bg" aria-hidden="true">
        <LightRays raysColor="#6366f1" raysOrigin="top-center" lightSpread={0.9} rayLength={1.4} saturation={0.7} fadeDistance={1.1} mouseInfluence={0.08} noiseAmount={0.05} />
      </div>
      {lang === null ? (
        <LanguagePicker onPick={setLangState} />
      ) : (
        <>
          <BackendSetupBanner />
          <HashRouter>
            <Routes>
              <Route path="/" element={<HomeScreen />} />
              <Route path="/range" element={<RangeWizard />} />
              <Route path="/exercises" element={<ExercisesScreen />} />
              <Route path="/songs" element={<LibraryScreen />} />
              <Route path="/play" element={<GameScreen />} />
              <Route path="/results" element={<ResultsScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
            </Routes>
          </HashRouter>
        </>
      )}
    </ProfileProvider>
  );
}
