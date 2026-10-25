// Ссылка раздела без Link из react-router: модуль роутера живёт во входном чанке, и каждый новый его экспорт,
// взятый ленивым разделом, утяжеляет вход (бюджет СБОРКА-ОК). HashRouter сам слушает смену location.hash.
import type { AnchorHTMLAttributes } from 'react';

interface HashLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** Путь внутри HashRouter, например '/guitar/tuner'. */
  to: string;
}

export function HashLink({ to, ...rest }: HashLinkProps) {
  return <a href={`#${to}`} {...rest} />;
}
