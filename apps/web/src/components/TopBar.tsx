import { useLocation, useNavigate } from 'react-router-dom';
import { APP_NAME } from '../lib/branding';
import { t } from '../lib/i18n';
import { classifyRange, midiToName } from '../lib/music';
import { practiceStreak } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';
import { Icon, type IconName } from './Icon';

const LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Overview', icon: 'home' },
  { to: '/exercises', label: 'Practice', icon: 'waves' },
  { to: '/songs', label: 'My songs', icon: 'note' },
];

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
          <span className="brand-mark">
            <Icon name="waves" size={24} strokeWidth={2.5} />
          </span>
          <span className="brand-name">
            {APP_NAME}
            <span>VOICE STUDIO</span>
          </span>
        </button>
        <span className="nav-caption overline">{t('Your space')}</span>
        <nav className="topnav" aria-label={t('Main navigation')}>
          {LINKS.map((l) => (
            <button
              key={l.to}
              aria-label={t(l.label)}
              title={t(l.label)}
              className={pathname === l.to ? 'topnav-link active' : 'topnav-link'}
              aria-current={pathname === l.to ? 'page' : undefined}
              onClick={() => navigate(l.to)}
            >
              <Icon name={l.icon} size={20} />
              <span>{t(l.label)}</span>
              {pathname === l.to && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="sidebar-bars" aria-hidden="true">
            {[18, 28, 39, 23, 48, 33, 20, 39, 27, 16].map((h, i) => (
              <i key={i} style={{ height: h }} />
            ))}
          </div>
          <p>
            {t('A little practice.')}
            <br />
            <strong>{t('A voice that feels like you.')}</strong>
          </p>
          {streak > 0 && (
            <span className="streak">
              <Icon name="flame" size={16} /> {t('{n} d.', { n: streak })} {t('in a row')}
            </span>
          )}
        </div>
        <div className="topbar-right">
          <button
            className={pathname === '/settings' ? 'topnav-link active' : 'topnav-link'}
            aria-label={t('Settings')}
            title={t('Settings')}
            aria-current={pathname === '/settings' ? 'page' : undefined}
            onClick={() => navigate('/settings')}
          >
            <Icon name="sliders" size={20} />
            <span>{t('Settings')}</span>
          </button>
          <button
            aria-label={t('My voice')}
            title={t('My voice')}
            className="sidebar-profile"
            onClick={() => navigate('/range')}
          >
            <span className="profile-avatar">
              <Icon name="user" size={21} />
            </span>
            <span>
              <strong>{r ? t(classifyRange(r.lowMidi, r.highMidi)) : t('My voice')}</strong>
              <small>
                {r ? `${midiToName(r.lowMidi)} — ${midiToName(r.highMidi)}` : t('Discover your range')}
              </small>
            </span>
            <Icon name="chevron" size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
