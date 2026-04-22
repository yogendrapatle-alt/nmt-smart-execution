import React from 'react';

interface PageHeaderProps {
  icon?: string;
  iconGradient?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  icon,
  iconGradient = 'linear-gradient(135deg, #0078d4, #005a9e)',
  title,
  subtitle,
  actions,
}) => (
  <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-3">
    <div>
      <h2 className="fw-bold mb-1 d-flex align-items-center gap-2" style={{ fontSize: 'var(--text-2xl)' }}>
        {icon && (
          <div
            className="d-inline-flex align-items-center justify-content-center rounded-3"
            style={{ width: 44, height: 44, background: iconGradient, flexShrink: 0 }}
          >
            <i className="material-icons-outlined text-white" style={{ fontSize: 24 }}>{icon}</i>
          </div>
        )}
        {title}
      </h2>
      {subtitle && (
        <p className="mb-0" style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)' }}>
          {subtitle}
        </p>
      )}
    </div>
    {actions && <div className="d-flex align-items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

export default PageHeader;
