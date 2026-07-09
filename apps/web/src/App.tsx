import { HashRouter, Route, Routes } from 'react-router-dom';
import { ProfileProvider } from './state/ProfileContext';
import { LightRays } from './components/fx/LightRays';
import { HomeScreen } from './screens/HomeScreen';
import { RangeWizard } from './screens/RangeWizard';
import { ExercisesScreen } from './screens/ExercisesScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export default function App() {
  return (
    <ProfileProvider>
      <div className="app-bg" aria-hidden="true">
        <LightRays raysColor="#6366f1" raysOrigin="top-center" lightSpread={0.9} rayLength={1.4} saturation={0.7} fadeDistance={1.1} mouseInfluence={0.08} noiseAmount={0.05} />
      </div>
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
    </ProfileProvider>
  );
}
