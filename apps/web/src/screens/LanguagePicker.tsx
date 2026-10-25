// Первый запуск: выбор языка на «Рампе» — постер слева, знак и заголовок справа, две кнопки (русский — главная).
import { useEffect } from 'react';
import { APP_NAME } from '../lib/branding';
import { setLang, type Lang } from '../lib/i18n';
import { RampaPoster } from '../components/RampaPoster';
import { GuitarIcon } from '../guitar/ui/GuitarIcon';
import './vocal.css';

export function LanguagePicker({ onPick }: { onPick: (lang: Lang) => void }) {
  useEffect(() => {
    document.documentElement.dataset.section = 'vocal';
  }, []);
  const pick = (lang: Lang) => {
    setLang(lang);
    onPick(lang);
  };
  return (
    <div className="rampa">
      <div className="screen lang-picker vo-lang" data-ui="vocal-language">
        <RampaPoster seed="your-voice-your-way" glyph="P" className="vo-lang__poster">
          <span className="rp-label vo-lang__motto">YOUR VOICE. YOUR OWN WAY.</span>
        </RampaPoster>
        <div className="vo-lang__body">
          <span className="rp-brand">
            <span className="rp-brand__name">{APP_NAME}</span>
            <span className="rp-brand__mode">VOICE · GUITAR</span>
          </span>
          <h1 className="rp-display vo-lang__title">
            Make room
            <br />
            for your voice.
          </h1>
          <p className="rp-muted">
            Твой голос может больше.
            <br />
            Начни с языка, на котором тебе удобно.
          </p>
          <div className="vo-lang__options">
            <button className="rp-btn rp-btn--light rp-btn--xl" onClick={() => pick('ru')}>
              Русский <span className="rp-num rp-faint">RU</span>
              <GuitarIcon name="arrow-right" />
            </button>
            <button className="rp-btn rp-btn--xl" onClick={() => pick('en')}>
              English <span className="rp-num rp-faint">EN</span>
              <GuitarIcon name="arrow-right" />
            </button>
          </div>
          <span className="rp-label">Choose your language · Выбери язык</span>
        </div>
      </div>
    </div>
  );
}
