// Первый запуск: выбор языка. Показывается, пока язык не сохранён.

import { setLang, type Lang } from '../lib/i18n';
import { ShinyText } from '../components/fx/ShinyText';

export function LanguagePicker({ onPick }: { onPick: (lang: Lang) => void }) {
  const pick = (lang: Lang) => {
    setLang(lang);
    onPick(lang);
  };
  return (
    <div className="screen lang-picker">
      <h1 className="logo">🎤 <ShinyText>Slopsician</ShinyText></h1>
      <p className="lead">Choose your language · Выбери язык</p>
      <div className="lang-options">
        <button className="btn primary big" onClick={() => pick('en')}>English</button>
        <button className="btn big" onClick={() => pick('ru')}>Русский</button>
      </div>
    </div>
  );
}
