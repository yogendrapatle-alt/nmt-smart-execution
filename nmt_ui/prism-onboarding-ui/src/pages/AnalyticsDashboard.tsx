import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactApexChart from 'react-apexcharts';
import { getApiBase } from '../utils/backendUrl';
import { PageHeader, MetricCard, EmptyState } from '../components/ui';
import { SkeletonMetricRow, SkeletonCard } from '../components/ui/LoadingSkeleton';

interface Overview {
  period: { start: string; end: string; days: number };
  executions: { total: number; completed: number; failed: number; running: number; stopped?: number; success_rate: number; completion_rate?: number };
  operations: { total: number; successful: number; failed?: number; success_rate: number; avg_per_execution: number };
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
  const [testbeds, setTestbeds] = useState<{ id: string; name: string }[]>([]);
  const [selectedTestbed, setSelectedTestbed] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/get-testbeds`);
        const d = await res.json();
        const list = (d.testbeds || []).map((t: any) => ({
          id: t.unique_testbed_id || t.id,
          name: t.testbed_label || t.ncm_ip || t.pc_ip || (t.unique_testbed_id || '').slice(0, 12),
        }));
        setTestbeds(list);
      } catch { /* ignore */ }
    })();
  }, []);

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
      if (selectedTestbed) params.set('testbed_id', selectedTestbed);

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
  }, [dateRange, selectedMetric, selectedTestbed]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

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
    ? overview.operations.success_rate >= 80 ? 'success' : overview.operations.success_rate >= 50 ? 'warning' : 'danger'
    : 'success';

  const stoppedCount = overview?.executions?.stopped ?? 0;

  return (
    <div className="main-content">
      <PageHeader
        icon="insights"
        iconGradient="linear-gradient(135deg, #667eea, #764ba2)"
        title="Analytics Dashboard"
        subtitle="Track Smart Execution performance across all testbeds — execution counts, success rates, operation throughput, and resource usage trends."
        actions={
          <div className="d-flex gap-2 align-items-center flex-wrap">
            {testbeds.length > 0 && (
              <select className="form-select form-select-sm rounded-3" style={{ width: 'auto', maxWidth: 200 }} value={selectedTestbed} onChange={e => setSelectedTestbed(e.target.value)}>
                <option value="">All Testbeds</option>
                {testbeds.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
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

      {overview && (
        <div className="row row-cols-1 row-cols-md-3 row-cols-xl-6 g-3 mb-4">
          <div className="col">
            <MetricCard icon="rocket_launch" variant="default" label="Total Executions" value={overview.executions.total}
              detail={`${overview.executions.completed} completed, ${overview.executions.failed} failed${stoppedCount > 0 ? `, ${stoppedCount} stopped` : ''}`} />
          </div>
          <div className="col">
            <MetricCard icon="check_circle" variant={successVariant} label="Op Success Rate" value={`${overview.operations.success_rate.toFixed(1)}`} suffix="%"
              detail={`${overview.operations.successful?.toLocaleString()} of ${overview.operations.total?.toLocaleString()} ops succeeded`} />
          </div>
          <div className="col">
            <MetricCard icon="settings" iconGradient="linear-gradient(135deg, #8b5cf6, #7c3aed)" label="Total Operations" value={overview.operations.total.toLocaleString()}
              detail={`~${overview.operations.avg_per_execution.toFixed(0)} ops per execution`} />
          </div>
          <div className="col">
            <MetricCard icon="timer" variant="warning" label="Avg Duration" value={`${overview.performance.avg_duration_minutes.toFixed(1)}`} suffix="m"
              detail={`${overview.performance.avg_operations_per_minute.toFixed(1)} ops/min throughput`} />
          </div>
          <div className="col">
            <MetricCard icon="memory" variant={cpuVariant} label="Avg CPU" value={`${overview.resource_utilization.avg_cpu_percent.toFixed(1)}`} suffix="%"
              detail={overview.resource_utilization.avg_cpu_percent > 80 ? 'High — monitor closely' : overview.resource_utilization.avg_cpu_percent > 0 ? 'Within normal range' : 'No data available'} />
          </div>
          <div className="col">
            <MetricCard icon="storage" variant={memVariant} label="Avg Memory" value={`${overview.resource_utilization.avg_memory_percent.toFixed(1)}`} suffix="%"
              detail={overview.resource_utilization.avg_memory_percent > 80 ? 'High — monitor closely' : overview.resource_utilization.avg_memory_percent > 0 ? 'Within normal range' : 'No data available'} />
          </div>
        </div>
      )}

      {/* Execution Status Breakdown */}
      {overview && overview.executions.total > 0 && (
        <div className="row g-3 mb-4">
          <div className="col-md-5">
            <div className="card border-0 rounded-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <div className="card-body p-4">
                <h6 className="mb-1 fw-semibold d-flex align-items-center gap-2" style={{ fontSize: 'var(--text-md)' }}>
                  <i className="material-icons-outlined" style={{ fontSize: 20, color: '#8b5cf6' }}>donut_large</i>
                  Execution Status
                </h6>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }} className="mb-3">Breakdown of execution outcomes</p>
                <ReactApexChart
                  type="donut"
                  height={220}
                  series={[overview.executions.completed, overview.executions.failed, stoppedCount, overview.executions.running].filter(v => v > 0)}
                  options={{
                    chart: { fontFamily: 'inherit' },
                    labels: ['Completed', 'Failed/Timeout', 'Stopped', 'Running'].filter((_, i) => [overview.executions.completed, overview.executions.failed, stoppedCount, overview.executions.running][i] > 0),
                    colors: ['#22c55e', '#ef4444', '#f59e0b', '#3b82f6'],
                    legend: { position: 'bottom', fontSize: '12px' },
                    dataLabels: { enabled: true, formatter: (v: number) => `${v.toFixed(0)}%` },
                    plotOptions: { pie: { donut: { size: '55%', labels: { show: true, total: { show: true, label: 'Total', fontSize: '14px', formatter: () => String(overview.executions.total) } } } } },
                  }}
                />
              </div>
            </div>
          </div>
          <div className="col-md-7">
            <div className="card border-0 rounded-3 h-100" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <div className="card-body p-4">
                <h6 className="mb-1 fw-semibold d-flex align-items-center gap-2" style={{ fontSize: 'var(--text-md)' }}>
                  <i className="material-icons-outlined" style={{ fontSize: 20, color: '#3b82f6' }}>assessment</i>
                  Performance Summary
                </h6>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }} className="mb-3">Key performance indicators at a glance</p>
                <div className="d-flex flex-column gap-3">
                  {[
                    { label: 'Threshold Achievement', value: `${overview.performance.threshold_achievement_rate.toFixed(1)}%`, color: overview.performance.threshold_achievement_rate > 50 ? '#22c55e' : '#f59e0b' },
                    { label: 'Avg Operations / Execution', value: overview.operations.avg_per_execution.toFixed(1), color: '#8b5cf6' },
                    { label: 'Avg Throughput', value: `${overview.performance.avg_operations_per_minute.toFixed(2)} ops/min`, color: '#3b82f6' },
                    { label: 'Operations Failed', value: `${(overview.operations.failed ?? (overview.operations.total - overview.operations.successful)).toLocaleString()}`, color: '#ef4444' },
                  ].map((item, i) => (
                    <div key={i} className="d-flex align-items-center justify-content-between p-2 rounded-3" style={{ background: '#f8fafc' }}>
                      <span className="small fw-medium text-muted">{item.label}</span>
                      <span className="fw-bold" style={{ color: item.color }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trend Chart */}
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

      {/* Quick Links */}
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
