import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getApiBase } from '../utils/backendUrl';

// ── EnhancedReportIframe ────────────────────────────────────────────
// Renders the backend-built /report.html with a loading overlay so the
// first-call wait (Prometheus is rebuilding pod/cluster snapshots) doesn't
// look like a blank page. The iframe stays mounted across re-renders so
// switching tabs and coming back doesn't restart the rebuild.
const EnhancedReportIframe: React.FC<{ src: string }> = ({ src }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <div style={{ position: 'relative', minHeight: 'calc(100vh - 460px)' }}>
      {!loaded && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.94)', flexDirection: 'column', gap: 14,
          }}
        >
          <div className="spinner-border text-primary" role="status" style={{ width: 48, height: 48 }} />
          <div className="text-center">
            <div className="fw-semibold text-dark mb-1">Rendering enhanced report…</div>
            <div className="text-muted small" style={{ maxWidth: 460 }}>
              First load takes 30–60 seconds while we pull pod health, cluster snapshots and
              violation history from Prometheus. Subsequent refreshes are cached.
            </div>
          </div>
        </div>
      )}
      <iframe
        src={src}
        title="Enhanced monitor report"
        onLoad={() => setLoaded(true)}
        style={{
          width: '100%',
          height: 'calc(100vh - 460px)',
          minHeight: 720,
          border: 'none',
          display: 'block',
        }}
      />
    </div>
  );
};

// We render the resource trend with a tiny inline SVG so we don't need to
// add a chart library dependency. Keeps the report page lightweight.

// Phase-4 (v5): the "enhanced" tab is the default view and embeds the same
// HTML the user gets when clicking "Open HTML" — single source of truth so
// the on-screen and downloaded views can never drift. The remaining tabs
// stay as drill-in views for testers who want to filter / search / CSV-export
// a specific slice (violations, rule_health, log_bundles, etc.).
type TabId = 'enhanced' | 'overview' | 'violations' | 'rules' | 'trend' | 'pods' | 'cluster' | 'logs' | 'config';

interface LogBundle {
  id: number; rule_id?: string; rule_name?: string; severity?: string;
  status: string; pc_ip?: string; ncm_ip?: string; duration_hours?: number;
  requested_at?: string; started_at?: string; completed_at?: string;
  error?: string; bundle_path?: string; bundle_size_bytes?: number;
  stdout_tail?: string; metadata?: { has_pc_creds?: boolean; paramiko_available?: boolean };
}

// Phase-1: enhanced-report parity blocks. Shapes are a subset of what
// EnhancedReportService emits — only the fields we actually render here.
interface PodHealthRow {
  namespace?: string; pod?: string; node?: string; phase?: string;
  severity?: 'Critical' | 'Watch' | 'Healthy' | string;
  cpu_pct?: number | null;
  // 'limit' | 'request' | 'unspecified' — which denominator cpu_pct uses.
  cpu_basis?: 'limit' | 'request' | 'unspecified' | null;
  cpu_cores?: number | null;
  cpu_pct_max_in_run?: number | null; memory_pct_max_in_run?: number | null;
  cpu_limit_cores?: number | null; memory_limit_mb?: number | null;
  cpu_throttle_pct?: number | null;
  throttle_top_container?: {
    container: string;
    throttle_ratio: number;
    cpu_cores: number;
  } | null;
  restarts_in_run?: number; oom_kills_in_run?: number; container_count?: number;
  reasons?: string[]; score?: number;
}
interface PodHealthBlock {
  pods?: PodHealthRow[];
  summary?: { total?: number; critical?: number; watch?: number; healthy?: number };
  by_namespace?: Record<string, { total?: number; critical?: number; watch?: number; healthy?: number }>;
}
interface ClusterHealth {
  pod_phase_summary?: Record<string, number>;
  cluster_summary?: Record<string, any>;
  node_breakdown?: Array<{ node?: string; cpu_pct?: number; memory_pct?: number; allocatable_cpu_cores?: number; allocatable_memory_mb?: number }>;
  oom_killed?: Array<{ namespace?: string; pod?: string; container?: string; reason?: string }>;
  cpu_throttling?: Array<{ namespace?: string; pod?: string; container?: string; throttle_ratio?: number }>;
  terminated_containers?: Array<{ namespace?: string; pod?: string; container?: string; reason?: string }>;
  total_restarts?: Array<{ namespace?: string; pod?: string; container?: string; restarts?: number }>;
  node_conditions?: Array<{ node?: string; condition?: string; status?: string }>;
  collection_status?: string; collection_reason?: string;
}
interface BaselineDelta {
  baseline?: Record<string, number>;
  current?: Record<string, number>;
  delta?: Record<string, number>;
}
interface RuleHistoryEntry {
  ts?: string; source?: string; total_rules?: number;
  replaced_count?: number; removed_count?: number; dropped_cooldowns?: number;
}
interface Operational {
  is_running?: boolean; status?: string;
  consecutive_failed_polls?: number;
  last_prometheus_error?: string | null;
  last_poll_at?: string | null;
  enhanced_report_error?: string | null;
  // 2026-06-03: backend sets these when build_report skipped the
  // slow live-merge because the testbed's Prometheus URL is dead.
  // The UI surfaces a banner so the user knows the report is served
  // from the persisted snapshot, not silently rendering stale data.
  live_prometheus_unavailable?: boolean;
  live_prometheus_skip_reason?: 'prometheus_url_unreachable' | 'prometheus_url_not_configured' | null;
  // 2026-06-04 (Layer-2): single source of truth for the report banner,
  // computed by report_snapshot_builder.classify_data_quality so HTML, JSON
  // and this view always agree. data_quality drives the banner styling.
  data_quality?: 'live' | 'live_with_gaps' | 'persisted_only' | 'stale' | 'unconfigured' | 'error';
  banner_text?: string | null;
  snapshot_generated_at?: string | null;
  snapshot_poll_count?: number;
}

interface Verdict { level: 'pass' | 'warn' | 'fail'; label: string; icon: string; summary: string; }
interface Overview {
  monitor_id: string; name?: string; description?: string; testbed_id: string;
  status: string; started_at?: string; stopped_at?: string; last_poll_at?: string;
  duration_seconds?: number; duration_hours_target?: number; poll_interval_s: number;
  total_polls: number; total_violations: number; is_running: boolean; rule_count: number;
}
interface RuleHealth {
  id: string; name?: string; severity?: string; enabled: boolean; description?: string;
  summary: string; collect_logs: boolean; log_duration_hours?: number;
  polls: number; fired: number; last_value?: number | string | null;
  last_violation_ts?: string | null; fire_rate: number;
}
interface Violation {
  rule_id?: string; rule_name?: string; severity?: string;
  value?: number | string | null; threshold?: number | string;
  operator?: string; is_composite?: boolean; logical_operator?: string;
  conditions_evaluated?: any[]; message?: string; timestamp?: string;
  iteration?: number; pod_name?: string; namespace?: string; source?: string;
}
interface Report {
  verdict: Verdict; overview: Overview; rules: RuleHealth[]; violations: Violation[];
  timeseries: Record<string, [string, number][]>;
  rule_health: Record<string, any>;
  correlation: { ts: string; severity?: string; rule_name?: string; value?: number | string }[];
  recommendations: string[];
  log_bundles?: LogBundle[];
  config_dump: { rule_config?: any; settings?: any; slack_channel_override?: string | null; schedule?: any };
  // Phase-1 enhanced-report parity payload
  pod_health?: PodHealthBlock;
  cluster_health?: ClusterHealth;
  pod_restart_tracking?: Record<string, any>;
  baseline_health?: Record<string, any>;
  baseline_delta?: BaselineDelta;
  rule_history?: RuleHistoryEntry[];
  operational?: Operational;
}

const SEV_COLOR: Record<string, string> = { Critical: '#ef4444', Moderate: '#f59e0b', Low: '#22c55e' };

const fmtTs = (s?: string | null) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(); } catch { return s; }
};
const fmtSec = (s?: number) => {
  if (s == null) return '—';
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(2)}h`;
};

// ── Tiny inline SVG chart (no deps) ─────────────────────────────────
const TrendChart: React.FC<{ series: Record<string, [string, number][]> }> = ({ series }) => {
  const cpu = series.cluster_cpu || [];
  const mem = series.cluster_mem || [];
  const maxCpu = series.cluster_max_cpu || [];
  const maxMem = series.cluster_max_mem || [];
  const all = [cpu, mem, maxCpu, maxMem].filter(s => s.length);
  if (all.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 8 }}>
        No timeseries data captured yet. Either Prometheus is unreachable for this testbed,
        or this monitor has not completed enough polls. Re-open this report after the monitor has run for a few minutes.
      </div>
    );
  }

  const W = 920, H = 280, P = 40;
  const labels = (cpu.length ? cpu : mem).map(p => p[0]);
  const xStep = labels.length > 1 ? (W - 2 * P) / (labels.length - 1) : 0;
  const allValues = all.flatMap(s => s.map(p => p[1]));
  const yMax = Math.max(100, Math.ceil(Math.max(...allValues, 1)));
  const yToPx = (v: number) => H - P - (v / yMax) * (H - 2 * P);

  const buildPath = (data: [string, number][]) => {
    if (!data.length) return '';
    return data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${P + i * xStep} ${yToPx(p[1])}`).join(' ');
  };

  const lines: { name: string; color: string; data: [string, number][] }[] = [
    { name: 'Cluster Avg CPU', color: '#3b82f6', data: cpu },
    { name: 'Cluster Max CPU', color: '#1e40af', data: maxCpu },
    { name: 'Cluster Avg Mem', color: '#ef4444', data: mem },
    { name: 'Cluster Max Mem', color: '#991b1b', data: maxMem },
  ].filter(l => l.data.length);

  // y-axis ticks at 0, 25, 50, 75, 100
  const ticks = [0, 25, 50, 75, 100].filter(t => t <= yMax);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: 320 }}>
        {/* gridlines + y labels */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={P} x2={W - P} y1={yToPx(t)} y2={yToPx(t)} stroke="#e2e8f0" strokeDasharray="2 4" />
            <text x={P - 6} y={yToPx(t) + 4} textAnchor="end" fontSize={10} fill="#64748b">{t}%</text>
          </g>
        ))}
        {/* x label first/last */}
        {labels.length > 0 && (
          <>
            <text x={P} y={H - P + 14} fontSize={9} fill="#64748b">{labels[0].slice(11, 19)}</text>
            <text x={W - P} y={H - P + 14} fontSize={9} fill="#64748b" textAnchor="end">{labels[labels.length - 1].slice(11, 19)}</text>
          </>
        )}
        {/* line series */}
        {lines.map(l => (
          <path key={l.name} d={buildPath(l.data)} stroke={l.color} fill="none" strokeWidth={1.6} />
        ))}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, fontSize: 12 }}>
        {lines.map(l => (
          <span key={l.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 4, background: l.color, borderRadius: 2 }} />
            {l.name}
          </span>
        ))}
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string | number; sub?: string }> = ({ label, value, sub }) => (
  <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, textAlign: 'center' }}>
    <div style={{ fontSize: 24, fontWeight: 800 }}>{value}</div>
    <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    {sub && <div style={{ color: '#9ca3af', fontSize: 10, marginTop: 2 }}>{sub}</div>}
  </div>
);

// ── Main page ──────────────────────────────────────────────────────
const MonitorOnlyReport: React.FC = () => {
  const { monitorId } = useParams<{ monitorId: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  // Set to true when the current /report fetch has been running long
  // enough that the user should see a "taking longer than usual"
  // hint plus a manual retry button. Threshold is half the abort
  // budget so the user gets visible progress before we cancel.
  const [slowFetch, setSlowFetch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Counts retries the user has triggered manually from the slow/error
  // panel — used to force ``load`` to re-run when the dependency array
  // is otherwise stable.
  const [retryNonce, setRetryNonce] = useState(0);
  const [tab, setTab] = useState<TabId>('enhanced');
  // Force-reload key for the embedded enhanced-report iframe. We want a
  // live monitor's iframe to pick up the latest /report.html data, but
  // we don't want React to re-mount the iframe (and lose scroll position)
  // unless the user explicitly hits Refresh. So we bump this only on the
  // Refresh handler, not on every report-poll.
  const [iframeReloadKey, setIframeReloadKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // In-flight guard so the 15s auto-refresh doesn't pile concurrent
  // requests on top of an in-flight rebuild (each backend rebuild can
  // take 60-90s when Prometheus is unreachable). Using a ref so the
  // value reads are stable across renders without an extra effect.
  const inFlightRef = React.useRef(false);
  // AbortController for the live request — Refresh / unmount cancels it.
  const abortRef = React.useRef<AbortController | null>(null);

  // Per-fetch budgets. The hard deadline matches roughly 2× a healthy
  // backend rebuild (a fast rebuild on a reachable testbed is ~5-15s;
  // a "build_report fast-probe skipped Prom, served persisted snapshot"
  // path is ~1-3s). 25s comfortably covers both while still giving the
  // user feedback within half a minute when something is wrong.
  const SLOW_HINT_MS = 12_000;
  const HARD_DEADLINE_MS = 25_000;

  const load = React.useCallback(async (opts: { isAutoRefresh?: boolean } = {}) => {
    if (!monitorId) return;
    // Drop overlapping auto-refresh ticks (user-initiated Refresh
    // always wins by aborting the current request — see Refresh
    // handler below).
    if (opts.isAutoRefresh && inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;

    // Abort any prior request before issuing a new one.
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* noop */ }
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const slowTimer = window.setTimeout(() => setSlowFetch(true), SLOW_HINT_MS);
    const hardTimer = window.setTimeout(() => {
      try { ctrl.abort(); } catch { /* noop */ }
    }, HARD_DEADLINE_MS);

    try {
      const res = await fetch(
        `${getApiBase()}/api/monitor-only/${monitorId}/report`,
        { signal: ctrl.signal },
      );
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Failed to load report');
      setReport(data.report);
      setError(null);
      setSlowFetch(false);
    } catch (err) {
      const e = err as Error;
      // Suppress the error UI for an aborted request that was kicked
      // off by a subsequent load (otherwise Refresh would briefly
      // flash an error). A user-cancel from the slow panel sets
      // error to null too — they'll see the spinner again on retry.
      const isAbort = e?.name === 'AbortError';
      if (!isAbort) {
        setError(e.message || 'Failed to load report');
      } else if (!opts.isAutoRefresh) {
        // Timeout fired or user cancelled — show actionable message
        setError(
          'Report did not respond within 25 seconds. The testbed Prometheus may be unreachable. ' +
          'Click Retry to try again, or refresh the testbed Prometheus URL.',
        );
      }
    } finally {
      window.clearTimeout(slowTimer);
      window.clearTimeout(hardTimer);
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [monitorId]);

  useEffect(() => { load(); }, [load, retryNonce]);
  useEffect(() => {
    if (!autoRefresh || !report?.overview?.is_running) return;
    // 15s tick — load() itself drops the call if a prior one is still
    // in flight, so a slow backend can't stack concurrent rebuilds.
    const t = setInterval(() => { load({ isAutoRefresh: true }); }, 15000);
    return () => clearInterval(t);
  }, [autoRefresh, report?.overview?.is_running, load]);

  // Cancel any in-flight fetch when the page unmounts.
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* noop */ }
      }
    };
  }, []);

  // Filters for the violations tab
  const [vSearch, setVSearch] = useState('');
  const [vSeverity, setVSeverity] = useState<'all' | 'Critical' | 'Moderate' | 'Low'>('all');
  const filteredViolations = useMemo(() => {
    if (!report) return [];
    return report.violations.filter(v => {
      if (vSeverity !== 'all' && v.severity !== vSeverity) return false;
      if (vSearch) {
        const hay = `${v.rule_name || ''} ${v.message || ''} ${v.pod_name || ''} ${v.namespace || ''}`.toLowerCase();
        if (!hay.includes(vSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [report, vSearch, vSeverity]);

  if (loading) {
    // When the fetch crosses the slow threshold (12s) we tell the user
    // exactly why and offer an immediate retry. Without this hint the
    // spinner is indistinguishable from a frozen UI, which is what was
    // reported on 2026-06-03 for live monitors against testbeds whose
    // Prometheus URL had gone stale.
    return (
      <div className="main-content text-center py-5">
        <div className="spinner-border text-primary" role="status" />
        <div className="mt-3 text-muted">Loading monitor report…</div>
        {slowFetch && (
          <div className="mt-4 mx-auto" style={{ maxWidth: 540 }}>
            <div className="alert alert-warning rounded-4 text-start small mb-2">
              <strong>Taking longer than usual.</strong> The backend is still
              waiting for the testbed's Prometheus to respond. If the
              Prometheus NodePort has moved, the request may time out at
              25s — refresh the testbed's Prometheus URL on the testbed
              detail page, then click Retry below.
            </div>
            <button
              className="btn btn-outline-primary btn-sm rounded-3"
              onClick={() => {
                setSlowFetch(false);
                setRetryNonce(n => n + 1);
              }}
            >
              <i className="material-icons-outlined me-1" style={{ fontSize: 16, verticalAlign: 'middle' }}>refresh</i>
              Retry now
            </button>
          </div>
        )}
      </div>
    );
  }
  if (error || !report) {
    return (
      <div className="main-content">
        <div className="alert alert-danger rounded-4 d-flex align-items-center gap-2 flex-wrap">
          <i className="material-icons-outlined">error_outline</i>
          <div className="flex-grow-1">
            <strong>Failed to load monitor report</strong>
            <div className="small text-muted">{error || 'No data'} ({monitorId})</div>
          </div>
          <button
            className="btn btn-outline-primary btn-sm rounded-3"
            onClick={() => {
              setError(null);
              setLoading(true);
              setSlowFetch(false);
              setRetryNonce(n => n + 1);
            }}
          >
            <i className="material-icons-outlined me-1" style={{ fontSize: 16, verticalAlign: 'middle' }}>refresh</i>
            Retry
          </button>
          <button className="btn btn-outline-danger btn-sm rounded-3" onClick={() => navigate('/monitor-only/sessions')}>
            <i className="material-icons-outlined me-1" style={{ fontSize: 16, verticalAlign: 'middle' }}>arrow_back</i>
            Back to sessions
          </button>
        </div>
      </div>
    );
  }

  const o = report.overview;
  const v = report.verdict;
  const apiBase = getApiBase();

  // Status badge metadata mirroring SmartExecutionHistory
  const statusBadge: Record<string, { bg: string; icon: string }> = {
    STARTING:  { bg: 'bg-warning text-dark', icon: 'hourglass_empty' },
    RUNNING:   { bg: 'bg-success bg-opacity-25 text-success', icon: 'monitor_heart' },
    DEGRADED:  { bg: 'bg-warning text-dark', icon: 'warning' },
    STOPPED:   { bg: 'bg-secondary bg-opacity-25 text-secondary', icon: 'stop_circle' },
    FAILED:    { bg: 'bg-danger bg-opacity-25 text-danger', icon: 'error' },
  };
  const si = statusBadge[o.status] || { bg: 'bg-secondary', icon: 'help' };
  const monitorAny = report as unknown as { enhanced_data?: unknown; pod_health?: { summary?: { critical?: number; watch?: number; healthy?: number; total?: number } } };
  const podSummary = monitorAny.pod_health?.summary || { critical: 0, watch: 0, healthy: 0, total: 0 };
  // Alert counts — pulled from the v5 overview enrichment when present
  const overviewAny = o as unknown as { alert_summary?: { critical: number; warning: number; info: number; total: number } };
  const alertSummary = overviewAny.alert_summary || { critical: 0, warning: 0, info: 0, total: 0 };
  const fmtHours = (sec?: number) => {
    if (!sec) return '—';
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${(sec / 60).toFixed(0)}m`;
    return `${(sec / 3600).toFixed(1)}h`;
  };
  const verdictBg = v.level === 'pass' ? 'bg-success bg-opacity-10 border-success'
                  : v.level === 'warn' ? 'bg-warning bg-opacity-10 border-warning'
                  : 'bg-danger bg-opacity-10 border-danger';
  const verdictTextColor = v.level === 'pass' ? 'text-success' : v.level === 'warn' ? 'text-warning' : 'text-danger';

  const reloadAll = () => { load(); setIframeReloadKey(k => k + 1); };

  return (
    <div className="main-content">
      {/* ── Page Header (gradient icon, KPI strip, primary CTAs) ────── */}
      <div className="mb-3">
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <div>
            <h2 className="fw-bold mb-2 d-flex align-items-center gap-2">
              <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                width: 48, height: 48,
                background: 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)',
              }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>description</i>
              </div>
              Monitor Report
              <span className={`badge ${si.bg} rounded-pill px-3 py-2 d-inline-flex align-items-center gap-1 ms-2`} style={{ fontSize: 12 }}>
                <i className="material-icons-outlined" style={{ fontSize: 14 }}>{si.icon}</i>
                {o.status}
              </span>
              {o.is_running && (
                <span className="badge bg-primary bg-opacity-25 text-primary rounded-pill px-2 py-1 ms-1" style={{ fontSize: 11 }}>
                  ● LIVE
                </span>
              )}
            </h2>
            <p className="text-muted mb-0">
              <span className="fw-semibold">{o.name || o.monitor_id}</span>
              {' '}<span className="badge bg-secondary rounded-pill ms-2">{o.testbed_id}</span>
              <span className="ms-2 small">·  {o.poll_interval_s}s poll · {o.rule_count} rules</span>
            </p>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <button
              className="btn btn-outline-secondary rounded-3 d-flex align-items-center gap-1"
              onClick={reloadAll}
              title="Refresh data + reload the enhanced report iframe"
            >
              <i className="material-icons-outlined" style={{ fontSize: 18 }}>refresh</i> Refresh
            </button>
            <a
              href={`${apiBase}/api/monitor-only/${o.monitor_id}/report.html?download=1`}
              className="btn btn-success rounded-3 d-flex align-items-center gap-1"
              title="Download the enhanced HTML report"
            >
              <i className="material-icons-outlined" style={{ fontSize: 18 }}>download</i> HTML
            </a>
            <a
              href={`${apiBase}/api/monitor-only/${o.monitor_id}/report.html`}
              target="_blank" rel="noreferrer"
              className="btn btn-primary rounded-3 d-flex align-items-center gap-1"
              title="Open the report in a new tab (print → PDF)"
            >
              <i className="material-icons-outlined" style={{ fontSize: 18 }}>open_in_new</i> Open in new tab
            </a>
            <a
              href={`${apiBase}/api/monitor-only/${o.monitor_id}/violations.csv`}
              className="btn btn-outline-info rounded-3 d-flex align-items-center gap-1"
              title="Download all violations as CSV"
            >
              <i className="material-icons-outlined" style={{ fontSize: 18 }}>table_view</i> CSV
            </a>
            <a
              href={`${apiBase}/api/monitor-only/${o.monitor_id}/report.json`}
              className="btn btn-outline-secondary rounded-3 d-flex align-items-center gap-1"
              title="Raw JSON payload"
            >
              <i className="material-icons-outlined" style={{ fontSize: 18 }}>code</i> JSON
            </a>
            <button
              className="btn btn-outline-secondary rounded-3 d-flex align-items-center gap-1"
              onClick={() => navigate(`/monitor-only/run/${o.monitor_id}`)}
              title="Switch to the live monitor view"
            >
              <i className="material-icons-outlined" style={{ fontSize: 18 }}>monitor_heart</i> Live
            </button>
            <button
              className="btn btn-outline-secondary rounded-3 d-flex align-items-center gap-1"
              onClick={() => navigate('/monitor-only/sessions')}
              title="Back to all sessions"
            >
              <i className="material-icons-outlined" style={{ fontSize: 18 }}>list</i> All sessions
            </button>
          </div>
        </div>
      </div>

      {/* ── Verdict banner ─────────────────────────────────────────── */}
      <div className={`alert ${verdictBg} border rounded-4 d-flex align-items-center gap-3 mb-3`} role="alert">
        <div style={{ fontSize: 36, lineHeight: 1 }}>{v.icon}</div>
        <div className="flex-grow-1">
          <div className={`h5 fw-bold mb-1 ${verdictTextColor}`}>{v.label}</div>
          <div className="text-muted small">{v.summary}</div>
        </div>
        {o.is_running && (
          <span className="badge bg-primary rounded-pill px-3 py-2">
            ● LIVE — auto-refresh {autoRefresh ? 'on' : 'off'}
            <button
              className="btn btn-link btn-sm text-white p-0 ms-2"
              style={{ textDecoration: 'underline' }}
              onClick={() => setAutoRefresh(a => !a)}
            >
              {autoRefresh ? 'pause' : 'resume'}
            </button>
          </span>
        )}
      </div>

      {/* ── Degraded banner ────────────────────────────────────────── */}
      {((report.operational?.consecutive_failed_polls || 0) > 0
        || report.operational?.status === 'DEGRADED') && (
        <div className="alert alert-warning rounded-4 d-flex align-items-start gap-2 mb-3" role="alert">
          <i className="material-icons-outlined text-warning" style={{ fontSize: 24 }}>warning</i>
          <div className="flex-grow-1">
            <strong>Degraded:</strong>{' '}
            {report.operational?.consecutive_failed_polls || 0} consecutive Prometheus failures.
            {report.operational?.last_prometheus_error && (
              <div className="text-muted font-monospace small mt-1">
                {String(report.operational.last_prometheus_error).slice(0, 200)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Data-quality banner (Layer-2 single source of truth) ─────── */}
      {/* Prefer operational.banner_text (computed once by the snapshot builder
          so HTML/JSON/React never disagree). Falls back to the legacy
          live-unavailable banner only if the backend didn't stamp one. */}
      {(() => {
        const op = report.operational;
        const dq = op?.data_quality;
        const banner = op?.banner_text;
        if (banner && dq && dq !== 'live') {
          const style = dq === 'unconfigured' || dq === 'error'
            ? { cls: 'alert-warning', icon: 'report_problem', iconCls: 'text-warning' }
            : dq === 'stale'
              ? { cls: 'alert-warning', icon: 'history', iconCls: 'text-warning' }
              : { cls: 'alert-info', icon: 'cloud_off', iconCls: 'text-info' };
          return (
            <div className={`alert ${style.cls} rounded-4 d-flex align-items-start gap-2 mb-3`} role="alert">
              <i className={`material-icons-outlined ${style.iconCls}`} style={{ fontSize: 24 }}>{style.icon}</i>
              <div className="flex-grow-1">
                {banner}
                {op?.snapshot_generated_at && (
                  <div className="text-muted small mt-1">
                    Report snapshot generated {new Date(op.snapshot_generated_at.replace(/Z$/, '') + 'Z').toLocaleString()}
                    {typeof op.snapshot_poll_count === 'number' && op.snapshot_poll_count > 0
                      ? ` · from poll ${op.snapshot_poll_count.toLocaleString()}` : ''}
                  </div>
                )}
              </div>
            </div>
          );
        }
        // Legacy fallback (no banner_text stamped)
        if (op?.live_prometheus_unavailable) {
          return (
            <div className="alert alert-info rounded-4 d-flex align-items-start gap-2 mb-3" role="alert">
              <i className="material-icons-outlined text-info" style={{ fontSize: 24 }}>cloud_off</i>
              <div className="flex-grow-1">
                <strong>Live Prometheus unavailable</strong>{' '}
                — showing data from the most recent poller snapshot (
                {op.last_poll_at
                  ? `last poll ${new Date(op.last_poll_at).toLocaleTimeString()}`
                  : 'no poll yet'})
                {op.live_prometheus_skip_reason === 'prometheus_url_unreachable' && (
                  <>. The testbed's stored Prometheus URL did not respond to a fast probe.
                    If the NodePort has moved, open the testbed page and click <em>Refresh
                    Prometheus URL</em>.</>
                )}
                {op.live_prometheus_skip_reason === 'prometheus_url_not_configured' && (
                  <>. No Prometheus URL is configured for this testbed — the report can
                    only show poller-captured metrics.</>
                )}
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* ── KPI Strip — same shape as SmartExecutionHistory header ──── */}
      <div className="row g-3 mb-3">
        <div className="col-md-3 col-xl">
          <div className="card rounded-4 border h-100">
            <div className="card-body p-3 d-flex justify-content-between align-items-center">
              <div>
                <div className="text-muted small fw-semibold text-uppercase mb-1" style={{ letterSpacing: 0.4, fontSize: 11 }}>Polls</div>
                <div className="h3 fw-bold mb-0 text-info">{o.total_polls.toLocaleString()}</div>
                {o.last_poll_at && (
                  <div className="small text-muted">last {new Date(o.last_poll_at).toLocaleTimeString()}</div>
                )}
              </div>
              <i className="material-icons-outlined text-info opacity-50" style={{ fontSize: 36 }}>sync</i>
            </div>
          </div>
        </div>
        <div className="col-md-3 col-xl">
          <div className="card rounded-4 border h-100">
            <div className="card-body p-3 d-flex justify-content-between align-items-center">
              <div>
                <div className="text-muted small fw-semibold text-uppercase mb-1" style={{ letterSpacing: 0.4, fontSize: 11 }}>Violations</div>
                <div className={`h3 fw-bold mb-0 ${o.total_violations > 0 ? 'text-danger' : 'text-success'}`}>{o.total_violations.toLocaleString()}</div>
                <div className="small text-muted">{o.rule_count} rules</div>
              </div>
              <i className={`material-icons-outlined opacity-50 ${o.total_violations > 0 ? 'text-danger' : 'text-success'}`} style={{ fontSize: 36 }}>report_problem</i>
            </div>
          </div>
        </div>
        <div className="col-md-3 col-xl">
          <div className="card rounded-4 border h-100">
            <div className="card-body p-3 d-flex justify-content-between align-items-center">
              <div>
                <div className="text-muted small fw-semibold text-uppercase mb-1" style={{ letterSpacing: 0.4, fontSize: 11 }}>Alerts</div>
                <div className={`h3 fw-bold mb-0 ${alertSummary.critical > 0 ? 'text-danger' : (alertSummary.total > 0 ? 'text-warning' : 'text-success')}`}>
                  {alertSummary.total.toLocaleString()}
                </div>
                <div className="small">
                  {alertSummary.critical > 0 && <span className="text-danger fw-semibold">{alertSummary.critical} crit </span>}
                  {alertSummary.warning > 0 && <span className="text-warning fw-semibold">{alertSummary.warning} warn </span>}
                  {alertSummary.info > 0 && <span className="text-info fw-semibold">{alertSummary.info} info</span>}
                </div>
              </div>
              <i className={`material-icons-outlined opacity-50 ${alertSummary.critical > 0 ? 'text-danger' : 'text-warning'}`} style={{ fontSize: 36 }}>notifications_active</i>
            </div>
          </div>
        </div>
        <div className="col-md-3 col-xl">
          <div className="card rounded-4 border h-100">
            <div className="card-body p-3 d-flex justify-content-between align-items-center">
              <div>
                <div className="text-muted small fw-semibold text-uppercase mb-1" style={{ letterSpacing: 0.4, fontSize: 11 }}>Pod Health</div>
                <div className={`h3 fw-bold mb-0 ${podSummary.critical && podSummary.critical > 0 ? 'text-danger' : (podSummary.watch && podSummary.watch > 0 ? 'text-warning' : 'text-success')}`}>
                  {podSummary.total ? `${podSummary.healthy ?? 0}/${podSummary.total}` : '—'}
                </div>
                <div className="small">
                  {(podSummary.critical || 0) > 0 && <span className="text-danger fw-semibold">{podSummary.critical} crit </span>}
                  {(podSummary.watch || 0) > 0 && <span className="text-warning fw-semibold">{podSummary.watch} watch</span>}
                  {!podSummary.critical && !podSummary.watch && podSummary.total ? <span className="text-success fw-semibold">all healthy</span> : null}
                </div>
              </div>
              <i className={`material-icons-outlined opacity-50 ${podSummary.critical && podSummary.critical > 0 ? 'text-danger' : (podSummary.watch && podSummary.watch > 0 ? 'text-warning' : 'text-success')}`} style={{ fontSize: 36 }}>health_and_safety</i>
            </div>
          </div>
        </div>
        <div className="col-md-3 col-xl">
          <div className="card rounded-4 border h-100">
            <div className="card-body p-3 d-flex justify-content-between align-items-center">
              <div>
                <div className="text-muted small fw-semibold text-uppercase mb-1" style={{ letterSpacing: 0.4, fontSize: 11 }}>Duration</div>
                <div className="h3 fw-bold mb-0 text-primary">{fmtHours(o.duration_seconds)}</div>
                <div className="small text-muted">{o.duration_hours_target ? `target ${o.duration_hours_target}h` : 'until stopped'}</div>
              </div>
              <i className="material-icons-outlined text-primary opacity-50" style={{ fontSize: 36 }}>schedule</i>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs (Bootstrap nav-tabs style, matching Smart Execution) ── */}
      <ul className="nav nav-tabs mb-3" role="tablist">
        {([
          { id: 'enhanced', label: 'Enhanced Report', icon: 'description', count: undefined as number | undefined },
          { id: 'overview', label: 'Overview', icon: 'dashboard', count: undefined },
          { id: 'pods', label: 'Pod Health', icon: 'health_and_safety', count: (report.pod_health?.pods || []).length },
          { id: 'cluster', label: 'Cluster', icon: 'dns', count: undefined },
          { id: 'violations', label: 'Violations', icon: 'report_problem', count: report.violations.length },
          { id: 'rules', label: 'Rule Health', icon: 'rule', count: report.rules.length },
          { id: 'trend', label: 'Resource Trend', icon: 'show_chart', count: undefined },
          { id: 'logs', label: 'Log Bundles', icon: 'folder_zip', count: (report.log_bundles || []).length },
          { id: 'config', label: 'Config', icon: 'settings', count: undefined },
        ] as const).map(t => (
          <li className="nav-item" key={t.id}>
            <button
              type="button"
              className={`nav-link d-flex align-items-center gap-1 ${tab === t.id ? 'active fw-semibold' : ''}`}
              onClick={() => setTab(t.id as TabId)}
            >
              <i className="material-icons-outlined" style={{ fontSize: 16 }}>{t.icon}</i>
              {t.label}
              {typeof t.count === 'number' && (
                <span className={`badge rounded-pill ms-1 ${tab === t.id ? 'bg-primary' : 'bg-secondary'}`} style={{ fontSize: 10 }}>{t.count}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {/* ── Enhanced Report (iframe of /report.html — same source of
            truth as the download). Loading overlay because /report.html
            takes 30-60s on first call for live monitors (Prometheus
            rebuild). Use onLoad to hide the spinner. */}
      {tab === 'enhanced' && (
        <div className="card rounded-4 shadow-none border" style={{ position: 'relative', minHeight: 'calc(100vh - 420px)' }}>
          <div className="card-header bg-light border-bottom d-flex justify-content-between align-items-center py-2 px-3">
            <div className="small text-muted">
              <i className="material-icons-outlined me-1" style={{ fontSize: 14, verticalAlign: 'middle' }}>info</i>
              Embedded view of the enhanced report — same content as the &ldquo;HTML&rdquo; download.
              Live monitors take 30-60s to render the first time while Prometheus rebuilds the pod/cluster snapshot.
            </div>
            <a
              href={`${apiBase}/api/monitor-only/${o.monitor_id}/report.html`}
              target="_blank" rel="noreferrer"
              className="btn btn-sm btn-outline-primary rounded-3 d-flex align-items-center gap-1"
            >
              <i className="material-icons-outlined" style={{ fontSize: 14 }}>open_in_new</i>
              Open in new tab
            </a>
          </div>
          <EnhancedReportIframe
            key={iframeReloadKey}
            src={`${apiBase}/api/monitor-only/${o.monitor_id}/report.html`}
          />
        </div>
      )}

      {tab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
            <StatCard label="Polls" value={o.total_polls} />
            <StatCard label="Violations" value={o.total_violations} />
            <StatCard label="Rules" value={o.rule_count} />
            <StatCard label="Poll interval" value={`${o.poll_interval_s}s`} />
            <StatCard label="Wall-clock" value={fmtSec(o.duration_seconds)} sub={o.duration_hours_target ? `target ${o.duration_hours_target}h` : 'unbounded'} />
            <StatCard label="Status" value={o.status} />
            {report.pod_health?.summary && (
              <>
                <StatCard label="Critical pods" value={report.pod_health.summary.critical || 0} />
                <StatCard label="Watch pods" value={report.pod_health.summary.watch || 0} />
                <StatCard label="Healthy pods" value={report.pod_health.summary.healthy || 0} />
              </>
            )}
          </div>

          {/* Phase-1: Baseline → Now delta — only render when we have a baseline. */}
          {report.baseline_delta?.baseline && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Baseline → Now (during this monitor window)</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      <th style={{ padding: '6px 12px', textAlign: 'left' }}>Metric</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>At start</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>Now</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['pods_tracked', 'Pods tracked'],
                      ['total_restarts', 'Container restarts'],
                      ['oom_events', 'OOM kills'],
                      ['unhealthy_pods', 'Unhealthy pods'],
                      ['pods_not_ready', 'Pods not ready'],
                      ['throttled_pods', 'CPU-throttled pods'],
                      ['terminated_containers', 'Terminated containers'],
                      ['problem_pods', 'Problem pods'],
                      ['node_conditions', 'Node condition flags'],
                    ].map(([key, label]) => {
                      const b = report.baseline_delta?.baseline?.[key] || 0;
                      const c = report.baseline_delta?.current?.[key] || 0;
                      const d = report.baseline_delta?.delta?.[key] || 0;
                      return (
                        <tr key={key} style={{ borderTop: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '6px 12px' }}>{label}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right' }}>{b}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right' }}>{c}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 999,
                              background: d > 0 ? '#fee2e2' : '#dcfce7',
                              color: d > 0 ? '#991b1b' : '#166534',
                              fontWeight: 700, fontSize: 11 }}>
                              {d > 0 ? `+${d}` : '0'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Recommendations</h3>
            <ul style={{ paddingLeft: 0, listStyle: 'none' }}>
              {report.recommendations.map((r, i) => (
                <li key={i} style={{ padding: '8px 12px', background: '#fffbeb', borderLeft: '4px solid #f59e0b',
                  marginBottom: 6, borderRadius: 4, fontSize: 13 }}>{r}</li>
              ))}
            </ul>
          </div>
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, fontSize: 13, color: '#475569' }}>
            <div><b>Started:</b> {fmtTs(o.started_at)}</div>
            <div><b>Last poll:</b> {fmtTs(o.last_poll_at)}</div>
            <div><b>Stopped:</b> {fmtTs(o.stopped_at)}</div>
            {o.description && <div style={{ marginTop: 8 }}><b>Description:</b> {o.description}</div>}
          </div>
        </>
      )}

      {/* Phase-1: Pod Health tab — table of every classified pod with severity,
          CPU/Mem peaks, restarts, OOMs, reasons. Mirrors the v5 unified table. */}
      {tab === 'pods' && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid #e5e7eb', fontSize: 12, color: '#64748b' }}>
            {report.pod_health?.summary
              ? `${report.pod_health.summary.total || 0} pods classified · `
                + `${report.pod_health.summary.critical || 0} Critical, `
                + `${report.pod_health.summary.watch || 0} Watch, `
                + `${report.pod_health.summary.healthy || 0} Healthy`
              : 'Pod health classification not available (Prometheus may be unreachable, or this monitor has not completed its first cluster_health snapshot yet).'}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1100 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Severity</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Namespace</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Pod</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Node</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Phase</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>CPU max %</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Mem max %</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Restarts</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>OOMs</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Reasons</th>
                </tr>
              </thead>
              <tbody>
                {(!report.pod_health?.pods || report.pod_health.pods.length === 0) && (
                  <tr><td colSpan={10} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                    No pods classified yet.
                  </td></tr>
                )}
                {(report.pod_health?.pods || []).slice(0, 500).map((p, i) => {
                  const sev = (p.severity || 'Healthy').toLowerCase();
                  const sevBg: Record<string, string> = {
                    critical: '#fee2e2', watch: '#fef3c7', healthy: '#dcfce7',
                  };
                  const sevColor: Record<string, string> = {
                    critical: '#991b1b', watch: '#92400e', healthy: '#166534',
                  };
                  return (
                    <tr key={i} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '6px 12px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 999,
                          background: sevBg[sev] || '#f1f5f9',
                          color: sevColor[sev] || '#475569',
                          fontSize: 11, fontWeight: 700 }}>
                          {p.severity}
                        </span>
                      </td>
                      <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 11 }}>{p.namespace}</td>
                      <td style={{ padding: '6px 12px', fontWeight: 500 }}>{p.pod}</td>
                      <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 11 }}>{p.node || '—'}</td>
                      <td style={{ padding: '6px 12px' }}>{p.phase || '—'}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}
                          title={p.cpu_basis ? `% of ${p.cpu_basis}` : undefined}>
                        {typeof p.cpu_pct_max_in_run === 'number'
                          ? `${p.cpu_pct_max_in_run.toFixed(1)}%${p.cpu_basis === 'request' ? ' (req)' : ''}`
                          : (typeof p.cpu_cores === 'number'
                              // No CPU limit/request — show raw cores so the
                              // value is honest instead of showing "—" or a
                              // fabricated 100%.
                              ? <span style={{ color: '#64748b' }} title="No CPU limit or request defined">
                                  {p.cpu_cores.toFixed(2)} c
                                </span>
                              : '—')}
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                        {typeof p.memory_pct_max_in_run === 'number' ? `${p.memory_pct_max_in_run.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'right',
                        color: (p.restarts_in_run || 0) > 0 ? '#ef4444' : '#475569', fontWeight: 600 }}>
                        {p.restarts_in_run ?? 0}
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'right',
                        color: (p.oom_kills_in_run || 0) > 0 ? '#ef4444' : '#475569', fontWeight: 600 }}>
                        {p.oom_kills_in_run ?? 0}
                      </td>
                      <td style={{ padding: '6px 12px', fontSize: 11, color: '#64748b' }}>
                        {(p.reasons || []).slice(0, 3).join(', ') || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Phase-1: Cluster Health tab — pod phase breakdown, node health,
          OOM/restart/throttle highlights. Lightweight by design — the deep
          drilldown lives in the smart-execution enhanced report. */}
      {tab === 'cluster' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Pod phase summary</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.entries(report.cluster_health?.pod_phase_summary || {}).map(([phase, count]) => (
                <div key={phase} style={{ padding: '10px 14px', background: '#f8fafc',
                  borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{count}</div>
                  <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>{phase}</div>
                </div>
              ))}
              {Object.keys(report.cluster_health?.pod_phase_summary || {}).length === 0 && (
                <div style={{ color: '#64748b', fontSize: 13 }}>No phase summary captured yet.</div>
              )}
            </div>
          </div>

          {(report.cluster_health?.node_breakdown || []).length > 0 && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, padding: '14px 20px', borderBottom: '1px solid #e5e7eb', margin: 0 }}>
                Node breakdown ({(report.cluster_health?.node_breakdown || []).length} nodes)
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Node</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>CPU %</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Mem %</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>CPU cores</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Mem MB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.cluster_health?.node_breakdown || []).map((n, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 11 }}>{n.node || '—'}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'right' }}>{typeof n.cpu_pct === 'number' ? `${n.cpu_pct.toFixed(1)}%` : '—'}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'right' }}>{typeof n.memory_pct === 'number' ? `${n.memory_pct.toFixed(1)}%` : '—'}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'right' }}>{n.allocatable_cpu_cores ?? '—'}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'right' }}>{n.allocatable_memory_mb ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(report.cluster_health?.oom_killed || []).length > 0 && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, padding: '14px 20px', borderBottom: '1px solid #e5e7eb', margin: 0 }}>
                OOM killed ({(report.cluster_health?.oom_killed || []).length})
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Namespace</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Pod</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Container</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.cluster_health?.oom_killed || []).slice(0, 200).map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 11 }}>{r.namespace}</td>
                        <td style={{ padding: '6px 12px' }}>{r.pod}</td>
                        <td style={{ padding: '6px 12px' }}>{r.container}</td>
                        <td style={{ padding: '6px 12px' }}>{r.reason || 'OOMKilled'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(report.cluster_health?.cpu_throttling || []).length > 0 && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, padding: '14px 20px', borderBottom: '1px solid #e5e7eb', margin: 0 }}>
                CPU throttled containers ({(report.cluster_health?.cpu_throttling || []).length})
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Namespace</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Pod</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Container</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Throttle ratio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.cluster_health?.cpu_throttling || []).slice(0, 200).map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 11 }}>{r.namespace}</td>
                        <td style={{ padding: '6px 12px' }}>{r.pod}</td>
                        <td style={{ padding: '6px 12px' }}>{r.container}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                          {typeof r.throttle_ratio === 'number' ? `${(r.throttle_ratio * 100).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(report.cluster_health?.total_restarts || []).length > 0 && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, padding: '14px 20px', borderBottom: '1px solid #e5e7eb', margin: 0 }}>
                Top restart counts
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Namespace</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Pod</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Container</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Restarts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.cluster_health?.total_restarts || [])
                      .slice()
                      .sort((a, b) => (b.restarts || 0) - (a.restarts || 0))
                      .slice(0, 100)
                      .map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 11 }}>{r.namespace}</td>
                        <td style={{ padding: '6px 12px' }}>{r.pod}</td>
                        <td style={{ padding: '6px 12px' }}>{r.container}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'right', color: '#ef4444', fontWeight: 700 }}>
                          {r.restarts ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {report.cluster_health?.collection_status && report.cluster_health?.collection_status !== 'success'
            && report.cluster_health?.collection_status !== 'live_prometheus+persisted' && (
            <div style={{ background: '#fef3c7', borderLeft: '4px solid #f59e0b',
              padding: '10px 14px', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
              <strong>Note:</strong> cluster_health collection status: {report.cluster_health?.collection_status}
              {report.cluster_health?.collection_reason && ` (${report.cluster_health.collection_reason})`}
            </div>
          )}
        </div>
      )}

      {tab === 'violations' && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="text" placeholder="Search rule name, pod, message…" value={vSearch}
              onChange={e => setVSearch(e.target.value)}
              style={{ flex: 1, minWidth: 200, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
            <select value={vSeverity} onChange={e => setVSeverity(e.target.value as 'all' | 'Critical' | 'Moderate' | 'Low')}
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}>
              <option value="all">All severities</option>
              <option value="Critical">Critical</option>
              <option value="Moderate">Moderate</option>
              <option value="Low">Low</option>
            </select>
            <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, color: '#64748b' }}>
              Showing {filteredViolations.length} of {report.violations.length}
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 880 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>When</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Rule</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Severity</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Type</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Value</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Threshold</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Iter</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Pod / NS</th>
                </tr>
              </thead>
              <tbody>
                {filteredViolations.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>No violations match.</td></tr>
                )}
                {filteredViolations.map((v, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>{fmtTs(v.timestamp)}</td>
                    <td style={{ padding: '6px 12px', fontWeight: 500 }}>{v.rule_name}</td>
                    <td style={{ padding: '6px 12px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 999,
                        background: `${SEV_COLOR[v.severity || 'Moderate']}26`,
                        color: SEV_COLOR[v.severity || 'Moderate'], fontSize: 11, fontWeight: 700 }}>
                        {v.severity}
                      </span>
                    </td>
                    <td style={{ padding: '6px 12px', fontSize: 11 }}>{v.is_composite ? `🔗 ${v.logical_operator}` : 'simple'}</td>
                    <td style={{ padding: '6px 12px', fontFamily: 'monospace' }}>{v.value ?? '—'}</td>
                    <td style={{ padding: '6px 12px', fontFamily: 'monospace' }}>{v.operator} {v.threshold}</td>
                    <td style={{ padding: '6px 12px' }}>{v.iteration ?? '—'}</td>
                    <td style={{ padding: '6px 12px', fontSize: 11, color: '#64748b' }}>
                      {v.pod_name || v.namespace || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'rules' && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 880 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Rule</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Severity</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Definition</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Polls</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Fired</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Fire %</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Last value</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Last violation</th>
                </tr>
              </thead>
              <tbody>
                {report.rules.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>No rules configured.</td></tr>
                )}
                {report.rules.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '6px 12px', fontWeight: 500 }}>
                      {r.name}
                      {r.collect_logs && (
                        <span title="Will collect logs on violation"
                          style={{ marginLeft: 6, padding: '1px 5px', background: '#fef3c7', color: '#92400e',
                            borderRadius: 3, fontSize: 10, fontWeight: 700 }}>LOG</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 999,
                        background: `${SEV_COLOR[r.severity || 'Moderate']}26`,
                        color: SEV_COLOR[r.severity || 'Moderate'], fontSize: 11, fontWeight: 700 }}>
                        {r.severity}
                      </span>
                    </td>
                    <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 11 }}>{r.summary}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right' }}>{r.polls}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 700,
                      color: r.fired > 0 ? '#ef4444' : '#22c55e' }}>{r.fired}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right' }}>{r.fire_rate}%</td>
                    <td style={{ padding: '6px 12px', fontFamily: 'monospace' }}>{r.last_value ?? '—'}</td>
                    <td style={{ padding: '6px 12px', fontSize: 11, color: '#64748b' }}>{fmtTs(r.last_violation_ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'trend' && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Cluster Resource Trend</h3>
          <TrendChart series={report.timeseries} />
          <p style={{ fontSize: 11, color: '#64748b', marginTop: 12 }}>
            Sampled on every poll. Lines stop where Prometheus was unreachable; gaps indicate failed scrapes.
          </p>
        </div>
      )}

      {tab === 'logs' && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Log collection bundles</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Bundles are scheduled automatically when a monitoring rule with <code>collectLogs=true</code> fires.
            Bundles with <strong>MISSING_CREDS</strong> mean the testbed has no SSH credentials saved — set them
            on the testbed configuration page to enable collection.
          </p>
          {(!report.log_bundles || report.log_bundles.length === 0) ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 8 }}>
              No log bundles yet. Enable "Collect logs" on a rule to capture PC/CVM logs at violation time.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 880 }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Requested</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Rule</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Severity</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Status</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>PC IP</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Duration</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Bundle / Error</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.log_bundles || []).map(b => {
                    const statusColor: Record<string, string> = {
                      READY: '#22c55e', PENDING: '#3b82f6', COLLECTING: '#3b82f6',
                      MISSING_CREDS: '#f59e0b', UNAVAILABLE: '#f59e0b',
                      FAILED: '#ef4444',
                    };
                    const c = statusColor[b.status] || '#6b7280';
                    return (
                      <tr key={b.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>{fmtTs(b.requested_at)}</td>
                        <td style={{ padding: '6px 12px' }}>{b.rule_name}</td>
                        <td style={{ padding: '6px 12px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 999,
                            background: `${SEV_COLOR[b.severity || 'Moderate']}26`,
                            color: SEV_COLOR[b.severity || 'Moderate'], fontSize: 11, fontWeight: 700 }}>
                            {b.severity}
                          </span>
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 999,
                            background: `${c}26`, color: c, fontSize: 11, fontWeight: 700 }}>
                            {b.status}
                          </span>
                        </td>
                        <td style={{ padding: '6px 12px', fontFamily: 'monospace' }}>{b.pc_ip || '—'}</td>
                        <td style={{ padding: '6px 12px' }}>{b.duration_hours ?? '—'}h</td>
                        <td style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'monospace',
                          color: b.status === 'READY' ? '#1e293b' : '#92400e', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={b.bundle_path || b.error || ''}>
                          {b.bundle_path || b.error || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'config' && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Raw configuration</h3>
          <pre style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 8, padding: 14,
            fontFamily: 'SF Mono, monospace', fontSize: 12, overflow: 'auto', maxHeight: 540 }}>
            {JSON.stringify(report.config_dump, null, 2)}
          </pre>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 12 }}>
        <Link to="/monitor-only/sessions" style={{ color: '#3b82f6' }}>← Back to all sessions</Link>
        {' · '}
        <button onClick={() => navigate(`/monitor-only/run/${o.monitor_id}`)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#3b82f6' }}>
          Live view
        </button>
      </div>
    </div>
  );
};

export default MonitorOnlyReport;
