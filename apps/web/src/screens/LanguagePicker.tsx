import { APP_NAME } from '../lib/branding';
import { setLang, type Lang } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { StudioArtwork } from '../components/StudioArtwork';

export function LanguagePicker({ onPick }: { onPick: (lang: Lang) => void }) {
  const pick = (lang: Lang) => {
    setLang(lang);
    onPick(lang);
  };
  return (
    <div className="screen lang-picker">
      <div className="lang-visual">
        <StudioArtwork />
        <p>YOUR VOICE. YOUR OWN WAY.</p>
      </div>
      <div className="lang-content">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="waves" size={24} />
          </span>
          <span className="brand-name">
            {APP_NAME}
            <span>VOICE STUDIO</span>
          </span>
        </div>
        <h1>
          Make room
          <br />
          for your voice.
        </h1>
        <p>
          Твой голос может больше.
          <br />
          Начни с языка, на котором тебе удобно.
        </p>
        <div className="lang-options">
          <button className="btn primary" onClick={() => pick('ru')}>
            <span>
              Русский <small>RU</small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
          <button className="btn" onClick={() => pick('en')}>
            <span>
              English <small>EN</small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
        </div>
        <span className="lang-footer">Choose your language · Выбери язык</span>
      </div>
    </div>
  );
}
