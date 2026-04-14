import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactApexChart from 'react-apexcharts';
import { getApiBase } from '../utils/backendUrl';

interface Overview {
  period: { start: string; end: string; days: number };
  executions: { total: number; completed: number; failed: number; running: number; success_rate: number };
  operations: { total: number; successful: number; success_rate: number; avg_per_execution: number };
  performance: { avg_duration_minutes: number; avg_operations_per_minute: number; threshold_achievement_rate: number };
  resource_utilization: { avg_cpu_percent: number; avg_memory_percent: number };
}

interface TrendPoint {
  period: string;
  value: number;
  count: number;
}

const metricInfo: Record<string, { label: string; unit: string; desc: string }> = {
  executions: { label: 'Executions', unit: '', desc: 'Number of Smart Executions started per day' },
  operations: { label: 'Operations', unit: '', desc: 'Total API operations performed per day' },
  cpu: { label: 'CPU Usage', unit: '%', desc: 'Average CPU utilization across execution runs' },
  memory: { label: 'Memory Usage', unit: '%', desc: 'Average memory utilization across execution runs' },
  success_rate: { label: 'Success Rate', unit: '%', desc: 'Percentage of operations that succeeded per day' },
};

const AnalyticsDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30');
  const [selectedMetric, setSelectedMetric] = useState('executions');

  const loadAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - parseInt(dateRange));
      const params = new URLSearchParams({
        start_date: start.toISOString().split('T')[0],
        end_date: end.toISOString().split('T')[0],
      });

      const [ovRes, trRes] = await Promise.all([
        fetch(`${getApiBase()}/api/analytics/overview?${params}`),
        fetch(`${getApiBase()}/api/analytics/trends?${params}&metric=${selectedMetric}&granularity=daily`),
      ]);

      const ovData = await ovRes.json();
      if (ovData.success) setOverview(ovData.overview);

      const trData = await trRes.json();
      if (trData.success) setTrends(trData.trends?.trend_data || []);
    } catch (err) {
      console.error('Analytics load error:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange, selectedMetric]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  if (loading) {
    return (
      <div className="main-content">
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status" style={{ width: '3rem', height: '3rem' }}><span className="visually-hidden">Loading...</span></div>
          <p className="mt-3 text-muted">Loading analytics...</p>
        </div>
      </div>
    );
  }

  const trendCategories = trends.map(t => {
    const d = new Date(t.period);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });
  const trendValues = trends.map(t => Math.round(t.value * 100) / 100);
  const mi = metricInfo[selectedMetric] || metricInfo.executions;

  return (
    <div className="main-content">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-3">
        <div>
          <h2 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>insights</i>
            </div>
            Analytics Dashboard
          </h2>
          <p className="text-muted mb-0" style={{ maxWidth: 600 }}>
            Track Smart Execution performance across all testbeds. Monitor execution counts, success rates, operation throughput, and resource usage trends over time.
          </p>
        </div>
        <div className="d-flex gap-2 align-items-center flex-wrap">
          <select className="form-select form-select-sm rounded-3" style={{ width: 'auto' }} value={dateRange} onChange={e => setDateRange(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <button className="btn btn-outline-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={loadAnalytics}>
            <i className="material-icons-outlined" style={{ fontSize: 18 }}>refresh</i>Refresh
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      {overview && (
        <div className="row g-3 mb-4">
          {[
            { icon: 'rocket_launch', label: 'Total Executions', value: overview.executions.total, sub: `${overview.executions.completed} completed, ${overview.executions.failed} failed`, color: '#3b82f6' },
            { icon: 'check_circle', label: 'Operation Success Rate', value: `${overview.executions.success_rate.toFixed(1)}%`, sub: overview.executions.success_rate >= 80 ? 'Healthy — above 80% target' : overview.executions.success_rate >= 50 ? 'Moderate — room for improvement' : 'Below 50% — review failing operations', color: overview.executions.success_rate >= 80 ? '#22c55e' : overview.executions.success_rate >= 50 ? '#f59e0b' : '#ef4444' },
            { icon: 'settings', label: 'Total Operations', value: overview.operations.total.toLocaleString(), sub: `${overview.operations.success_rate.toFixed(1)}% op success rate`, color: '#8b5cf6' },
            { icon: 'timer', label: 'Avg Execution Time', value: `${overview.performance.avg_duration_minutes.toFixed(1)}m`, sub: `${overview.performance.avg_operations_per_minute.toFixed(1)} ops/min throughput`, color: '#f59e0b' },
            { icon: 'memory', label: 'Avg CPU Usage', value: `${overview.resource_utilization.avg_cpu_percent.toFixed(1)}%`, sub: overview.resource_utilization.avg_cpu_percent > 80 ? 'High — monitor closely' : 'Within normal range', color: '#06b6d4' },
            { icon: 'storage', label: 'Avg Memory Usage', value: `${overview.resource_utilization.avg_memory_percent.toFixed(1)}%`, sub: overview.resource_utilization.avg_memory_percent > 80 ? 'High — monitor closely' : 'Within normal range', color: '#ec4899' },
          ].map((c, i) => (
            <div className="col-md-4 col-xl-2" key={i}>
              <div className="card rounded-4 border shadow-none h-100">
                <div className="card-body d-flex align-items-center gap-3 p-3">
                  <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 44, height: 44, background: `${c.color}15` }}>
                    <i className="material-icons-outlined" style={{ fontSize: 24, color: c.color }}>{c.icon}</i>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: '0.7rem' }}>{c.label}</div>
                    <div className="fw-bold fs-5">{c.value}</div>
                    <div className="text-muted" style={{ fontSize: '0.68rem' }}>{c.sub}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Trend Chart */}
      <div className="card rounded-4 border shadow-none mb-4">
        <div className="card-header bg-transparent border-bottom p-4 d-flex justify-content-between align-items-start">
          <div>
            <h5 className="mb-0 fw-semibold d-flex align-items-center gap-2">
              <i className="material-icons-outlined text-primary" style={{ fontSize: 24 }}>show_chart</i>
              {mi.label} Trend
            </h5>
            <p className="text-muted small mb-0 mt-1">{mi.desc}</p>
          </div>
          <select className="form-select form-select-sm rounded-3" style={{ width: 'auto' }} value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)}>
            {Object.entries(metricInfo).map(([key, info]) => (
              <option key={key} value={key}>{info.label}</option>
            ))}
          </select>
        </div>
        <div className="card-body p-4">
          {trends.length > 0 ? (
            <ReactApexChart
              type="area"
              height={300}
              series={[{ name: mi.label, data: trendValues }]}
              options={{
                chart: { toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'inherit' },
                colors: ['#667eea'],
                stroke: { curve: 'smooth', width: 2 },
                fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05 } },
                xaxis: { categories: trendCategories, labels: { style: { fontSize: '11px' } } },
                yaxis: { labels: { formatter: (v: number) => mi.unit ? `${v.toFixed(1)}${mi.unit}` : (v % 1 === 0 ? String(v) : v.toFixed(1)) } },
                dataLabels: { enabled: false },
                grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
                tooltip: { y: { formatter: (v: number) => mi.unit ? `${v.toFixed(1)}${mi.unit}` : String(Math.round(v * 100) / 100) } },
              }}
            />
          ) : (
            <div className="text-center py-5 text-muted">
              <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>bar_chart</i>
              <div>No trend data for this period. Run some Smart Executions to see data here.</div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div className="row g-3">
        <div className="col-md-6">
          <div className="card rounded-4 border shadow-none h-100" role="button" onClick={() => navigate('/analytics/comparison')} style={{ cursor: 'pointer', transition: 'transform 0.15s' }} onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')} onMouseLeave={e => (e.currentTarget.style.transform = 'none')}>
            <div className="card-body d-flex align-items-center gap-3 p-4">
              <div className="d-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 24 }}>compare</i>
              </div>
              <div>
                <h6 className="fw-bold mb-0">Execution Comparison</h6>
                <p className="text-muted mb-0 small">Compare multiple executions side by side to see which performed best</p>
              </div>
              <i className="material-icons-outlined ms-auto text-muted">chevron_right</i>
            </div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card rounded-4 border shadow-none h-100" role="button" onClick={() => navigate('/analytics/executive-summary')} style={{ cursor: 'pointer', transition: 'transform 0.15s' }} onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')} onMouseLeave={e => (e.currentTarget.style.transform = 'none')}>
            <div className="card-body d-flex align-items-center gap-3 p-4">
              <div className="d-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 24 }}>summarize</i>
              </div>
              <div>
                <h6 className="fw-bold mb-0">Executive Summary</h6>
                <p className="text-muted mb-0 small">High-level insights and key metrics to share with stakeholders</p>
              </div>
              <i className="material-icons-outlined ms-auto text-muted">chevron_right</i>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
