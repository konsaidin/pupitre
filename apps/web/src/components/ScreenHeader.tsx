// Заголовок страницы «Рампы»: надпись-метка, заголовок, подзаголовок, действие справа. Навигация — в верхней панели
// (вкладки), поэтому кнопка «назад» — только если задан backTo.
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { GuitarIcon } from '../guitar/ui/GuitarIcon';
import { t } from '../lib/i18n';

interface ScreenHeaderProps {
  title: ReactNode;
  /** куда ведёт «назад»; нет — кнопки нет */
  backTo?: string;
  subtitle?: ReactNode;
  /** место под кнопку/бейдж справа */
  action?: ReactNode;
  eyebrow?: ReactNode;
}

export function ScreenHeader({ title, backTo, subtitle, action, eyebrow }: ScreenHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="vo-head">
      <div>
        {backTo && (
          <button className="rp-btn rp-btn--ghost rp-btn--sm vo-back" onClick={() => navigate(backTo)}>
            <GuitarIcon name="arrow-left" size="sm" />
            {t('Back')}
          </button>
        )}
        {eyebrow && <span className="rp-label">{eyebrow}</span>}
        <h1 className="rp-h1">{title}</h1>
        {subtitle && <p className="rp-muted vo-head__sub">{subtitle}</p>}
      </div>
      {action && <div className="vo-head__actions">{action}</div>}
    </header>
  );
}
