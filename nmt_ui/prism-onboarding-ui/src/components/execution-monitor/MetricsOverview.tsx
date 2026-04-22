import React from 'react';

interface Props {
  cpuVal: number;
  cpuTarget: number;
  memVal: number;
  memTarget: number;
  opsPerMinute: number;
  totalOperations: number;
  successRate: number;
  circuitBreakerTrips: number;
}

const StatCard: React.FC<{
  label: string;
  value: string;
  colorClass: string;
  bar?: { pct: number; bg: string };
  hint?: string;
  extra?: React.ReactNode;
}> = ({ label, value, colorClass, bar, hint, extra }) => (
  <div className="monitor-stat-card">
    <div className="stat-label">{label}</div>
    <div className={`stat-value ${colorClass}`}>{value}</div>
    {bar && (
      <div className="stat-bar">
        <div className="stat-bar-fill" style={{ width: `${Math.min(bar.pct, 100)}%`, background: bar.bg }} />
      </div>
    )}
    {hint && <div className="stat-hint">{hint}</div>}
    {extra}
  </div>
);

const MetricsOverview: React.FC<Props> = ({
  cpuVal, cpuTarget, memVal, memTarget,
  opsPerMinute, totalOperations, successRate, circuitBreakerTrips,
}) => {
  const cpuColor = cpuVal >= cpuTarget ? 'text-danger' : cpuVal >= cpuTarget * 0.8 ? 'text-warning' : 'text-primary';
  const memColor = memVal >= memTarget ? 'text-danger' : memVal >= memTarget * 0.8 ? 'text-warning' : 'text-success';
  const srColor = successRate >= 90 ? 'text-success' : successRate >= 70 ? 'text-warning' : 'text-danger';

  return (
    <div className="monitor-stat-cards">
      <StatCard
        label="CPU Usage"
        value={`${cpuVal.toFixed(1)}%`}
        colorClass={cpuColor}
        bar={{ pct: cpuVal, bg: cpuVal >= cpuTarget ? 'var(--color-danger)' : '#3b82f6' }}
        hint={`Target: ${cpuTarget}%`}
      />
      <StatCard
        label="Memory Usage"
        value={`${memVal.toFixed(1)}%`}
        colorClass={memColor}
        bar={{ pct: memVal, bg: memVal >= memTarget ? 'var(--color-danger)' : 'var(--color-success)' }}
        hint={`Target: ${memTarget}%`}
      />
      <StatCard
        label="Ops/Minute"
        value={opsPerMinute.toFixed(1)}
        colorClass="text-info"
        hint={`${totalOperations} total operations`}
      />
      <StatCard
        label="Success Rate"
        value={`${successRate.toFixed(0)}%`}
        colorClass={srColor}
        extra={circuitBreakerTrips > 0 ? (
          <span className="badge bg-warning bg-opacity-10 text-warning small mt-1">
            <i className="material-icons-outlined" style={{ fontSize: 12, verticalAlign: 'middle' }}>warning</i> {circuitBreakerTrips} trips
          </span>
        ) : undefined}
      />
    </div>
  );
};

export default MetricsOverview;
