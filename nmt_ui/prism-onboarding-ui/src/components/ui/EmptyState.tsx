import React from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon = 'inbox', title, description, action }) => (
  <div
    className="d-flex flex-column align-items-center justify-content-center text-center"
    style={{ padding: 'var(--space-9) var(--space-6)' }}
  >
    <div
      className="d-flex align-items-center justify-content-center mb-3"
      style={{
        width: 64,
        height: 64,
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface-muted)',
      }}
    >
      <i className="material-icons-outlined" style={{ fontSize: 32, color: 'var(--color-text-muted)' }}>{icon}</i>
    </div>
    <h5 className="fw-semibold mb-1" style={{ fontSize: 'var(--text-lg)', color: 'var(--color-text)' }}>
      {title}
    </h5>
    {description && (
      <p className="mb-3" style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)', maxWidth: 400 }}>
        {description}
      </p>
    )}
    {action && <div>{action}</div>}
  </div>
);

export default EmptyState;
