// Общая оболочка «Рампы» для обоих режимов (ui-spec §11.1): панель 60/56 px — знак режима, «Пюпитр | <режим>», вкладки
// с линией-рампой под активной, справа — слот режима (пилюля входа гитары или голоса), переключатель «Голос | Гитара»,
// аватар; на телефоне та же разметка — левый рельс (rampa.css, раздел А). Без импортов audio/** и guitar/** кроме ui —
// живёт во входном чанке вместе с вокалом.
import type { ReactNode } from 'react';
import { APP_NAME } from '../../lib/branding';
import { t } from '../../lib/i18n';
import { HashLink } from '../HashLink';
import { GuitarIcon, type GuitarIconName } from './GuitarIcon';

export type ShellMode = 'voice' | 'guitar';

export interface ShellTab {
  id: string;
  to: string;
  label: string;
  short: string;
  icon: GuitarIconName;
  /** Активна ли вкладка на этом пути. */
  match: (pathname: string) => boolean;
}

// Знак гитары: шесть струн цветами струн, сходящиеся к свету (макет, tpl-topbar).
const STRING_COLORS = ['#FF4F5A', '#E2C102', '#1DACF9', '#FF9216', '#3FCC0C', '#C825ED'];
const STRING_X = [3.6, 7, 10.3, 13.7, 17, 20.4];
// Знак голоса: та же «рампа» света, вместо струн — волна голоса столбиками.
const VOICE_BARS = [[4, 8], [8, 5], [12, 2.5], [16, 5.5], [20, 8.5]];

function BrandMark({ mode }: { mode: ShellMode }) {
  return (
    <svg className="rp-brand__mark" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeWidth={1.9} aria-hidden="true">
      {mode === 'guitar'
        ? STRING_X.map((x, i) => <path key={x} d={`M12 5 ${x} 20.4`} stroke={STRING_COLORS[i]} />)
        : VOICE_BARS.map(([x, top]) => <path key={x} d={`M${x} ${top} V${24 - top}`} stroke="url(#rp-voice-mark)" />)}
      {mode === 'voice' && (
        <defs>
          <linearGradient id="rp-voice-mark" gradientUnits="userSpaceOnUse" x1="3" y1="0" x2="21" y2="0">
            <stop offset="0" stopColor="#72D0FF" />
            <stop offset="0.5" stopColor="#F5F7FF" />
            <stop offset="1" stopColor="#FFA06E" />
          </linearGradient>
        </defs>
      )}
      {mode === 'guitar' && <circle cx="12" cy="4.2" r="2" fill="#F5F7FF" stroke="none" />}
    </svg>
  );
}

interface Props {
  mode: ShellMode;
  home: string;
  tabs: ShellTab[];
  pathname: string;
  /** Слот режима справа (пилюля входа). */
  status?: ReactNode;
  /** Переход в другой режим; нет — переключатель не рисуется (гитара выключена флагом). */
  onSwitch?: (to: ShellMode) => void;
  /** Аватар: ссылка на профиль режима; нет — неактивен с подсказкой. */
  avatar?: { to: string; label: string; initials?: ReactNode };
  mainId: string;
  /** Подписи для экранных читалок: знак режима и навигация (по умолчанию — «Пюпитр, <режим>» и «Разделы»). */
  brandLabel?: string;
  navLabel?: string;
  children: ReactNode;
}

export function RampaShell({ mode, home, tabs, pathname, status, onSwitch, avatar, mainId, brandLabel, navLabel, children }: Props) {
  const modeLabel = mode === 'guitar' ? t('Guitar') : t('Voice');
  return (
    <div className="rp-shell" data-ui="shell" data-mode={mode}>
      <header className="rp-topbar" data-ui="shell-topbar">
        <HashLink className="rp-brand" to={home} aria-label={brandLabel ?? `${APP_NAME}, ${modeLabel}`} data-ui="shell-brand">
          <BrandMark mode={mode} />
          <span className="rp-brand__name">{APP_NAME}</span>
          <span className="rp-brand__mode">{modeLabel}</span>
        </HashLink>
        <nav className="rp-nav" aria-label={navLabel ?? t('Sections')} data-ui="shell-nav">
          {tabs.map((tab) => (
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
          {status}
          {onSwitch && (
            <div className="rp-seg rp-seg--sm rp-modeswitch" role="radiogroup" aria-label={t('Pupitre mode')} data-ui="shell-mode-switch">
              {(['voice', 'guitar'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className="rp-seg__item"
                  role="radio"
                  aria-checked={m === mode}
                  onClick={m === mode ? undefined : () => onSwitch(m)}
                >
                  {m === 'guitar' ? t('Guitar') : t('Voice')}
                </button>
              ))}
            </div>
          )}
          {avatar ? (
            <HashLink className="rp-avatar" to={avatar.to} aria-label={avatar.label} title={avatar.label} data-ui="shell-avatar">
              {avatar.initials ?? <GuitarIcon name="user" size="sm" />}
            </HashLink>
          ) : (
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
          )}
        </div>
      </header>
      <main className="rp-main" id={mainId}>
        {children}
      </main>
      <div className="rp-toasts" role="status" aria-live="polite" aria-label={t('Notifications')} data-ui="shell-toasts" />
    </div>
  );
}
