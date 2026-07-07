import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { loadProfile, saveProfile, addScore, type Profile, type ScoreRecord } from '../lib/profile';

interface ProfileApi {
  profile: Profile;
  update: (patch: Partial<Profile>) => void;
  recordScore: (rec: ScoreRecord) => void;
}

const Ctx = createContext<ProfileApi | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());

  const update = useCallback((patch: Partial<Profile>) => {
    setProfile((p) => {
      const next = { ...p, ...patch };
      saveProfile(next);
      return next;
    });
  }, []);

  const recordScore = useCallback((rec: ScoreRecord) => {
    setProfile((p) => addScore(p, rec));
  }, []);

  const api = useMemo(() => ({ profile, update, recordScore }), [profile, update, recordScore]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useProfile(): ProfileApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useProfile вне ProfileProvider');
  return api;
}
