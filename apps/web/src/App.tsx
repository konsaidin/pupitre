import { HashRouter, Route, Routes } from 'react-router-dom';
import { ProfileProvider } from './state/ProfileContext';
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
