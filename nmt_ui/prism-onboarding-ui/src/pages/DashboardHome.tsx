import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTestbeds, useExecutions } from '../hooks';
import { useApi } from '../hooks/useApi';
import { fetchAlerts, type AlertDTO } from '../services/api';
import { PageHeader, MetricCard, EmptyState, StatusBadge } from '../components/ui';
import { SkeletonMetricRow, SkeletonTable } from '../components/ui/LoadingSkeleton';

interface RecentActivity {
  type: 'testbed' | 'alert';
  title: string;
  subtitle: string;
  timestamp: Date;
  icon: string;
  color: string;
}

const alertsFetcher = () => fetchAlerts();

const DashboardHome: React.FC = () => {
  const navigate = useNavigate();

  const { testbeds, loading: tbLoading, error: tbError, refetch: refetchTb } = useTestbeds();
  const { data: alerts, loading: alLoading, error: alError, refetch: refetchAl } = useApi<AlertDTO[]>({
    fetcher: alertsFetcher, key: 'alerts:all',
  });
  const { executions, loading: exLoading, error: exError, refetch: refetchEx } = useExecutions();

  const loading = tbLoading || alLoading || exLoading;
  const error = tbError || alError || exError;
  const refetchAll = () => { refetchTb(); refetchAl(); refetchEx(); };

  const allAlerts = alerts ?? [];

  const stats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const alertsToday = allAlerts.filter(a => {
      const ts = a.timestamp || a.triggered_at;
      if (!ts) return false;
      return new Date(ts).toISOString().split('T')[0] === today;
    });
    const sev = { Critical: 0, Moderate: 0, Low: 0 };
    allAlerts.forEach(a => {
      const s = a.severity === 'critical' ? 'Critical' : a.severity === 'warning' ? 'Moderate' : a.severity in sev ? a.severity as keyof typeof sev : 'Low';
      sev[s as keyof typeof sev]++;
    });
    return { totalTestbeds: testbeds.length, savedRules: testbeds.length || 0, alertsToday: alertsToday.length, alertsBySeverity: sev };
  }, [testbeds, allAlerts]);

  const executionStats = useMemo(() => {
    const now = Date.now();
    const h24 = 86_400_000;
    const running = executions.filter(e => ['RUNNING', 'LONGEVITY_SUSTAINING', 'SUSTAINING'].includes(e.status));
    const last24 = executions.filter(e => {
      const ts = e.start_time || e.started_at;
      return ts && (now - new Date(ts).getTime()) < h24;
    });
    const rates = executions.slice(0, 10).map(e => e.success_rate ?? 0);
    const avg = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    return { running: running.length, last24h: last24.length, avgSuccessRate: avg, total: executions.length };
  }, [executions]);

  const recentExecutions = useMemo(() => executions.slice(0, 5), [executions]);

  const recentActivity = useMemo(() => {
    const items: RecentActivity[] = [];
    [...testbeds]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 3)
      .forEach(tb => {
        items.push({ type: 'testbed', title: `Testbed Configured: ${tb.testbed_label}`, subtitle: `PC IP: ${tb.pc_ip || 'N/A'}`, timestamp: new Date(tb.timestamp), icon: 'dns', color: '#0078d4' });
      });
    [...allAlerts]
      .sort((a, b) => new Date(b.timestamp || b.triggered_at || 0).getTime() - new Date(a.timestamp || a.triggered_at || 0).getTime())
      .slice(0, 3)
      .forEach(alert => {
        const sev = alert.severity;
        items.push({
          type: 'alert',
          title: `Alert: ${alert.ruleName || alert.alert_name || 'Unknown'}`,
          subtitle: `${sev} - ${alert.testbed || 'Unknown testbed'}`,
          timestamp: new Date(alert.timestamp || alert.triggered_at || Date.now()),
          icon: 'notifications_active',
          color: sev === 'Critical' || sev === 'critical' ? '#dc3545' : sev === 'Moderate' || sev === 'warning' ? '#fd7e14' : '#28a745',
        });
      });
    return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 5);
  }, [testbeds, allAlerts]);

  const formatTimestamp = (date: Date) => {
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const statusVariant = (status: string) => {
    if (['RUNNING', 'SUSTAINING', 'LONGEVITY_SUSTAINING'].includes(status)) return 'primary';
    if (status === 'COMPLETED') return 'success';
    if (status === 'FAILED') return 'danger';
    return 'neutral';
  };

  /* ── Loading skeleton ──────────────────────────────────── */
  if (loading) {
    return (
      <div className="main-content">
        <PageHeader icon="dashboard" title="Dashboard" subtitle="Loading your workspace…" />
        <SkeletonMetricRow count={4} />
        <SkeletonMetricRow count={4} />
        <SkeletonTable rows={4} cols={5} />
      </div>
    );
  }

  /* ── Error state ───────────────────────────────────────── */
  if (error) {
    return (
      <div className="main-content">
        <PageHeader icon="dashboard" title="Dashboard" />
        <div className="card border-0 rounded-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="card-body d-flex align-items-start gap-3 p-4">
            <div className="d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: 44, height: 44, borderRadius: 'var(--radius-sm)', background: 'var(--color-danger-light)' }}>
              <i className="material-icons-outlined" style={{ color: 'var(--color-danger)', fontSize: 24 }}>error_outline</i>
            </div>
            <div>
              <h6 className="fw-semibold mb-1">Connection Error</h6>
              <p className="mb-2" style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)' }}>{error}</p>
              <button className="btn btn-sm btn-outline-danger rounded-3" onClick={refetchAll}>
                <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>refresh</i> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totalAlerts = stats.alertsBySeverity.Critical + stats.alertsBySeverity.Moderate + stats.alertsBySeverity.Low;
  const successRateVariant = executionStats.avgSuccessRate >= 80 ? 'success' : executionStats.avgSuccessRate >= 50 ? 'warning' : 'danger';

  return (
    <div className="main-content">
      <PageHeader
        icon="dashboard"
        iconGradient="linear-gradient(135deg, #667eea, #764ba2)"
        title="Dashboard"
        subtitle="Your NCM monitoring workspace at a glance"
        actions={
          <button className="btn btn-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => navigate('/smart-execution')}>
            <i className="material-icons-outlined" style={{ fontSize: 18 }}>psychology</i>
            Start Execution
          </button>
        }
      />

      {/* ── Platform KPIs ──────────────────────────────────── */}
      <div className="row row-cols-1 row-cols-md-2 row-cols-xl-4 g-3 mb-4">
        <div className="col">
          <MetricCard icon="dns" iconGradient="linear-gradient(135deg, #667eea, #764ba2)" label="Total Testbeds" value={stats.totalTestbeds} />
        </div>
        <div className="col">
          <MetricCard icon="rule" iconGradient="linear-gradient(135deg, #f093fb, #f5576c)" label="Saved Rules" value={stats.savedRules} />
        </div>
        <div className="col">
          <MetricCard icon="notifications_active" iconGradient="linear-gradient(135deg, #fa709a, #fee140)" label="Alerts Today" value={stats.alertsToday} />
        </div>
        <div className="col">
          <MetricCard icon="notification_important" iconGradient="linear-gradient(135deg, #30cfd0, #330867)" label="Total Alerts" value={totalAlerts} />
        </div>
      </div>

      {/* ── Execution KPIs ─────────────────────────────────── */}
      <div className="row row-cols-1 row-cols-md-2 row-cols-xl-4 g-3 mb-4">
        <div className="col">
          <MetricCard icon="play_circle" variant="success" label="Running Now" value={executionStats.running}
            detail={executionStats.running > 0 ? 'Active executions in progress' : 'No active executions'} />
        </div>
        <div className="col">
          <MetricCard icon="schedule" variant="default" label="Last 24h" value={executionStats.last24h} />
        </div>
        <div className="col">
          <MetricCard icon="trending_up" variant={successRateVariant} label="Avg Success Rate" value={`${executionStats.avgSuccessRate.toFixed(1)}`} suffix="%" />
        </div>
        <div className="col">
          <MetricCard icon="science" iconGradient="linear-gradient(135deg, #8b5cf6, #7c3aed)" label="Total Executions" value={executionStats.total} />
        </div>
      </div>

      {/* ── Recent Executions ──────────────────────────────── */}
      {recentExecutions.length > 0 && (
        <div className="card border-0 rounded-3 mb-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="card-body p-4">
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h6 className="mb-0 fw-bold" style={{ fontSize: 'var(--text-md)' }}>Recent Executions</h6>
              <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={() => navigate('/smart-execution/history')}>View All</button>
            </div>
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0 align-middle">
                <thead><tr style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  <th className="fw-semibold border-0 pb-2">Execution</th>
                  <th className="fw-semibold border-0 pb-2">Testbed</th>
                  <th className="fw-semibold border-0 pb-2 text-center">Status</th>
                  <th className="fw-semibold border-0 pb-2 text-center">Duration</th>
                  <th className="fw-semibold border-0 pb-2 text-center">Success</th>
                  <th className="fw-semibold border-0 pb-2 text-center">Ops</th>
                  <th className="border-0"></th>
                </tr></thead>
                <tbody>
                  {recentExecutions.map(exec => (
                    <tr key={exec.execution_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/smart-execution/report/${exec.execution_id}`)}>
                      <td className="border-0">
                        {exec.execution_name
                          ? <span className="fw-semibold">{exec.execution_name}</span>
                          : <code className="small" style={{ color: 'var(--color-text-secondary)' }}>{exec.execution_id.substring(0, 18)}…</code>
                        }
                      </td>
                      <td className="border-0"><StatusBadge label={exec.testbed_label || 'N/A'} variant="neutral" /></td>
                      <td className="border-0 text-center"><StatusBadge label={exec.status} variant={statusVariant(exec.status)} dot /></td>
                      <td className="border-0 text-center" style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>{exec.duration_minutes ? `${exec.duration_minutes.toFixed(0)}m` : '–'}</td>
                      <td className="border-0 text-center fw-semibold">{exec.success_rate != null ? `${exec.success_rate.toFixed(0)}%` : '–'}</td>
                      <td className="border-0 text-center" style={{ color: 'var(--color-text-secondary)' }}>{exec.total_operations ?? '–'}</td>
                      <td className="border-0 text-end"><i className="material-icons-outlined" style={{ fontSize: 16, color: 'var(--color-text-muted)' }}>chevron_right</i></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Activity + Alert Distribution ──────────────────── */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-xl-8">
          <div className="card border-0 rounded-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="card-body p-4">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h6 className="mb-0 fw-bold" style={{ fontSize: 'var(--text-md)' }}>Recent Activity</h6>
                <button className="btn btn-sm btn-outline-secondary rounded-3" onClick={refetchAll} style={{ padding: '4px 10px' }}>
                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>refresh</i>
                </button>
              </div>

              {recentActivity.length === 0 ? (
                <EmptyState icon="inbox" title="No recent activity" description="Start by onboarding a testbed or configuring rules"
                  action={<button className="btn btn-primary btn-sm rounded-3" onClick={() => navigate('/onboarding')}>Onboard Now</button>} />
              ) : (
                <div className="d-flex flex-column gap-2">
                  {recentActivity.map((a, idx) => (
                    <div key={idx} className="d-flex align-items-center gap-3 p-2 rounded-3" style={{ transition: 'background var(--transition-fast)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-muted)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <div className="flex-shrink-0 d-flex align-items-center justify-content-center"
                        style={{ width: 38, height: 38, borderRadius: 'var(--radius-sm)', background: `${a.color}15` }}>
                        <i className="material-icons-outlined" style={{ color: a.color, fontSize: 20 }}>{a.icon}</i>
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="fw-semibold text-truncate" style={{ fontSize: 'var(--text-base)' }}>{a.title}</div>
                        <div className="text-truncate" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{a.subtitle}</div>
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{formatTimestamp(a.timestamp)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-12 col-xl-4">
          <div className="card border-0 rounded-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="card-body p-4">
              <h6 className="mb-3 fw-bold" style={{ fontSize: 'var(--text-md)' }}>Alert Distribution</h6>

              {totalAlerts === 0 ? (
                <EmptyState icon="check_circle" title="All Clear" description="No alerts recorded — your system is healthy!" />
              ) : (
                <div className="d-flex flex-column gap-3">
                  {([
                    { key: 'Critical', color: 'var(--color-danger)', bg: 'var(--color-danger)' },
                    { key: 'Moderate', color: 'var(--color-warning)', bg: 'var(--color-warning)' },
                    { key: 'Low', color: 'var(--color-success)', bg: 'var(--color-success)' },
                  ] as const).map(s => {
                    const count = stats.alertsBySeverity[s.key];
                    const pct = totalAlerts > 0 ? (count / totalAlerts) * 100 : 0;
                    return (
                      <div key={s.key}>
                        <div className="d-flex align-items-center justify-content-between mb-1">
                          <span className="d-flex align-items-center gap-2">
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                            <span style={{ fontWeight: 500, fontSize: 'var(--text-base)' }}>{s.key}</span>
                          </span>
                          <span className="fw-bold">{count}</span>
                        </div>
                        <div className="progress" style={{ height: 6, borderRadius: 'var(--radius-full)', background: 'var(--color-surface-muted)' }}>
                          <div style={{ width: `${pct}%`, background: s.bg, borderRadius: 'var(--radius-full)', transition: 'width var(--transition-slow)' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Actions ──────────────────────────────────── */}
      <div className="card border-0 rounded-3 mb-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="card-body p-4">
          <h6 className="mb-3 fw-bold" style={{ fontSize: 'var(--text-md)' }}>Quick Actions</h6>
          <div className="row row-cols-2 row-cols-md-5 g-3">
            {[
              { path: '/smart-execution', icon: 'psychology', label: 'Smart Execution', cls: 'btn-primary' },
              { path: '/onboarding', icon: 'add_circle_outline', label: 'Onboard Testbed', cls: 'btn-outline-secondary' },
              { path: '/my-testbeds', icon: 'dns', label: 'My Testbeds', cls: 'btn-outline-secondary' },
              { path: '/alert-summary', icon: 'notifications_active', label: 'View Alerts', cls: 'btn-outline-secondary' },
            ].map(qa => (
              <div className="col" key={qa.path}>
                <button
                  className={`btn ${qa.cls} w-100 d-flex flex-column align-items-center gap-2 py-3`}
                  onClick={() => navigate(qa.path)}
                  style={{ borderRadius: 'var(--radius-md)' }}
                >
                  <i className="material-icons-outlined" style={{ fontSize: 28 }}>{qa.icon}</i>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{qa.label}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Welcome onboarding guidance ────────────────────── */}
      {stats.totalTestbeds === 0 && (
        <div className="card border-0 rounded-3" style={{ boxShadow: 'var(--shadow-sm)', borderLeft: '4px solid var(--color-primary)' }}>
          <div className="card-body p-4 d-flex align-items-start gap-3">
            <i className="material-icons-outlined" style={{ fontSize: 28, color: 'var(--color-primary)' }}>info</i>
            <div>
              <h6 className="fw-bold mb-1">Welcome to NCM Monitoring Tool!</h6>
              <p className="mb-3" style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)' }}>Get started by deploying a new testbed or onboarding your existing one.</p>
              <div className="d-flex gap-2 flex-wrap">
                <button className="btn btn-sm btn-primary rounded-3" onClick={() => navigate('/onboarding')}>Onboard Testbed</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardHome;
