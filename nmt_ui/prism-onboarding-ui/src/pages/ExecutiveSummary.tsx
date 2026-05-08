import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactApexChart from 'react-apexcharts';
import { getApiBase } from '../utils/backendUrl';
import { SkeletonMetricRow, SkeletonCard } from '../components/ui/LoadingSkeleton';

interface Insight {
  type: 'positive' | 'warning' | 'info';
  message: string;
}

interface SummaryData {
  period: { start: string; end: string; days: number };
  key_metrics: {
    total_executions: number;
    completed_executions: number;
    failed_executions: number;
    stopped_executions: number;
    success_rate: number;
    completion_rate: number;
    total_operations: number;
    successful_operations: number;
    failed_operations: number;
  };
  performance: {
    avg_duration_minutes: number;
    total_test_hours: number;
    avg_ops_per_minute: number;
    threshold_reached: number;
    longest_run_minutes: number;
    shortest_run_minutes: number;
  };
  resource_utilization: {
    avg_cpu_percent: number;
    avg_memory_percent: number;
    peak_cpu_percent: number;
    peak_memory_percent: number;
  };
  status_breakdown: { status: string; count: number }[];
  entity_breakdown: { entity: string; operation: string; count: number; success_rate: number }[];
  insights: Insight[];
  most_active_testbed: { testbed_id: string; testbed_name?: string; execution_count: number } | null;
  testbed_summary: { testbed_id: string; testbed_name: string; executions: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: '#22c55e',
  FAILED: '#ef4444',
  TIMEOUT: '#f97316',
  STOPPED: '#f59e0b',
  RUNNING: '#3b82f6',
  ERROR: '#dc2626',
};

const ExecutiveSummary: React.FC = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('365');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - parseInt(dateRange));
      const res = await fetch(`${getApiBase()}/api/analytics/executive-summary?start_date=${start.toISOString().split('T')[0]}&end_date=${end.toISOString().split('T')[0]}`);
      const d = await res.json();
      if (d.success) setSummary(d.summary);
    } catch (err) {
      console.error('Failed to load executive summary:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { load(); }, [load]);

  const exportJson = () => {
    if (!summary) return;
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `executive-summary-${dateRange}d.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const insightStyle = (type: string) => {
    switch (type) {
      case 'positive': return { icon: 'check_circle', bg: '#dcfce7', border: '#86efac', color: '#166534' };
      case 'warning': return { icon: 'warning', bg: '#fef3c7', border: '#fcd34d', color: '#92400e' };
      default: return { icon: 'info', bg: '#dbeafe', border: '#93c5fd', color: '#1e40af' };
    }
  };

  if (loading) {
    return (
      <div className="main-content">
        <SkeletonMetricRow count={4} />
        <SkeletonCard lines={6} />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="main-content">
        <div className="text-center py-5 text-muted">
          <i className="material-icons-outlined mb-2" style={{ fontSize: 64, opacity: 0.3 }}>summarize</i>
          <h5>No Summary Data</h5>
          <p>No execution data available for the selected period.</p>
          <button className="btn btn-primary rounded-3" onClick={() => navigate('/analytics/dashboard')}>Back to Analytics</button>
        </div>
      </div>
    );
  }

  const km = summary.key_metrics;
  const perf = summary.performance || {} as SummaryData['performance'];
  const res = summary.resource_utilization || {} as SummaryData['resource_utilization'];

  const statusLabels = (summary.status_breakdown || []).map(s => s.status);
  const statusCounts = (summary.status_breakdown || []).map(s => s.count);
  const statusColors = statusLabels.map(s => STATUS_COLORS[s] || '#94a3b8');

  const entityLabels = (summary.entity_breakdown || []).map(e => `${e.entity} ${e.operation}`);
  const entityCounts = (summary.entity_breakdown || []).map(e => e.count);

  return (
    <div className="main-content">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-3">
        <div>
          <h2 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>summarize</i>
            </div>
            Executive Summary
          </h2>
          <p className="text-muted mb-0" style={{ maxWidth: 600 }}>
            High-level overview of all Smart Execution activity. Use this to quickly assess overall system health and share progress with stakeholders.
          </p>
        </div>
        <div className="d-flex gap-2 align-items-center flex-wrap">
          <select className="form-select form-select-sm rounded-3" style={{ width: 'auto' }} value={dateRange} onChange={e => setDateRange(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
            <option value="180">Last 6 months</option>
            <option value="365">Last 1 year</option>
          </select>
          <button className="btn btn-outline-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={exportJson}>
            <i className="material-icons-outlined" style={{ fontSize: 18 }}>download</i>Export
          </button>
          <button className="btn btn-outline-secondary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => navigate('/analytics/dashboard')}>
            <i className="material-icons-outlined" style={{ fontSize: 18 }}>arrow_back</i>Analytics
          </button>
        </div>
      </div>

      {/* Period Banner */}
      <div className="d-flex align-items-center gap-2 mb-4 px-3 py-2 rounded-3" style={{ background: '#f0f9ff', border: '1px solid #bfdbfe' }}>
        <i className="material-icons-outlined" style={{ fontSize: 18, color: '#2563eb' }}>date_range</i>
        <span className="small fw-medium" style={{ color: '#1e40af' }}>
          Reporting period: {new Date(summary.period.start).toLocaleDateString()} — {new Date(summary.period.end).toLocaleDateString()} ({summary.period.days} days)
        </span>
      </div>

      {/* Key Metrics Row */}
      <div className="row g-3 mb-4">
        {[
          { icon: 'rocket_launch', label: 'Total Executions', value: km.total_executions, color: '#3b82f6', desc: `${km.completed_executions} completed, ${km.failed_executions} failed, ${km.stopped_executions} stopped` },
          { icon: 'check_circle', label: 'Operation Success Rate', value: `${km.success_rate.toFixed(1)}%`, color: km.success_rate >= 80 ? '#22c55e' : km.success_rate >= 60 ? '#f59e0b' : '#ef4444', desc: `${km.successful_operations.toLocaleString()} of ${km.total_operations.toLocaleString()} ops succeeded` },
          { icon: 'settings', label: 'Total Operations', value: km.total_operations.toLocaleString(), color: '#8b5cf6', desc: `${km.failed_operations.toLocaleString()} failed operations` },
          { icon: 'timer', label: 'Total Test Hours', value: (perf.total_test_hours || 0).toFixed(1), color: '#06b6d4', desc: `Avg ${(perf.avg_duration_minutes || 0).toFixed(1)} min/execution` },
        ].map((m, i) => (
          <div className="col-md-3" key={i}>
            <div className="card rounded-4 border shadow-none h-100">
              <div className="card-body p-4">
                <div className="d-flex align-items-center gap-3 mb-2">
                  <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 44, height: 44, background: `${m.color}15` }}>
                    <i className="material-icons-outlined" style={{ fontSize: 24, color: m.color }}>{m.icon}</i>
                  </div>
                  <div className="text-muted small">{m.label}</div>
                </div>
                <div className="fw-bold fs-3 mb-1">{m.value}</div>
                <div className="text-muted" style={{ fontSize: '0.72rem' }}>{m.desc}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row: Status Breakdown + Entity Breakdown */}
      <div className="row g-3 mb-4">
        {statusLabels.length > 0 && (
          <div className="col-md-5">
            <div className="card rounded-4 border shadow-none h-100">
              <div className="card-header bg-transparent border-bottom p-4">
                <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
                  <i className="material-icons-outlined" style={{ fontSize: 20, color: '#8b5cf6' }}>donut_large</i>
                  Execution Status Breakdown
                </h6>
                <p className="text-muted small mb-0 mt-1">How executions ended — completed, failed, stopped, or timed out</p>
              </div>
              <div className="card-body d-flex justify-content-center align-items-center p-4">
                <ReactApexChart
                  type="donut"
                  width={280}
                  series={statusCounts}
                  options={{
                    chart: { fontFamily: 'inherit' },
                    labels: statusLabels,
                    colors: statusColors,
                    legend: { position: 'bottom', fontSize: '12px' },
                    dataLabels: { enabled: true, formatter: (v: number) => `${v.toFixed(0)}%` },
                    plotOptions: { pie: { donut: { size: '55%', labels: { show: true, total: { show: true, label: 'Total', fontSize: '14px', formatter: () => km.total_executions.toLocaleString() } } } } },
                  }}
                />
              </div>
            </div>
          </div>
        )}

        <div className={statusLabels.length > 0 ? 'col-md-7' : 'col-12'}>
          {/* Performance Section */}
          <div className="card rounded-4 border shadow-none mb-3">
            <div className="card-header bg-transparent border-bottom p-4">
              <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
                <i className="material-icons-outlined" style={{ fontSize: 20, color: '#3b82f6' }}>speed</i>
                Performance Metrics
              </h6>
            </div>
            <div className="card-body p-4">
              <div className="row g-3">
                {[
                  { label: 'Avg Duration', value: `${(perf.avg_duration_minutes || 0).toFixed(1)} min`, icon: 'timer' },
                  { label: 'Throughput', value: `${(perf.avg_ops_per_minute || 0).toFixed(2)} ops/min`, icon: 'speed' },
                  { label: 'Threshold Reached', value: `${perf.threshold_reached || 0} of ${km.total_executions}`, icon: 'flag' },
                  { label: 'Longest Run', value: `${(perf.longest_run_minutes || 0).toFixed(1)} min`, icon: 'hourglass_top' },
                ].map((item, i) => (
                  <div className="col-6" key={i}>
                    <div className="d-flex align-items-center gap-2 p-2 rounded-3" style={{ background: '#f8fafc' }}>
                      <i className="material-icons-outlined" style={{ fontSize: 18, color: '#6b7280' }}>{item.icon}</i>
                      <div>
                        <div style={{ fontSize: '0.72rem' }} className="text-muted">{item.label}</div>
                        <div className="fw-bold small">{item.value}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Resource Utilization */}
          {(res.avg_cpu_percent > 0 || res.avg_memory_percent > 0) && (
            <div className="card rounded-4 border shadow-none">
              <div className="card-header bg-transparent border-bottom p-4">
                <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
                  <i className="material-icons-outlined" style={{ fontSize: 20, color: '#f59e0b' }}>memory</i>
                  Resource Utilization
                </h6>
              </div>
              <div className="card-body p-4">
                <div className="row g-3">
                  {[
                    { label: 'Avg CPU', value: `${res.avg_cpu_percent.toFixed(1)}%`, peak: `${res.peak_cpu_percent.toFixed(1)}%`, color: res.peak_cpu_percent > 85 ? '#ef4444' : '#3b82f6' },
                    { label: 'Avg Memory', value: `${res.avg_memory_percent.toFixed(1)}%`, peak: `${res.peak_memory_percent.toFixed(1)}%`, color: res.peak_memory_percent > 85 ? '#ef4444' : '#8b5cf6' },
                  ].map((item, i) => (
                    <div className="col-6" key={i}>
                      <div className="text-center p-3 rounded-3" style={{ background: '#f8fafc' }}>
                        <div className="fw-bold fs-4" style={{ color: item.color }}>{item.value}</div>
                        <div className="text-muted" style={{ fontSize: '0.72rem' }}>{item.label}</div>
                        <div className="text-muted mt-1" style={{ fontSize: '0.68rem' }}>Peak: <strong>{item.peak}</strong></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Entity Breakdown Chart */}
      {entityLabels.length > 0 && (
        <div className="card rounded-4 border shadow-none mb-4">
          <div className="card-header bg-transparent border-bottom p-4">
            <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
              <i className="material-icons-outlined" style={{ fontSize: 20, color: '#8b5cf6' }}>category</i>
              Top Entity Operations
            </h6>
            <p className="text-muted small mb-0 mt-1">Most frequently executed entity/operation combinations with their success rates</p>
          </div>
          <div className="card-body p-4">
            <div className="row g-3">
              <div className="col-md-7">
                <ReactApexChart
                  type="bar"
                  height={Math.max(200, entityLabels.length * 32)}
                  series={[{ name: 'Operations', data: entityCounts }]}
                  options={{
                    chart: { toolbar: { show: false }, fontFamily: 'inherit' },
                    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '60%', distributed: true } },
                    colors: ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1', '#14b8a6', '#f97316'],
                    xaxis: { categories: entityLabels, labels: { style: { fontSize: '11px' } } },
                    yaxis: { labels: { style: { fontSize: '11px' } } },
                    legend: { show: false },
                    dataLabels: { enabled: true, style: { fontSize: '11px' } },
                    grid: { borderColor: '#f1f5f9' },
                  }}
                />
              </div>
              <div className="col-md-5">
                <div className="table-responsive">
                  <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.82rem' }}>
                    <thead className="table-light">
                      <tr><th>Entity</th><th>Operation</th><th className="text-end">Count</th><th className="text-end">Success</th></tr>
                    </thead>
                    <tbody>
                      {(summary.entity_breakdown || []).map((e, i) => (
                        <tr key={i}>
                          <td className="fw-medium">{e.entity}</td>
                          <td><code className="small">{e.operation}</code></td>
                          <td className="text-end">{e.count}</td>
                          <td className="text-end">
                            <span className={e.success_rate >= 90 ? 'text-success' : e.success_rate >= 70 ? 'text-warning' : 'text-danger'}>
                              {e.success_rate}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Insights */}
      {summary.insights.length > 0 && (
        <div className="card rounded-4 border shadow-none mb-4">
          <div className="card-header bg-transparent border-bottom p-4">
            <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
              <i className="material-icons-outlined text-warning" style={{ fontSize: 20 }}>lightbulb</i>
              Key Insights
            </h6>
            <p className="text-muted small mb-0 mt-1">Automatically generated observations about your execution activity</p>
          </div>
          <div className="card-body p-4 d-flex flex-column gap-2">
            {summary.insights.map((ins, i) => {
              const s = insightStyle(ins.type);
              return (
                <div key={i} className="d-flex align-items-start gap-2 p-3 rounded-3" style={{ background: s.bg, borderLeft: `3px solid ${s.border}` }}>
                  <i className="material-icons-outlined flex-shrink-0" style={{ fontSize: 20, color: s.color }}>{s.icon}</i>
                  <span className="small fw-medium" style={{ color: s.color }}>{ins.message}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Testbed Summary */}
      {(summary.testbed_summary || []).length > 0 && (
        <div className="card rounded-4 border shadow-none mb-4">
          <div className="card-header bg-transparent border-bottom p-4">
            <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
              <i className="material-icons-outlined" style={{ fontSize: 20, color: '#f59e0b' }}>dns</i>
              Testbed Activity
            </h6>
            <p className="text-muted small mb-0 mt-1">Execution count per testbed in this period</p>
          </div>
          <div className="card-body p-4">
            {summary.testbed_summary.map((tb, i) => {
              const pct = km.total_executions > 0 ? (tb.executions / km.total_executions * 100) : 0;
              return (
                <div key={i} className="d-flex align-items-center gap-3 mb-3">
                  <div className="flex-grow-1">
                    <div className="d-flex justify-content-between mb-1">
                      <span className="fw-medium small">{tb.testbed_name || tb.testbed_id.slice(0, 16)}</span>
                      <span className="text-muted small">{tb.executions} runs ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="progress" style={{ height: 6 }}>
                      <div className="progress-bar" style={{ width: `${pct}%`, background: ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#06b6d4'][i % 5] }}></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Most Active Testbed */}
      {summary.most_active_testbed && (
        <div className="card rounded-4 border shadow-none mb-4">
          <div className="card-body p-4 d-flex align-items-center gap-3">
            <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 24 }}>emoji_events</i>
            </div>
            <div className="flex-grow-1">
              <div className="small text-muted fw-medium">Most Active Testbed</div>
              <div className="fw-bold">{summary.most_active_testbed.testbed_name || summary.most_active_testbed.testbed_id.slice(0, 16)}</div>
            </div>
            <div className="text-end">
              <div className="fw-bold fs-5">{summary.most_active_testbed.execution_count}</div>
              <div className="text-muted small">executions
                {km.total_executions > 0 && (
                  <span className="ms-1">({(summary.most_active_testbed.execution_count / km.total_executions * 100).toFixed(0)}%)</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Navigation */}
      <div className="row g-3">
        <div className="col-md-6">
          <div className="card rounded-4 border shadow-none h-100" role="button" onClick={() => navigate('/analytics/dashboard')} style={{ cursor: 'pointer', transition: 'transform 0.15s' }} onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')} onMouseLeave={e => (e.currentTarget.style.transform = 'none')}>
            <div className="card-body d-flex align-items-center gap-3 p-4">
              <div className="d-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 24 }}>insights</i>
              </div>
              <div>
                <h6 className="fw-bold mb-0">Analytics Dashboard</h6>
                <p className="text-muted mb-0 small">View detailed trends and metric breakdowns</p>
              </div>
              <i className="material-icons-outlined ms-auto text-muted">chevron_right</i>
            </div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card rounded-4 border shadow-none h-100" role="button" onClick={() => navigate('/analytics/comparison')} style={{ cursor: 'pointer', transition: 'transform 0.15s' }} onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')} onMouseLeave={e => (e.currentTarget.style.transform = 'none')}>
            <div className="card-body d-flex align-items-center gap-3 p-4">
              <div className="d-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 24 }}>compare</i>
              </div>
              <div>
                <h6 className="fw-bold mb-0">Execution Comparison</h6>
                <p className="text-muted mb-0 small">Compare executions side by side</p>
              </div>
              <i className="material-icons-outlined ms-auto text-muted">chevron_right</i>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExecutiveSummary;
