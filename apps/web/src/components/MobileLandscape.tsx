import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../lib/i18n';

// Short touch screens are phones in landscape; narrow screens also cover portrait.
const PHONE_QUERY = '(any-pointer: coarse) and (max-height: 600px), (max-width: 680px)';
const PORTRAIT_QUERY = '(orientation: portrait)';
const LandscapeContext = createContext({ phone: false, blocked: false });

export function useMobileLandscape() {
  return useContext(LandscapeContext);
}

export function MobileLandscape({ children }: { children: ReactNode }) {
  const [phone, setPhone] = useState(() => matchMedia(PHONE_QUERY).matches);
  const [portrait, setPortrait] = useState(() => matchMedia(PORTRAIT_QUERY).matches);
  const frameRef = useRef<HTMLDivElement>(null);
  const blocked = phone && portrait;

  useEffect(() => {
    const phoneQuery = matchMedia(PHONE_QUERY);
    const portraitQuery = matchMedia(PORTRAIT_QUERY);
    const sync = () => {
      setPhone(phoneQuery.matches);
      setPortrait(portraitQuery.matches);
    };
    phoneQuery.addEventListener('change', sync);
    portraitQuery.addEventListener('change', sync);
    sync();
    return () => {
      phoneQuery.removeEventListener('change', sync);
      portraitQuery.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    if (frameRef.current) frameRef.current.inert = blocked;
  }, [blocked]);

  return (
    <LandscapeContext.Provider value={{ phone, blocked }}>
      <div className={`viewport${phone ? ' mobile-viewport' : ''}${blocked ? ' portrait' : ''}`}>
        <div className="app-frame" ref={frameRef} aria-hidden={blocked || undefined}>
          {children}
        </div>
        {blocked && (
          <div className="orientation-gate" role="status">
            <svg className="rotate-phone" viewBox="0 0 120 120" fill="none" aria-hidden="true">
              <rect x="20" y="35" width="80" height="50" rx="10" stroke="currentColor" strokeWidth="2.5" />
              <path
                d="M88 47v26M32 58v4M22 20a48 48 0 0 1 77 6m-1-14 2 16-16-2M98 100a48 48 0 0 1-77-6m1 14-2-16 16 2"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M46 64v-8m9 14V50m10 24V46m9 20V54"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <span className="overline">PUPITRE · 16:9</span>
            <h1>{t('Turn your phone sideways')}</h1>
            <p>{t('Your studio is made for landscape. Rotate your phone to continue.')}</p>
          </div>
        )}
      </div>
    </LandscapeContext.Provider>
  );
}
