// Оболочка раздела (ui-spec §11.1, 01-architecture.md §9.2): общая RampaShell с вкладками гитары, пилюлей деки записи
// (пока идёт запись или прослушивание — на любом экране) и пилюлей входа (input/InputPill). Экраны — children (вложенные
// Routes в GuitarApp); игра — вне оболочки.
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '../lib/i18n';
import { DeckPill } from './input/DeckPill';
import { DB_BLOCKED_EVENT } from './store/db';
import { InputPill } from './input/InputPill';
import { RampaShell, type ShellTab } from './ui/RampaShell';

const TABS: ShellTab[] = [
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

/** Обновление хранилища ждёт другую вкладку старой версии — пилюля просит её закрыть. */
function useDbBlocked(): boolean {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const on = () => setBlocked(true);
    globalThis.addEventListener(DB_BLOCKED_EVENT, on);
    return () => globalThis.removeEventListener(DB_BLOCKED_EVENT, on);
  }, []);
  return blocked;
}

export function GuitarShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const dbBlocked = useDbBlocked();
  return (
    <RampaShell
      mode="guitar"
      home="/guitar"
      tabs={TABS}
      pathname={pathname}
      status={
        <>
          {dbBlocked && (
            <span className="rp-chip rp-chip--warn rp-chip--dot" role="status" data-ui="shell-db-blocked">
              {t('Close other Pupitre tabs: the storage is updating')}
            </span>
          )}
          <DeckPill />
          <InputPill />
        </>
      }
      onSwitch={() => navigate('/')}
      mainId="guitar-main"
      brandLabel={t('Pupitre, guitar mode')}
      navLabel={t('Guitar mode sections')}
    >
      {children}
    </RampaShell>
  );
}
