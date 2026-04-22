import React from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 16,
  borderRadius = 'var(--radius-sm)',
  className = '',
}) => (
  <div
    className={`nmt-skeleton ${className}`}
    style={{ width, height, borderRadius, display: 'block' }}
  />
);

export const SkeletonCard: React.FC<{ lines?: number }> = ({ lines = 3 }) => (
  <div
    className="card border-0"
    style={{ borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', padding: 'var(--space-5)' }}
  >
    <Skeleton width="40%" height={14} className="mb-2" />
    <Skeleton width="60%" height={22} className="mb-3" />
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} width={`${80 - i * 15}%`} height={12} className="mb-2" />
    ))}
  </div>
);

export const SkeletonMetricRow: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="row g-3 mb-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className={`col-md-${12 / count}`}>
        <div
          className="card border-0"
          style={{ borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', padding: 'var(--space-4)' }}
        >
          <div className="d-flex align-items-center gap-3">
            <Skeleton width={42} height={42} borderRadius="var(--radius-sm)" />
            <div style={{ flex: 1 }}>
              <Skeleton width="55%" height={12} className="mb-2" />
              <Skeleton width="35%" height={20} />
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);

export const SkeletonTable: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 4 }) => (
  <div className="card border-0" style={{ borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
    <div style={{ padding: 'var(--space-4)' }}>
      <Skeleton width="30%" height={16} className="mb-3" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="d-flex gap-3 mb-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} width={`${100 / cols}%`} height={14} />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export default Skeleton;
