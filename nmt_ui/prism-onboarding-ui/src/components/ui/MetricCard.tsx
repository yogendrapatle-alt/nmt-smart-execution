import React from 'react';

type MetricVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

interface MetricCardProps {
  icon?: string;
  iconGradient?: string;
  label: string;
  value: string | number;
  suffix?: string;
  detail?: string;
  variant?: MetricVariant;
  loading?: boolean;
}

const variantMap: Record<MetricVariant, { gradient: string; bg: string }> = {
  default: { gradient: 'linear-gradient(135deg, #0078d4, #005a9e)', bg: '#f0f7ff' },
  success: { gradient: 'linear-gradient(135deg, #198754, #0f6b3a)', bg: '#d1e7dd' },
  warning: { gradient: 'linear-gradient(135deg, #e8a317, #c78b10)', bg: '#fff3cd' },
  danger:  { gradient: 'linear-gradient(135deg, #dc3545, #b02a37)', bg: '#f8d7da' },
  info:    { gradient: 'linear-gradient(135deg, #0dcaf0, #0aa2c0)', bg: '#cff4fc' },
};

const MetricCard: React.FC<MetricCardProps> = ({
  icon,
  iconGradient,
  label,
  value,
  suffix,
  detail,
  variant = 'default',
  loading = false,
}) => {
  const v = variantMap[variant];
  const bg = iconGradient || v.gradient;

  if (loading) {
    return (
      <div className="card border-0 h-100" style={{ borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="card-body d-flex align-items-center gap-3 p-3">
          <div className="skeleton-circle" style={{ width: 42, height: 42, borderRadius: 'var(--radius-sm)' }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton-line" style={{ width: '60%', height: 12, marginBottom: 6 }} />
            <div className="skeleton-line" style={{ width: '40%', height: 20 }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-0 h-100" style={{ borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)' }}>
      <div className="card-body d-flex align-items-center gap-3 p-3">
        {icon && (
          <div
            className="d-flex align-items-center justify-content-center flex-shrink-0"
            style={{ width: 42, height: 42, borderRadius: 'var(--radius-sm)', background: bg }}
          >
            <i className="material-icons-outlined text-white" style={{ fontSize: 22 }}>{icon}</i>
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="text-truncate" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
            {label}
          </div>
          <div className="fw-bold" style={{ fontSize: 'var(--text-xl)', lineHeight: 1.2, color: 'var(--color-text)' }}>
            {value}{suffix && <span style={{ fontSize: 'var(--text-sm)', fontWeight: 400, marginLeft: 2 }}>{suffix}</span>}
          </div>
          {detail && (
            <div className="text-truncate" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
              {detail}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MetricCard;
