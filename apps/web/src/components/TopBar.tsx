// Верхняя навигация: логотип-заглушка, вкладки разделов, серия занятий,
// настройки и чип голосового профиля. Скрывается на игровых экранах (см. App).

import { useLocation, useNavigate } from 'react-router-dom';
import { APP_NAME } from '../lib/branding';
import { t } from '../lib/i18n';
import { classifyRange } from '../lib/music';
import { practiceStreak } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { Icon } from './Icon';

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/songs', label: 'Library' },
  { to: '/exercises', label: 'Exercises' },
] as const;

export function TopBar() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const streak = practiceStreak(profile.scores);
  const r = profile.range;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" onClick={() => navigate('/')} aria-label={APP_NAME}>
          <span className="brand-mark"><Icon name="mic" size={19} /></span>
          <span className="brand-name">{APP_NAME}</span>
        </button>
        <nav className="topnav">
          {LINKS.map((l) => (
            <button
              key={l.to}
              className={pathname === l.to ? 'topnav-link active' : 'topnav-link'}
              onClick={() => navigate(l.to)}
            >
              {t(l.label)}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {streak > 0 && (
            <span className="chip streak" title={t('Practice streak')}>
              <Icon name="flame" size={15} /> {t('{n} d.', { n: streak })}
            </span>
          )}
          <button className="icon-btn" onClick={() => navigate('/settings')} aria-label={t('Settings')}>
            <Icon name="gear" size={17} />
          </button>
          <button className="chip" onClick={() => navigate('/range')}>
            <Icon name="user" size={15} />
            {r ? t(classifyRange(r.lowMidi, r.highMidi)) : t('My voice')}
          </button>
        </div>
      </div>
    </header>
  );
}
