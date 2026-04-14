import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactApexChart from 'react-apexcharts';
import { getApiBase } from '../utils/backendUrl';

interface Insight {
  type: 'positive' | 'warning' | 'info';
  message: string;
}

interface SummaryData {
  period: { start: string; end: string; days: number };
  key_metrics: {
    total_executions: number;
    success_rate: number;
    total_operations: number;
  };
  insights: Insight[];
  most_active_testbed: { testbed_id: string; execution_count: number } | null;
}

const ExecutiveSummary: React.FC = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30');

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

  const insightIcon = (type: string) => {
    switch (type) {
      case 'positive': return { icon: 'check_circle', bg: '#dcfce7', border: '#86efac', color: '#166534' };
      case 'warning': return { icon: 'warning', bg: '#fef3c7', border: '#fcd34d', color: '#92400e' };
      default: return { icon: 'info', bg: '#dbeafe', border: '#93c5fd', color: '#1e40af' };
    }
  };

  if (loading) {
    return (
      <div className="main-content">
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status" style={{ width: '3rem', height: '3rem' }}><span className="visually-hidden">Loading...</span></div>
          <p className="mt-3 text-muted">Loading executive summary...</p>
        </div>
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
  const opsPerExec = km.total_executions > 0 ? (km.total_operations / km.total_executions).toFixed(1) : '0';

  const donutColors = ['#22c55e', '#ef4444'];
  const successOps = (km as any).successful_operations || Math.round(km.total_operations * (km.success_rate / 100));
  const failedOps = km.total_operations - successOps;

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
            High-level overview of all Smart Execution activity. Use this page to quickly assess overall system health, identify trends, and share progress with stakeholders.
          </p>
        </div>
        <div className="d-flex gap-2 align-items-center flex-wrap">
          <select className="form-select form-select-sm rounded-3" style={{ width: 'auto' }} value={dateRange} onChange={e => setDateRange(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <button className="btn btn-outline-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={exportJson}>
            <i className="material-icons-outlined" style={{ fontSize: 18 }}>download</i>Export
          </button>
          <button className="btn btn-outline-secondary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => navigate('/analytics/dashboard')}>
            <i className="material-icons-outlined" style={{ fontSize: 18 }}>arrow_back</i>Analytics
          </button>
        </div>
      </div>

      {/* Period banner */}
      <div className="d-flex align-items-center gap-2 mb-4 px-3 py-2 rounded-3" style={{ background: '#f0f9ff', border: '1px solid #bfdbfe' }}>
        <i className="material-icons-outlined" style={{ fontSize: 18, color: '#2563eb' }}>date_range</i>
        <span className="small fw-medium" style={{ color: '#1e40af' }}>
          Reporting period: {new Date(summary.period.start).toLocaleDateString()} — {new Date(summary.period.end).toLocaleDateString()} ({summary.period.days} days)
        </span>
      </div>

      {/* Key Metrics */}
      <div className="row g-3 mb-4">
        {[
          { icon: 'rocket_launch', label: 'Total Executions', value: km.total_executions, color: '#3b82f6', desc: 'Smart Execution runs in this period' },
          { icon: 'check_circle', label: 'Success Rate', value: `${km.success_rate.toFixed(1)}%`, color: km.success_rate >= 80 ? '#22c55e' : '#ef4444', desc: km.success_rate >= 80 ? 'Operations succeeding at a healthy rate' : 'Below 80% — review failing operations' },
          { icon: 'settings', label: 'Total Operations', value: km.total_operations.toLocaleString(), color: '#8b5cf6', desc: 'Individual API operations executed' },
          { icon: 'functions', label: 'Avg Ops / Execution', value: opsPerExec, color: '#06b6d4', desc: 'Average operations per execution run' },
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

      <div className="row g-3 mb-4">
        {/* Ops Breakdown Donut */}
        {km.total_operations > 0 && (
          <div className="col-md-5">
            <div className="card rounded-4 border shadow-none h-100">
              <div className="card-header bg-transparent border-bottom p-4">
                <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
                  <i className="material-icons-outlined" style={{ fontSize: 20, color: '#8b5cf6' }}>donut_large</i>
                  Operations Breakdown
                </h6>
                <p className="text-muted small mb-0 mt-1">Success vs failure split across all operations</p>
              </div>
              <div className="card-body d-flex justify-content-center align-items-center p-4">
                <ReactApexChart
                  type="donut"
                  width={280}
                  series={[successOps, failedOps]}
                  options={{
                    chart: { fontFamily: 'inherit' },
                    labels: ['Successful', 'Failed'],
                    colors: donutColors,
                    legend: { position: 'bottom', fontSize: '12px' },
                    dataLabels: { enabled: true, formatter: (v: number) => `${v.toFixed(0)}%` },
                    plotOptions: { pie: { donut: { size: '55%', labels: { show: true, total: { show: true, label: 'Total', fontSize: '14px', formatter: () => km.total_operations.toLocaleString() } } } } },
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Insights + Most Active Testbed */}
        <div className={km.total_operations > 0 ? 'col-md-7' : 'col-12'}>
          {/* Insights */}
          {summary.insights.length > 0 && (
            <div className="card rounded-4 border shadow-none mb-3">
              <div className="card-header bg-transparent border-bottom p-4">
                <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
                  <i className="material-icons-outlined text-warning" style={{ fontSize: 20 }}>lightbulb</i>
                  Key Insights
                </h6>
                <p className="text-muted small mb-0 mt-1">Automatically generated observations about your execution activity</p>
              </div>
              <div className="card-body p-4 d-flex flex-column gap-2">
                {summary.insights.map((ins, i) => {
                  const s = insightIcon(ins.type);
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

          {/* Most Active Testbed */}
          {summary.most_active_testbed && (
            <div className="card rounded-4 border shadow-none">
              <div className="card-body p-4 d-flex align-items-center gap-3">
                <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 24 }}>emoji_events</i>
                </div>
                <div className="flex-grow-1">
                  <div className="small text-muted fw-medium">Most Active Testbed</div>
                  <div className="fw-bold"><code>{summary.most_active_testbed.testbed_id.slice(0, 16)}...</code></div>
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
        </div>
      </div>

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
