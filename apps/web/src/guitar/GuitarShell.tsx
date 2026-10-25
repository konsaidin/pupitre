// Оболочка раздела (ui-spec §11.1, 01-architecture.md §9.2): панель 60/56 px — знак, «Пюпитр | Гитара», вкладки с
// линией-рампой под активной, пилюля входа (input/InputPill), переключатель «Голос | Гитара», аватар; на телефоне та же разметка
// становится левым рельсом (rampa.css, раздел А). Экраны — children (вложенные Routes в GuitarApp); игра — вне оболочки.
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { APP_NAME } from '../lib/branding';
import { t } from '../lib/i18n';
import { HashLink } from './HashLink';
import { InputPill } from './input/InputPill';
import { GuitarIcon, type GuitarIconName } from './ui/GuitarIcon';

interface Tab {
  id: string;
  to: string;
  label: string;
  short: string;
  icon: GuitarIconName;
  /** Активна ли вкладка на этом пути (подготовка песни — часть библиотеки). */
  match: (pathname: string) => boolean;
}

const TABS: Tab[] = [
  {
    id: 'library',
    to: '/guitar',
    label: 'Library',
    short: 'Songs',
    icon: 'books',
    match: (p) => p === '/guitar' || p.startsWith('/guitar/song'),
  },
  {
    id: 'tuner',
    to: '/guitar/tuner',
    label: 'Tuner',
    short: 'Tuner',
    icon: 'c-fork',
    match: (p) => p.startsWith('/guitar/tuner'),
  },
  {
    id: 'tone',
    to: '/guitar/tone',
    label: 'Tone',
    short: 'Tone',
    icon: 'c-amp',
    match: (p) => p.startsWith('/guitar/tone'),
  },
  {
    id: 'input',
    to: '/guitar/input',
    label: 'Input and sound',
    short: 'Input',
    icon: 'plug-connected',
    match: (p) => p.startsWith('/guitar/input'),
  },
];

// Знак раздела: шесть струн цветами струн, сходящиеся к свету (макет, tpl-topbar).
const STRING_COLORS = ['#FF4F5A', '#E2C102', '#1DACF9', '#FF9216', '#3FCC0C', '#C825ED'];
const STRING_X = [3.6, 7, 10.3, 13.7, 17, 20.4];
function BrandMark() {
  return (
    <svg className="rp-brand__mark" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeWidth={1.7} aria-hidden="true">
      {STRING_X.map((x, i) => (
        <path key={x} d={`M12 5 ${x} 20.4`} stroke={STRING_COLORS[i]} />
      ))}
      <circle cx="12" cy="4.2" r="2" fill="#F5F7FF" stroke="none" />
    </svg>
  );
}

export function GuitarShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <div className="rp-shell" data-ui="shell">
      <header className="rp-topbar" data-ui="shell-topbar">
        <HashLink className="rp-brand" to="/guitar" aria-label={t('Pupitre, guitar mode')} data-ui="shell-brand">
          <BrandMark />
          <span className="rp-brand__name">{APP_NAME}</span>
          <span className="rp-brand__mode">{t('Guitar')}</span>
        </HashLink>
        <nav className="rp-nav" aria-label={t('Guitar mode sections')} data-ui="shell-nav">
          {TABS.map((tab) => (
            <HashLink
              key={tab.id}
              to={tab.to}
              data-nav={tab.id}
              data-ui={`shell-tab-${tab.id}`}
              aria-current={tab.match(pathname) ? 'page' : undefined}
            >
              <GuitarIcon name={tab.icon} />
              <span>{t(tab.label)}</span>
              <i className="rp-nav__short">{t(tab.short)}</i>
            </HashLink>
          ))}
        </nav>
        <div className="rp-topbar__right">
          <InputPill />
          <div className="rp-seg rp-seg--sm rp-modeswitch" role="radiogroup" aria-label={t('Pupitre mode')} data-ui="shell-mode-switch">
            <button type="button" className="rp-seg__item" role="radio" aria-checked="false" onClick={() => navigate('/')}>
              {t('Voice')}
            </button>
            <button type="button" className="rp-seg__item" role="radio" aria-checked="true">
              {t('Guitar')}
            </button>
          </div>
          {/* Статистика игрока — этап 38b; до него кнопка неактивна с подсказкой. */}
          <button
            type="button"
            className="rp-avatar"
            disabled
            title={t('Player statistics will appear later')}
            aria-label={t('Profile')}
            data-ui="shell-avatar"
          >
            <GuitarIcon name="user" size="sm" />
          </button>
        </div>
      </header>
      <main className="rp-main" id="guitar-main">
        {children}
      </main>
      <div className="rp-toasts" role="status" aria-live="polite" aria-label={t('Notifications')} data-ui="shell-toasts" />
    </div>
  );
}
