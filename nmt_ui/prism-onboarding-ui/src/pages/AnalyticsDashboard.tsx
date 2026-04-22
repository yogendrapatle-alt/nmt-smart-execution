import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactApexChart from 'react-apexcharts';
import { getApiBase } from '../utils/backendUrl';
import { PageHeader, MetricCard, EmptyState } from '../components/ui';
import { SkeletonMetricRow, SkeletonCard } from '../components/ui/LoadingSkeleton';

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
  const [dateRange, setDateRange] = useState('365');
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

  /* ── Loading skeleton ──────────────────────────────────── */
  if (loading) {
    return (
      <div className="main-content">
        <PageHeader icon="insights" iconGradient="linear-gradient(135deg, #667eea, #764ba2)" title="Analytics Dashboard" subtitle="Loading performance data…" />
        <SkeletonMetricRow count={6} />
        <SkeletonCard lines={8} />
      </div>
    );
  }

  const trendCategories = trends.map(t => {
    const d = new Date(t.period);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });
  const trendValues = trends.map(t => Math.round(t.value * 100) / 100);
  const mi = metricInfo[selectedMetric] || metricInfo.executions;

  const cpuVariant: 'success' | 'warning' | 'danger' = overview
    ? overview.resource_utilization.avg_cpu_percent > 80 ? 'danger' : overview.resource_utilization.avg_cpu_percent > 60 ? 'warning' : 'success'
    : 'success';
  const memVariant: 'success' | 'warning' | 'danger' = overview
    ? overview.resource_utilization.avg_memory_percent > 80 ? 'danger' : overview.resource_utilization.avg_memory_percent > 60 ? 'warning' : 'success'
    : 'success';
  const successVariant: 'success' | 'warning' | 'danger' = overview
    ? overview.executions.success_rate >= 80 ? 'success' : overview.executions.success_rate >= 50 ? 'warning' : 'danger'
    : 'success';

  return (
    <div className="main-content">
      <PageHeader
        icon="insights"
        iconGradient="linear-gradient(135deg, #667eea, #764ba2)"
        title="Analytics Dashboard"
        subtitle="Track Smart Execution performance across all testbeds — execution counts, success rates, operation throughput, and resource usage trends."
        actions={
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <select className="form-select form-select-sm rounded-3" style={{ width: 'auto' }} value={dateRange} onChange={e => setDateRange(e.target.value)}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 6 months</option>
              <option value="365">Last 1 year</option>
            </select>
            <button className="btn btn-outline-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={loadAnalytics}>
              <i className="material-icons-outlined" style={{ fontSize: 18 }}>refresh</i>Refresh
            </button>
          </div>
        }
      />

      {/* ── Metric Cards ──────────────────────────────────── */}
      {overview && (
        <div className="row row-cols-1 row-cols-md-3 row-cols-xl-6 g-3 mb-4">
          <div className="col">
            <MetricCard icon="rocket_launch" variant="default" label="Total Executions" value={overview.executions.total}
              detail={`${overview.executions.completed} completed, ${overview.executions.failed} failed`} />
          </div>
          <div className="col">
            <MetricCard icon="check_circle" variant={successVariant} label="Success Rate" value={`${overview.executions.success_rate.toFixed(1)}`} suffix="%"
              detail={overview.executions.success_rate >= 80 ? 'Healthy — above 80%' : overview.executions.success_rate >= 50 ? 'Moderate — room for improvement' : 'Below 50% — review failures'} />
          </div>
          <div className="col">
            <MetricCard icon="settings" iconGradient="linear-gradient(135deg, #8b5cf6, #7c3aed)" label="Total Operations" value={overview.operations.total.toLocaleString()}
              detail={`${overview.operations.success_rate.toFixed(1)}% op success`} />
          </div>
          <div className="col">
            <MetricCard icon="timer" variant="warning" label="Avg Exec Time" value={`${overview.performance.avg_duration_minutes.toFixed(1)}`} suffix="m"
              detail={`${overview.performance.avg_operations_per_minute.toFixed(1)} ops/min`} />
          </div>
          <div className="col">
            <MetricCard icon="memory" variant={cpuVariant} label="Avg CPU" value={`${overview.resource_utilization.avg_cpu_percent.toFixed(1)}`} suffix="%"
              detail={overview.resource_utilization.avg_cpu_percent > 80 ? 'High — monitor closely' : 'Within normal range'} />
          </div>
          <div className="col">
            <MetricCard icon="storage" variant={memVariant} label="Avg Memory" value={`${overview.resource_utilization.avg_memory_percent.toFixed(1)}`} suffix="%"
              detail={overview.resource_utilization.avg_memory_percent > 80 ? 'High — monitor closely' : 'Within normal range'} />
          </div>
        </div>
      )}

      {/* ── Trend Chart ───────────────────────────────────── */}
      <div className="card border-0 rounded-3 mb-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="card-body p-4">
          <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
            <div>
              <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2" style={{ fontSize: 'var(--text-md)' }}>
                <i className="material-icons-outlined" style={{ fontSize: 20, color: 'var(--color-primary)' }}>show_chart</i>
                {mi.label} Trend
              </h6>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }} className="mb-0 mt-1">{mi.desc}</p>
            </div>
            <select className="form-select form-select-sm rounded-3" style={{ width: 'auto' }} value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)}>
              {Object.entries(metricInfo).map(([key, info]) => (
                <option key={key} value={key}>{info.label}</option>
              ))}
            </select>
          </div>

          {trends.length > 0 ? (
            <ReactApexChart
              type="area"
              height={300}
              series={[{ name: mi.label, data: trendValues }]}
              options={{
                chart: { toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'var(--font-sans)' },
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
            <EmptyState icon="bar_chart" title="No trend data" description={`No data for this period. Run some Smart Executions to see ${mi.label.toLowerCase()} trends.`} />
          )}
        </div>
      </div>

      {/* ── Quick Links ───────────────────────────────────── */}
      <div className="row g-3">
        {[
          { path: '/analytics/comparison', icon: 'compare', gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)', title: 'Execution Comparison', desc: 'Compare multiple executions side by side to see which performed best' },
          { path: '/analytics/executive-summary', icon: 'summarize', gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', title: 'Executive Summary', desc: 'High-level insights and key metrics to share with stakeholders' },
        ].map(link => (
          <div className="col-md-6" key={link.path}>
            <div
              className="card border-0 rounded-3 h-100"
              style={{ boxShadow: 'var(--shadow-sm)', cursor: 'pointer', transition: 'transform var(--transition-fast), box-shadow var(--transition-fast)' }}
              role="button"
              onClick={() => navigate(link.path)}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
            >
              <div className="card-body d-flex align-items-center gap-3 p-4">
                <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 44, height: 44, background: link.gradient }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 24 }}>{link.icon}</i>
                </div>
                <div style={{ minWidth: 0 }}>
                  <h6 className="fw-bold mb-0" style={{ fontSize: 'var(--text-base)' }}>{link.title}</h6>
                  <p className="mb-0" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{link.desc}</p>
                </div>
                <i className="material-icons-outlined ms-auto" style={{ color: 'var(--color-text-muted)' }}>chevron_right</i>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
