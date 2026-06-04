import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader';
import { useToast } from '../context/ToastContext';
import { getApiBase } from '../utils/backendUrl';
import MonitoringRulesEditor from '../components/MonitoringRulesEditor';
import type { MonitoringRule } from '../components/smart-execution/types';

// Phase-2 (v5) live view — the backend now ships pre-derived counters
// (pod_health_summary, alert_summary, latest_cluster_summary,
//  duration_*_seconds, testbed_name) so the UI just renders.

interface AlertSummary {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

interface PodHealthSummary {
  critical: number;
  watch: number;
  healthy: number;
  total: number;
}

interface ClusterSummary {
  pods?: number;
  nodes?: number;
  containers?: number;
  namespaces?: number;
}

interface ClusterAllocation {
  cpu_utilization_pct?: number;
  memory_utilization_pct?: number;
  cpu_requests_pct?: number;
  cpu_limits_pct?: number;
  memory_requests_pct?: number;
  memory_limits_pct?: number;
  cpu_usage_cores?: number;
  memory_usage_gib?: number;
  cpu_capacity_cores?: number;
  memory_capacity_gib?: number;
}

interface RuleHealth {
  polls?: number;
  fired?: number;
  last_value?: number | string | null;
  last_fired_at?: string | null;
}

interface MonitorRecord {
  monitor_id: string;
  testbed_id: string;
  testbed_name?: string;
  pc_ip?: string | null;
  name?: string;
  description?: string;
  status: string;
  last_error?: string;
  started_at?: string;
  stopped_at?: string;
  last_poll_at?: string;
  poll_interval_s: number;
  duration_hours?: number | null;
  duration_elapsed_seconds?: number | null;
  duration_remaining_seconds?: number | null;
  rule_config?: { monitoring_rules?: MonitoringRule[] };
  rule_count?: number;
  total_polls: number;
  total_violations: number;
  is_running?: boolean;
  live_violations?: number;
  consecutive_failed_polls?: number;
  last_prometheus_error?: string;
  metric_samples?: Record<string, unknown>;
  alert_summary?: AlertSummary;
  pod_health_summary?: PodHealthSummary;
  latest_cluster_summary?: ClusterSummary;
  latest_cluster_allocation?: ClusterAllocation;
  cluster_snapshot_at?: string | null;
  cluster_health_snapshot?: Record<string, unknown>;
  rule_history?: Array<Record<string, unknown>>;
}

interface ViolationRow {
  source: 'live' | 'persisted';
  rule_name?: string;
  alert_type?: string;
  severity?: string;
  value?: number | null;
  threshold?: number | null;
  operator?: string;
  is_composite?: boolean;
  logical_operator?: string;
  conditions_evaluated?: Array<{
    query: string; scope?: string; operator: string; threshold: number;
    value: number | null; violated: boolean; error?: string | null; scope_label?: string;
  }>;
  iteration?: number;
  timestamp?: string;
  message?: string;
  created_at?: string;
}

const STATUS_COLORS: Record<string, string> = {
  STARTING: '#f59e0b',
  RUNNING: '#22c55e',
  DEGRADED: '#f59e0b',
  STOPPED: '#6b7280',
  FAILED: '#ef4444',
};

const SEVERITY_COLORS: Record<string, string> = {
  Critical: '#ef4444', critical: '#ef4444',
  Moderate: '#f59e0b', warning: '#f59e0b',
  Low: '#22c55e', info: '#0ea5e9',
};

// Compact human-readable duration. ``2h 14m``, ``45m``, ``12s``, ``—``.
const fmtDuration = (sec: number | null | undefined): string => {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

// Inline mini-Sparkline (no chart library — keeps the bundle small and the
// live view snappy even on a hundred-row report).
const Sparkline: React.FC<{
  series: Array<[string, number | null]> | undefined;
  width?: number;
  height?: number;
  color?: string;
  fill?: string;
  yMin?: number;
  yMax?: number;
}> = ({ series, width = 220, height = 44, color = '#0ea5e9', fill = 'rgba(14,165,233,0.12)', yMin, yMax }) => {
  if (!series || series.length === 0) {
    return (
      <svg width={width} height={height} aria-label="no data">
        <text x={width / 2} y={height / 2 + 4} textAnchor="middle" fontSize="10" fill="#9ca3af">
          no data yet
        </text>
      </svg>
    );
  }
  const values = series.map(([, v]) => (typeof v === 'number' ? v : NaN));
  const finite = values.filter(v => Number.isFinite(v));
  if (finite.length === 0) {
    return <svg width={width} height={height}><text x={width / 2} y={height / 2 + 4} textAnchor="middle" fontSize="10" fill="#9ca3af">no values</text></svg>;
  }
  const lo = yMin !== undefined ? yMin : Math.min(...finite);
  const hi = yMax !== undefined ? yMax : Math.max(...finite);
  const range = hi - lo || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const points: string[] = [];
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const x = i * stepX;
    const y = height - ((v - lo) / range) * (height - 4) - 2;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  });
  if (points.length === 0) return <svg width={width} height={height} />;
  const areaPath = `M${points[0]} L${points.join(' L')} L${(values.length - 1) * stepX},${height} L0,${height} Z`;
  const linePath = `M${points.join(' L')}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={areaPath} fill={fill} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// Single stat card — used 8x across the header row.
const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  icon?: string;
}> = ({ label, value, sub, color, icon }) => (
  <div className="card h-100">
    <div className="card-body" style={{ padding: '12px 14px' }}>
      <div className="d-flex justify-content-between align-items-start">
        <div className="text-muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          {label}
        </div>
        {icon && (
          <i className="material-icons-outlined" style={{ fontSize: 16, color: color || '#94a3b8', opacity: 0.7 }}>
            {icon}
          </i>
        )}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--color-primary)', marginTop: 4, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {sub && (
        <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>{sub}</div>
      )}
    </div>
  </div>
);

// Coerce ``[[ts, v], …]`` (the metric_samples shape) into the format
// Sparkline expects. Tolerates objects ``{timestamp, value}`` too.
const coerceSeries = (raw: unknown): Array<[string, number | null]> => {
  if (!Array.isArray(raw)) return [];
  return raw.map((row): [string, number | null] => {
    if (Array.isArray(row)) {
      const [ts, v] = row;
      return [String(ts ?? ''), typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : null)];
    }
    if (row && typeof row === 'object') {
      const o = row as Record<string, unknown>;
      const v = o.value ?? o.v;
      return [
        String(o.timestamp ?? o.ts ?? ''),
        typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : null),
      ];
    }
    return ['', null];
  }).filter(([, v]) => v === null || Number.isFinite(v));
};

const lastVal = (series: Array<[string, number | null]>): number | null => {
  for (let i = series.length - 1; i >= 0; i--) {
    if (typeof series[i][1] === 'number') return series[i][1];
  }
  return null;
};

const MonitorOnlyRun: React.FC = () => {
  const { monitorId } = useParams<{ monitorId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast, confirm } = useToast();

  const [monitor, setMonitor] = useState<MonitorRecord | null>(null);
  const [violations, setViolations] = useState<ViolationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollerRef = useRef<number | null>(null);

  const [showRuleEditor, setShowRuleEditor] = useState(false);
  const [draftRules, setDraftRules] = useState<MonitoringRule[]>([]);
  const [reloading, setReloading] = useState(false);
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [availablePods, setAvailablePods] = useState<string[]>([]);
  const [podsByNamespace, setPodsByNamespace] = useState<Record<string, string[]>>({});

  const refresh = useCallback(async () => {
    if (!monitorId) return;
    try {
      const [monRes, vioRes] = await Promise.all([
        fetch(`${getApiBase()}/api/monitor-only/${monitorId}`),
        fetch(`${getApiBase()}/api/monitor-only/${monitorId}/violations?limit=200`),
      ]);
      const mData = await monRes.json();
      const vData = await vioRes.json();
      if (mData?.success && mData.monitor) {
        setMonitor(mData.monitor);
      } else {
        setError(mData?.error || 'Monitor not found');
      }
      if (vData?.success) {
        setViolations(vData.violations || []);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [monitorId]);

  useEffect(() => {
    refresh();
    pollerRef.current = window.setInterval(refresh, 5000);
    return () => {
      if (pollerRef.current) window.clearInterval(pollerRef.current);
    };
  }, [refresh]);

  const stop = async () => {
    if (!monitorId) return;
    const ok = await confirm({
      title: 'Stop monitor?',
      message: 'This will stop polling Prometheus. The session record stays for review.',
      confirmLabel: 'Stop', variant: 'warning',
    });
    if (!ok) return;
    try {
      const res = await fetch(`${getApiBase()}/api/monitor-only/stop/${monitorId}`, { method: 'POST' });
      const data = await res.json();
      if (data?.success) {
        addToast('success', 'Stop signal sent');
        refresh();
      } else {
        addToast('error', data?.error || 'Failed to stop monitor');
      }
    } catch (e: unknown) {
      addToast('error', `Network error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const openRuleEditor = useCallback(async () => {
    if (!monitor) return;
    const current = (monitor.rule_config?.monitoring_rules || []) as MonitoringRule[];
    setDraftRules(current);
    setShowRuleEditor(true);
    try {
      const res = await fetch(`${getApiBase()}/api/smart-execution/available-pods`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testbed_id: monitor.testbed_id }),
      });
      const data = await res.json();
      if (data?.success) {
        setAvailableNamespaces(data.namespaces || []);
        setAvailablePods(data.pods || []);
        setPodsByNamespace(data.pods_by_namespace || {});
      }
    } catch { /* leave pickers empty */ }
  }, [monitor]);

  useEffect(() => {
    if (monitor && searchParams.get('edit') === '1' && !showRuleEditor) {
      openRuleEditor();
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      setSearchParams(next, { replace: true });
    }
  }, [monitor, searchParams, setSearchParams, showRuleEditor, openRuleEditor]);

  const submitRuleReload = async () => {
    if (!monitorId) return;
    const enabled = draftRules.filter(r => r.enabled !== false);
    if (enabled.length === 0) {
      addToast('error', 'At least one enabled rule is required');
      return;
    }
    setReloading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/monitor-only/${monitorId}/reload-rules`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitoring_rules: enabled }),
      });
      const data = await res.json();
      if (data?.success) {
        addToast('success',
          `Rules updated: +${data.replaced_count || 0} added, -${data.removed_count || 0} removed`);
        setShowRuleEditor(false);
        refresh();
      } else {
        addToast('error', data?.error || 'Failed to reload rules');
      }
    } catch (e: unknown) {
      addToast('error', `Network error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReloading(false);
    }
  };

  // Memoised series extraction so we don't re-coerce on every render.
  const series = useMemo(() => {
    const ms = (monitor?.metric_samples || {}) as Record<string, unknown>;
    return {
      cpu: coerceSeries(ms.cluster_cpu),
      mem: coerceSeries(ms.cluster_mem),
      maxCpu: coerceSeries(ms.cluster_max_cpu),
      maxMem: coerceSeries(ms.cluster_max_mem),
    };
  }, [monitor?.metric_samples]);

  // Rule-health map → array, joined with rule name when we have it.
  const ruleHealthRows = useMemo(() => {
    const ms = (monitor?.metric_samples || {}) as Record<string, unknown>;
    const rh = (ms.rule_health || {}) as Record<string, RuleHealth>;
    const rules = monitor?.rule_config?.monitoring_rules || [];
    const ruleById: Record<string, string> = {};
    rules.forEach((r, idx) => {
      const id = (r as unknown as { id?: string }).id || `rule-${idx}`;
      const name = (r as unknown as { name?: string }).name || (r as unknown as { rule_name?: string }).rule_name || id;
      ruleById[id] = name;
    });
    const out: Array<{ id: string; name: string; polls: number; fired: number; last_value: number | string | null }> = [];
    Object.entries(rh).forEach(([id, h]) => {
      out.push({
        id,
        name: ruleById[id] || id,
        polls: Number(h?.polls || 0),
        fired: Number(h?.fired || 0),
        last_value: h?.last_value ?? null,
      });
    });
    // Sort: fired desc, then polls desc, then name
    out.sort((a, b) => b.fired - a.fired || b.polls - a.polls || a.name.localeCompare(b.name));
    return out;
  }, [monitor?.metric_samples, monitor?.rule_config]);

  if (loading) return <div className="container-fluid py-3"><div className="text-muted">Loading…</div></div>;
  if (error) return (
    <div className="container-fluid py-3">
      <div className="alert alert-danger">{error}</div>
      <button className="btn btn-outline-secondary" onClick={() => navigate('/monitor-only')}>← Back</button>
    </div>
  );
  if (!monitor) return <div className="container-fluid py-3"><div className="alert alert-warning">No monitor data</div></div>;

  const ruleCount = monitor.rule_count ?? (Array.isArray(monitor.rule_config?.monitoring_rules) ? monitor.rule_config!.monitoring_rules!.length : 0);
  const isLive = monitor.status === 'RUNNING' || monitor.status === 'STARTING';
  const statusColor = STATUS_COLORS[monitor.status] || '#6b7280';
  const alerts = monitor.alert_summary || { critical: 0, warning: 0, info: 0, total: 0 };
  const podSum = monitor.pod_health_summary || { critical: 0, watch: 0, healthy: 0, total: 0 };
  const clusterAlloc = monitor.latest_cluster_allocation || {};
  const clusterSum = monitor.latest_cluster_summary || {};
  const cpuLive = lastVal(series.cpu);
  const memLive = lastVal(series.mem);
  const cpuShown = cpuLive !== null ? cpuLive : (clusterAlloc.cpu_utilization_pct ?? null);
  const memShown = memLive !== null ? memLive : (clusterAlloc.memory_utilization_pct ?? null);
  const podLabel = clusterSum.pods != null ? `${clusterSum.pods} pods · ${clusterSum.nodes ?? '?'} nodes` : '—';

  // Cluster-health snapshot for the live pod-snapshot panel.
  const snap = (monitor.cluster_health_snapshot || {}) as Record<string, unknown>;
  const oomRows = Array.isArray(snap.oom_killed) ? (snap.oom_killed as Array<Record<string, unknown>>) : [];
  const restartRows = Array.isArray(snap.window_restarts) ? (snap.window_restarts as Array<Record<string, unknown>>) : [];
  const throttleRows = Array.isArray(snap.cpu_throttling) ? (snap.cpu_throttling as Array<Record<string, unknown>>) : [];
  const notReadyRows = Array.isArray(snap.pods_not_ready) ? (snap.pods_not_ready as Array<Record<string, unknown>>) : [];

  return (
    <div className="container-fluid py-3">
      <PageHeader
        icon="visibility"
        iconGradient="linear-gradient(135deg, #0ea5e9, #0369a1)"
        title={monitor.name || `Monitor ${monitor.monitor_id}`}
        subtitle={[
          monitor.testbed_name || monitor.testbed_id,
          monitor.pc_ip || null,
          `${ruleCount} rule${ruleCount !== 1 ? 's' : ''}`,
          `poll ${monitor.poll_interval_s}s`,
        ].filter(Boolean).join(' · ')}
        actions={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={() => navigate('/monitor-only/sessions')}>
              <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>list</i>
              All sessions
            </button>
            <button type="button" className="btn btn-outline-primary" onClick={() => navigate(`/monitor-only/report/${monitor.monitor_id}`)}>
              <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>description</i>
              Open Report
            </button>
            {isLive && (
              <button type="button" className="btn btn-outline-warning" onClick={openRuleEditor}>
                <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>edit_note</i>
                Edit Rules
              </button>
            )}
            {isLive ? (
              <button type="button" className="btn btn-danger" onClick={stop}>
                <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>stop_circle</i>
                Stop
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => navigate('/monitor-only')}>
                <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>add</i>
                Start a new monitor
              </button>
            )}
          </>
        }
      />

      {((monitor.consecutive_failed_polls || 0) > 0 || monitor.status === 'DEGRADED') && (
        <div className="alert alert-warning" style={{ marginBottom: 12, fontSize: 13 }}>
          <strong>⚠ Degraded:</strong> {monitor.consecutive_failed_polls || 0} consecutive Prometheus failures.
          {monitor.last_prometheus_error && (
            <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 11, color: '#92400e' }}>
              {String(monitor.last_prometheus_error).slice(0, 240)}
            </div>
          )}
        </div>
      )}

      {/* 8-stat header (Status · Duration · Polls · Violations · Alerts ·
          Pod Health · Cluster CPU · Cluster Mem) */}
      <div className="row g-3 mb-3">
        <div className="col-6 col-md-3 col-xl">
          <StatCard
            label="Status"
            icon={isLive ? 'monitor_heart' : 'pause_circle'}
            color={statusColor}
            value={
              <span style={{ fontSize: 18, padding: '4px 10px', borderRadius: 999, background: `${statusColor}1a`, color: statusColor }}>
                {monitor.status}
              </span>
            }
            sub={isLive ? 'polling…' : (monitor.stopped_at ? `stopped ${new Date(monitor.stopped_at).toLocaleString()}` : '—')}
          />
        </div>
        <div className="col-6 col-md-3 col-xl">
          <StatCard
            label="Duration"
            icon="schedule"
            value={fmtDuration(monitor.duration_elapsed_seconds)}
            sub={monitor.duration_hours
              ? (monitor.duration_remaining_seconds !== null && monitor.duration_remaining_seconds !== undefined
                  ? `${fmtDuration(monitor.duration_remaining_seconds)} left of ${monitor.duration_hours}h`
                  : `target ${monitor.duration_hours}h`)
              : 'until stopped'}
          />
        </div>
        <div className="col-6 col-md-3 col-xl">
          <StatCard
            label="Polls"
            icon="sync"
            value={monitor.total_polls}
            sub={monitor.last_poll_at ? `last poll ${new Date(monitor.last_poll_at).toLocaleTimeString()}` : 'no poll yet'}
          />
        </div>
        <div className="col-6 col-md-3 col-xl">
          <StatCard
            label="Violations"
            icon="report_problem"
            color={monitor.total_violations > 0 ? '#ef4444' : '#22c55e'}
            value={monitor.total_violations}
            sub={`${ruleCount} rule${ruleCount !== 1 ? 's' : ''} evaluated`}
          />
        </div>
        <div className="col-6 col-md-3 col-xl">
          <StatCard
            label="Alerts"
            icon="notifications"
            color={alerts.critical > 0 ? '#ef4444' : (alerts.warning > 0 ? '#f59e0b' : '#22c55e')}
            value={alerts.total}
            sub={
              alerts.total > 0
                ? <span>
                    {alerts.critical > 0 && <span style={{ color: '#ef4444', fontWeight: 700 }}>{alerts.critical} crit </span>}
                    {alerts.warning > 0 && <span style={{ color: '#f59e0b', fontWeight: 700 }}>{alerts.warning} warn </span>}
                    {alerts.info > 0 && <span style={{ color: '#0ea5e9', fontWeight: 700 }}>{alerts.info} info</span>}
                  </span>
                : 'no alerts'
            }
          />
        </div>
        <div className="col-6 col-md-3 col-xl">
          <StatCard
            label="Pod Health"
            icon="health_and_safety"
            color={podSum.critical > 0 ? '#ef4444' : (podSum.watch > 0 ? '#f59e0b' : '#22c55e')}
            value={podSum.total > 0 ? `${podSum.healthy}/${podSum.total}` : '—'}
            sub={
              podSum.total > 0
                ? <span>
                    {podSum.critical > 0 && <span style={{ color: '#ef4444' }}>{podSum.critical} critical · </span>}
                    {podSum.watch > 0 && <span style={{ color: '#f59e0b' }}>{podSum.watch} watch · </span>}
                    <span style={{ color: '#22c55e' }}>{podSum.healthy} healthy</span>
                  </span>
                : podLabel
            }
          />
        </div>
        <div className="col-6 col-md-3 col-xl">
          <StatCard
            label="Cluster CPU"
            icon="memory"
            color={cpuShown !== null && cpuShown > 80 ? '#ef4444' : (cpuShown !== null && cpuShown > 60 ? '#f59e0b' : '#22c55e')}
            value={cpuShown !== null ? `${cpuShown.toFixed(1)}%` : '—'}
            sub={
              series.cpu.length > 0
                ? <Sparkline series={series.cpu} width={130} height={28} color="#0ea5e9" fill="rgba(14,165,233,0.15)" yMin={0} yMax={100} />
                : (clusterAlloc.cpu_capacity_cores ? `cap ${clusterAlloc.cpu_capacity_cores}c` : 'no samples yet')
            }
          />
        </div>
        <div className="col-6 col-md-3 col-xl">
          <StatCard
            label="Cluster Mem"
            icon="developer_board"
            color={memShown !== null && memShown > 80 ? '#ef4444' : (memShown !== null && memShown > 60 ? '#f59e0b' : '#22c55e')}
            value={memShown !== null ? `${memShown.toFixed(1)}%` : '—'}
            sub={
              series.mem.length > 0
                ? <Sparkline series={series.mem} width={130} height={28} color="#10b981" fill="rgba(16,185,129,0.15)" yMin={0} yMax={100} />
                : (clusterAlloc.memory_capacity_gib ? `cap ${clusterAlloc.memory_capacity_gib} GiB` : 'no samples yet')
            }
          />
        </div>
      </div>

      {/* Sparkline strip — full-width quartet with explicit y-range so the
          live view can show CPU avg vs. max side-by-side at a glance. */}
      {(series.cpu.length > 0 || series.mem.length > 0) && (
        <div className="card mb-3">
          <div className="card-header d-flex justify-content-between align-items-center">
            <strong>Live Cluster Metrics</strong>
            <span className="text-muted" style={{ fontSize: 11 }}>
              {series.cpu.length} samples · {isLive ? `refresh ${monitor.poll_interval_s}s` : 'historical'}
            </span>
          </div>
          <div className="card-body">
            <div className="row g-3">
              {[
                { key: 'cpu', label: 'CPU avg', series: series.cpu, color: '#0ea5e9', fill: 'rgba(14,165,233,0.12)' },
                { key: 'maxCpu', label: 'CPU max (per-node)', series: series.maxCpu, color: '#f59e0b', fill: 'rgba(245,158,11,0.12)' },
                { key: 'mem', label: 'Memory avg', series: series.mem, color: '#10b981', fill: 'rgba(16,185,129,0.12)' },
                { key: 'maxMem', label: 'Memory max (per-node)', series: series.maxMem, color: '#a855f7', fill: 'rgba(168,85,247,0.12)' },
              ].map(s => {
                const lv = lastVal(s.series);
                const colorByVal = lv !== null && lv > 80 ? '#ef4444' : (lv !== null && lv > 60 ? '#f59e0b' : s.color);
                return (
                  <div key={s.key} className="col-md-6 col-xl-3">
                    <div className="d-flex justify-content-between align-items-baseline" style={{ marginBottom: 4 }}>
                      <span className="text-muted" style={{ fontSize: 11, fontWeight: 600 }}>{s.label}</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: colorByVal, fontVariantNumeric: 'tabular-nums' }}>
                        {lv !== null ? `${lv.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                    <Sparkline series={s.series} width={260} height={50} color={s.color} fill={s.fill} yMin={0} yMax={100} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Rule-health grid — one mini-card per evaluated rule.
          A monitor with 20 rules wraps automatically; an empty grid means
          metric_samples haven't been flushed yet (first ~150s for default
          settings) and we say so explicitly. */}
      <div className="card mb-3">
        <div className="card-header d-flex justify-content-between align-items-center">
          <strong>Rule Health</strong>
          <span className="text-muted" style={{ fontSize: 11 }}>
            {ruleHealthRows.length > 0 ? `${ruleHealthRows.length} rules evaluating` : 'no samples flushed yet'}
          </span>
        </div>
        <div className="card-body">
          {ruleHealthRows.length === 0 ? (
            <div className="text-muted text-center py-3" style={{ fontSize: 12 }}>
              Rule health snapshots are flushed every few polls. Check back in ~{Math.ceil(monitor.poll_interval_s * 5 / 60)} min.
            </div>
          ) : (
            <div className="row g-2">
              {ruleHealthRows.map(r => {
                const tone = r.fired === 0 ? '#22c55e' : (r.fired < 5 ? '#f59e0b' : '#ef4444');
                const pct = r.polls > 0 ? (100 * r.fired / r.polls) : 0;
                return (
                  <div key={r.id} className="col-md-6 col-lg-4 col-xl-3">
                    <div className="card h-100" style={{ borderLeft: `3px solid ${tone}` }}>
                      <div className="card-body" style={{ padding: 10 }}>
                        <div title={r.name} style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.name}
                        </div>
                        <div className="d-flex justify-content-between align-items-baseline" style={{ marginTop: 4 }}>
                          <span className="text-muted" style={{ fontSize: 10 }}>{r.polls} polls</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums' }}>
                            {r.fired} fired
                          </span>
                        </div>
                        <div style={{ marginTop: 4, height: 4, background: '#e5e7eb', borderRadius: 2 }}>
                          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: tone, borderRadius: 2 }} />
                        </div>
                        {r.last_value !== null && r.last_value !== undefined && (
                          <div className="text-muted" style={{ fontSize: 10, marginTop: 3, fontFamily: 'monospace' }}>
                            last: {typeof r.last_value === 'number' ? r.last_value.toFixed(2) : String(r.last_value).slice(0, 24)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Live Pod Health snapshot — surfaces top-10 of each problem bucket
          from the latest cluster_health_snapshot. Same data the report
          uses, just streamed here so testers don't need to open the report
          to know which pods are broken right now. */}
      {(oomRows.length + restartRows.length + throttleRows.length + notReadyRows.length) > 0 && (
        <div className="card mb-3">
          <div className="card-header d-flex justify-content-between align-items-center">
            <strong>Live Pod Health</strong>
            <span className="text-muted" style={{ fontSize: 11 }}>
              snapshot {monitor.cluster_snapshot_at ? new Date(monitor.cluster_snapshot_at).toLocaleTimeString() : 'recent'}
              {' · '}top 10 per bucket
            </span>
          </div>
          <div className="card-body">
            <div className="row g-3">
              {[
                { label: 'OOMKilled', rows: oomRows, color: '#ef4444', icon: 'cancel', valueKey: 'restart_count' },
                { label: 'Restarted (in window)', rows: restartRows, color: '#f59e0b', icon: 'restart_alt', valueKey: 'restarts_in_window' },
                { label: 'CPU Throttled', rows: throttleRows, color: '#f59e0b', icon: 'speed', valueKey: 'throttle_pct' },
                { label: 'Not Ready', rows: notReadyRows, color: '#ef4444', icon: 'block', valueKey: 'state' },
              ].filter(b => b.rows.length > 0).map(bucket => (
                <div key={bucket.label} className="col-md-6 col-xl-3">
                  <div className="d-flex align-items-center gap-2" style={{ marginBottom: 6 }}>
                    <i className="material-icons-outlined" style={{ fontSize: 16, color: bucket.color }}>{bucket.icon}</i>
                    <strong style={{ fontSize: 12 }}>{bucket.label}</strong>
                    <span className="badge" style={{ background: `${bucket.color}1a`, color: bucket.color, fontSize: 10 }}>
                      {bucket.rows.length}
                    </span>
                  </div>
                  <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 11 }}>
                    {bucket.rows.slice(0, 10).map((r, i) => {
                      const ns = (r.namespace as string) || '?';
                      const pod = (r.pod as string) || (r.pod_name as string) || '?';
                      const cont = (r.container as string) || '';
                      const val = r[bucket.valueKey];
                      return (
                        <div key={i} className="d-flex justify-content-between" style={{ padding: '3px 0', borderBottom: '1px solid #f3f4f6' }}>
                          <span title={`${ns}/${pod}${cont ? `/${cont}` : ''}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                            <span className="text-muted">{ns}/</span>{pod}
                            {cont && <span className="text-muted" style={{ fontSize: 10 }}> · {cont}</span>}
                          </span>
                          <span style={{ fontWeight: 600, color: bucket.color, fontVariantNumeric: 'tabular-nums' }}>
                            {val !== null && val !== undefined ? (typeof val === 'number' ? val.toFixed(typeof val === 'number' && val < 10 ? 2 : 0) : String(val).slice(0, 12)) : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent violations — same data as before, just below the new sections.
          Kept as the primary tester surface because most users come here to
          investigate why an alert fired. */}
      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center">
          <strong>Recent Violations</strong>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {violations.length === 0 ? 'No violations yet' : `${violations.length} shown · auto-refresh 5s`}
          </span>
        </div>
        {violations.length === 0 ? (
          <div className="card-body text-muted text-center py-5">
            <i className="material-icons-outlined" style={{ fontSize: 48, opacity: 0.5 }}>check_circle</i>
            <div style={{ marginTop: 8 }}>All rules healthy.</div>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm mb-0" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Time</th>
                  <th>Rule</th>
                  <th style={{ width: 90 }}>Severity</th>
                  <th>Detail</th>
                  <th style={{ width: 70 }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {violations.map((v, i) => {
                  const ts = v.timestamp || v.created_at || '';
                  const sev = v.severity || 'Moderate';
                  const sevColor = SEVERITY_COLORS[sev] || SEVERITY_COLORS.Moderate;
                  const ruleName = v.rule_name || v.alert_type || '—';
                  const detail = v.is_composite && v.conditions_evaluated
                    ? <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {v.conditions_evaluated.map((c, idx) => (
                          <React.Fragment key={idx}>
                            {idx > 0 && <span style={{ margin: '0 4px', padding: '0 4px', background: '#e0e7ff', color: '#4338ca', borderRadius: 3, fontWeight: 700 }}>{v.logical_operator || 'AND'}</span>}
                            <span style={{ color: c.violated ? '#ef4444' : 'var(--color-text-muted)' }}>
                              {(c.scope || 'pod').toUpperCase()}:{c.scope_label?.replace(/^[ /]/, '') || '*'} {c.query} {c.operator} {c.threshold}
                              {c.value !== null && <> = <strong>{Number(c.value).toFixed(2)}</strong></>}
                              {c.error && <span style={{ color: '#f59e0b', fontStyle: 'italic' }}> ({c.error})</span>}
                            </span>
                          </React.Fragment>
                        ))}
                      </span>
                    : <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {v.message || (v.value != null && v.threshold != null && v.operator
                          ? <>actual <strong>{Number(v.value).toFixed(2)}</strong> {v.operator} threshold {v.threshold}</>
                          : '—')}
                      </span>;
                  return (
                    <tr key={i}>
                      <td className="text-muted" style={{ fontSize: 11 }}>{ts ? new Date(ts).toLocaleTimeString() : '—'}</td>
                      <td><strong>{ruleName}</strong></td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 999, background: `${sevColor}1a`, color: sevColor, fontSize: 11, fontWeight: 600 }}>
                          {sev}
                        </span>
                      </td>
                      <td>{detail}</td>
                      <td>
                        <span className="badge bg-light text-dark" style={{ fontSize: 10 }}>{v.source}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-muted text-center" style={{ fontSize: 11, marginTop: 12 }}>
        Violations are also recorded on the <a href="#" onClick={e => { e.preventDefault(); navigate('/alert-summary'); }}>Alert Summary</a> page and the testbed's Slack channel (if configured).
      </div>

      {showRuleEditor && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            zIndex: 1050, padding: 24, overflowY: 'auto',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowRuleEditor(false); }}
        >
          <div style={{
            background: 'white', borderRadius: 12, width: '100%', maxWidth: 1100,
            boxShadow: '0 10px 40px rgba(0,0,0,.25)', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', maxHeight: '90vh',
          }}>
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                Edit monitoring rules — {monitor.monitor_id}
              </h2>
              <button type="button" className="btn btn-sm btn-link" onClick={() => setShowRuleEditor(false)}>✕</button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
              <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
                Adding a rule takes effect on the next poll (no restart). Removing a rule clears its cooldown so a re-added rule fires fresh.
                A history entry is recorded for every change.
              </p>
              <MonitoringRulesEditor
                rules={draftRules}
                onChange={setDraftRules}
                availableNamespaces={availableNamespaces}
                availablePods={availablePods}
                podsByNamespace={podsByNamespace}
                testbedId={monitor.testbed_id}
                embedded
              />
            </div>
            <div style={{
              padding: '14px 20px', borderTop: '1px solid #e5e7eb',
              display: 'flex', justifyContent: 'flex-end', gap: 8,
            }}>
              <button type="button" className="btn btn-outline-secondary" onClick={() => setShowRuleEditor(false)} disabled={reloading}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={submitRuleReload} disabled={reloading}>
                {reloading && <span className="spinner-border spinner-border-sm me-2" />}
                Save & apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitorOnlyRun;
