// Оболочка вокального режима на «Рампе»: общая RampaShell с вкладками голоса (Обзор · Практика · Мои песни ·
// Настройки), справа — пилюля «Мой голос» (тип голоса и диапазон или «Узнать свой диапазон», серия дней) и
// переключатель «Голос | Гитара» (если раздел гитары включён).
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HashLink } from '../guitar/HashLink';
import { GuitarIcon } from '../guitar/ui/GuitarIcon';
import { RampaShell, type ShellTab } from '../guitar/ui/RampaShell';
import { GUITAR_ENABLED } from '../guitarFlag';
import { t } from '../lib/i18n';
import { classifyRange, midiToName } from '../lib/music';
import { practiceStreak } from '../lib/profile';
import { useProfile } from '../state/ProfileContext';

const TABS: ShellTab[] = [
  { id: 'home', to: '/', label: 'Overview', short: 'Overview', icon: 'layout-grid', match: (p) => p === '/' },
  { id: 'practice', to: '/exercises', label: 'Practice', short: 'Practice', icon: 'wave-sine', match: (p) => p.startsWith('/exercises') },
  { id: 'songs', to: '/songs', label: 'My songs', short: 'Songs', icon: 'music', match: (p) => p.startsWith('/songs') },
  { id: 'settings', to: '/settings', label: 'Settings', short: 'Settings', icon: 'adjustments-horizontal', match: (p) => p.startsWith('/settings') },
];

const pretty = (name: string) => name.replace('#', '♯');

function VoicePill() {
  const { profile } = useProfile();
  const r = profile.range;
  const streak = practiceStreak(profile.scores);
  return (
    <HashLink className="rp-inputpill" to="/range" data-ui="shell-voice-pill" title={t('My voice')}>
      <GuitarIcon name="microphone" size="sm" />
      {r ? (
        <>
          <b>{t(classifyRange(r.lowMidi, r.highMidi))}</b>
          <span className="rp-num">
            {pretty(midiToName(r.lowMidi))}–{pretty(midiToName(r.highMidi))}
          </span>
        </>
      ) : (
        <span>{t('Discover your range')}</span>
      )}
      {streak > 0 && (
        <span className="rp-num" title={`${t('{n} d.', { n: streak })} ${t('in a row')}`}>
          <GuitarIcon name="flame" size="sm" /> {streak}
        </span>
      )}
    </HashLink>
  );
}

export function VocalShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <RampaShell
      mode="voice"
      home="/"
      tabs={TABS}
      pathname={pathname}
      status={<VoicePill />}
      onSwitch={GUITAR_ENABLED ? () => navigate('/guitar') : undefined}
      avatar={{ to: '/range', label: t('My voice') }}
      mainId="main-content"
    >
      {children}
    </RampaShell>
  );
}
