import React from 'react';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

interface StatusBadgeProps {
  label: string;
  variant?: BadgeVariant;
  dot?: boolean;
  size?: 'sm' | 'md';
}

const colors: Record<BadgeVariant, { bg: string; text: string; dot: string }> = {
  success: { bg: 'var(--color-success-light)', text: 'var(--color-success)', dot: 'var(--color-success)' },
  warning: { bg: 'var(--color-warning-light)', text: '#856404', dot: 'var(--color-warning)' },
  danger:  { bg: 'var(--color-danger-light)', text: 'var(--color-danger)', dot: 'var(--color-danger)' },
  info:    { bg: 'var(--color-info-light)', text: '#055160', dot: 'var(--color-info)' },
  neutral: { bg: '#eef0f2', text: 'var(--color-text-secondary)', dot: 'var(--color-text-muted)' },
  primary: { bg: 'var(--color-primary-light)', text: 'var(--color-primary)', dot: 'var(--color-primary)' },
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ label, variant = 'neutral', dot = false, size = 'sm' }) => {
  const c = colors[variant];
  const isSmall = size === 'sm';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: isSmall ? '2px 8px' : '4px 12px',
        borderRadius: 'var(--radius-full)',
        background: c.bg,
        color: c.text,
        fontSize: isSmall ? 'var(--text-xs)' : 'var(--text-sm)',
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0,
        }} />
      )}
      {label}
    </span>
  );
};

export default StatusBadge;
