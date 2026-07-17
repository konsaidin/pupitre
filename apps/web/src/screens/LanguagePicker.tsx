// Первый запуск: выбор языка. Показывается, пока язык не сохранён.

import { APP_NAME } from '../lib/branding';
import { setLang, type Lang } from '../lib/i18n';
import { Icon } from '../components/Icon';

export function LanguagePicker({ onPick }: { onPick: (lang: Lang) => void }) {
  const pick = (lang: Lang) => {
    setLang(lang);
    onPick(lang);
  };
  return (
    <div className="screen lang-picker">
      <span className="brand-mark big"><Icon name="mic" size={28} /></span>
      <h1>{APP_NAME}</h1>
      <p className="lead">Choose your language · Выбери язык</p>
      <div className="lang-options">
        <button className="btn primary big" onClick={() => pick('en')}>English</button>
        <button className="btn big" onClick={() => pick('ru')}>Русский</button>
      </div>
    </div>
  );
}
