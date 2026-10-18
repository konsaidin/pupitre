// Единая шапка экрана: кнопка «назад», заголовок, опциональный подзаголовок.
// Один компонент на все экраны — навигация не теряется ни на телефоне, ни на десктопе.

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../lib/i18n';
import { Icon } from './Icon';

interface ScreenHeaderProps {
  title: ReactNode;
  /** куда ведёт «назад» (по умолчанию — главное меню) */
  backTo?: string;
  subtitle?: ReactNode;
  /** место под кнопку/бейдж справа */
  action?: ReactNode;
  eyebrow?: ReactNode;
}

export function ScreenHeader({ title, backTo = '/', subtitle, action, eyebrow }: ScreenHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="screen-head">
      <div className="screen-head-row">
        <button className="back-btn" aria-label={t('Back')} onClick={() => navigate(backTo)}>
          <Icon name="arrow" size={18} className="back-arrow" />
        </button>
        <div className="screen-head-title">
          {eyebrow && <span className="overline">{eyebrow}</span>}
          <h1>{title}</h1>
        </div>
        {action && <div className="screen-head-action">{action}</div>}
      </div>
      {subtitle && <p className="lead dim">{subtitle}</p>}
    </header>
  );
}
