// Пилюля деки записи в оболочке раздела: пока идёт запись или прослушивание дубля — «● REC 0:42» / «▶ 0:12» на любом
// экране (дека живёт вне экрана «Тон»); клик — к деке.
import { useEffect, useRef } from 'react';
import { t } from '../../lib/i18n';
import { HashLink } from '../HashLink';
import { deckSeconds, useDeck } from '../store/deck';

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function DeckPill() {
  const deck = useDeck();
  const live = deck.phase === 'recording' || deck.phase === 'playing';
  const time = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!live) return;
    const tick = () => {
      if (time.current) time.current.textContent = mmss(deckSeconds());
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [live]);
  if (!live) return null;
  const rec = deck.phase === 'recording';
  return (
    <HashLink to="/guitar/tone" className={`rp-chip rp-chip--dot deck-pill${rec ? ' deck-pill--rec' : ''}`} data-ui="shell-deck"
      aria-label={rec ? t('Recording a take — open the recorder') : t('A take is playing — open the recorder')}>
      <b>{rec ? 'REC' : 'PLAY'}</b>
      <span className="rp-num" ref={time}>0:00</span>
    </HashLink>
  );
}
