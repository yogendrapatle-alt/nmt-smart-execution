import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactApexChart from 'react-apexcharts';
import { getApiBase } from '../utils/backendUrl';
import { SkeletonMetricRow, SkeletonTable, SkeletonCard } from '../components/ui/LoadingSkeleton';

/** Actionable copy when cluster health cannot be loaded (Phase 1 empty states). */
function clusterHealthUnavailableCopy(
  collectionStatus: string | undefined,
  collectionReason: string | undefined
): { headline: string; detail: string } {
  const reason = (collectionReason || '').trim();
  const legacyErr = collectionStatus?.startsWith('error:')
    ? collectionStatus.slice('error:'.length).trim()
    : '';
  const r = (reason || legacyErr).toLowerCase();
  if (collectionStatus === 'unavailable' || r.includes('prometheus_url_not_configured')) {
    return {
      headline: 'Cluster health was not collected',
      detail:
        'No Prometheus base URL was configured for this execution. Ensure the smart execution controller has prometheus_url set, or open the report while the testbed API can reach the cluster Prometheus (typically port 9090).',
    };
  }
  if (
    r.includes('connection refused') ||
    r.includes('timed out') ||
    r.includes('timeout') ||
    r.includes('name or service not known') ||
    r.includes('http_') ||
    r.includes('prometheus_unreachable')
  ) {
    return {
      headline: 'Prometheus could not be reached',
      detail:
        reason || legacyErr
          ? `Last error: ${reason || legacyErr}. If the cluster is offline, a snapshot taken when the run finished may still appear after reload.`
          : 'The report service could not complete a live query to Prometheus. Check network access to the testbed metrics endpoint.',
    };
  }
  return {
    headline: 'Cluster health snapshot unavailable',
    detail:
      reason || legacyErr ||
      'Live Prometheus queries did not return usable data. Exporters (kube-state-metrics, cAdvisor) must expose the expected metric names.',
  };
}

interface AIInsights {
  ai_enabled?: boolean;
  pid_performance?: {
    final_operations_per_minute?: number;
    final_phase?: string;
    total_iterations?: number;
    cpu_pid_stats?: any;
    memory_pid_stats?: any;
  };
  ml_performance?: {
    model_trained?: boolean;
    training_samples?: number;
    feature_importance?: any;
  };
  ai_decisions?: Array<{
    iteration: number;
    phase: string;
    reasoning: string;
  }>;
  recommendations?: string[];
}

interface EnhancedReport {
  verdict: {
    result: string;
    summary: string;
    issues: string[];
    success_rate: number;
    threshold_reached: boolean;
    oom_kills: number;
    container_restarts: number;
    high_risk_spikes: number;
  };
  spike_analysis: {
    spikes: any[];
    total_spikes: number;
    avg_recovery_minutes: number;
    high_risk_count: number;
    medium_risk_count: number;
  };
  cluster_health: Record<string, any>;
  failure_analysis: {
    groups: any[];
    total_failures: number;
    unique_patterns: number;
  };
  operation_heatmap: {
    buckets: string[];
    entity_ops: string[];
    data: any;
  };
  pod_stability: any[];
  node_stability: any[];
  restart_timestamps: any[];
  historical_comparison: {
    available: boolean;
    previous_executions?: any[];
    count?: number;
    reason?: string;
    trend_vs_last_run?: {
      duration_delta_minutes: number;
      success_rate_delta_pct: number;
      duration_vs_last: 'faster' | 'slower' | 'same';
    };
  };
  report_metadata?: {
    execution_id?: string;
    generated_at_utc?: string;
    metrics_samples?: number;
    operations_recorded?: number;
    metrics_time_range?: { first_timestamp: string; last_timestamp: string } | null;
    cluster_health_source?: string;
    prometheus_configured?: boolean;
    baseline_final_resolution?: string;
  };
  capacity_planning: {
    available: boolean;
    total_ops_executed?: number;
    real_ops?: number;
    simulated_ops?: number;
    cpu_per_operation?: number;
    memory_per_operation?: number;
    cpu_delta_direction?: string;
    memory_delta_direction?: string;
    estimated_total_capacity_ops?: number;
    bottleneck?: string;
    recommendation?: string;
    entities_created?: Record<string, number>;
    simulation_warning?: string;
  };
  entity_latency_breakdown?: {
    available: boolean;
    entity_latencies?: Array<{
      entity_operation: string;
      count: number;
      avg_seconds: number;
      p50_seconds: number;
      p95_seconds: number;
      min_seconds: number;
      max_seconds: number;
      degradation_detected: boolean;
    }>;
  };
  error_code_breakdown?: {
    available: boolean;
    total_failures?: number;
    http_code_distribution?: Array<{ code: string; count: number; category: string }>;
    error_type_distribution?: Array<{ error_type: string; count: number }>;
    sample_errors?: any[];
  };
  dependency_cascade?: {
    available: boolean;
    cascades?: Array<{
      entity_type: string;
      failure_count: number;
      failed_dependencies: Array<{ entity_type: string; failure_count: number }>;
      hint: string;
    }>;
    total_cascade_patterns?: number;
  };
  execution_mode_summary?: {
    available: boolean;
    total_operations?: number;
    real_operations?: number;
    simulated_operations?: number;
    real_percentage?: number;
    trust_level?: string;
    warning?: string | null;
  };
  iteration_timeline?: {
    iterations: any[];
    total_iterations: number;
    total_spikes: number;
    summary?: any;
  };
  effective_metrics?: {
    baseline?: { cpu_percent?: number; memory_percent?: number };
    final?: { cpu_percent?: number; memory_percent?: number };
    resolution_note?: string;
  };
  health_assessment?: {
    overall_status: string;
    critical_count: number;
    warning_count: number;
    findings: Array<{ severity: string; category: string; message: string; detail?: string }>;
  };
  // Phase 2 (pod-coverage v2): single source-of-truth severity classification
  // produced by services/pod_health_classifier.py. Optional because legacy
  // executions / reports persisted before the classifier landed won't carry it.
  pod_health?: {
    thresholds?: {
      crit_pct?: number;
      watch_pct?: number;
      crit_throttle_pct?: number;
      watch_throttle_pct?: number;
    };
    summary?: {
      total: number;
      critical: number;
      watch: number;
      healthy: number;
      with_restarts_in_run?: number;
      with_oom_in_run?: number;
      with_high_throttle?: number;
      with_critical_cpu?: number;
      with_critical_memory?: number;
    };
    pods?: PodHealthEntry[];
    critical_pods?: PodHealthEntry[];
    watch_pods?: PodHealthEntry[];
    healthy_pods?: PodHealthEntry[];
    by_namespace?: Record<string, {
      namespace: string;
      total: number;
      critical: number;
      watch: number;
      healthy: number;
      pods: PodHealthEntry[];
    }>;
    error?: string;
  };
}

// Single classified pod — the shape our backend classifier hands the UI. Kept
// near the top so every consumer (PodCoverageSection, namespace cards,
// drill-down) can lean on the same type.
interface PodHealthEntry {
  pod: string;
  namespace: string;
  severity: 'critical' | 'watch' | 'healthy';
  reasons: string[];
  signals: Array<{ name: string; severity: string; value: any; reason: string }>;
  cpu_pct: number | null;
  // 'limit' | 'request' | 'unspecified' — which denominator cpu_pct uses.
  // null when no pod_cpu row populated this pod. Affects how the UI labels
  // the % (eg. "90% of request" vs "90% of limit" — meaningfully different).
  cpu_basis?: 'limit' | 'request' | 'unspecified' | null;
  cpu_cores?: number | null;
  memory_pct: number | null;
  cpu_pct_max_in_run: number | null;
  cpu_pct_max_at: string | null;
  memory_pct_max_in_run: number | null;
  memory_pct_max_at: string | null;
  cpu_throttle_pct: number | null;
  // Per-container provenance for cpu_throttle_pct — when set, the UI shows
  // "(top: container 99%)" so users can see which container is throttled
  // instead of assuming the main container is starved.
  throttle_top_container?: {
    container: string;
    throttle_ratio: number;
    cpu_cores: number;
  } | null;
  restarts_in_run: number;
  restarts_total_lifetime: number;
  last_restart_at: string | null;
  oom_in_run: boolean;
  oom_at: string | null;
  phase: string | null;
  ready: boolean | null;
  sort_score: number;
  containers: Array<{
    container: string;
    cpu_pct?: number | null;
    cpu_cores?: number | null;
    cpu_limit_cores?: number | null;
    cpu_request_cores?: number | null;
    memory_pct?: number | null;
    memory_mb?: number | null;
    memory_limit_mb?: number | null;
    memory_request_mb?: number | null;
  }>;
  // v3 — chronological per-pod timeline + sparkline series.
  // Always present (default []) so consumers don't have to null-check.
  events?: Array<PodEvent>;
  cpu_series?: Array<[string, number]>;
  memory_series?: Array<[string, number]>;
  // v4 — flat-table column data. ``node`` / ``uptime_seconds`` come from
  // kube_pod_info (so even idle pods get a row); ``cpu_limit_cores_pod``
  // / ``memory_limit_mb_pod`` are the sum of container limits;
  // ``container_count`` lets the table cell show "3 ▾" without expanding.
  node?: string | null;
  uptime_seconds?: number | null;
  cpu_limit_cores_pod?: number | null;
  memory_limit_mb_pod?: number | null;
  container_count?: number;
}

// One entry on the per-pod Events timeline. Mirrors the backend ``Event``
// dataclass — when fields are missing the renderer just hides those bits.
interface PodEvent {
  ts: string;                                    // ISO 8601
  type: 'restart' | 'oom' | 'throttle_spike' | 'terminated' | 'phase_change' | string;
  severity: 'critical' | 'watch' | 'healthy' | string;
  detail: string;
  container?: string | null;
  exit_code?: number | null;
  memory_mb?: number | null;
  memory_limit_mb?: number | null;
  cpu_cores?: number | null;
  cpu_limit_cores?: number | null;
  throttle_pct?: number | null;
  concurrent_op?: string | null;
  log_snippet?: string | null;
  node?: string | null;
}

// ---------------------------------------------------------------------------
//  Pod-coverage v2 — UI helpers (severity colour + tier rendering)
// ---------------------------------------------------------------------------
// All three views (this report, the printed HTML report, the Alerts page)
// must agree on the colour scheme — keep these constants in one place. They
// match the badge classes already used elsewhere in the codebase
// (bg-danger / bg-warning text-dark / bg-success).

const SEVERITY_COLOR: Record<PodHealthEntry['severity'], { bg: string; text: string; bar: string; label: string; icon: string }> = {
  critical: { bg: '#fef2f2', text: '#991b1b', bar: '#ef4444', label: 'CRITICAL', icon: 'error' },
  watch:    { bg: '#fffbeb', text: '#92400e', bar: '#f59e0b', label: 'WATCH',    icon: 'warning' },
  healthy:  { bg: '#f0fdf4', text: '#166534', bar: '#22c55e', label: 'HEALTHY',  icon: 'check_circle' },
};

function pctClass(pct: number | null | undefined, critPct = 80, watchPct = 60): string {
  if (pct == null) return 'text-muted';
  if (pct >= critPct) return 'text-danger fw-bold';
  if (pct >= watchPct) return 'text-warning fw-semibold';
  return '';
}

// Module-level so the top-level SpikeCard component can use it without a
// closure into the main React component.
function getRiskBadge(risk: string): string {
  switch (risk) {
    case 'high': return 'bg-danger';
    case 'medium': return 'bg-warning text-dark';
    default: return 'bg-success';
  }
}

function fmtPct(pct: number | null | undefined): string {
  if (pct == null) return '—';
  return `${pct.toFixed(1)}%`;
}

function fmtTs(raw: string | number | undefined | null): string {
  if (!raw) return '—';
  try {
    const d = new Date(typeof raw === 'number' ? raw * 1000 : raw);
    if (isNaN(d.getTime())) return String(raw).substring(0, 19);
    return d.toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return String(raw).substring(0, 19); }
}

// v4 — render seconds → compact human duration ("1d 0h", "5m", "45s") for
// the Pod Health table's Uptime column. Mirrors the ``fmtduration`` Jinja
// filter wired up in app.py so the printed HTML and React UI agree on the
// format.
function fmtDuration(secs: number | null | undefined): string {
  if (secs == null || isNaN(Number(secs)) || Number(secs) < 0) return '—';
  const s = Math.floor(Number(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function csvEscapeCell(val: string): string {
  if (/[",\n\r]/.test(val)) return `"${val.replace(/"/g, '""')}"`;
  return val;
}

function downloadRowsAsCsv(rows: Record<string, unknown>[], filename: string): void {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const header = keys.map((k) => csvEscapeCell(k)).join(',');
  const lines = rows.map((row) =>
    keys.map((k) => csvEscapeCell(String(row[k] ?? ''))).join(',')
  );
  const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

interface ReportData {
  execution_id: string;
  execution_name?: string;
  execution_description?: string;
  status: string;
  testbed_label: string;
  start_time: string;
  end_time?: string;
  duration_minutes: number;
  total_operations: number;
  successful_operations: number;
  failed_operations: number;
  success_rate: number;
  operations_per_minute: number;
  baseline_metrics: {
    cpu_percent: number;
    memory_percent: number;
  };
  current_metrics: {
    cpu_percent: number;
    memory_percent: number;
  };
  target_config: {
    cpu_threshold: number;
    memory_threshold: number;
    stop_condition: string;
  };
  entity_breakdown: any;
  operations_history: any[];
  metrics_history: any[];
  execution_context?: any;
  ai_insights?: AIInsights;
  ai_enabled?: boolean;
  ai_settings?: any;
  ml_stats?: any;
  pid_stats?: any;
  longevity?: {
    enabled: boolean;
    duration_hours?: number;
    health_check_results?: any[];
    health_baseline?: any;
    checkpoint_reports?: any[];
    entity_parity_snapshots?: any[];
    total_health_checks?: number;
    latest_health_verdict?: string;
  };
  event_timeline?: Array<{
    event_id: string;
    timestamp: string;
    elapsed_seconds: number;
    event_type: string;
    severity: string;
    title: string;
    message?: string;
    entity_type?: string;
    operation?: string;
    operation_id?: string;
    pod_name?: string;
    namespace?: string;
    iteration?: number | null;
    metadata?: Record<string, any>;
  }>;
  resource_lifecycle?: {
    total_created: number;
    deleted_during_execution: number;
    cleanup_attempted: number;
    cleanup_success: number;
    cleanup_failed: number;
    potentially_leaked: number;
    leak_verdict: string;
    resources: Array<{
      entity_type: string;
      entity_name: string;
      entity_uuid: string;
      created_at: string;
      deleted_at: string | null;
      cleanup_status: string;
      cleanup_error?: string | null;
    }>;
  };
  data_quality?: {
    score: string;
    operations_recorded: number;
    metrics_samples: number;
    missing_metric_samples: number;
    prometheus_configured: boolean;
    real_operations: number;
    simulated_operations: number;
    real_operations_percent: number;
    pod_events_captured: number;
    cleanup_tracked: boolean;
    timeline_events: number;
    issues: string[];
  };
  metrics_stats?: {
    cpu?: { baseline: number; final: number; min: number; max: number; avg: number; p50: number; p95: number; samples: number };
    memory?: { baseline: number; final: number; min: number; max: number; avg: number; p50: number; p95: number; samples: number };
  };
  cleanup_results?: Record<string, any>;
  testbed_topology?: {
    topology_type?: string;
    total_hosts?: number;
    total_clusters?: number;
    [key: string]: any;
  };
  full_execution_data?: Record<string, any>;
}

// ---------------------------------------------------------------------------
//  Pod-coverage v2 — tier card + section components
// ---------------------------------------------------------------------------

/**
 * v4 — one TABLE ROW per pod. Designed to mirror enhanced_report.html so the
 * downloadable HTML and the React UI tell the exact same story.
 *
 * Why a row, not a card?
 *   The user's previous feedback: cards were "very complicated" and made it
 *   hard to scan a noisy cluster. A flat table with consistent columns lets
 *   anyone — even somebody who's never seen the tool — answer "which pods
 *   are unhealthy and why?" in one glance, then click ▸ on the row to drill
 *   into events / containers / sparklines for that single pod.
 *
 * Columns (same order as the HTML table):
 *   ▸ · Sev · Namespace · Pod · Containers · Node · Uptime · Restarts ·
 *   OOM · CPU Max % (+time) · CPU Limit · Throttle % · Mem Max % (+time) ·
 *   Mem Limit
 */
const PodRow: React.FC<{
  pod: PodHealthEntry;
  thresholds?: { crit_pct?: number; watch_pct?: number };
}> = ({ pod, thresholds }) => {
  const [open, setOpen] = useState(false);
  const events = pod.events || [];
  const cpuSeries = pod.cpu_series || [];
  const memSeries = pod.memory_series || [];
  const hasSparklines = cpuSeries.length > 1 || memSeries.length > 1;
  const hasContainers = (pod.containers || []).length > 0;
  const hasDetail = events.length > 0 || hasContainers || hasSparklines;
  const critEventCount = events.filter(e => e.severity === 'critical').length;
  const colour = SEVERITY_COLOR[pod.severity];
  const critPct = thresholds?.crit_pct ?? 80;
  const watchPct = thresholds?.watch_pct ?? 60;
  const lifetimeExtra = pod.restarts_total_lifetime > pod.restarts_in_run
    ? pod.restarts_total_lifetime - pod.restarts_in_run
    : 0;
  // Pick the "headline" CPU/Mem to show in the column: prefer the in-run
  // peak (more useful for triage) but fall back to the current value.
  const cpuShow = pod.cpu_pct_max_in_run != null ? pod.cpu_pct_max_in_run : pod.cpu_pct;
  const memShow = pod.memory_pct_max_in_run != null ? pod.memory_pct_max_in_run : pod.memory_pct;
  const tierBg = pod.severity === 'critical' ? '#fef2f2'
              : pod.severity === 'watch' ? '#fffbeb'
              : '#ffffff';

  return (
    <>
      <tr style={{ background: tierBg, verticalAlign: 'top' }}>
        <td style={{ width: 32, textAlign: 'center' }}>
          {hasDetail ? (
            <button
              type="button"
              className="btn btn-sm btn-link p-0"
              onClick={() => setOpen(v => !v)}
              aria-expanded={open}
              title={open ? 'Hide events / containers / trend' : 'Show events / containers / trend'}
              style={{ width: 22, height: 22, lineHeight: 1, color: open ? '#1d4ed8' : '#64748b' }}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="text-muted small">—</span>
          )}
        </td>
        <td style={{ minWidth: 78 }}>
          <span
            className="badge rounded-pill"
            style={{ background: colour.bg, color: colour.text, border: `1px solid ${colour.bar}`, fontSize: 10 }}
          >
            {colour.label}
          </span>
        </td>
        <td style={{ minWidth: 130, fontWeight: 600 }}>{pod.namespace}</td>
        <td style={{ minWidth: 240 }}>
          <code className="small" style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }} title={pod.pod}>
            {pod.pod}
          </code>
          {pod.phase && pod.phase !== 'Running' && (
            <span className="badge bg-warning text-dark ms-2" style={{ fontSize: 10 }}>{pod.phase}</span>
          )}
          {events.length > 0 && (
            <span
              className={`badge ${critEventCount > 0 ? 'bg-danger' : 'bg-warning text-dark'} ms-2`}
              style={{ fontSize: 10 }}
              title={`${events.length} event(s)${critEventCount ? ` · ${critEventCount} critical` : ''}`}
            >
              {events.length} ev
            </span>
          )}
        </td>
        <td className="text-end" style={{ fontFamily: 'monospace' }}>{pod.container_count ?? (pod.containers || []).length}</td>
        <td><code className="small">{pod.node || '—'}</code></td>
        <td className="text-end small">{fmtDuration(pod.uptime_seconds ?? null)}</td>
        <td className="text-end" style={{ fontFamily: 'monospace' }}>
          <span className={pod.restarts_in_run > 0 ? 'text-danger fw-bold' : (pod.restarts_total_lifetime > 0 ? 'text-warning fw-semibold' : 'text-success')}>
            {pod.restarts_in_run}
          </span>
          {lifetimeExtra > 0 && (
            <div className="text-muted" style={{ fontSize: 10 }}>+{lifetimeExtra} lifetime</div>
          )}
          {pod.last_restart_at && (
            <div className="text-muted" style={{ fontSize: 10 }}>last {fmtTs(pod.last_restart_at)}</div>
          )}
        </td>
        <td className="text-end">
          {pod.oom_in_run
            ? <>
                <span className="badge bg-danger">YES</span>
                {pod.oom_at && <div className="text-muted" style={{ fontSize: 10 }}>{fmtTs(pod.oom_at)}</div>}
              </>
            : <span className="text-success small">no</span>}
        </td>
        <td className="text-end" style={{ fontFamily: 'monospace' }}>
          {cpuShow == null && pod.cpu_basis === 'unspecified' && pod.cpu_cores != null ? (
            // No CPU limit + no CPU request defined — show raw cores instead
            // of a misleading "—". The percent column genuinely doesn't
            // apply: there's no denominator to compare against.
            <>
              <span className="text-muted" title="No CPU limit or request defined for this pod">
                {pod.cpu_cores.toFixed(2)} c
              </span>
              <div className="text-muted" style={{ fontSize: 10 }}>no limit</div>
            </>
          ) : (
            <>
              <span
                className={pctClass(cpuShow, critPct, watchPct)}
                title={pod.cpu_basis ? `% of ${pod.cpu_basis}` : undefined}
              >
                {fmtPct(cpuShow)}
              </span>
              {pod.cpu_basis === 'request' && (
                <div className="text-muted" style={{ fontSize: 10 }}>of request</div>
              )}
              {pod.cpu_pct_max_at && (
                <div className="text-muted" style={{ fontSize: 10 }}>peak {fmtTs(pod.cpu_pct_max_at)}</div>
              )}
              {!pod.cpu_pct_max_at && pod.cpu_pct != null && pod.cpu_pct_max_in_run == null && (
                <div className="text-muted" style={{ fontSize: 10 }}>current</div>
              )}
            </>
          )}
        </td>
        <td className="text-end" style={{ fontFamily: 'monospace' }}>
          {pod.cpu_limit_cores_pod != null && pod.cpu_limit_cores_pod > 0
            ? `${pod.cpu_limit_cores_pod.toFixed(2)} c`
            : <span className="text-muted">—</span>}
        </td>
        <td className="text-end" style={{ fontFamily: 'monospace' }}>
          <span
            className={pctClass(pod.cpu_throttle_pct, 50, 25)}
            title={
              pod.throttle_top_container
                ? `Top: ${pod.throttle_top_container.container} `
                  + `(${pod.throttle_top_container.throttle_ratio}% throttled, `
                  + `${pod.throttle_top_container.cpu_cores} cores used)`
                : 'Pod-level CPU throttling (usage-weighted across containers)'
            }
          >
            {fmtPct(pod.cpu_throttle_pct)}
          </span>
          {pod.throttle_top_container && (pod.cpu_throttle_pct ?? 0) > 0 && (
            // When the rolled-up value is much lower than the worst
            // container, surface that asymmetry inline so users don't have
            // to expand the pod row to understand the number.
            <div className="text-muted" style={{ fontSize: 10 }} title="Worst-throttled container">
              top {pod.throttle_top_container.throttle_ratio}%
            </div>
          )}
        </td>
        <td className="text-end" style={{ fontFamily: 'monospace' }}>
          <span className={pctClass(memShow, critPct, watchPct)}>{fmtPct(memShow)}</span>
          {pod.memory_pct_max_at && (
            <div className="text-muted" style={{ fontSize: 10 }}>peak {fmtTs(pod.memory_pct_max_at)}</div>
          )}
          {!pod.memory_pct_max_at && pod.memory_pct != null && pod.memory_pct_max_in_run == null && (
            <div className="text-muted" style={{ fontSize: 10 }}>current</div>
          )}
        </td>
        <td className="text-end" style={{ fontFamily: 'monospace' }}>
          {pod.memory_limit_mb_pod != null && pod.memory_limit_mb_pod > 0
            ? `${Math.round(pod.memory_limit_mb_pod)} MB`
            : <span className="text-muted">—</span>}
        </td>
      </tr>
      {open && hasDetail && (
        <tr style={{ background: '#f8fafc' }}>
          <td colSpan={14} style={{ padding: 14, borderTop: '2px solid #2563eb' }}>
            {pod.reasons.length > 0 && (
              <div className="mb-3" style={{ fontSize: 12 }}>
                <strong className="text-muted text-uppercase" style={{ fontSize: 10, letterSpacing: '0.4px' }}>
                  Why this pod is {pod.severity}:
                </strong>
                <ul className="mb-0 mt-1 ps-3">
                  {pod.reasons.slice(0, 6).map((r, i) => <li key={i}>{r}</li>)}
                  {pod.reasons.length > 6 && (
                    <li className="text-muted">… and {pod.reasons.length - 6} more reason(s)</li>
                  )}
                </ul>
              </div>
            )}
            <div className="row g-3">
              <div className="col-lg-7">
                <h6 className="text-muted text-uppercase mb-2" style={{ fontSize: 10, letterSpacing: '0.4px' }}>
                  📅 Timeline · {events.length} event{events.length === 1 ? '' : 's'}
                </h6>
                {events.length === 0 ? (
                  <div className="alert alert-success py-2 px-3 mb-0" style={{ fontSize: 12 }}>
                    ✓ No restart / OOM / throttle events recorded for this pod.
                  </div>
                ) : (
                  <div>
                    {events.slice(0, 30).map((e, i) => <PodEventRow key={i} event={e} />)}
                    {events.length > 30 && (
                      <div className="text-muted small">… and {events.length - 30} more event(s)</div>
                    )}
                  </div>
                )}
              </div>
              <div className="col-lg-5">
                {hasContainers && (
                  <>
                    <h6 className="text-muted text-uppercase mb-2" style={{ fontSize: 10, letterSpacing: '0.4px' }}>
                      📦 Containers · {pod.containers.length}
                    </h6>
                    <div className="table-responsive mb-3">
                      <table className="table table-sm table-bordered mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>Container</th>
                            <th className="text-end">CPU %</th>
                            <th className="text-end">cores/limit</th>
                            <th className="text-end">Mem %</th>
                            <th className="text-end">MB/limit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pod.containers.map((c, i) => (
                            <tr key={i}>
                              <td><code className="small">{c.container}</code></td>
                              <td className={`text-end ${pctClass(c.cpu_pct ?? null, critPct, watchPct)}`}>{fmtPct(c.cpu_pct ?? null)}</td>
                              <td className="text-end small" style={{ fontFamily: 'monospace' }}>
                                {c.cpu_cores != null ? c.cpu_cores.toFixed(2) : '—'} / {c.cpu_limit_cores != null ? c.cpu_limit_cores.toFixed(2) : '∞'}
                              </td>
                              <td className={`text-end ${pctClass(c.memory_pct ?? null, critPct, watchPct)}`}>{fmtPct(c.memory_pct ?? null)}</td>
                              <td className="text-end small" style={{ fontFamily: 'monospace' }}>
                                {c.memory_mb != null ? c.memory_mb : '—'} / {c.memory_limit_mb != null ? c.memory_limit_mb : '∞'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {hasSparklines && (
                  <>
                    <h6 className="text-muted text-uppercase mb-2" style={{ fontSize: 10, letterSpacing: '0.4px' }}>
                      📈 Trend · {cpuSeries.length + memSeries.length} samples
                    </h6>
                    {cpuSeries.length > 1 && <Sparkline label="CPU %" series={cpuSeries} colour="#3b82f6" />}
                    {memSeries.length > 1 && <Sparkline label="Memory %" series={memSeries} colour="#7c3aed" />}
                  </>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

/**
 * v4 — wraps a tier's pods in a sortable, sticky-header table. The tier
 * itself is a collapsible block; each row internally manages its own
 * expand state so opening one pod doesn't disturb the others.
 *
 * Sortable columns: any header with a sort-key. Click toggles asc/desc.
 * Default order is whatever PodHealthClassifier produced (worst-first by
 * sort_score) so the most concerning pods are at the top without any user
 * interaction.
 */
type SortDir = 'asc' | 'desc';
type SortKey =
  | 'sev' | 'ns' | 'pod' | 'containers' | 'node' | 'uptime'
  | 'restarts' | 'oom' | 'cpu' | 'cpuLim' | 'throttle' | 'mem' | 'memLim'
  | null;

function podSortValue(p: PodHealthEntry, key: SortKey): string | number {
  switch (key) {
    case 'sev':
      return ({ critical: 3, watch: 2, healthy: 1 } as Record<string, number>)[p.severity] ?? 0;
    case 'ns': return (p.namespace || '').toLowerCase();
    case 'pod': return (p.pod || '').toLowerCase();
    case 'containers': return p.container_count ?? (p.containers || []).length;
    case 'node': return (p.node || '').toLowerCase();
    case 'uptime': return Number(p.uptime_seconds ?? 0);
    case 'restarts': return p.restarts_in_run ?? 0;
    case 'oom': return p.oom_in_run ? 1 : 0;
    case 'cpu': return Number(p.cpu_pct_max_in_run ?? p.cpu_pct ?? 0);
    case 'cpuLim': return Number(p.cpu_limit_cores_pod ?? 0);
    case 'throttle': return Number(p.cpu_throttle_pct ?? 0);
    case 'mem': return Number(p.memory_pct_max_in_run ?? p.memory_pct ?? 0);
    case 'memLim': return Number(p.memory_limit_mb_pod ?? 0);
    default: return 0;
  }
}

const PodTier: React.FC<{
  pods: PodHealthEntry[];
  severity: PodHealthEntry['severity'];
  thresholds?: { crit_pct?: number; watch_pct?: number };
}> = ({ pods, severity, thresholds }) => {
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sortedPods = React.useMemo(() => {
    if (!sortKey) return pods;
    const sorted = [...pods].sort((a, b) => {
      const av = podSortValue(a, sortKey);
      const bv = podSortValue(b, sortKey);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [pods, sortKey, sortDir]);

  const onSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(k);
      setSortDir('desc');
    }
  };
  const arrow = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕';

  if (pods.length === 0) {
    return (
      <div className="text-muted small px-3 py-2 border rounded-3 mb-2 bg-light">
        ✓ No {severity} pods.
      </div>
    );
  }

  // Single styled wrapper enables horizontal scroll without breaking the
  // sticky severity-tier card around it.
  return (
    <div className="border rounded-3 mb-2" style={{ overflow: 'auto', maxHeight: '70vh', background: '#fff' }}>
      <table className="table table-sm align-middle mb-0" style={{ minWidth: 1100, fontSize: 12 }}>
        <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 2 }}>
          <tr>
            <th style={{ width: 32 }}></th>
            <th onClick={() => onSort('sev')} style={{ cursor: 'pointer', userSelect: 'none' }}>Severity{arrow('sev')}</th>
            <th onClick={() => onSort('ns')} style={{ cursor: 'pointer', userSelect: 'none' }}>Namespace{arrow('ns')}</th>
            <th onClick={() => onSort('pod')} style={{ cursor: 'pointer', userSelect: 'none' }}>Pod{arrow('pod')}</th>
            <th className="text-end" onClick={() => onSort('containers')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Container count (expand row to inspect each)">Containers{arrow('containers')}</th>
            <th onClick={() => onSort('node')} style={{ cursor: 'pointer', userSelect: 'none' }}>Node{arrow('node')}</th>
            <th className="text-end" onClick={() => onSort('uptime')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Time since pod started">Uptime{arrow('uptime')}</th>
            <th className="text-end" onClick={() => onSort('restarts')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Restarts during this run">Restarts{arrow('restarts')}</th>
            <th className="text-end" onClick={() => onSort('oom')} style={{ cursor: 'pointer', userSelect: 'none' }}>OOM{arrow('oom')}</th>
            <th className="text-end" onClick={() => onSort('cpu')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Peak CPU% of limit during the run">CPU Max %{arrow('cpu')}</th>
            <th className="text-end" onClick={() => onSort('cpuLim')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Aggregated container CPU limits">CPU Limit{arrow('cpuLim')}</th>
            <th className="text-end" onClick={() => onSort('throttle')} style={{ cursor: 'pointer', userSelect: 'none' }} title="% of CFS scheduling periods throttled">Throttle %{arrow('throttle')}</th>
            <th className="text-end" onClick={() => onSort('mem')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Peak memory% of limit during the run">Mem Max %{arrow('mem')}</th>
            <th className="text-end" onClick={() => onSort('memLim')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Aggregated container memory limits">Mem Limit{arrow('memLim')}</th>
          </tr>
        </thead>
        <tbody>
          {sortedPods.map((p, i) => (
            <PodRow key={`${p.namespace}/${p.pod}/${i}`} pod={p} thresholds={thresholds} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ---------------------------------------------------------------------------
//  v3 — small reusable bits PodRow's expand row composes (event row,
//  sparkline, collapsible tab). Kept colocated with PodRow / PodTier so the
//  file's pod-related section stays in one place.
// ---------------------------------------------------------------------------

// Reusable pod-coverage-v3 sub-section component, kept around for the
// forthcoming per-pod drilldown refactor. The leading underscore makes
// eslint's no-unused-vars allow it, and @ts-expect-error suppresses the
// matching TS6133 unused-local build error.
// @ts-expect-error TS6133 — intentional: see comment above.
const _PodTab: React.FC<{
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  countTone?: 'crit' | 'warn' | 'info';
  countLabel?: string;
  children: React.ReactNode;
}> = ({ label, count, open, onToggle, countTone = 'info', countLabel, children }) => {
  const tone = countTone === 'crit' ? 'bg-danger text-white'
              : countTone === 'warn' ? 'bg-warning text-dark'
              : 'bg-light text-dark border';
  return (
    <div className="mb-1">
      <button
        type="button"
        className="btn btn-sm btn-link p-0 d-flex align-items-center gap-2 text-decoration-none"
        onClick={onToggle}
        style={{ fontSize: 12, fontWeight: 600, color: '#0c63e4' }}
      >
        <i className="material-icons-outlined" style={{ fontSize: 14 }}>
          {open ? 'expand_more' : 'chevron_right'}
        </i>
        <span>{label}</span>
        <span className={`badge rounded-pill ${tone}`} style={{ fontSize: 10 }}>
          {count}{countLabel ? ` ${countLabel}` : ''}
        </span>
      </button>
      {open && <div className="ms-3 mt-1">{children}</div>}
    </div>
  );
};

const PodEventRow: React.FC<{ event: PodEvent }> = ({ event }) => {
  const [logOpen, setLogOpen] = useState(false);
  const tone = event.severity === 'critical'
    ? { border: '#ef4444', bg: '#fef2f2' }
    : event.severity === 'watch'
    ? { border: '#f59e0b', bg: '#fffbeb' }
    : { border: '#cbd5e1', bg: '#f8fafc' };
  const icon = event.type === 'oom' ? '💥'
             : event.type === 'restart' ? '♻️'
             : event.type === 'throttle_spike' ? '📈'
             : event.type === 'terminated' ? '🛑'
             : 'ℹ️';
  return (
    <div
      className="d-flex gap-2 mb-1 p-2 rounded-2"
      style={{ borderLeft: `3px solid ${tone.border}`, background: tone.bg, fontSize: 12 }}
    >
      <div style={{ width: 110, fontFamily: 'monospace', fontSize: 11, color: '#64748b', flexShrink: 0 }}>
        🕐 {fmtTs(event.ts)}
      </div>
      <div style={{ width: 24, textAlign: 'center', fontSize: 16, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="fw-semibold" style={{ color: '#0f172a' }}>{event.detail || event.type.toUpperCase()}</div>
        <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
          {event.exit_code != null && <code className="me-2">exit={event.exit_code}</code>}
          {event.memory_mb != null && (
            <span className="me-2">mem <code>{event.memory_mb}{event.memory_limit_mb ? ` / ${event.memory_limit_mb} MB` : ''}</code></span>
          )}
          {event.cpu_cores != null && (
            <span className="me-2">cpu <code>{event.cpu_cores}{event.cpu_limit_cores ? ` / ${event.cpu_limit_cores} c` : ''}</code></span>
          )}
          {event.throttle_pct != null && <span className="me-2">throttle <code>{event.throttle_pct}%</code></span>}
          {event.concurrent_op && <span className="me-2">during <code>{event.concurrent_op}</code></span>}
          {event.node && <span className="me-2">node <code>{event.node}</code></span>}
        </div>
        {event.log_snippet && (
          <>
            <button
              type="button"
              className="btn btn-link btn-sm p-0"
              style={{ fontSize: 11 }}
              onClick={() => setLogOpen(v => !v)}
            >
              {logOpen ? '▾ Hide container logs' : '▸ Container logs'}
            </button>
            {logOpen && (
              <pre style={{
                background: '#1e293b', color: '#e2e8f0', padding: 8, borderRadius: 4,
                fontSize: 10, maxHeight: 200, overflow: 'auto', marginTop: 4,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>{event.log_snippet}</pre>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const Sparkline: React.FC<{
  label: string;
  series: Array<[string, number]>;
  colour: string;
}> = ({ label, series, colour }) => {
  if (!series || series.length < 2) return null;
  const values = series.map(s => Number(s[1]) || 0);
  const ymax = Math.max(...values, 1);
  const n = series.length;
  // 100x24 viewBox so it scales fluidly with the parent's width.
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * 100;
    const y = 22 - (v / ymax) * 20;
    return [x.toFixed(2), y.toFixed(2)] as [string, string];
  });
  const linePath = 'M ' + pts.map(p => `${p[0]},${p[1]}`).join(' L ');
  const fillPath = `M 0,22 ${pts.map(p => `L ${p[0]},${p[1]}`).join(' ')} L 100,22 Z`;
  const peak = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return (
    <div
      className="d-grid align-items-center mb-1"
      style={{ gridTemplateColumns: '70px 1fr 110px', gap: 8, fontSize: 11 }}
    >
      <div className="text-muted fw-semibold">{label}</div>
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ width: '100%', height: 24 }}>
        <path d={fillPath} fill={colour} opacity={0.15} />
        <path d={linePath} stroke={colour} strokeWidth={1.5} fill="none" />
      </svg>
      <div className="text-muted text-end" style={{ fontFamily: 'monospace', fontSize: 10 }}>
        peak {peak.toFixed(1)}% · avg {avg.toFixed(1)}%
      </div>
    </div>
  );
};

/**
 * Individual spike card with a collapsible body.
 *
 * The header (spike number, iteration, risk badge, CPU/Mem deltas) is always
 * visible so a tester can scan the list quickly. Details (causal operations
 * table, affected pods, ML prediction) only render when expanded — this is
 * the "Spike Analysis takes too much space" fix.
 *
 * Defaults: only the first card in the list is expanded (so the user lands
 * on something useful but the page isn't 2000px tall on load).
 */
const SpikeCard: React.FC<{ spike: any; defaultExpanded?: boolean }> = ({ spike, defaultExpanded = false }) => {
  const [open, setOpen] = useState(defaultExpanded);
  const hasDetails = (spike.causal_operations?.length ?? 0) > 0
    || (spike.affected_pods?.length ?? 0) > 0
    || spike.ml_prediction?.model_available;
  return (
    <div className="border rounded-3 p-3 mb-2" style={{
      borderLeft: `4px solid ${spike.risk_level === 'high' ? '#ef4444' : spike.risk_level === 'medium' ? '#f59e0b' : '#22c55e'} !important`,
      background: spike.risk_level === 'high' ? '#fef2f2' : spike.risk_level === 'medium' ? '#fffbeb' : '#f0fdf4'
    }}>
      <div
        className="d-flex justify-content-between align-items-center mb-2"
        onClick={() => hasDetails && setOpen(v => !v)}
        style={{ cursor: hasDetails ? 'pointer' : 'default' }}
        role={hasDetails ? 'button' : undefined}
      >
        <h6 className="fw-bold mb-0 d-flex align-items-center gap-2 flex-wrap">
          {hasDetails && (
            <i className="material-icons-outlined text-muted" style={{ fontSize: 18 }}>
              {open ? 'expand_less' : 'expand_more'}
            </i>
          )}
          <span>Spike #{spike.spike_number} — Iteration {spike.iteration}</span>
          <span className="text-muted fw-normal" style={{ fontSize: 12 }}>
            <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 13 }}>schedule</i>
            {fmtTs(spike.timestamp)}
          </span>
          {spike.spike_type && (
            <span className={`badge rounded-pill ${
              spike.spike_type === 'threshold_breach' ? 'bg-danger' :
              spike.spike_type === 'ml_anomaly_deviation' ? 'bg-purple text-white' : 'bg-warning text-dark'
            }`} style={spike.spike_type === 'ml_anomaly_deviation' ? { background: '#7c3aed' } : undefined}>
              {spike.spike_type === 'threshold_breach' ? 'Threshold Breach' :
               spike.spike_type === 'ml_anomaly_deviation' ? 'ML Anomaly' : 'Delta Spike'}
            </span>
          )}
          {spike.operation_count > 0 && (
            <span className="badge bg-secondary">{spike.operation_count} ops ({spike.operations_success}ok/{spike.operations_failed}fail)</span>
          )}
        </h6>
        <span className={`badge ${getRiskBadge(spike.risk_level)} rounded-pill`}>{spike.risk_level?.toUpperCase()} RISK</span>
      </div>

      {/* Compact summary always visible */}
      <div className="row g-3 small">
        <div className="col-md-3">
          <div className="text-muted fw-semibold">CPU Change</div>
          <div className="fw-bold" style={{ color: spike.cpu_delta > 0 ? '#ef4444' : '#22c55e' }}>
            {spike.cpu_before?.toFixed(1)}% → {spike.cpu_after?.toFixed(1)}% ({spike.cpu_delta > 0 ? '+' : ''}{spike.cpu_delta?.toFixed(1)}%)
          </div>
        </div>
        <div className="col-md-3">
          <div className="text-muted fw-semibold">Memory Change</div>
          <div className="fw-bold" style={{ color: spike.memory_delta > 0 ? '#ef4444' : '#22c55e' }}>
            {spike.memory_before?.toFixed(1)}% → {spike.memory_after?.toFixed(1)}% ({spike.memory_delta > 0 ? '+' : ''}{spike.memory_delta?.toFixed(1)}%)
          </div>
        </div>
        {spike.recovery_minutes && (
          <div className="col-md-3">
            <div className="text-muted fw-semibold">Recovery Time</div>
            <div className="fw-bold text-info">{spike.recovery_minutes} min</div>
          </div>
        )}
        {spike.ml_prediction?.model_available && (
          <div className="col-md-3">
            <div className="text-muted fw-semibold">ML Predicted</div>
            <div className="fw-bold" style={{ color: '#7c3aed' }}>CPU: {spike.ml_prediction.predicted_cpu_impact > 0 ? '+' : ''}{spike.ml_prediction.predicted_cpu_impact?.toFixed(1)}%</div>
          </div>
        )}
      </div>

      {/* Details only when expanded */}
      {open && hasDetails && (
        <>
          {spike.causal_operations?.length > 0 && (
            <div className="mt-3">
              <div className="small text-muted fw-semibold mb-1">Causal Operations ({spike.causal_operations.length})</div>
              <div className="table-responsive">
                <table className="table table-sm table-bordered mb-0">
                  <thead className="table-light"><tr><th>Timestamp</th><th>Entity</th><th>Op</th><th>Name</th><th>Status</th><th>Timing</th></tr></thead>
                  <tbody>
                    {spike.causal_operations.slice(0, 5).map((op: any, oi: number) => (
                      <tr key={oi}>
                        <td className="text-muted" style={{ fontSize: 11 }}>{fmtTs(op.timestamp)}</td>
                        <td>{op.entity_type}</td>
                        <td>{op.operation}</td>
                        <td><code className="small">{op.entity_name?.substring(0, 30)}</code></td>
                        <td><span className={`badge ${op.status === 'SUCCESS' ? 'bg-success' : 'bg-danger'} rounded-pill`}>{op.status}</span></td>
                        <td>{op.seconds_before_spike}s before</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {spike.affected_pods?.length > 0 && (
            <div className="mt-2">
              <div className="small text-muted fw-semibold mb-1">Affected Pods</div>
              <div className="d-flex gap-2 flex-wrap">
                {spike.affected_pods.slice(0, 5).map((pod: any, pi: number) => (
                  <span key={pi} className="badge bg-light text-dark border">
                    {pod.pod_name?.substring(0, 25)} (CPU: {pod.cpu_delta > 0 ? '+' : ''}{pod.cpu_delta?.toFixed(1)}%)
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Section header for a tier — clickable to collapse, shows count + icon.
 */
const TierHeader: React.FC<{
  severity: PodHealthEntry['severity'];
  count: number;
  open: boolean;
  onToggle: () => void;
  helper?: string;
}> = ({ severity, count, open, onToggle, helper }) => {
  const colour = SEVERITY_COLOR[severity];
  return (
    <div
      className="d-flex justify-content-between align-items-center px-3 py-2 mb-2 rounded-3 border"
      style={{ background: colour.bg, borderLeft: `4px solid ${colour.bar}`, cursor: 'pointer' }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      <div className="d-flex align-items-center gap-2">
        <i className="material-icons-outlined" style={{ fontSize: 22, color: colour.bar }}>{colour.icon}</i>
        <span className="fw-bold" style={{ color: colour.text }}>{colour.label}</span>
        <span className="badge bg-white text-dark border" style={{ color: colour.text }}>{count}</span>
        {helper && <span className="text-muted small ms-2">{helper}</span>}
      </div>
      <i className="material-icons-outlined text-muted" style={{ fontSize: 22 }}>
        {open ? 'expand_less' : 'expand_more'}
      </i>
    </div>
  );
};

/**
 * Top-level section: KPI strip → tiered list (Critical / Watch / Healthy).
 *
 * Defaults:
 *   - Critical/Watch start expanded so problems are immediately visible.
 *   - Healthy starts collapsed so it doesn't drown the page.
 */
const PodCoverageSection: React.FC<{
  podHealth: NonNullable<EnhancedReport['pod_health']>;
}> = ({ podHealth }) => {
  const [openCritical, setOpenCritical] = useState(true);
  const [openWatch, setOpenWatch] = useState(true);
  const [openHealthy, setOpenHealthy] = useState(false);
  const [openByNs, setOpenByNs] = useState(false);
  // v3 — pod-list search + severity filter (in-memory, no debounce needed
  // because lists are capped at POD_COVERAGE_MAX_ROWS).
  const [searchQuery, setSearchQuery] = useState('');
  const [sevFilter, setSevFilter] = useState<'all' | 'critical' | 'watch' | 'healthy'>('all');

  const summary = podHealth.summary || { total: 0, critical: 0, watch: 0, healthy: 0 };
  const thresholds = podHealth.thresholds;
  const allCrit = (podHealth.critical_pods || []) as PodHealthEntry[];
  const allWatch = (podHealth.watch_pods || []) as PodHealthEntry[];
  const allHealthy = (podHealth.healthy_pods || []) as PodHealthEntry[];
  // Apply search + severity filter once, then split by tier.
  const matches = (p: PodHealthEntry) => {
    if (sevFilter !== 'all' && p.severity !== sevFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (p.pod || '').toLowerCase().includes(q)
        || (p.namespace || '').toLowerCase().includes(q);
  };
  const crit = allCrit.filter(matches);
  const watch = allWatch.filter(matches);
  const healthy = allHealthy.filter(matches);
  const filterActive = !!searchQuery || sevFilter !== 'all';
  const byNs = podHealth.by_namespace || {};
  const nsCount = Object.keys(byNs).length;

  if (podHealth.error) {
    return (
      <div className="alert alert-warning rounded-3 mb-3 d-flex align-items-center gap-2">
        <i className="material-icons-outlined" style={{ fontSize: 20 }}>warning</i>
        <span>Pod health classifier reported an error: <code>{podHealth.error}</code>. Falling back to legacy tables below.</span>
      </div>
    );
  }

  if (summary.total === 0) {
    return (
      <div className="alert alert-info rounded-3 mb-3 d-flex align-items-center gap-2">
        <i className="material-icons-outlined" style={{ fontSize: 20 }}>info</i>
        <span>No pods classified — Prometheus may not have returned per-pod metrics for this execution. Legacy tables below show the raw cluster_health arrays.</span>
      </div>
    );
  }

  return (
    <div className="mb-4">
      {/* KPI strip */}
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <h6 className="fw-bold mb-0 d-flex align-items-center gap-2">
          <i className="material-icons-outlined text-primary" style={{ fontSize: 22 }}>health_and_safety</i>
          Pod Health
          <span className="badge bg-secondary rounded-pill" style={{ fontSize: 11 }}>v4</span>
          <span className="text-muted fw-normal small ms-2">sortable table · click any row for events / containers / trend</span>
        </h6>
        {thresholds && (
          <span className="text-muted" style={{ fontSize: 11 }}>
            Thresholds: ≥{thresholds.crit_pct ?? 80}% critical · {thresholds.watch_pct ?? 60}-{thresholds.crit_pct ?? 80}% watch · CPU throttle ≥{thresholds.crit_throttle_pct ?? 50}% critical
          </span>
        )}
      </div>

      <div className="row g-2 mb-3">
        <div className="col-6 col-md-2">
          <div className="border rounded-3 p-2 text-center" style={{ background: SEVERITY_COLOR.critical.bg }}>
            <div className="h4 mb-0 fw-bold" style={{ color: SEVERITY_COLOR.critical.text }}>{summary.critical}</div>
            <div className="small text-muted">Critical</div>
          </div>
        </div>
        <div className="col-6 col-md-2">
          <div className="border rounded-3 p-2 text-center" style={{ background: SEVERITY_COLOR.watch.bg }}>
            <div className="h4 mb-0 fw-bold" style={{ color: SEVERITY_COLOR.watch.text }}>{summary.watch}</div>
            <div className="small text-muted">Watch</div>
          </div>
        </div>
        <div className="col-6 col-md-2">
          <div className="border rounded-3 p-2 text-center" style={{ background: SEVERITY_COLOR.healthy.bg }}>
            <div className="h4 mb-0 fw-bold" style={{ color: SEVERITY_COLOR.healthy.text }}>{summary.healthy}</div>
            <div className="small text-muted">Healthy</div>
          </div>
        </div>
        <div className="col-6 col-md-2">
          <div className="border rounded-3 p-2 text-center bg-light">
            <div className="h4 mb-0 fw-bold text-danger">{summary.with_restarts_in_run ?? 0}</div>
            <div className="small text-muted">Restarts (run)</div>
          </div>
        </div>
        <div className="col-6 col-md-2">
          <div className="border rounded-3 p-2 text-center bg-light">
            <div className="h4 mb-0 fw-bold text-danger">{summary.with_oom_in_run ?? 0}</div>
            <div className="small text-muted">OOM (run)</div>
          </div>
        </div>
        <div className="col-6 col-md-2">
          <div className="border rounded-3 p-2 text-center bg-light">
            <div className="h4 mb-0 fw-bold text-warning">{summary.with_high_throttle ?? 0}</div>
            <div className="small text-muted">High throttle</div>
          </div>
        </div>
      </div>

      {/* v3 — search + severity filter (in-memory, no debounce). Auto-opens
          tiers when filter is active so matches inside the collapsed Healthy
          tier still surface. */}
      <div className="d-flex gap-2 mb-3 flex-wrap align-items-center">
        <div className="position-relative flex-grow-1" style={{ minWidth: 220 }}>
          <i
            className="material-icons-outlined position-absolute"
            style={{ left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 16 }}
          >search</i>
          <input
            type="text"
            className="form-control form-control-sm"
            style={{ paddingLeft: 32, fontSize: 13 }}
            placeholder="Filter pods by name or namespace…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) {
                setOpenCritical(true); setOpenWatch(true); setOpenHealthy(true);
              }
            }}
          />
        </div>
        <div className="btn-group btn-group-sm" role="group">
          {(['all', 'critical', 'watch', 'healthy'] as const).map((sev) => {
            const counts = { all: summary.total, critical: summary.critical, watch: summary.watch, healthy: summary.healthy };
            const cls = sevFilter === sev
              ? (sev === 'critical' ? 'btn-danger' : sev === 'watch' ? 'btn-warning' : sev === 'healthy' ? 'btn-success' : 'btn-primary')
              : 'btn-outline-secondary';
            return (
              <button
                key={sev}
                type="button"
                className={`btn ${cls}`}
                onClick={() => {
                  setSevFilter(sev);
                  if (sev !== 'all') {
                    setOpenCritical(sev === 'critical');
                    setOpenWatch(sev === 'watch');
                    setOpenHealthy(sev === 'healthy');
                  }
                }}
                style={{ textTransform: 'capitalize' }}
              >
                {sev} ({counts[sev] ?? 0})
              </button>
            );
          })}
        </div>
        {filterActive && (
          <button
            type="button"
            className="btn btn-sm btn-link text-muted"
            onClick={() => { setSearchQuery(''); setSevFilter('all'); }}
            title="Clear filter"
          >
            <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>close</i> clear
          </button>
        )}
        {filterActive && (
          <span className="badge bg-info text-dark" style={{ fontSize: 11 }}>
            {crit.length + watch.length + healthy.length} match{(crit.length + watch.length + healthy.length) === 1 ? '' : 'es'}
          </span>
        )}
      </div>

      {/* v4 — Critical tier rendered as a sortable table. Each row ▸-expands
          inline to show events, containers and sparklines for that pod
          alone. Open by default so problems are immediately visible. */}
      {crit.length > 0 && (
        <>
          <TierHeader
            severity="critical"
            count={crit.length}
            open={openCritical}
            onToggle={() => setOpenCritical(v => !v)}
            helper={`≥${thresholds?.crit_pct ?? 80}% usage / restarted / OOMKilled / phase failure`}
          />
          {openCritical && (
            <div className="ms-2">
              <PodTier pods={crit} severity="critical" thresholds={thresholds} />
            </div>
          )}
        </>
      )}

      {/* Watch tier */}
      {watch.length > 0 && (
        <>
          <TierHeader
            severity="watch"
            count={watch.length}
            open={openWatch}
            onToggle={() => setOpenWatch(v => !v)}
            helper={`${thresholds?.watch_pct ?? 60}–${thresholds?.crit_pct ?? 80}% usage / readiness / pending`}
          />
          {openWatch && (
            <div className="ms-2">
              <PodTier pods={watch} severity="watch" thresholds={thresholds} />
            </div>
          )}
        </>
      )}

      {/* Healthy tier — collapsed by default to keep the page short. */}
      {healthy.length > 0 && (
        <>
          <TierHeader
            severity="healthy"
            count={healthy.length}
            open={openHealthy}
            onToggle={() => setOpenHealthy(v => !v)}
            helper={`<${thresholds?.watch_pct ?? 60}% usage, no restarts, no OOM (click to inspect)`}
          />
          {openHealthy && (
            <div className="ms-2">
              <PodTier pods={healthy} severity="healthy" thresholds={thresholds} />
            </div>
          )}
        </>
      )}

      {/* Per-namespace card grid — collapsed by default */}
      {nsCount > 0 && (
        <div className="mt-3">
          <div
            className="d-flex justify-content-between align-items-center px-3 py-2 mb-2 rounded-3 border bg-light"
            style={{ cursor: 'pointer' }}
            onClick={() => setOpenByNs(v => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenByNs(v => !v); } }}
          >
            <div className="d-flex align-items-center gap-2">
              <i className="material-icons-outlined text-secondary" style={{ fontSize: 22 }}>folder</i>
              <span className="fw-bold">By Namespace</span>
              <span className="badge bg-secondary">{nsCount}</span>
            </div>
            <i className="material-icons-outlined text-muted" style={{ fontSize: 22 }}>
              {openByNs ? 'expand_less' : 'expand_more'}
            </i>
          </div>
          {openByNs && (
            <div className="row g-2">
              {Object.values(byNs)
                .sort((a, b) => (b.critical - a.critical) || (b.watch - a.watch) || a.namespace.localeCompare(b.namespace))
                .map((blk) => (
                  <div key={blk.namespace} className="col-md-4 col-lg-3">
                    <div
                      className="border rounded-3 p-3 h-100"
                      style={{
                        borderLeft: `4px solid ${blk.critical > 0 ? SEVERITY_COLOR.critical.bar : blk.watch > 0 ? SEVERITY_COLOR.watch.bar : SEVERITY_COLOR.healthy.bar}`,
                      }}
                    >
                      <div className="fw-semibold text-truncate" title={blk.namespace}>{blk.namespace}</div>
                      <div className="small text-muted mb-2">{blk.total} pod{blk.total === 1 ? '' : 's'}</div>
                      <div className="d-flex gap-1">
                        {blk.critical > 0 && <span className="badge bg-danger">{blk.critical}</span>}
                        {blk.watch > 0 && <span className="badge bg-warning text-dark">{blk.watch}</span>}
                        {blk.healthy > 0 && <span className="badge bg-success">{blk.healthy}</span>}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SmartExecutionReport: React.FC = () => {
  const { executionId } = useParams<{ executionId: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportData | null>(null);
  const [enhanced, setEnhanced] = useState<EnhancedReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingEnhanced, setDownloadingEnhanced] = useState(false);
  const [enhancedUnavailable, setEnhancedUnavailable] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'spikes' | 'health' | 'failures' | 'capacity' | 'iterations' | 'heatmap' | 'latency' | 'errors' | 'resources' | 'config'>('overview');
  const [expandedIterations, setExpandedIterations] = useState<Set<number>>(new Set());
  const [expandedEffectiveOps, setExpandedEffectiveOps] = useState<Set<string>>(new Set());
  const [podEvents, setPodEvents] = useState<any[]>([]);
  const [expandedLogSnippets, setExpandedLogSnippets] = useState<Set<string | number>>(new Set());

  useEffect(() => {
    fetchReport();
    fetchEnhancedReport();
    fetchPodEvents();
  }, [executionId]);

  const fetchReport = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${getApiBase()}/api/smart-execution/report/${executionId}`);
      if (!response.ok) {
        setError(`Failed to fetch report (HTTP ${response.status})`);
        return;
      }
      const data = await response.json();
      
      if (data.success) {
        setReport(data);
      } else {
        setError(data.error || 'Failed to fetch report');
      }
    } catch (err: any) {
      setError(err.message || 'Network error fetching report');
    } finally {
      setLoading(false);
    }
  };

  const fetchEnhancedReport = async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/smart-execution/report/${executionId}/enhanced?format=json`);
      if (!response.ok) {
        console.warn(`Enhanced report unavailable (HTTP ${response.status})`);
        setEnhancedUnavailable(true);
        return;
      }
      const data = await response.json();
      if (data.success && data.enhanced_report) {
        setEnhanced(data.enhanced_report);
      } else {
        setEnhancedUnavailable(true);
      }
    } catch (err) {
      console.warn('Enhanced report fetch failed:', err);
      setEnhancedUnavailable(true);
    }
  };

  const fetchPodEvents = async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/smart-execution/${executionId}/pod-events?per_page=200`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.success && data.pod_events) {
        setPodEvents(data.pod_events);
      }
    } catch {
      // non-fatal
    }
  };

  const downloadReport = async () => {
    try {
      setDownloading(true);
      const response = await fetch(`${getApiBase()}/api/smart-execution/report/${executionId}/download`);
      if (!response.ok) {
        setError(`Failed to download report (HTTP ${response.status})`);
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smart-execution-${executionId?.substring(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(`Failed to download report: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const downloadEnhancedReport = async () => {
    try {
      setDownloadingEnhanced(true);
      const response = await fetch(`${getApiBase()}/api/smart-execution/report/${executionId}/enhanced`);
      if (!response.ok) {
        setError(`Failed to download enhanced report (HTTP ${response.status})`);
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smart-execution-enhanced-${executionId?.substring(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(`Failed to download enhanced report: ${err.message}`);
    } finally {
      setDownloadingEnhanced(false);
    }
  };

  const exportOperationsCsv = () => {
    const ops = report?.operations_history as Record<string, unknown>[] | undefined;
    if (!ops?.length) return;
    const rows = ops.map((o) => {
      const r: Record<string, unknown> = {};
      Object.keys(o).forEach((k) => {
        const v = o[k];
        r[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      });
      return r;
    });
    downloadRowsAsCsv(rows, `smart-execution-${executionId?.substring(0, 10)}-operations.csv`);
  };

  const exportMetricsCsv = () => {
    const mh = report?.metrics_history as Record<string, unknown>[] | undefined;
    if (!mh?.length) return;
    const rows = mh.map((o) => {
      const r: Record<string, unknown> = {};
      Object.keys(o).forEach((k) => {
        const v = o[k];
        r[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      });
      return r;
    });
    downloadRowsAsCsv(rows, `smart-execution-${executionId?.substring(0, 10)}-metrics.csv`);
  };

  const getVerdictStyle = (result: string) => {
    switch (result) {
      case 'PASS': return { bg: '#dcfce7', border: '#22c55e', color: '#166534', icon: 'check_circle' };
      case 'WARN': return { bg: '#fef3c7', border: '#f59e0b', color: '#92400e', icon: 'warning' };
      case 'FAIL': return { bg: '#fee2e2', border: '#ef4444', color: '#991b1b', icon: 'error' };
      default: return { bg: '#f1f5f9', border: '#94a3b8', color: '#475569', icon: 'help_outline' };
    }
  };


  const formatDuration = (minutes: number) => {
    if (minutes < 1) return `${Math.round(minutes * 60)}s`;
    if (minutes < 60) return `${Math.round(minutes)}m`;
    return `${(minutes / 60).toFixed(1)}h`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { bg: string; icon: string }> = {
      'RUNNING': { bg: 'bg-info', icon: 'play_circle' },
      'COMPLETED': { bg: 'bg-success', icon: 'check_circle' },
      'STOPPED': { bg: 'bg-warning', icon: 'stop_circle' },
      'FAILED': { bg: 'bg-danger', icon: 'error' },
      'THRESHOLD_REACHED': { bg: 'bg-primary', icon: 'flag' }
    };
    return badges[status] || { bg: 'bg-secondary', icon: 'help_outline' };
  };

  if (loading) {
    return (
      <div className="main-content">
        <SkeletonMetricRow count={4} />
        <SkeletonCard lines={6} />
        <div className="mt-3"><SkeletonTable rows={5} cols={5} /></div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="main-content">
        <div className="alert alert-danger rounded-4 d-flex align-items-center" role="alert">
          <i className="material-icons-outlined me-2" style={{ fontSize: 24 }}>error_outline</i>
          <div className="flex-grow-1">
            <h4 className="alert-heading">Error Loading Report</h4>
            <p className="mb-0">{error || 'Report not found'}</p>
          </div>
          <button 
            className="btn btn-primary rounded-4"
            onClick={() => navigate('/smart-execution/history')}
          >
            <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>arrow_back</i>
            Back to History
          </button>
        </div>
      </div>
    );
  }

  const statusInfo = getStatusBadge(report.status);

  return (
    <div className="main-content">
        {/* Page Header */}
        <div className="mb-3">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h2 className="fw-bold mb-2 d-flex align-items-center gap-2">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                  width: 48,
                  height: 48,
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>assessment</i>
                </div>
                {report?.execution_name || 'Smart Execution Report'}
              </h2>
              <p className="text-muted mb-0">
                {report?.execution_description || <>Detailed analysis and metrics for execution <code className="small">{executionId?.substring(0, 20)}...</code></>}
              </p>
            </div>
            <div className="d-flex gap-2">
              <button 
                className="btn btn-primary btn-lg rounded-4 d-flex align-items-center gap-2"
                onClick={downloadEnhancedReport}
                disabled={downloadingEnhanced}
              >
                {downloadingEnhanced ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                    Generating...
                  </>
                ) : (
                  <>
                    <i className="material-icons-outlined" style={{ fontSize: 20 }}>analytics</i>
                    Enhanced Report
                  </>
                )}
              </button>
              <button 
                className="btn btn-outline-primary btn-lg rounded-4 d-flex align-items-center gap-2"
                onClick={downloadReport}
                disabled={downloading}
              >
                {downloading ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                    Downloading...
                  </>
                ) : (
                  <>
                    <i className="material-icons-outlined" style={{ fontSize: 20 }}>download</i>
                    Basic Report
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn btn-outline-success btn-lg rounded-4 d-flex align-items-center gap-2"
                onClick={exportOperationsCsv}
                title="Download operations_history as CSV"
              >
                <i className="material-icons-outlined" style={{ fontSize: 20 }}>table_chart</i>
                Ops CSV
              </button>
              <button
                type="button"
                className="btn btn-outline-success btn-lg rounded-4 d-flex align-items-center gap-2"
                onClick={exportMetricsCsv}
                title="Download metrics_history as CSV"
              >
                <i className="material-icons-outlined" style={{ fontSize: 20 }}>show_chart</i>
                Metrics CSV
              </button>
              <button
                type="button"
                className="btn btn-outline-info btn-lg rounded-4 d-flex align-items-center gap-2"
                onClick={() => {
                  const url = `${window.location.origin}/smart-execution/report/${executionId}`;
                  navigator.clipboard.writeText(url);
                  setShareCopied(true);
                  setTimeout(() => setShareCopied(false), 2000);
                }}
                title="Copy shareable report link to clipboard"
              >
                <i className="material-icons-outlined" style={{ fontSize: 20 }}>{shareCopied ? 'check' : 'share'}</i>
                {shareCopied ? 'Copied!' : 'Share'}
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-lg rounded-4 d-flex align-items-center gap-2"
                onClick={() => window.print()}
                title="Print report as PDF via browser print dialog"
              >
                <i className="material-icons-outlined" style={{ fontSize: 20 }}>print</i>
                Print PDF
              </button>
              <button 
                className="btn btn-outline-secondary btn-lg rounded-4 d-flex align-items-center gap-2"
                onClick={() => navigate('/smart-execution/history')}
              >
                <i className="material-icons-outlined" style={{ fontSize: 20 }}>arrow_back</i>
                Back
              </button>
            </div>
          </div>
        </div>

        {/* Execution Info Card */}
        <div className="card rounded-4 shadow-none border mb-3">
          <div className="card-body p-4">
            <div className="row g-4">
              <div className="col-md-3">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>flag</i>
                  <span className="small text-muted fw-semibold">Status</span>
                </div>
                <span className={`badge ${statusInfo.bg} rounded-pill px-3 py-2 d-inline-flex align-items-center gap-1`}>
                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>{statusInfo.icon}</i>
                  {report.status}
                </span>
              </div>
              <div className="col-md-3">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>dns</i>
                  <span className="small text-muted fw-semibold">Testbed</span>
                </div>
                <div className="fw-semibold">
                  {report.testbed_label || (report.execution_context && report.execution_context.testbed_label) || 'Unknown'}
                </div>
              </div>
              <div className="col-md-3">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>schedule</i>
                  <span className="small text-muted fw-semibold">Started</span>
                </div>
                <div className="small">{formatDate(report.start_time)}</div>
              </div>
              <div className="col-md-3">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>timer</i>
                  <span className="small text-muted fw-semibold">Duration</span>
                </div>
                <div className="fw-semibold">{formatDuration(report.duration_minutes || 0)}</div>
                {report.end_time && (
                  <div className="text-muted" style={{ fontSize: 11 }}>Ended: {formatDate(report.end_time)}</div>
                )}
              </div>
            </div>
            {/* Topology row */}
            {(() => {
              const topo = report.testbed_topology || (report as any).full_execution_data?.testbed_topology;
              if (!topo || !topo.total_hosts) return null;
              const topoLabel: Record<string, string> = { single_node: 'Single Node', multi_node: 'Multi-Node', multi_cluster: 'Multi-Cluster' };
              return (
                <div className="border-top pt-3 mt-3">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <i className="material-icons-outlined text-success" style={{ fontSize: 18 }}>account_tree</i>
                    <span className="small fw-semibold text-muted">Topology:</span>
                    <span className="badge bg-success bg-opacity-10 text-success rounded-pill" style={{ fontSize: 11 }}>
                      {topoLabel[topo.topology_type] || topo.topology_type}
                    </span>
                    <span className="small text-muted">{topo.total_clusters} cluster{topo.total_clusters !== 1 ? 's' : ''}, {topo.total_hosts} host{topo.total_hosts !== 1 ? 's' : ''}</span>
                    {(topo.clusters || []).map((c: any) => (
                      <span key={c.name} className="badge bg-light text-dark rounded-pill" style={{ fontSize: 10 }}>
                        {c.name}: {c.host_count} host{c.host_count !== 1 ? 's' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Auto-generated Executive Summary */}
        {report && (() => {
          const dur = report.duration_minutes || 0;
          const durStr = dur >= 60 ? `${Math.floor(dur / 60)}h ${Math.round(dur % 60)}m` : `${Math.round(dur)} minutes`;
          const testbed = report.testbed_label || 'unknown testbed';
          const ops = report.total_operations || 0;
          const rate = report.success_rate != null ? report.success_rate.toFixed(1) : '0';
          const cpuFinal = report.current_metrics?.cpu_percent?.toFixed(1) || '?';
          const cpuTarget = report.target_config?.cpu_threshold || '?';
          const memFinal = report.current_metrics?.memory_percent?.toFixed(1) || '?';
          const memTarget = report.target_config?.memory_threshold || '?';
          const thresholdHit = report.execution_context?.threshold_reached;
          const failedOps = report.failed_operations || 0;
          const spikeCount = enhanced?.spike_analysis?.total_spikes || 0;
          const verdictPass = Number(rate) >= 90 && !thresholdHit;
          const verdictWarn = Number(rate) >= 70 && Number(rate) < 90;
          const verdictColor = verdictPass ? '#22c55e' : verdictWarn ? '#f59e0b' : '#ef4444';
          const verdictLabel = verdictPass ? 'PASS' : verdictWarn ? 'PASS WITH WARNINGS' : 'NEEDS REVIEW';
          const verdictBg = verdictPass ? '#f0fdf4' : verdictWarn ? '#fffbeb' : '#fef2f2';
          return (
            <div className="card rounded-4 shadow-none border mb-3" style={{ borderLeft: `4px solid ${verdictColor}` }}>
              <div className="card-body p-4">
                <div className="d-flex align-items-center gap-3 mb-3">
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: verdictBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="material-icons-outlined" style={{ fontSize: 24, color: verdictColor }}>
                      {verdictPass ? 'check_circle' : verdictWarn ? 'warning' : 'error'}
                    </i>
                  </div>
                  <div>
                    <h6 className="fw-bold mb-0">Executive Summary</h6>
                    <span className="badge rounded-pill px-3 py-1 mt-1" style={{ background: verdictBg, color: verdictColor, fontWeight: 700, fontSize: 11 }}>
                      VERDICT: {verdictLabel}
                    </span>
                  </div>
                </div>
                <p className="mb-0" style={{ lineHeight: 1.7, color: '#334155' }}>
                  This execution ran for <strong>{durStr}</strong> on testbed <strong>{testbed}</strong>
                  {report.start_time && <> (started <strong>{fmtTs(report.start_time)}</strong>{report.end_time && <>, ended <strong>{fmtTs(report.end_time)}</strong></>})</>}
                  , executing <strong>{ops} operations</strong> ({rate}% success rate).
                  {failedOps > 0 && <> <strong>{failedOps} operations failed.</strong></>}
                  {' '}CPU reached <strong>{cpuFinal}%</strong> against a target of {cpuTarget}%, and memory reached <strong>{memFinal}%</strong> against a target of {memTarget}%.
                  {spikeCount > 0 && <> The cluster experienced <strong>{spikeCount} resource spike{spikeCount > 1 ? 's' : ''}</strong>.</>}
                  {thresholdHit && <> The <strong>resource threshold was reached</strong>.</>}
                  {(enhanced?.health_assessment?.findings?.length ?? 0) > 0 && <> {enhanced!.health_assessment!.findings.length} health finding{enhanced!.health_assessment!.findings.length > 1 ? 's' : ''} were recorded.</>}
                </p>
              </div>
            </div>
          );
        })()}

        {/* Executive Summary Cards — clickable drill-down to relevant tabs */}
        <div className="row g-3 mb-3">
          <div className="col-md-3" onClick={() => setActiveTab('iterations')} style={{ cursor: 'pointer' }} title="Click to view iteration timeline">
            <div className="card rounded-4 shadow-none border h-100 card-hover-lift" style={{ borderLeft: '4px solid #667eea' }}>
              <div className="card-body p-4 text-center">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3 mb-3" style={{
                  width: 56,
                  height: 56,
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>list</i>
                </div>
                <h1 className="display-5 fw-bold text-primary mb-2">{report.total_operations || 0}</h1>
                <p className="text-muted mb-0 fw-semibold">Total Operations</p>
                <span className="badge bg-light text-muted mt-2" style={{ fontSize: 10 }}>Click to drill down</span>
              </div>
            </div>
          </div>
          <div className="col-md-3" onClick={() => setActiveTab('latency')} style={{ cursor: 'pointer' }} title="Click to view latency breakdown">
            <div className="card rounded-4 shadow-none border h-100 card-hover-lift" style={{ borderLeft: '4px solid #28a745' }}>
              <div className="card-body p-4 text-center">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3 mb-3" style={{
                  width: 56,
                  height: 56,
                  background: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>check_circle</i>
                </div>
                <h1 className="display-5 fw-bold text-success mb-2">{(report.success_rate || 0).toFixed(1)}%</h1>
                <p className="text-muted mb-0 fw-semibold">Success Rate</p>
                <span className="badge bg-light text-muted mt-2" style={{ fontSize: 10 }}>Click to drill down</span>
              </div>
            </div>
          </div>
          <div className="col-md-3" onClick={() => setActiveTab('heatmap')} style={{ cursor: 'pointer' }} title="Click to view operation heatmap">
            <div className="card rounded-4 shadow-none border h-100 card-hover-lift" style={{ borderLeft: '4px solid #17a2b8' }}>
              <div className="card-body p-4 text-center">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3 mb-3" style={{
                  width: 56,
                  height: 56,
                  background: 'linear-gradient(135deg, #17a2b8 0%, #138496 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>speed</i>
                </div>
                <h1 className="display-5 fw-bold text-info mb-2">{(report.operations_per_minute || 0).toFixed(1)}</h1>
                <p className="text-muted mb-0 fw-semibold">Ops/Min</p>
                <span className="badge bg-light text-muted mt-2" style={{ fontSize: 10 }}>Click to drill down</span>
              </div>
            </div>
          </div>
          <div className="col-md-3" onClick={() => setActiveTab('failures')} style={{ cursor: 'pointer' }} title="Click to view failure analysis">
            <div className="card rounded-4 shadow-none border h-100 card-hover-lift" style={{ borderLeft: '4px solid #ffc107' }}>
              <div className="card-body p-4 text-center">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3 mb-3" style={{
                  width: 56,
                  height: 56,
                  background: 'linear-gradient(135deg, #ffc107 0%, #ff9800 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>error</i>
                </div>
                <h1 className="display-5 fw-bold text-warning mb-2">{report.failed_operations || 0}</h1>
                <p className="text-muted mb-0 fw-semibold">Failed Ops</p>
                <span className="badge bg-light text-muted mt-2" style={{ fontSize: 10 }}>Click to drill down</span>
              </div>
            </div>
          </div>
        </div>

        {/* AI Verdict Banner */}
        {enhanced?.verdict && (
          <div className="rounded-4 mb-3 p-4 d-flex align-items-start gap-3" style={{
            background: getVerdictStyle(enhanced.verdict.result).bg,
            borderLeft: `6px solid ${getVerdictStyle(enhanced.verdict.result).border}`,
          }}>
            <i className="material-icons-outlined" style={{ fontSize: 48, color: getVerdictStyle(enhanced.verdict.result).color }}>
              {getVerdictStyle(enhanced.verdict.result).icon}
            </i>
            <div>
              <h3 className="fw-bold mb-1" style={{ color: getVerdictStyle(enhanced.verdict.result).color }}>
                {enhanced.verdict.result}
              </h3>
              <p className="mb-2" style={{ color: getVerdictStyle(enhanced.verdict.result).color, opacity: 0.8 }}>
                {enhanced.verdict.summary}
              </p>
              {enhanced.verdict.issues && enhanced.verdict.issues.length > 0 && (
                <ul className="mb-0 ps-3" style={{ color: getVerdictStyle(enhanced.verdict.result).color, opacity: 0.7 }}>
                  {enhanced.verdict.issues.map((issue, idx) => (
                    <li key={idx} className="small">{issue}</li>
                  ))}
                </ul>
              )}
              <div className="d-flex gap-3 mt-2 flex-wrap">
                <span className="badge bg-dark bg-opacity-10 text-dark" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('health')} title="View cluster health details">OOM Kills: {enhanced.verdict.oom_kills} ↗</span>
                <span className="badge bg-dark bg-opacity-10 text-dark" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('health')} title="View pod restart details">Restarts: {enhanced.verdict.container_restarts} ↗</span>
                <span className="badge bg-dark bg-opacity-10 text-dark" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('spikes')} title="View spike analysis">High-Risk Spikes: {enhanced.verdict.high_risk_spikes} ↗</span>
                {report?.data_quality && (
                  <span className={`badge ${report.data_quality.score === 'HIGH' ? 'bg-success bg-opacity-10 text-success' : report.data_quality.score === 'MEDIUM' ? 'bg-warning bg-opacity-10 text-dark' : 'bg-danger bg-opacity-10 text-danger'}`}
                        style={{ cursor: 'pointer' }} onClick={() => setActiveTab('config')} title="View data quality details">
                    Data Quality: {report.data_quality.score} ↗
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Enhanced Report Unavailable Notice */}
        {!enhanced && enhancedUnavailable && (
          <div className="alert alert-warning rounded-4 d-flex align-items-center gap-2 mb-3">
            <i className="material-icons-outlined" style={{ fontSize: 20 }}>info</i>
            <span>Enhanced analysis (spikes, heatmap, cluster health, iterations) is not available for this execution. Only basic report data is shown below.</span>
          </div>
        )}

        {/* Enhanced Report Tabs */}
        {enhanced && (
          <div className="card rounded-4 shadow-none border mb-3">
            <div className="card-header bg-transparent border-bottom p-0">
              <ul className="nav nav-tabs border-0" style={{ padding: '0 16px' }}>
                {[
                  { key: 'overview', label: 'Overview', icon: 'dashboard' },
                  { key: 'timeline', label: `Timeline (${report?.event_timeline?.length || 0})`, icon: 'schedule' },
                  { key: 'iterations', label: `Iterations (${enhanced.iteration_timeline?.total_iterations || 0})`, icon: 'format_list_numbered' },
                  { key: 'spikes', label: `Spikes (${enhanced.spike_analysis?.total_spikes || 0})`, icon: 'show_chart' },
                  { key: 'heatmap', label: 'Heatmap', icon: 'grid_on' },
                  { key: 'health', label: 'Cluster Health', icon: 'health_and_safety' },
                  { key: 'failures', label: `Failures (${enhanced.failure_analysis?.total_failures || 0})`, icon: 'bug_report' },
                  { key: 'latency', label: 'Latency', icon: 'timer' },
                  { key: 'errors', label: 'Error Codes', icon: 'error_outline' },
                  { key: 'resources', label: 'Resources', icon: 'inventory_2' },
                  { key: 'capacity', label: 'Capacity', icon: 'speed' },
                  { key: 'config', label: 'Config', icon: 'settings' },
                ].map((tab) => (
                  <li key={tab.key} className="nav-item">
                    <button
                      className={`nav-link d-flex align-items-center gap-1 ${activeTab === tab.key ? 'active fw-semibold' : ''}`}
                      onClick={() => setActiveTab(tab.key as any)}
                      style={{ border: 'none', borderBottom: activeTab === tab.key ? '3px solid #667eea' : '3px solid transparent', borderRadius: 0, padding: '12px 16px' }}
                    >
                      <i className="material-icons-outlined" style={{ fontSize: 18 }}>{tab.icon}</i>
                      {tab.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card-body p-4">

              {/* OVERVIEW TAB */}
              {activeTab === 'overview' && (
                <div>
                  {/* CPU/Memory Over Time Chart */}
                  {report.metrics_history && report.metrics_history.length > 1 && (() => {
                    const mh = report.metrics_history;
                    const step = Math.max(1, Math.floor(mh.length / 60));
                    const sampled = mh.filter((_: any, i: number) => i % step === 0);
                    const cpuD = sampled.map((m: any) => parseFloat((m.cpu_percent ?? m.cpu ?? 0).toFixed(1)));
                    const memD = sampled.map((m: any) => parseFloat((m.memory_percent ?? m.memory ?? 0).toFixed(1)));
                    const cats = sampled.map((m: any, i: number) => {
                      if (m.timestamp) { try { return new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch {} }
                      return `#${m.iteration || i + 1}`;
                    });
                    return (
                      <div className="mb-4">
                        <div className="d-flex align-items-center gap-2 mb-2">
                          <h6 className="fw-semibold mb-0">Resource Usage Over Time</h6>
                          <span className="badge bg-light text-muted rounded-pill" style={{ fontSize: 10, cursor: 'help' }} title="Shows how CPU and memory usage changed throughout the execution. Horizontal dashed lines indicate configured thresholds.">
                            <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>info</i>
                          </span>
                        </div>
                        <ReactApexChart
                          type="area"
                          height={260}
                          series={[
                            { name: 'CPU %', data: cpuD },
                            { name: 'Memory %', data: memD }
                          ]}
                          options={{
                            chart: { toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'inherit' },
                            colors: ['#3b82f6', '#10b981'],
                            dataLabels: { enabled: false },
                            stroke: { curve: 'smooth', width: 2 },
                            fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.05, stops: [0, 100] } },
                            xaxis: { categories: cats, labels: { show: sampled.length <= 30, rotate: -45, style: { fontSize: '9px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
                            yaxis: { min: 0, max: 100, labels: { formatter: (v: number) => `${v.toFixed(0)}%` } },
                            annotations: {
                              yaxis: [
                                { y: report.target_config?.cpu_threshold || 0, borderColor: '#3b82f6', strokeDashArray: 4, label: { text: `CPU Target`, style: { color: '#3b82f6', background: '#eff6ff', fontSize: '10px' } } },
                                { y: report.target_config?.memory_threshold || 0, borderColor: '#10b981', strokeDashArray: 4, label: { text: `Mem Target`, style: { color: '#10b981', background: '#f0fdf4', fontSize: '10px' }, position: 'front' } }
                              ]
                            },
                            tooltip: { x: { show: true }, y: { formatter: (v: number) => `${v.toFixed(1)}%` } },
                            grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
                            legend: { position: 'top' as const, horizontalAlign: 'right' as const }
                          }}
                        />
                      </div>
                    );
                  })()}

                  {/* Per-Node Metrics — one chart per cluster */}
                  {report.metrics_history && report.metrics_history.some((m: any) => m.per_node?.length > 0) && (() => {
                    const mh = report.metrics_history;
                    const clusterPalette = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#84cc16'];
                    const nodePalette  = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#84cc16','#14b8a6','#a855f7','#f97316','#64748b'];

                    // Build node→cluster mapping from first non-empty sample
                    const nodeCluster: Record<string, string> = {};
                    const nodeLabel: Record<string, string> = {};
                    const clusterIpMap: Record<string, string> = {};
                    mh.forEach((m: any) => {
                      (m.per_node || []).forEach((n: any) => {
                        const id = n.node_id || n.name || 'unknown';
                        if (!nodeCluster[id]) {
                          nodeCluster[id] = n.cluster_name || '';
                          nodeLabel[id] = n.name || id.split(':')[0];
                        }
                        if (n.cluster_name && n.cluster_ip && !clusterIpMap[n.cluster_name]) {
                          clusterIpMap[n.cluster_name] = n.cluster_ip;
                        }
                      });
                    });
                    const clLabel = (cn: string) => clusterIpMap[cn] ? `${cn} (${clusterIpMap[cn]})` : cn;
                    const allNodeIds = Object.keys(nodeCluster);
                    if (allNodeIds.length === 0) return null;

                    const clusterNames = [...new Set(Object.values(nodeCluster).filter(Boolean))];
                    if (clusterNames.length === 0) clusterNames.push('');
                    const clusterColorMap: Record<string, string> = {};
                    clusterNames.forEach((cn, i) => { clusterColorMap[cn] = clusterPalette[i % clusterPalette.length]; });

                    const step = Math.max(1, Math.floor(mh.length / 60));
                    const sampled = mh.filter((_: any, i: number) => i % step === 0);
                    const timeLabels = sampled.map((m: any, i: number) => {
                      if (m.timestamp) { try { return new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch {} }
                      return `#${m.iteration || i + 1}`;
                    });

                    // Build per-node time-series data
                    const nodeData: Record<string, { cpu: number[]; mem: number[] }> = {};
                    allNodeIds.forEach(id => { nodeData[id] = { cpu: [], mem: [] }; });
                    sampled.forEach((m: any) => {
                      const seen = new Set<string>();
                      (m.per_node || []).forEach((n: any) => {
                        const id = n.node_id || n.name || 'unknown';
                        if (nodeData[id]) {
                          seen.add(id);
                          nodeData[id].cpu.push(parseFloat((n.cpu_percent || 0).toFixed(1)));
                          nodeData[id].mem.push(parseFloat((n.memory_percent || 0).toFixed(1)));
                        }
                      });
                      allNodeIds.forEach(id => { if (!seen.has(id)) { nodeData[id].cpu.push(0); nodeData[id].mem.push(0); } });
                    });

                    const topologyInfo = report.testbed_topology || (report as any).full_execution_data?.testbed_topology;
                    const topoType = topologyInfo?.topology_type || (clusterNames.length > 1 ? 'multi_cluster' : allNodeIds.length > 1 ? 'multi_node' : 'single_node');
                    const topoLabels: Record<string, string> = { single_node: 'Single Node', multi_node: 'Multi-Node', multi_cluster: 'Multi-Cluster' };

                    // Latest snapshot for the summary table
                    const lastSample = sampled[sampled.length - 1];
                    const lastNodes: Record<string, any> = {};
                    ((lastSample?.per_node) || []).forEach((n: any) => { lastNodes[n.node_id || n.name || 'unknown'] = n; });

                    return (
                      <div className="mb-4">
                        {/* Header */}
                        <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
                          <h6 className="fw-bold mb-0"><i className="material-icons-outlined align-middle me-1" style={{ fontSize: 20 }}>dns</i>Physical Host Metrics</h6>
                          <span className={`badge ${topoType === 'multi_cluster' ? 'bg-success' : topoType === 'multi_node' ? 'bg-info' : 'bg-secondary'} text-white rounded-pill`} style={{ fontSize: 10 }}>{topoLabels[topoType] || topoType}</span>
                          <span className="badge bg-primary bg-opacity-10 text-primary rounded-pill" style={{ fontSize: 10 }}>{allNodeIds.length} host{allNodeIds.length !== 1 ? 's' : ''}</span>
                          {clusterNames.length > 1 && <span className="badge bg-warning bg-opacity-15 text-warning rounded-pill" style={{ fontSize: 10 }}>{clusterNames.length} clusters</span>}
                          {clusterNames.map((cn, i) => (
                            <span key={i} className="badge bg-success bg-opacity-10 text-success rounded-pill" style={{ fontSize: 10 }}>{clLabel(cn)}</span>
                          ))}
                        </div>

                        {/* Live snapshot table */}
                        <div className="table-responsive mb-3">
                          <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: 12 }}>
                            <thead className="table-light">
                              <tr><th>Cluster</th><th>Host</th><th>CPU %</th><th style={{ width: 150 }}></th><th>Memory %</th><th style={{ width: 150 }}></th><th>Cores</th><th>RAM (GB)</th></tr>
                            </thead>
                            <tbody>
                              {allNodeIds.map(id => {
                                const n = lastNodes[id] || {};
                                const cpu = n.cpu_percent || nodeData[id]?.cpu?.slice(-1)[0] || 0;
                                const mem = n.memory_percent || nodeData[id]?.mem?.slice(-1)[0] || 0;
                                return (
                                  <tr key={id}>
                                    <td><span className="badge rounded-pill" style={{ background: clusterColorMap[nodeCluster[id]] || '#64748b', color: '#fff', fontSize: 10 }}>{clLabel(nodeCluster[id] || 'N/A')}</span></td>
                                    <td className="fw-semibold">{nodeLabel[id]}</td>
                                    <td className="fw-bold" style={{ color: cpu > 80 ? '#ef4444' : cpu > 50 ? '#f59e0b' : '#22c55e' }}>{cpu.toFixed(1)}%</td>
                                    <td><div style={{ background: '#e2e8f0', borderRadius: 4, height: 8, width: '100%' }}><div style={{ background: cpu > 80 ? '#ef4444' : cpu > 50 ? '#f59e0b' : '#22c55e', borderRadius: 4, height: 8, width: `${Math.min(cpu, 100)}%` }} /></div></td>
                                    <td className="fw-bold" style={{ color: mem > 80 ? '#ef4444' : mem > 50 ? '#f59e0b' : '#22c55e' }}>{mem.toFixed(1)}%</td>
                                    <td><div style={{ background: '#e2e8f0', borderRadius: 4, height: 8, width: '100%' }}><div style={{ background: mem > 80 ? '#ef4444' : mem > 50 ? '#f59e0b' : '#22c55e', borderRadius: 4, height: 8, width: `${Math.min(mem, 100)}%` }} /></div></td>
                                    <td>{n.num_cpu_cores || '-'}</td>
                                    <td>{n.memory_capacity_gb ? n.memory_capacity_gb.toFixed(0) : '-'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* One chart per cluster */}
                        {clusterNames.map((cname, ci) => {
                          const cNodes = allNodeIds.filter(id => nodeCluster[id] === cname);
                          if (cNodes.length === 0) return null;
                          const cSeries = cNodes.flatMap((id) => [
                            { name: `${nodeLabel[id]} CPU`, data: nodeData[id].cpu },
                            { name: `${nodeLabel[id]} Mem`, data: nodeData[id].mem },
                          ]);
                          const cColors = cNodes.flatMap((_, idx) => {
                            const c = nodePalette[idx % nodePalette.length];
                            return [c, c];
                          });
                          return (
                            <div key={ci} className="mb-3 border rounded-3 p-3" style={{ borderLeft: `4px solid ${clusterColorMap[cname] || '#64748b'}` }}>
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <span style={{ width: 12, height: 12, borderRadius: '50%', background: clusterColorMap[cname] || '#64748b', display: 'inline-block' }} />
                                <h6 className="fw-bold mb-0">{clLabel(cname || 'Cluster')}</h6>
                                <span className="badge bg-light text-muted rounded-pill" style={{ fontSize: 10 }}>{cNodes.length} host{cNodes.length !== 1 ? 's' : ''}</span>
                              </div>
                              <ReactApexChart
                                type="line"
                                height={220}
                                series={cSeries}
                                options={{
                                  chart: { toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'inherit' },
                                  colors: cColors,
                                  dataLabels: { enabled: false },
                                  stroke: { curve: 'smooth', width: 2, dashArray: cNodes.flatMap(() => [0, 5]) },
                                  xaxis: { categories: timeLabels, labels: { show: sampled.length <= 30, rotate: -45, style: { fontSize: '9px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
                                  yaxis: { min: 0, max: 100, labels: { formatter: (v: number) => `${v.toFixed(0)}%` } },
                                  tooltip: { x: { show: true }, y: { formatter: (v: number) => `${v?.toFixed(1)}%` } },
                                  grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
                                  legend: { position: 'bottom' as const, horizontalAlign: 'center' as const, fontSize: '10px', markers: { size: 4 }, height: 40, itemMargin: { horizontal: 8, vertical: 2 } },
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Simulation Mode Warning Banner */}
                  {enhanced.execution_mode_summary?.available && (enhanced.execution_mode_summary.simulated_operations ?? 0) > 0 && (
                    <div className={`alert ${enhanced.execution_mode_summary.trust_level === 'LOW' ? 'alert-danger' : 'alert-warning'} rounded-3 mb-3 d-flex align-items-start gap-2`}>
                      <i className="material-icons-outlined mt-1" style={{ fontSize: 20 }}>science</i>
                      <div>
                        <strong>Execution Mode: {enhanced.execution_mode_summary.real_percentage}% Real Operations</strong>
                        <div className="small mt-1">
                          {enhanced.execution_mode_summary.real_operations} real, {enhanced.execution_mode_summary.simulated_operations} simulated out of {enhanced.execution_mode_summary.total_operations} total.
                          {enhanced.execution_mode_summary.trust_level === 'LOW' && ' NCM client was unavailable — report data reflects random simulation, not real cluster behavior.'}
                          {enhanced.execution_mode_summary.trust_level === 'MEDIUM' && ' Some operations fell back to simulation. Check individual operation statuses.'}
                        </div>
                        <div className="mt-1">
                          <span className={`badge ${enhanced.execution_mode_summary.trust_level === 'HIGH' ? 'bg-success' : enhanced.execution_mode_summary.trust_level === 'MEDIUM' ? 'bg-warning text-dark' : 'bg-danger'}`}>
                            Trust Level: {enhanced.execution_mode_summary.trust_level}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Execution Summary Counts */}
                  <div className="mb-4">
                    <h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
                      <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>summarize</i>
                      Execution Summary
                    </h6>
                    <div className="row g-2">
                      {[
                        { label: 'Iterations', value: enhanced.iteration_timeline?.total_iterations || report.metrics_history?.length || 0, icon: 'repeat', color: '#667eea' },
                        { label: 'Total Operations', value: report.total_operations || 0, icon: 'play_arrow', color: '#0078d4' },
                        { label: 'Successful', value: report.successful_operations || 0, icon: 'check_circle', color: '#22c55e' },
                        { label: 'Failed', value: report.failed_operations || 0, icon: 'cancel', color: '#ef4444' },
                        { label: 'Spikes Detected', value: enhanced.spike_analysis?.total_spikes || 0, icon: 'show_chart', color: '#f59e0b' },
                        { label: 'Anomalies', value: (report as any).detected_anomalies?.length || enhanced.verdict?.oom_kills || 0, icon: 'warning', color: '#e11d48' },
                        { label: 'Stress Pods', value: (report as any).resource_summary?.stress_pods_deployed || 0, icon: 'rocket_launch', color: '#8b5cf6' },
                        { label: 'Duration', value: `${(report.duration_minutes || 0).toFixed(0)}m`, icon: 'schedule', color: '#64748b' },
                      ].map((item, idx) => (
                        <div key={idx} className="col-md-3 col-6">
                          <div className="d-flex align-items-center gap-2 p-2 bg-light rounded-3">
                            <i className="material-icons-outlined" style={{ fontSize: 18, color: item.color }}>{item.icon}</i>
                            <div>
                              <div className="fw-bold" style={{ fontSize: 16 }}>{item.value}</div>
                              <div className="text-muted" style={{ fontSize: 11 }}>{item.label}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Sustain Phase Summary */}
                  {(report as any).sustain_stats?.entered_at && (
                    <div className="mb-4 p-3 rounded-3 border" style={{ background: '#f0fdf4' }}>
                      <h6 className="fw-bold mb-2 d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-success" style={{ fontSize: 20 }}>trending_flat</i>
                        Sustained Load Phase
                      </h6>
                      <div className="row g-2 small">
                        <div className="col-md-3"><span className="text-muted">Duration:</span>{' '}
                          <strong>{((report as any).sustain_stats.duration_seconds / 60).toFixed(1)} min</strong></div>
                        <div className="col-md-3"><span className="text-muted">CPU Range:</span>{' '}
                          <strong>{(report as any).sustain_stats.min_cpu?.toFixed(1)}% – {(report as any).sustain_stats.max_cpu?.toFixed(1)}%</strong></div>
                        <div className="col-md-3"><span className="text-muted">Memory Range:</span>{' '}
                          <strong>{(report as any).sustain_stats.min_memory?.toFixed(1)}% – {(report as any).sustain_stats.max_memory?.toFixed(1)}%</strong></div>
                        <div className="col-md-3"><span className="text-muted">Re-escalations:</span>{' '}
                          <strong className={((report as any).sustain_stats.reescalations || 0) > 0 ? 'text-warning' : ''}>{(report as any).sustain_stats.reescalations || 0}</strong></div>
                        <div className="col-md-3"><span className="text-muted">Ops during sustain:</span>{' '}
                          <strong>{(report as any).sustain_stats.ops_during_sustain || 0}</strong>
                          {(report as any).sustain_stats.sustain_ops_per_minute > 0 && (
                            <span className="text-muted ms-1">({(report as any).sustain_stats.sustain_ops_per_minute}/min)</span>
                          )}</div>
                      </div>
                    </div>
                  )}

                  {/* Report data quality / provenance */}
                  {enhanced.report_metadata && (
                    <div className="mb-4 p-3 rounded-3 border bg-light">
                      <h6 className="fw-bold mb-2 d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-info" style={{ fontSize: 20 }}>fact_check</i>
                        Report data quality
                      </h6>
                      <p className="small text-muted mb-2">
                        Sample counts, metric time span, and how cluster health was sourced (live Prometheus vs persisted snapshot).
                      </p>
                      <div className="row g-2 small">
                        <div className="col-md-4"><span className="text-muted">Generated (UTC):</span>{' '}
                          <code>{enhanced.report_metadata.generated_at_utc || '—'}</code></div>
                        <div className="col-md-4"><span className="text-muted">Metrics samples:</span>{' '}
                          <strong>{enhanced.report_metadata.metrics_samples ?? 0}</strong></div>
                        <div className="col-md-4"><span className="text-muted">Operations recorded:</span>{' '}
                          <strong>{enhanced.report_metadata.operations_recorded ?? 0}</strong></div>
                        {enhanced.report_metadata.metrics_time_range && (
                          <div className="col-12">
                            <span className="text-muted">Metric time range:</span>{' '}
                            <code className="small">
                              {enhanced.report_metadata.metrics_time_range.first_timestamp} → {enhanced.report_metadata.metrics_time_range.last_timestamp}
                            </code>
                          </div>
                        )}
                        <div className="col-md-4"><span className="text-muted">Cluster health source:</span>{' '}
                          <span className="badge bg-info text-dark">{enhanced.report_metadata.cluster_health_source}</span></div>
                        <div className="col-md-4"><span className="text-muted">Prometheus configured:</span>{' '}
                          {enhanced.report_metadata.prometheus_configured ? 'Yes' : 'No'}</div>
                        <div className="col-md-4"><span className="text-muted">Start/final resolution:</span>{' '}
                          <code className="small">{enhanced.report_metadata.baseline_final_resolution}</code></div>
                      </div>
                    </div>
                  )}

                  {/* Most Effective Operations */}
                  {(report as any).operation_effectiveness?.length > 0 && (
                    <div className="mb-4">
                      <h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-success" style={{ fontSize: 20 }}>trending_up</i>
                        Most Effective Operations
                      </h6>
                      <div className="table-responsive">
                        <table className="table table-sm table-hover align-middle mb-0">
                          <thead className="table-light">
                            <tr><th style={{ width: 30 }}></th><th>Operation</th><th>Count</th><th>Avg CPU Impact</th><th>Avg Mem Impact</th><th>Avg Duration</th><th>Success Rate</th></tr>
                          </thead>
                          <tbody>
                            {(report as any).operation_effectiveness.map((op: any, idx: number) => {
                              const key = `${op.entity_type || op.entity}.${op.operation}`;
                              const isExpanded = expandedEffectiveOps.has(key);
                              return (
                                <React.Fragment key={idx}>
                                  <tr
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => setExpandedEffectiveOps(prev => {
                                      const next = new Set(prev);
                                      next.has(key) ? next.delete(key) : next.add(key);
                                      return next;
                                    })}
                                  >
                                    <td><i className="material-icons-outlined" style={{ fontSize: 16 }}>{isExpanded ? 'expand_less' : 'expand_more'}</i></td>
                                    <td><strong>{key}</strong></td>
                                    <td><span className="badge bg-primary rounded-pill">{op.count ?? op.executions ?? op.execution_count ?? '-'}</span></td>
                                    <td style={{ color: ((op.avg_cpu_impact ?? op.avg_cpu_delta) || 0) > 0 ? '#ef4444' : '#22c55e' }}>{((op.avg_cpu_impact ?? op.avg_cpu_delta) || 0) > 0 ? '+' : ''}{((op.avg_cpu_impact ?? op.avg_cpu_delta) || 0).toFixed(2)}%</td>
                                    <td style={{ color: ((op.avg_memory_impact ?? op.avg_memory_delta) || 0) > 0 ? '#ef4444' : '#22c55e' }}>{((op.avg_memory_impact ?? op.avg_memory_delta) || 0) > 0 ? '+' : ''}{((op.avg_memory_impact ?? op.avg_memory_delta) || 0).toFixed(2)}%</td>
                                    <td>{(op.avg_duration || 0).toFixed(1)}s</td>
                                    <td><span className={`badge ${(op.success_rate || 0) >= 80 ? 'bg-success' : (op.success_rate || 0) >= 50 ? 'bg-warning text-dark' : 'bg-danger'} rounded-pill`}>{(op.success_rate || 0).toFixed(0)}%</span></td>
                                  </tr>
                                  {isExpanded && op.impacts && (
                                    <tr>
                                      <td colSpan={7} style={{ background: '#f8fafc', padding: '8px 16px 8px 48px' }}>
                                        <div className="small">
                                          <strong>Individual Executions:</strong>
                                          <table className="table table-sm table-bordered mt-1 mb-0" style={{ fontSize: 11 }}>
                                            <thead className="table-light"><tr><th>#</th><th>CPU Before</th><th>CPU After</th><th>CPU Δ</th><th>Mem Before</th><th>Mem After</th><th>Mem Δ</th><th>Duration</th></tr></thead>
                                            <tbody>
                                              {op.impacts.slice(0, 15).map((impact: any, ii: number) => (
                                                <tr key={ii}>
                                                  <td>{ii + 1}</td>
                                                  <td>{(impact.cpu_before || 0).toFixed(1)}%</td>
                                                  <td>{(impact.cpu_after || 0).toFixed(1)}%</td>
                                                  <td style={{ color: (impact.cpu_delta || 0) > 0 ? '#ef4444' : '#22c55e', fontWeight: 'bold' }}>{(impact.cpu_delta || 0) > 0 ? '+' : ''}{(impact.cpu_delta || 0).toFixed(2)}%</td>
                                                  <td>{(impact.memory_before || 0).toFixed(1)}%</td>
                                                  <td>{(impact.memory_after || 0).toFixed(1)}%</td>
                                                  <td style={{ color: (impact.memory_delta || 0) > 0 ? '#ef4444' : '#22c55e', fontWeight: 'bold' }}>{(impact.memory_delta || 0) > 0 ? '+' : ''}{(impact.memory_delta || 0).toFixed(2)}%</td>
                                                  <td>{(impact.duration || 0).toFixed(1)}s</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Capacity Planning */}
                  {enhanced.capacity_planning?.available && (
                    <div className="mb-4">
                      <h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>analytics</i>
                        Capacity Planning
                      </h6>
                      <div className="row g-3 mb-3">
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="small text-muted fw-semibold">CPU / Operation</div>
                            <div className="h4 mb-0 text-primary">{enhanced.capacity_planning.cpu_per_operation}%</div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="small text-muted fw-semibold">Memory / Operation</div>
                            <div className="h4 mb-0 text-warning">{enhanced.capacity_planning.memory_per_operation}%</div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="small text-muted fw-semibold">Bottleneck</div>
                            <div className="h5 mb-0"><span className="badge bg-danger">{enhanced.capacity_planning.bottleneck?.toUpperCase()}</span></div>
                          </div>
                        </div>
                        {enhanced.capacity_planning.estimated_total_capacity_ops && (
                          <div className="col-md-3">
                            <div className="p-3 bg-light rounded-3 text-center">
                              <div className="small text-muted fw-semibold">Est. Max Ops</div>
                              <div className="h4 mb-0 text-info">~{enhanced.capacity_planning.estimated_total_capacity_ops}</div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="alert alert-info rounded-3 mb-0">
                        <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 18 }}>tips_and_updates</i>
                        {enhanced.capacity_planning.recommendation}
                      </div>
                    </div>
                  )}

                  {/* Historical Comparison */}
                  {enhanced.historical_comparison?.available && enhanced.historical_comparison.previous_executions && (
                    <div>
                      <h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-warning" style={{ fontSize: 20 }}>history</i>
                        Previous Executions on This Testbed
                      </h6>
                      {enhanced.historical_comparison.trend_vs_last_run && (
                        <div className="alert alert-light border mb-3 small" role="status">
                          <strong className="me-1">vs last run on this testbed:</strong>
                          duration Δ{' '}
                          <span className={enhanced.historical_comparison.trend_vs_last_run.duration_delta_minutes <= 0 ? 'text-success' : 'text-warning'}>
                            {enhanced.historical_comparison.trend_vs_last_run.duration_delta_minutes > 0 ? '+' : ''}
                            {enhanced.historical_comparison.trend_vs_last_run.duration_delta_minutes} min
                          </span>
                          {' · '}success rate Δ{' '}
                          <span className={enhanced.historical_comparison.trend_vs_last_run.success_rate_delta_pct >= 0 ? 'text-success' : 'text-danger'}>
                            {enhanced.historical_comparison.trend_vs_last_run.success_rate_delta_pct > 0 ? '+' : ''}
                            {enhanced.historical_comparison.trend_vs_last_run.success_rate_delta_pct}%
                          </span>
                          {' · '}
                          <span className="text-muted">
                            ({enhanced.historical_comparison.trend_vs_last_run.duration_vs_last} than previous duration)
                          </span>
                        </div>
                      )}
                      <div className="table-responsive">
                        <table className="table table-hover table-sm align-middle mb-0">
                          <thead className="table-light">
                            <tr><th>Execution</th><th>Status</th><th>Duration</th><th>Iterations</th><th>Ops</th><th>Success</th><th>CPU Start</th><th>CPU End</th></tr>
                          </thead>
                          <tbody>
                            {enhanced.historical_comparison.previous_executions.map((h: any, idx: number) => (
                              <tr key={idx}>
                                <td><code className="small">{h.execution_id?.substring(0, 12)}...</code></td>
                                <td><span className={`badge ${h.status === 'COMPLETED' ? 'bg-success' : h.status === 'LONGEVITY_SUSTAINING' ? 'bg-info' : 'bg-warning'} rounded-pill`}>{h.status}</span></td>
                                <td>{h.duration_minutes}m</td>
                                <td><strong>{h.iterations || '-'}</strong></td>
                                <td>{h.total_operations}</td>
                                <td>{h.success_rate}%</td>
                                <td>{h.baseline_cpu?.toFixed(1)}%</td>
                                <td>{h.final_cpu?.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SPIKE ANALYSIS TAB */}
              {activeTab === 'spikes' && (
                <div>
                  <div className="alert alert-light border rounded-3 mb-3 py-2 px-3 d-flex align-items-center gap-2" style={{ fontSize: 13 }}>
                    <i className="material-icons-outlined text-info" style={{ fontSize: 18 }}>info</i>
                    <span>Spikes are sudden resource jumps &gt;5% between consecutive polls. High-risk spikes exceeded the target threshold and may indicate capacity limits.</span>
                  </div>
                  {enhanced.spike_analysis?.spikes?.length > 0 ? (
                    <>
                      <div className="row g-3 mb-4">
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="h3 mb-0 text-danger fw-bold">{enhanced.spike_analysis.high_risk_count}</div>
                            <div className="small text-muted fw-semibold">High Risk</div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="h3 mb-0 text-warning fw-bold">{enhanced.spike_analysis.medium_risk_count}</div>
                            <div className="small text-muted fw-semibold">Medium Risk</div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="h3 mb-0 text-info fw-bold">{enhanced.spike_analysis.total_spikes}</div>
                            <div className="small text-muted fw-semibold">Total Spikes</div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="h3 mb-0 text-success fw-bold">{enhanced.spike_analysis.avg_recovery_minutes}m</div>
                            <div className="small text-muted fw-semibold">Avg Recovery</div>
                          </div>
                        </div>
                      </div>

                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <span className="small text-muted">
                          Showing {Math.min(enhanced.spike_analysis.spikes.length, 10)} of {enhanced.spike_analysis.spikes.length} spikes — click any card to expand details.
                        </span>
                      </div>
                      {enhanced.spike_analysis.spikes.slice(0, 10).map((spike: any, idx: number) => (
                        <SpikeCard
                          key={idx}
                          spike={spike}
                          /* Only the first card auto-expands; the rest start collapsed
                             so the page is scannable on load (Phase 3 UX fix). */
                          defaultExpanded={idx === 0}
                        />
                      ))}
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>check_circle</i>
                      <div>No significant metric spikes detected</div>
                    </div>
                  )}
                </div>
              )}

              {/* CLUSTER HEALTH TAB */}
              {activeTab === 'health' && (
                <div>
                  <div className="alert alert-light border rounded-3 mb-3 py-2 px-3 d-flex align-items-center gap-2" style={{ fontSize: 13 }}>
                    <i className="material-icons-outlined text-info" style={{ fontSize: 18 }}>info</i>
                    <span>Cluster health data from Prometheus: CPU throttling, container restarts, OOM kills, node conditions, and PVC health. Scores below 50 indicate serious issues.</span>
                  </div>

                  {/* Pod-coverage v2 — single-source-of-truth severity tiers.
                      Sits at the very top of the health tab so the most actionable
                      view is the first thing testers see. Falls back gracefully
                      when the classifier wasn't run (legacy reports). */}
                  {enhanced.pod_health && (
                    <PodCoverageSection podHealth={enhanced.pod_health} />
                  )}

                  {/* QA Health Assessment */}
                  {enhanced.health_assessment && enhanced.health_assessment.findings?.length > 0 && (() => {
                    const ha = enhanced.health_assessment!;
                    return (
                    <div className="mb-4">
                      <div className="d-flex align-items-center gap-3 mb-3">
                        <h6 className="fw-bold mb-0">QA Health Assessment</h6>
                        <span className={`badge ${
                          ha.overall_status === 'CRITICAL' ? 'bg-danger' :
                          ha.overall_status === 'DEGRADED' ? 'bg-warning text-dark' :
                          ha.overall_status === 'ATTENTION' ? 'bg-warning text-dark' :
                          'bg-success'
                        } fs-6`}>
                          {ha.overall_status}
                        </span>
                        {ha.critical_count > 0 && <span className="badge bg-danger">{ha.critical_count} Critical</span>}
                        {ha.warning_count > 0 && <span className="badge bg-warning text-dark">{ha.warning_count} Warning</span>}
                      </div>
                      <div className="table-responsive">
                        <table className="table table-sm table-bordered">
                          <thead className="table-light"><tr><th style={{width: 90}}>Severity</th><th style={{width: 120}}>Category</th><th>Finding</th><th>Recommendation</th></tr></thead>
                          <tbody>
                            {ha.findings.map((f: any, i: number) => (
                              <tr key={i}>
                                <td>
                                  <span className={`badge ${f.severity === 'critical' ? 'bg-danger' : f.severity === 'warning' ? 'bg-warning text-dark' : 'bg-info'}`}>
                                    {f.severity.toUpperCase()}
                                  </span>
                                </td>
                                <td className="fw-semibold">{f.category}</td>
                                <td>{f.finding}</td>
                                <td className="text-muted small">{f.recommendation}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    );
                  })()}

                  {enhanced.report_metadata?.cluster_health_source && (
                    <div className={`alert ${enhanced.report_metadata.cluster_health_source === 'live_prometheus' ? 'alert-success' : 'alert-info'} rounded-3 mb-3 d-flex align-items-center gap-2`}>
                      <i className="material-icons-outlined" style={{ fontSize: 18 }}>
                        {enhanced.report_metadata.cluster_health_source === 'live_prometheus' ? 'cloud_done' : 'inventory_2'}
                      </i>
                      <span>
                        Data source: <strong>{enhanced.report_metadata.cluster_health_source === 'live_prometheus' ? 'Live Prometheus' : 'Persisted Snapshot (captured at execution end)'}</strong>
                        {enhanced.report_metadata.cluster_health_source === 'persisted_snapshot' && (
                          <span className="text-muted ms-2">— values reflect cluster state when execution finished, not current state</span>
                        )}
                      </span>
                    </div>
                  )}
                  {enhanced.cluster_health?.collection_status === 'success' ? (
                    <>
                      {/* Node Conditions */}
                      {enhanced.cluster_health.node_conditions?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3">Node Conditions</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Node</th><th>Ready</th><th>Disk Pressure</th><th>Memory Pressure</th><th>PID Pressure</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.node_conditions.map((n: any, i: number) => (
                                  <tr key={i}>
                                    <td><strong>{n.node}</strong></td>
                                    <td>{n.ready ? <span className="badge bg-success">Ready</span> : <span className="badge bg-danger">Not Ready</span>}</td>
                                    <td>{n.disk_pressure ? <span className="badge bg-danger">YES</span> : <span className="badge bg-success">No</span>}</td>
                                    <td>{n.memory_pressure ? <span className="badge bg-danger">YES</span> : <span className="badge bg-success">No</span>}</td>
                                    <td>{n.pid_pressure ? <span className="badge bg-danger">YES</span> : <span className="badge bg-success">No</span>}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* OOM Killed */}
                      {enhanced.cluster_health.oom_killed?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3 text-danger">OOMKilled Containers ({enhanced.cluster_health.oom_killed.length})</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Namespace</th><th>Container</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.oom_killed.map((o: any, i: number) => (
                                  <tr key={i}><td><code>{o.pod}</code></td><td>{o.namespace}</td><td>{o.container}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* CPU Throttling */}
                      {enhanced.cluster_health.cpu_throttling?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3 text-warning">CPU Throttled Pods ({enhanced.cluster_health.cpu_throttling.length})</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Namespace</th><th>Container</th><th>Throttle %</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.cpu_throttling.slice(0, 15).map((t: any, i: number) => (
                                  <tr key={i}>
                                    <td><code>{t.pod}</code></td><td>{t.namespace}</td><td>{t.container}</td>
                                    <td><span className={`badge ${t.throttle_ratio > 30 ? 'bg-danger' : t.throttle_ratio > 10 ? 'bg-warning text-dark' : 'bg-info'}`}>{t.throttle_ratio}%</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Container Restarts */}
                      {enhanced.cluster_health.container_restarts?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3">Container Restarts (Last Hour)</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Namespace</th><th>Container</th><th>Restarts</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.container_restarts.slice(0, 10).map((r: any, i: number) => (
                                  <tr key={i}>
                                    <td><code>{r.pod}</code></td><td>{r.namespace}</td><td>{r.container}</td>
                                    <td><span className="badge bg-warning text-dark">{r.restart_count}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Unhealthy Pods */}
                      {enhanced.cluster_health.unhealthy_pods?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3 text-danger">Unhealthy Pods — Waiting State ({enhanced.cluster_health.unhealthy_pods.length})</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Namespace</th><th>Container</th><th>Reason</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.unhealthy_pods.map((u: any, i: number) => (
                                  <tr key={i}>
                                    <td><code>{u.pod}</code></td><td>{u.namespace}</td><td>{u.container}</td>
                                    <td><span className="badge bg-danger">{u.reason}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Terminated Containers */}
                      {enhanced.cluster_health.terminated_containers?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3">Terminated Containers — Last Reason</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Namespace</th><th>Container</th><th>Reason</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.terminated_containers.map((tc: any, i: number) => (
                                  <tr key={i}>
                                    <td><code>{tc.pod}</code></td><td>{tc.namespace}</td><td>{tc.container}</td>
                                    <td><span className={`badge ${tc.reason === 'OOMKilled' ? 'bg-danger' : tc.reason === 'Error' ? 'bg-warning text-dark' : 'bg-info'}`}>{tc.reason}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Cumulative Restarts */}
                      {enhanced.cluster_health.total_restarts?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3">Cumulative Container Restarts (All-Time)</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Namespace</th><th>Container</th><th>Total Restarts</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.total_restarts.slice(0, 15).map((tr: any, i: number) => (
                                  <tr key={i}>
                                    <td><code>{tr.pod}</code></td><td>{tr.namespace}</td><td>{tr.container}</td>
                                    <td><span className={`badge ${tr.total_restarts > 5 ? 'bg-danger' : tr.total_restarts > 2 ? 'bg-warning text-dark' : 'bg-info'}`}>{tr.total_restarts}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Pod Phase Distribution */}
                      {enhanced.cluster_health.pod_phase_summary && Object.keys(enhanced.cluster_health.pod_phase_summary).length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3">Pod Phase Distribution</h6>
                          <div className="d-flex gap-3 flex-wrap">
                            {Object.entries(enhanced.cluster_health.pod_phase_summary).map(([phase, count]: [string, any]) => (
                              <div key={phase} className={`text-center p-3 rounded-3 ${phase === 'Running' ? 'bg-success bg-opacity-10' : phase === 'Pending' ? 'bg-warning bg-opacity-10' : phase === 'Failed' ? 'bg-danger bg-opacity-10' : 'bg-light'}`}>
                                <div className="fs-4 fw-bold">{count}</div>
                                <div className="small text-muted fw-semibold">{phase}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Problem Pods */}
                      {enhanced.cluster_health.problem_pods?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3 text-warning">Problem Pods — Pending/Failed/Unknown</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Namespace</th><th>Phase</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.problem_pods.map((pp: any, i: number) => (
                                  <tr key={i}>
                                    <td><code>{pp.pod}</code></td><td>{pp.namespace}</td>
                                    <td><span className={`badge ${pp.phase === 'Failed' ? 'bg-danger' : 'bg-warning text-dark'}`}>{pp.phase}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Pods Not Ready */}
                      {enhanced.cluster_health.pods_not_ready?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3 text-warning">Pods Not Ready — Readiness Probe Failing ({enhanced.cluster_health.pods_not_ready.length})</h6>
                          <div className="d-flex flex-wrap gap-2">
                            {enhanced.cluster_health.pods_not_ready.map((nr: any, i: number) => (
                              <span key={i} className="badge bg-warning text-dark"><code>{nr.pod}</code> ({nr.namespace})</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* API Server Latency */}
                      {enhanced.cluster_health.api_server_latency?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3">API Server Latency (P99 &gt; 1s)</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Verb</th><th>Resource</th><th>P99 Latency</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.api_server_latency.slice(0, 10).map((a: any, i: number) => (
                                  <tr key={i}>
                                    <td><strong>{a.verb}</strong></td><td>{a.resource}</td>
                                    <td><span className={`badge ${a.p99_seconds > 10 ? 'bg-danger' : a.p99_seconds > 5 ? 'bg-warning text-dark' : 'bg-info'}`}>{a.p99_seconds}s</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* etcd + Infrastructure Health */}
                      {enhanced.cluster_health.etcd_healthy !== undefined && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3">Infrastructure Health</h6>
                          <div className="d-flex gap-3">
                            <div className={`p-3 rounded-3 ${enhanced.cluster_health.etcd_healthy ? 'bg-success bg-opacity-10' : 'bg-danger bg-opacity-10'}`}>
                              <strong>etcd: </strong>
                              {enhanced.cluster_health.etcd_healthy
                                ? <span className="badge bg-success">Healthy (has leader)</span>
                                : <span className="badge bg-danger">NO LEADER</span>}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Pod Resource Usage */}
                      {enhanced.cluster_health.pod_cpu?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3">Top Pod Resource Usage</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Namespace</th><th>CPU %</th><th>CPU Cores</th><th>CPU Limit</th><th>Memory</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.pod_cpu.slice(0, 15).map((c: any, i: number) => {
                                  const memEntry = enhanced.cluster_health.pod_memory?.find((m: any) => m.pod === c.pod);
                                  const memMb = memEntry?.memory_mb || 0;
                                  // c.cpu_pct can be null when the pod has
                                  // neither a CPU limit nor a CPU request
                                  // defined (cpu_basis === 'unspecified').
                                  // Show raw cores in that case so the table
                                  // doesn't render "null%".
                                  const cpuPct: number | null = c.cpu_pct;
                                  const cpuBasis: string = c.cpu_basis || 'limit';
                                  const cpuCores: number | null = c.cpu_cores ?? null;
                                  return (
                                    <tr key={i}>
                                      <td><code className="small">{c.pod?.substring(0, 40)}</code></td>
                                      <td>{c.namespace}</td>
                                      <td>
                                        {cpuPct == null ? (
                                          <span className="text-muted" title="No CPU limit or request defined">
                                            {cpuCores != null ? `${cpuCores.toFixed(2)} c` : '—'}
                                            <span className="ms-1" style={{ fontSize: 10 }}>no limit</span>
                                          </span>
                                        ) : (
                                          <span
                                            className={cpuPct > 90 ? 'text-danger fw-bold' : cpuPct > 70 ? 'text-warning' : ''}
                                            title={`% of ${cpuBasis}`}
                                          >
                                            {cpuPct.toFixed(1)}%{cpuBasis === 'request' ? ' (req)' : ''}
                                          </span>
                                        )}
                                      </td>
                                      <td>{c.cpu_cores}</td>
                                      <td>{c.cpu_limit_cores != null ? `${c.cpu_limit_cores}` : <span className="text-muted">unlimited</span>}</td>
                                      <td>
                                        <span className={memMb > 2048 ? 'text-danger fw-bold' : memMb > 1024 ? 'text-warning' : ''}>
                                          {memMb >= 1024 ? `${(memMb / 1024).toFixed(1)} GB` : `${memMb} MB`}
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

                      {/* Pod Health Overview (replaces numeric stability scores) */}
                      {enhanced.pod_stability?.length > 0 && (
                        <div>
                          <h6 className="fw-bold mb-3">Pod Health Overview</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Status</th><th>Restarts (1h/Total)</th><th>Throttle %</th><th>OOM</th><th>State</th><th>Max CPU</th><th>Max Mem</th></tr></thead>
                              <tbody>
                                {enhanced.pod_stability.slice(0, 20).map((p: any, i: number) => (
                                  <tr key={i}>
                                    <td><code className="small">{p.pod_name?.substring(0, 40)}</code></td>
                                    <td>
                                      {p.stability_score >= 80
                                        ? <span className="badge bg-success">Healthy</span>
                                        : p.stability_score >= 50
                                          ? <span className="badge bg-warning text-dark">Degraded</span>
                                          : <span className="badge bg-danger">Critical</span>
                                      }
                                    </td>
                                    <td>
                                      {p.restarts > 0 ? <span className="badge bg-danger">{p.restarts}</span> : '0'}
                                      <span className="text-muted mx-1">/</span>
                                      {p.total_restarts > 0 ? <span className="text-warning fw-bold">{p.total_restarts}</span> : '0'}
                                    </td>
                                    <td>
                                      {p.cpu_throttle_pct > 10
                                        ? <span className="badge bg-warning text-dark"
                                                title={p.throttle_top_container
                                                  ? `Top container: ${p.throttle_top_container.container} `
                                                    + `(${p.throttle_top_container.throttle_ratio}% throttled, `
                                                    + `${p.throttle_top_container.cpu_cores} cores)`
                                                  : 'Usage-weighted pod-level throttle'}>
                                            {p.cpu_throttle_pct}%
                                          </span>
                                        : `${p.cpu_throttle_pct}%`}
                                      {p.throttle_top_container
                                        && p.throttle_top_container.throttle_ratio
                                           > (p.cpu_throttle_pct || 0) + 5 && (
                                        <div className="text-muted" style={{ fontSize: 10 }}>
                                          top {p.throttle_top_container.throttle_ratio}% ({p.throttle_top_container.container})
                                        </div>
                                      )}
                                    </td>
                                    <td>{p.oom_killed ? <span className="badge bg-danger">YES</span> : <span className="badge bg-success">No</span>}</td>
                                    <td>
                                      {p.unhealthy_reason
                                        ? <span className="badge bg-danger">{p.unhealthy_reason}</span>
                                        : p.pod_phase
                                          ? <span className="badge bg-warning text-dark">{p.pod_phase}</span>
                                          : p.not_ready
                                            ? <span className="badge bg-warning text-dark">NotReady</span>
                                            : p.termination_reasons?.length > 0
                                              ? <span className="text-warning small">{p.termination_reasons.join(', ')}</span>
                                              : <span className="badge bg-success">Healthy</span>
                                      }
                                    </td>
                                    <td>
                                      {p.max_cpu_pct == null
                                        ? <span className="text-muted" title="No CPU limit/request">
                                            {p.cpu_cores > 0 ? `${p.cpu_cores} c` : 'N/A'}
                                            <span className="ms-1" style={{ fontSize: 10 }}>no limit</span>
                                          </span>
                                        : p.max_cpu_pct === 0 && p.impact_events === 0
                                          ? <span className="text-muted">N/A</span>
                                          : <>
                                              <span className={p.max_cpu_pct > 90 ? 'text-danger fw-bold' : p.max_cpu_pct > 70 ? 'text-warning' : ''}
                                                    title={p.cpu_basis ? `% of ${p.cpu_basis}` : undefined}>
                                                {p.max_cpu_pct}%{p.cpu_basis === 'request' ? ' (req)' : ''}
                                              </span>
                                              {p.cpu_cores > 0 && <span className="text-muted small ms-1">({p.cpu_cores}c)</span>}
                                            </>
                                      }
                                    </td>
                                    <td>
                                      {p.max_memory_mb === 0 && p.impact_events === 0
                                        ? <span className="text-muted">N/A</span>
                                        : <span className={p.max_memory_mb > 2048 ? 'text-danger fw-bold' : p.max_memory_mb > 1024 ? 'text-warning' : ''}>
                                            {p.max_memory_mb >= 1024 ? `${(p.max_memory_mb / 1024).toFixed(1)} GB` : `${p.max_memory_mb} MB`}
                                          </span>
                                      }
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Node Health Overview (replaces numeric stability scores) */}
                      {enhanced.node_stability?.length > 0 && (
                        <div>
                          <h6 className="fw-bold mb-3">Node Health Overview</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Node</th><th>Status</th><th>Ready</th><th>CPU %</th><th>Memory %</th><th>Disk %</th><th>Pressures</th></tr></thead>
                              <tbody>
                                {enhanced.node_stability.map((n: any, i: number) => (
                                  <tr key={i}>
                                    <td><strong>{n.node_name}</strong></td>
                                    <td>
                                      {n.stability_score >= 80
                                        ? <span className="badge bg-success">Healthy</span>
                                        : n.stability_score >= 50
                                          ? <span className="badge bg-warning text-dark">Degraded</span>
                                          : <span className="badge bg-danger">Critical</span>
                                      }
                                    </td>
                                    <td>{n.ready ? <span className="badge bg-success">Ready</span> : <span className="badge bg-danger">NotReady</span>}</td>
                                    <td><span className={n.cpu_percent > 85 ? 'text-danger fw-bold' : n.cpu_percent > 70 ? 'text-warning' : ''}>{n.cpu_percent}%</span></td>
                                    <td><span className={n.memory_percent > 85 ? 'text-danger fw-bold' : n.memory_percent > 70 ? 'text-warning' : ''}>{n.memory_percent}%</span></td>
                                    <td><span className={n.disk_percent > 85 ? 'text-danger fw-bold' : n.disk_percent > 70 ? 'text-warning' : ''}>{n.disk_percent}%</span></td>
                                    <td>{n.pressures?.length > 0 ? <span className="badge bg-warning text-dark">{n.pressure_summary}</span> : <span className="badge bg-success">None</span>}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Pod Restart Timeline */}
                      {enhanced.restart_timestamps?.length > 0 && (
                        <div>
                          <h6 className="fw-bold mb-3"><i className="material-icons-outlined align-middle me-1" style={{ fontSize: 18 }}>restart_alt</i>Pod Restart Timeline</h6>
                          <p className="text-muted small mb-2">Most recent container terminations. All timestamps are in local time.</p>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Terminated At</th><th>Pod</th><th>Namespace</th><th>Container</th><th>Reason</th><th>Exit Code</th></tr></thead>
                              <tbody>
                                {enhanced.restart_timestamps.slice(0, 20).map((rt: any, i: number) => (
                                    <tr key={i}>
                                      <td className="fw-semibold" style={{ fontSize: 12, whiteSpace: 'nowrap' }}><i className="material-icons-outlined align-middle me-1" style={{ fontSize: 13 }}>schedule</i>{fmtTs(rt.last_terminated_at)}</td>
                                      <td><code className="small">{rt.pod?.substring(0, 40)}</code></td>
                                      <td>{rt.namespace}</td>
                                      <td>{rt.container}</td>
                                      <td>{rt.reason ? <span className={`badge ${rt.reason === 'OOMKilled' ? 'bg-danger' : 'bg-warning text-dark'}`}>{rt.reason}</span> : '—'}</td>
                                      <td>{rt.exit_code != null ? <span className={`badge ${rt.exit_code === 137 ? 'bg-danger' : rt.exit_code === 0 ? 'bg-success' : 'bg-warning text-dark'}`}>{rt.exit_code}</span> : '—'}</td>
                                    </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* OOM Kill Details Table (filtered from podEvents) */}
                      {(() => {
                        const oomEvents = podEvents.filter((ev: any) => ev.restart_reason === 'OOMKilled' || ev.exit_code === 137);
                        if (oomEvents.length === 0) return null;
                        return (
                          <div className="mt-4">
                            <h6 className="fw-bold mb-3 text-danger">
                              <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 18 }}>dangerous</i>
                              OOM Kill Details ({oomEvents.length} events)
                            </h6>
                            <div className="table-responsive" style={{ maxHeight: 400, overflowY: 'auto' }}>
                              <table className="table table-sm table-bordered">
                                <thead style={{ background: '#fef2f2' }}>
                                  <tr>
                                    <th>Time</th><th>Pod</th><th>Container</th><th>Namespace</th>
                                    <th>Memory Usage</th><th>Memory Limit</th><th>Node</th>
                                    <th>Concurrent Operation</th><th>Elapsed</th><th>Logs</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {oomEvents.map((ev: any) => (
                                    <React.Fragment key={`oom-${ev.id}`}>
                                      <tr>
                                        <td className="small fw-semibold" style={{ whiteSpace: 'nowrap' }}><i className="material-icons-outlined align-middle me-1" style={{ fontSize: 12 }}>schedule</i>{fmtTs(ev.detected_at)}</td>
                                        <td><code className="small text-danger">{ev.pod_name?.substring(0, 35)}</code></td>
                                        <td>{ev.container}</td>
                                        <td>{ev.namespace}</td>
                                        <td className="fw-bold text-danger">{ev.pod_memory_mb != null ? `${ev.pod_memory_mb} MB` : '—'}</td>
                                        <td>{ev.pod_memory_limit_mb != null ? `${ev.pod_memory_limit_mb} MB` : '—'}</td>
                                        <td>{ev.node ? <code className="small">{ev.node}</code> : '—'}</td>
                                        <td>{ev.concurrent_operation ? <span className="badge bg-info">{ev.concurrent_operation}</span> : '—'}</td>
                                        <td>{ev.execution_elapsed_min != null ? `${ev.execution_elapsed_min} min` : '—'}</td>
                                        <td>
                                          {ev.log_snippet ? (
                                            <button
                                              className="btn btn-sm btn-outline-danger py-0 px-2"
                                              style={{ fontSize: '0.75rem' }}
                                              onClick={() => {
                                                setExpandedLogSnippets(prev => {
                                                  const next = new Set(prev);
                                                  if (next.has(`oom-${ev.id}`)) next.delete(`oom-${ev.id}`);
                                                  else next.add(`oom-${ev.id}`);
                                                  return next;
                                                });
                                              }}
                                            >
                                              {expandedLogSnippets.has(`oom-${ev.id}`) ? 'Hide' : 'View'}
                                            </button>
                                          ) : '—'}
                                        </td>
                                      </tr>
                                      {expandedLogSnippets.has(`oom-${ev.id}`) && ev.log_snippet && (
                                        <tr>
                                          <td colSpan={10} style={{ padding: 0 }}>
                                            <pre className="mb-0" style={{
                                              maxHeight: 200, overflow: 'auto', fontSize: '0.75rem',
                                              background: '#1e293b', color: '#e2e8f0', padding: '8px 12px',
                                              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                            }}>
                                              {ev.log_snippet}
                                            </pre>
                                          </td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}

                      {/* All Pod Restart Events with enriched data */}
                      {podEvents.length > 0 && (
                        <div className="mt-4">
                          <h6 className="fw-bold mb-3">All Restart Events ({podEvents.length})</h6>
                          <p className="text-muted small mb-2">
                            Every restart event detected during execution with memory, node, and operation context.
                          </p>
                          <div className="table-responsive" style={{ maxHeight: 500, overflowY: 'auto' }}>
                            <table className="table table-sm table-bordered">
                              <thead className="table-light">
                                <tr>
                                  <th>Time</th><th>Pod</th><th>Container</th><th>Namespace</th>
                                  <th>Restarts</th><th>Reason</th><th>Exit Code</th>
                                  <th>Memory</th><th>Node</th><th>Operation</th><th>Elapsed</th><th>Logs</th>
                                </tr>
                              </thead>
                              <tbody>
                                {podEvents.map((ev: any) => (
                                  <React.Fragment key={ev.id}>
                                    <tr style={ev.restart_reason === 'OOMKilled' || ev.exit_code === 137 ? { background: '#fef2f2' } : {}}>
                                      <td className="small fw-semibold" style={{ whiteSpace: 'nowrap' }}><i className="material-icons-outlined align-middle me-1" style={{ fontSize: 12 }}>schedule</i>{fmtTs(ev.detected_at)}</td>
                                      <td><code className="small">{ev.pod_name?.substring(0, 35)}</code></td>
                                      <td>{ev.container}</td>
                                      <td>{ev.namespace}</td>
                                      <td><span className="badge bg-warning text-dark">+{ev.new_restarts}</span></td>
                                      <td>
                                        {ev.restart_reason ? (
                                          <span className={`badge ${ev.restart_reason === 'OOMKilled' ? 'bg-danger' : ev.restart_reason === 'Error' ? 'bg-warning text-dark' : 'bg-info'}`}>
                                            {ev.restart_reason}
                                          </span>
                                        ) : '—'}
                                      </td>
                                      <td>
                                        {ev.exit_code != null ? (
                                          <span className={`badge ${ev.exit_code === 137 ? 'bg-danger' : ev.exit_code === 0 ? 'bg-success' : 'bg-warning text-dark'}`}>
                                            {ev.exit_code}
                                          </span>
                                        ) : '—'}
                                      </td>
                                      <td className="small">{ev.pod_memory_mb != null ? `${ev.pod_memory_mb}${ev.pod_memory_limit_mb != null ? `/${ev.pod_memory_limit_mb}` : ''} MB` : '—'}</td>
                                      <td className="small">{ev.node ? <code>{ev.node?.substring(0, 20)}</code> : '—'}</td>
                                      <td className="small">{ev.concurrent_operation ? <span className="badge bg-info" style={{ fontSize: 10 }}>{ev.concurrent_operation}</span> : '—'}</td>
                                      <td>{ev.execution_elapsed_min != null ? `${ev.execution_elapsed_min} min` : '—'}</td>
                                      <td>
                                        {ev.log_snippet ? (
                                          <button
                                            className="btn btn-sm btn-outline-secondary py-0 px-2"
                                            style={{ fontSize: '0.75rem' }}
                                            onClick={() => {
                                              setExpandedLogSnippets(prev => {
                                                const next = new Set(prev);
                                                if (next.has(ev.id)) next.delete(ev.id);
                                                else next.add(ev.id);
                                                return next;
                                              });
                                            }}
                                          >
                                            {expandedLogSnippets.has(ev.id) ? 'Hide' : 'View'}
                                          </button>
                                        ) : '—'}
                                      </td>
                                    </tr>
                                    {expandedLogSnippets.has(ev.id) && ev.log_snippet && (
                                      <tr>
                                        <td colSpan={12} style={{ padding: 0 }}>
                                          <pre className="mb-0" style={{
                                            maxHeight: 200, overflow: 'auto', fontSize: '0.75rem',
                                            background: '#1e293b', color: '#e2e8f0', padding: '8px 12px',
                                            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                          }}>
                                            {ev.log_snippet}
                                          </pre>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {(() => {
                        const ch = enhanced.cluster_health;
                        if (!ch) return null;
                        const hasPromRows =
                          (ch.node_conditions?.length || 0) +
                          (ch.oom_killed?.length || 0) +
                          (ch.cpu_throttling?.length || 0) +
                          (ch.container_restarts?.length || 0) +
                          (ch.pvc_health?.length || 0) > 0;
                        if (hasPromRows || (enhanced.pod_stability?.length || 0) > 0 || (enhanced.node_stability?.length || 0) > 0) return null;
                        return (
                          <div className="alert alert-success border-0 rounded-3 mb-0">
                            Live snapshot succeeded: no rows matched reporting thresholds (throttling, restarts, OOM, node pressure, or PVC usage). Your cluster may still be healthy—thresholds filter noise.
                          </div>
                        );
                      })()}
                    </>
                  ) : (
                    (() => {
                      const healthCopy = clusterHealthUnavailableCopy(
                        enhanced.cluster_health?.collection_status,
                        enhanced.cluster_health?.collection_reason
                      );
                      return (
                        <div className="text-center py-4 text-muted">
                          <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>cloud_off</i>
                          <div className="fw-semibold text-dark">{healthCopy.headline}</div>
                          <div className="small mt-2 px-2" style={{ maxWidth: 520, margin: '0 auto' }}>
                            {healthCopy.detail}
                          </div>
                          <div className="small mt-2 font-monospace">
                            status={enhanced.cluster_health?.collection_status || 'N/A'}
                            {enhanced.cluster_health?.collection_reason
                              ? ` · reason=${enhanced.cluster_health.collection_reason}`
                              : ''}
                          </div>
                          <div className="small mt-2 text-info">
                            A snapshot is taken when the run completes; reopen the report or ensure the testbed Prometheus URL is reachable from the app server.
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              )}

              {/* FAILURES TAB */}
              {activeTab === 'failures' && (
                <div>
                  {enhanced.failure_analysis?.groups?.length > 0 ? (
                    <>
                      <div className="alert alert-danger rounded-3 mb-3">
                        <strong>{enhanced.failure_analysis.total_failures}</strong> failures grouped into <strong>{enhanced.failure_analysis.unique_patterns}</strong> root cause patterns
                      </div>
                      {enhanced.failure_analysis.groups.map((group: any, idx: number) => (
                        <div key={idx} className="border rounded-3 mb-3" style={{ borderLeft: '4px solid #ef4444' }}>
                          <div
                            className="p-3 d-flex justify-content-between align-items-center"
                            style={{ cursor: 'pointer' }}
                            onClick={(e) => {
                              const body = (e.currentTarget as HTMLElement).nextElementSibling;
                              if (body) body.classList.toggle('d-none');
                            }}
                          >
                            <div>
                              <span className="me-2" style={{ fontSize: 12 }}>▶</span>
                              <strong>{group.count}x — {group.entity_types?.join(', ')} {group.operations?.join(', ')}</strong>
                            </div>
                            <div className="d-flex gap-1 align-items-center">
                              {group.http_status_distribution && Object.entries(group.http_status_distribution).map(([code, cnt]: [string, any]) => (
                                <span key={code} className={`badge rounded-pill ${
                                  code.startsWith('5') ? 'bg-danger' : code.startsWith('4') ? 'bg-warning text-dark' : 'bg-secondary'
                                }`}>{code}: {cnt}</span>
                              ))}
                              <span className="badge bg-danger rounded-pill">{group.count}</span>
                            </div>
                          </div>
                          <div className="d-none border-top px-3 pb-3 pt-2" style={{ background: '#fafafa' }}>
                            <div className="mb-2">
                              <code className="small text-muted">{group.sample_error?.substring(0, 200)}</code>
                            </div>
                            <div className="alert alert-warning rounded-3 mb-2 py-2">
                              <strong>Root Cause:</strong> {group.root_cause_hint}
                            </div>
                            {(group.first_occurrence || group.last_occurrence) && (
                              <div className="text-muted small mb-2"><i className="material-icons-outlined align-middle me-1" style={{ fontSize: 13 }}>schedule</i>First seen: <strong>{fmtTs(group.first_occurrence)}</strong> · Last seen: <strong>{fmtTs(group.last_occurrence)}</strong></div>
                            )}
                                {group.sample_failures?.length > 0 && (
                              <div className="mt-2">
                                <div className="small text-muted fw-bold mb-2 text-uppercase">Sample Failures ({group.sample_failures.length} of {group.count})</div>
                                {group.sample_failures.map((sf: any, si: number) => (
                                  <div key={si} className="border rounded-2 p-2 mb-2 bg-white">
                                    <div className="d-flex justify-content-between flex-wrap gap-1 mb-1">
                                      <div>
                                        <span className="fw-bold small">{sf.entity_type}.{sf.operation} <code className="ms-1">{sf.entity_name?.substring(0, 40)}</code></span>
                                        <span className="text-muted ms-2" style={{ fontSize: 11 }}><i className="material-icons-outlined align-middle" style={{ fontSize: 12 }}>schedule</i> {fmtTs(sf.timestamp)}{sf.iteration != null && ` · Iter #${sf.iteration}`}</span>
                                      </div>
                                      <div className="d-flex gap-1">
                                        {sf.http_status_code && (
                                          <span className={`badge rounded-pill ${sf.http_status_code >= 500 ? 'bg-danger' : sf.http_status_code >= 400 ? 'bg-warning text-dark' : 'bg-secondary'}`}>HTTP {sf.http_status_code}</span>
                                        )}
                                        {sf.http_method && <span className="badge bg-info rounded-pill">{sf.http_method}</span>}
                                        {sf.duration_seconds != null && <span className="text-muted" style={{ fontSize: 11 }}>{sf.duration_seconds.toFixed(2)}s</span>}
                                      </div>
                                    </div>
                                    {sf.api_url && <div className="small text-muted mb-1"><strong>URL:</strong> <code>{sf.api_url}</code></div>}
                                    {sf.error && <div className="small text-danger mb-1">{sf.error.substring(0, 300)}</div>}
                                    {sf.request_payload && (
                                      <details className="mt-1 mb-1">
                                        <summary className="small fw-bold text-muted" style={{ cursor: 'pointer' }}>Request Payload</summary>
                                        <pre className="p-2 rounded small mt-1 mb-0" style={{ maxHeight: 200, overflow: 'auto', background: '#1e293b', color: '#e2e8f0', fontSize: 11 }}>
                                          {typeof sf.request_payload === 'string' ? sf.request_payload : JSON.stringify(sf.request_payload, null, 2)}
                                        </pre>
                                      </details>
                                    )}
                                    {sf.response_body && (
                                      <details className="mt-1 mb-1">
                                        <summary className="small fw-bold text-muted" style={{ cursor: 'pointer' }}>Response Body</summary>
                                        <pre className="p-2 rounded small mt-1 mb-0" style={{ maxHeight: 200, overflow: 'auto', background: '#1e293b', color: '#e2e8f0', fontSize: 11 }}>
                                          {typeof sf.response_body === 'string' ? sf.response_body : JSON.stringify(sf.response_body, null, 2)}
                                        </pre>
                                      </details>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>check_circle</i>
                      <div>No failures detected</div>
                    </div>
                  )}
                </div>
              )}

              {/* LATENCY TAB */}
              {activeTab === 'latency' && (
                <div>
                  {/* Execution Mode Trust Banner */}
                  {enhanced.execution_mode_summary?.available && enhanced.execution_mode_summary.warning && (
                    <div className="alert alert-warning rounded-3 mb-3 d-flex align-items-center gap-2">
                      <i className="material-icons-outlined">warning</i>
                      <div>
                        <strong>Trust Level: {enhanced.execution_mode_summary.trust_level}</strong> — {enhanced.execution_mode_summary.warning}
                      </div>
                    </div>
                  )}

                  {enhanced.entity_latency_breakdown?.available && enhanced.entity_latency_breakdown.entity_latencies?.length ? (
                    <>
                      <h6 className="fw-bold mb-3">Per-Entity Latency Breakdown</h6>
                      <div className="table-responsive">
                        <table className="table table-sm table-hover align-middle">
                          <thead className="table-light">
                            <tr>
                              <th>Entity.Operation</th>
                              <th className="text-end">Count</th>
                              <th className="text-end">Avg (s)</th>
                              <th className="text-end">P50 (s)</th>
                              <th className="text-end">P95 (s)</th>
                              <th className="text-end">Min (s)</th>
                              <th className="text-end">Max (s)</th>
                              <th className="text-center">Degraded?</th>
                            </tr>
                          </thead>
                          <tbody>
                            {enhanced.entity_latency_breakdown.entity_latencies.map((row, idx) => (
                              <tr key={idx} className={row.degradation_detected ? 'table-warning' : ''}>
                                <td><code className="small">{row.entity_operation}</code></td>
                                <td className="text-end">{row.count}</td>
                                <td className="text-end">{row.avg_seconds}</td>
                                <td className="text-end">{row.p50_seconds}</td>
                                <td className="text-end fw-bold">{row.p95_seconds}</td>
                                <td className="text-end text-muted">{row.min_seconds}</td>
                                <td className="text-end text-muted">{row.max_seconds}</td>
                                <td className="text-center">
                                  {row.degradation_detected
                                    ? <span className="badge bg-danger">Yes</span>
                                    : <span className="badge bg-success">No</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Dependency Cascade Warnings */}
                      {enhanced.dependency_cascade?.available && enhanced.dependency_cascade.cascades?.length ? (
                        <div className="mt-4">
                          <h6 className="fw-bold mb-3 text-warning">
                            <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 18 }}>link_off</i>
                            Dependency Cascade Failures ({enhanced.dependency_cascade.total_cascade_patterns})
                          </h6>
                          {enhanced.dependency_cascade.cascades.map((cascade, idx) => (
                            <div key={idx} className="alert alert-warning rounded-3 py-2 mb-2">
                              <strong>{cascade.entity_type}</strong> ({cascade.failure_count} failures) — likely caused by upstream failures in{' '}
                              {cascade.failed_dependencies.map((dep, di) => (
                                <span key={di}>
                                  <strong>{dep.entity_type}</strong> ({dep.failure_count}){di < cascade.failed_dependencies.length - 1 ? ', ' : ''}
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>timer</i>
                      <div>No latency data available</div>
                    </div>
                  )}
                </div>
              )}

              {/* ERROR CODES TAB */}
              {activeTab === 'errors' && (
                <div>
                  {enhanced.error_code_breakdown?.available ? (
                    <>
                      <div className="alert alert-danger rounded-3 mb-3">
                        <strong>{enhanced.error_code_breakdown.total_failures}</strong> total failures analyzed
                      </div>

                      <div className="row g-3 mb-4">
                        <div className="col-md-6">
                          <h6 className="fw-bold mb-2">HTTP Status Code Distribution</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-hover">
                              <thead className="table-light">
                                <tr>
                                  <th>HTTP Code</th>
                                  <th>Category</th>
                                  <th className="text-end">Count</th>
                                </tr>
                              </thead>
                              <tbody>
                                {enhanced.error_code_breakdown.http_code_distribution?.map((row, idx) => (
                                  <tr key={idx}>
                                    <td>
                                      <span className={`badge ${row.category === 'server_error' ? 'bg-danger' : row.category === 'client_error' ? 'bg-warning text-dark' : 'bg-secondary'}`}>
                                        {row.code}
                                      </span>
                                    </td>
                                    <td className="small text-muted">{row.category.replace('_', ' ')}</td>
                                    <td className="text-end fw-bold">{row.count}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div className="col-md-6">
                          <h6 className="fw-bold mb-2">Error Type Distribution</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-hover">
                              <thead className="table-light">
                                <tr>
                                  <th>Error Type</th>
                                  <th className="text-end">Count</th>
                                </tr>
                              </thead>
                              <tbody>
                                {enhanced.error_code_breakdown.error_type_distribution?.map((row, idx) => (
                                  <tr key={idx}>
                                    <td><code className="small">{row.error_type}</code></td>
                                    <td className="text-end fw-bold">{row.count}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>

                      {enhanced.error_code_breakdown.sample_errors && enhanced.error_code_breakdown.sample_errors.length > 0 && (
                        <div className="mt-3">
                          <h6 className="fw-bold mb-2">Sample Errors (first 20)</h6>
                          <div className="table-responsive" style={{ maxHeight: 400, overflowY: 'auto' }}>
                            <table className="table table-sm table-hover align-middle" style={{ fontSize: '0.8rem' }}>
                              <thead className="table-light sticky-top">
                                <tr>
                                  <th>Iter</th>
                                  <th>Entity.Op</th>
                                  <th>HTTP</th>
                                  <th>Type</th>
                                  <th>Error</th>
                                </tr>
                              </thead>
                              <tbody>
                                {enhanced.error_code_breakdown.sample_errors.map((err: any, idx: number) => (
                                  <tr key={idx}>
                                    <td>{err.iteration ?? '—'}</td>
                                    <td><code>{err.entity_type}.{err.operation}</code></td>
                                    <td><span className="badge bg-secondary">{err.http_code}</span></td>
                                    <td className="text-muted">{err.error_type}</td>
                                    <td className="text-truncate" style={{ maxWidth: 300 }} title={err.error_snippet}>{err.error_snippet}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>check_circle</i>
                      <div>No failures detected — no error codes to analyze</div>
                    </div>
                  )}
                </div>
              )}

              {/* CAPACITY TAB */}
              {activeTab === 'capacity' && (
                <div>
                  <div className="alert alert-light border rounded-3 mb-3 py-2 px-3 d-flex align-items-center gap-2" style={{ fontSize: 13 }}>
                    <i className="material-icons-outlined text-info" style={{ fontSize: 18 }}>info</i>
                    <span>Capacity planning estimates how much CPU/memory each operation type consumes, based on resource deltas during execution. Use this to predict cluster limits.</span>
                  </div>
                  {enhanced.capacity_planning?.available ? (
                    <>
                      <div className="row g-3 mb-4">
                        <div className="col-md-3">
                          <div className="card rounded-3 border h-100">
                            <div className="card-body text-center p-3">
                              <div className="h2 fw-bold text-primary mb-1">{enhanced.capacity_planning.total_ops_executed}</div>
                              <div className="small text-muted fw-semibold">Ops Executed</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="card rounded-3 border h-100">
                            <div className="card-body text-center p-3">
                              <div className="h2 fw-bold text-info mb-1">{enhanced.capacity_planning.cpu_per_operation}%</div>
                              <div className="small text-muted fw-semibold">CPU per Op</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="card rounded-3 border h-100">
                            <div className="card-body text-center p-3">
                              <div className="h2 fw-bold text-warning mb-1">{enhanced.capacity_planning.memory_per_operation}%</div>
                              <div className="small text-muted fw-semibold">Memory per Op</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="card rounded-3 border h-100">
                            <div className="card-body text-center p-3">
                              <div className="h2 fw-bold text-danger mb-1">{enhanced.capacity_planning.bottleneck?.toUpperCase()}</div>
                              <div className="small text-muted fw-semibold">Bottleneck</div>
                            </div>
                          </div>
                        </div>
                      </div>
                      {enhanced.capacity_planning.estimated_total_capacity_ops && (
                        <div className="alert alert-info rounded-3 mb-3">
                          <strong>Estimated Maximum Capacity:</strong> ~{enhanced.capacity_planning.estimated_total_capacity_ops} operations before reaching target threshold
                        </div>
                      )}
                      {enhanced.capacity_planning.simulation_warning && (
                        <div className="alert alert-warning rounded-3 mb-3">
                          <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 18 }}>science</i>
                          {enhanced.capacity_planning.simulation_warning}
                        </div>
                      )}
                      <div className="alert alert-light rounded-3 border">
                        <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 18 }}>tips_and_updates</i>
                        {enhanced.capacity_planning.recommendation}
                      </div>
                      {enhanced.capacity_planning.entities_created && Object.keys(enhanced.capacity_planning.entities_created).length > 0 && (
                        <div className="mt-3">
                          <h6 className="fw-bold mb-2">Entities Created</h6>
                          <div className="d-flex gap-2 flex-wrap">
                            {Object.entries(enhanced.capacity_planning.entities_created).map(([etype, count]) => (
                              <span key={etype} className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 rounded-pill px-3 py-2">
                                {etype}: {count as number}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>info</i>
                      <div>Not enough data for capacity planning</div>
                    </div>
                  )}
                </div>
              )}

              {/* ITERATIONS TIMELINE TAB */}
              {activeTab === 'iterations' && (
                <div>
                  {enhanced.iteration_timeline?.iterations?.length ? (() => {
                    const itl = enhanced.iteration_timeline;
                    return (
                    <>
                      <p className="text-muted small mb-3">
                        Each row is one controller <strong>iteration</strong> (metrics sample). <strong>Ops</strong> = operations attributed to that iteration
                        (stored <code>iteration</code> on each op when available; otherwise time-window matching). Expand a row for the full list and
                        <strong> counts by entity × operation</strong>.
                      </p>
                      <div className="d-flex gap-3 mb-3 flex-wrap">
                        <span className="badge bg-primary bg-opacity-10 text-primary border px-3 py-2">Total Iterations: <strong>{itl.total_iterations}</strong></span>
                        <span className="badge bg-danger bg-opacity-10 text-danger border px-3 py-2">Spike Iterations: <strong>{itl.total_spikes}</strong></span>
                        <span className="badge bg-info bg-opacity-10 text-info border px-3 py-2">Total Ops: <strong>{itl.summary?.total_ops || 0}</strong></span>
                        <span className="badge bg-success bg-opacity-10 text-success border px-3 py-2">Creates: <strong>{itl.summary?.total_creates || 0}</strong></span>
                        <span className="badge bg-warning bg-opacity-10 text-dark border px-3 py-2">Deletes: <strong>{itl.summary?.total_deletes || 0}</strong></span>
                        <span className="badge bg-secondary bg-opacity-10 text-dark border px-3 py-2">Avg Ops/Iter: <strong>{itl.summary?.avg_ops_per_iteration || 0}</strong></span>
                      </div>
                      <div className="table-responsive" style={{ maxHeight: 600, overflowY: 'auto' }}>
                        <table className="table table-sm table-hover align-middle mb-0">
                          <thead className="table-light sticky-top">
                            <tr>
                              <th style={{ width: 40 }}></th>
                              <th>Iter</th>
                              <th>Time</th>
                              <th>CPU</th>
                              <th>Mem</th>
                              <th>CPU Δ</th>
                              <th>Mem Δ</th>
                              <th>Ops</th>
                              <th>Creates</th>
                              <th>Deletes</th>
                              <th>Success</th>
                              <th>Failed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itl.iterations.map((iter: any, idx: number) => (
                              <React.Fragment key={idx}>
                                <tr
                                  style={{
                                    cursor: iter.operations_count > 0 ? 'pointer' : 'default',
                                    background: iter.is_spike
                                      ? iter.spike_risk === 'high' ? '#fef2f2' : iter.spike_risk === 'medium' ? '#fffbeb' : '#f0fdf4'
                                      : undefined,
                                    borderLeft: iter.is_spike ? `4px solid ${iter.spike_risk === 'high' ? '#ef4444' : iter.spike_risk === 'medium' ? '#f59e0b' : '#22c55e'}` : '4px solid transparent',
                                  }}
                                  onClick={() => {
                                    const hasDetail = (iter.operations_count > 0) || (iter.operation_breakdown && Object.keys(iter.operation_breakdown).length > 0);
                                    if (hasDetail) {
                                      setExpandedIterations(prev => {
                                        const next = new Set(prev);
                                        next.has(iter.iteration) ? next.delete(iter.iteration) : next.add(iter.iteration);
                                        return next;
                                      });
                                    }
                                  }}
                                >
                                  <td>
                                    {((iter.operations_count > 0) || (iter.operation_breakdown && Object.keys(iter.operation_breakdown).length > 0)) && (
                                      <i className="material-icons-outlined" style={{ fontSize: 16 }}>
                                        {expandedIterations.has(iter.iteration) ? 'expand_less' : 'expand_more'}
                                      </i>
                                    )}
                                  </td>
                                  <td>
                                    <strong>#{iter.iteration}</strong>
                                    {iter.is_spike && <span className={`badge ms-1 ${iter.spike_risk === 'high' ? 'bg-danger' : iter.spike_risk === 'medium' ? 'bg-warning text-dark' : 'bg-success'}`} style={{ fontSize: 9 }}>SPIKE</span>}
                                  </td>
                                  <td className="text-muted small">{fmtTs(iter.timestamp)}</td>
                                  <td><strong>{iter.cpu}%</strong></td>
                                  <td><strong>{iter.memory}%</strong></td>
                                  <td style={{ color: iter.cpu_delta > 0 ? '#ef4444' : iter.cpu_delta < -2 ? '#22c55e' : '#666' }}>
                                    {iter.cpu_delta > 0 ? '+' : ''}{iter.cpu_delta}%
                                  </td>
                                  <td style={{ color: iter.memory_delta > 0 ? '#ef4444' : iter.memory_delta < -2 ? '#22c55e' : '#666' }}>
                                    {iter.memory_delta > 0 ? '+' : ''}{iter.memory_delta}%
                                  </td>
                                  <td><span className="badge bg-primary rounded-pill">{iter.operations_count}</span></td>
                                  <td>{iter.creates > 0 && <span className="badge bg-info bg-opacity-25 text-info">{iter.creates}</span>}</td>
                                  <td>{iter.deletes > 0 && <span className="badge bg-warning bg-opacity-25 text-dark">{iter.deletes}</span>}</td>
                                  <td>{iter.operations_success > 0 && <span className="text-success fw-bold">{iter.operations_success}</span>}</td>
                                  <td>{iter.operations_failed > 0 && <span className="text-danger fw-bold">{iter.operations_failed}</span>}</td>
                                </tr>
                                {expandedIterations.has(iter.iteration) && ((iter.operations?.length > 0) || (iter.operation_breakdown && Object.keys(iter.operation_breakdown).length > 0)) && (
                                  <tr>
                                    <td colSpan={12} style={{ background: '#f8fafc', padding: '8px 16px 8px 48px' }}>
                                      <div className="small">
                                        {Object.keys(iter.operation_breakdown || {}).length > 0 && (
                                          <div className="mb-3">
                                            <strong>Counts by entity × operation (this iteration):</strong>
                                            <table className="table table-sm table-bordered mt-1 mb-0" style={{ fontSize: 12 }}>
                                              <thead className="table-light"><tr><th>Entity.operation</th><th>Count</th><th>OK</th><th>Fail</th><th>Avg duration (s)</th></tr></thead>
                                              <tbody>
                                                {Object.entries(iter.operation_breakdown).map(([key, val]: [string, any]) => (
                                                  <tr key={key}>
                                                    <td><code>{key}</code></td>
                                                    <td><span className="badge bg-primary rounded-pill">{val.count}</span></td>
                                                    <td className="text-success">{val.success}</td>
                                                    <td className="text-danger">{val.failed}</td>
                                                    <td>{val.avg_duration ?? '—'}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                        {iter.operations?.length > 0 && (
                                          <>
                                            <strong>Operation instances (up to 20):</strong>
                                            <table className="table table-sm table-bordered mt-1 mb-0" style={{ fontSize: 12 }}>
                                              <thead className="table-light"><tr><th>Timestamp</th><th>Entity</th><th>Operation</th><th>Name</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead>
                                              <tbody>
                                                {iter.operations.map((op: any, oi: number) => (
                                                  <tr key={oi}>
                                                    <td className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtTs(op.timestamp)}</td>
                                                    <td>{op.entity_type}</td>
                                                    <td>{op.operation}</td>
                                                    <td><code>{op.entity_name?.substring(0, 30)}</code></td>
                                                    <td><span className={`badge ${op.status === 'SUCCESS' ? 'bg-success' : op.status === 'FAILED' ? 'bg-danger' : 'bg-secondary'} rounded-pill`}>{op.status}</span></td>
                                                    <td>{op.duration}s</td>
                                                    <td className="text-danger text-truncate" style={{ maxWidth: 200 }} title={op.error || ''}>{op.status === 'FAILED' ? (op.error || op.error_type || 'Unknown error') : ''}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                    );
                  })() : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>format_list_numbered</i>
                      <div>No iteration data available</div>
                    </div>
                  )}
                </div>
              )}

              {/* OPERATION HEATMAP TAB */}
              {activeTab === 'heatmap' && (
                <div>
                  {enhanced.operation_heatmap?.entity_ops?.length > 0 ? (
                    <>
                      <p className="text-muted small mb-3">Operation frequency and duration across time buckets. Darker = more operations. Red border = failures detected.</p>
                      <div className="table-responsive">
                        <table className="table table-sm table-bordered mb-0" style={{ fontSize: 12 }}>
                          <thead className="table-light">
                            <tr>
                              <th style={{ minWidth: 160 }}>Operation</th>
                              <th style={{ minWidth: 50 }}>Total</th>
                              {enhanced.operation_heatmap.buckets.map((b: string, bi: number) => (
                                <th key={bi} className="text-center" style={{ minWidth: 60 }}>{b}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {enhanced.operation_heatmap.entity_ops.map((eo: string) => {
                              const rowData = enhanced.operation_heatmap.data[eo] || {};
                              const totalCount = Object.values(rowData).reduce((sum: number, cell: any) => sum + (cell?.count || 0), 0);
                              const maxCount = Math.max(...Object.values(rowData).map((cell: any) => cell?.count || 0), 1);
                              return (
                                <tr key={eo}>
                                  <td><strong>{eo}</strong></td>
                                  <td className="text-center"><span className="badge bg-primary rounded-pill">{totalCount}</span></td>
                                  {enhanced.operation_heatmap.buckets.map((_: string, bi: number) => {
                                    const cell = rowData[bi] || { count: 0, avg_duration: 0, failures: 0, failure_rate: 0 };
                                    const intensity = cell.count > 0 ? Math.max(0.1, cell.count / maxCount) : 0;
                                    const hasFails = cell.failures > 0;
                                    return (
                                      <td key={bi} className="text-center" style={{
                                        background: cell.count > 0 ? `rgba(102, 126, 234, ${intensity})` : undefined,
                                        color: intensity > 0.6 ? 'white' : undefined,
                                        border: hasFails ? '2px solid #ef4444' : undefined,
                                      }} title={`${cell.count} ops, avg ${cell.avg_duration}s${hasFails ? `, ${cell.failures} failed (${cell.failure_rate}%)` : ''}`}>
                                        {cell.count > 0 ? (
                                          <div>
                                            <div className="fw-bold">{cell.count}</div>
                                            <div style={{ fontSize: 10 }}>{cell.avg_duration}s</div>
                                          </div>
                                        ) : '-'}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="d-flex gap-3 mt-2 small text-muted">
                        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(102,126,234,0.3)', borderRadius: 2 }}></span> Low activity</span>
                        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(102,126,234,0.8)', borderRadius: 2 }}></span> High activity</span>
                        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#fff', border: '2px solid #ef4444', borderRadius: 2 }}></span> Has failures</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>grid_on</i>
                      <div>No heatmap data available</div>
                    </div>
                  )}
                </div>
              )}

              {/* TIMELINE TAB */}
              {activeTab === 'timeline' && (
                <div>
                  {report?.event_timeline?.length ? (
                    <>
                      <p className="text-muted small mb-3">Chronological log of every significant event during execution — operations, threshold events, pod restarts, anomalies, cleanup.</p>
                      <div className="table-responsive" style={{ maxHeight: 600, overflowY: 'auto' }}>
                        <table className="table table-sm table-hover align-middle mb-0">
                          <thead className="table-light sticky-top">
                            <tr><th>Time</th><th>Elapsed</th><th>Type</th><th>Severity</th><th>Title</th><th>Details</th></tr>
                          </thead>
                          <tbody>
                            {report.event_timeline.map((ev, i) => (
                              <tr key={ev.event_id || i} style={{
                                background: ev.severity === 'error' ? '#fef2f2' : ev.severity === 'warning' ? '#fffbeb' : ev.severity === 'success' ? '#f0fdf4' : undefined,
                              }}>
                                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : '—'}</td>
                                <td style={{ fontSize: 12 }}>{Math.round(ev.elapsed_seconds)}s</td>
                                <td><span className="badge bg-light text-dark border" style={{ fontSize: 10 }}>{ev.event_type}</span></td>
                                <td><span style={{ fontSize: 11, fontWeight: 600, color: ev.severity === 'error' ? '#ef4444' : ev.severity === 'warning' ? '#f59e0b' : ev.severity === 'success' ? '#22c55e' : '#64748b' }}>{ev.severity}</span></td>
                                <td style={{ fontSize: 13 }}>{ev.title}</td>
                                <td style={{ fontSize: 11, color: '#64748b' }}>
                                  {ev.entity_type}{ev.operation ? `.${ev.operation}` : ''}{ev.pod_name ? ` pod=${ev.pod_name}` : ''}{ev.operation_id ? ` ${ev.operation_id}` : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>schedule</i>
                      <div>No timeline events available</div>
                    </div>
                  )}
                </div>
              )}

              {/* RESOURCES TAB */}
              {activeTab === 'resources' && (
                <div>
                  {report?.resource_lifecycle ? (
                    <>
                      <div className="row g-3 mb-3">
                        <div className="col"><div className="card rounded-3 border h-100"><div className="card-body text-center p-3"><div className="h3 fw-bold text-primary mb-1">{report.resource_lifecycle.total_created}</div><div className="small text-muted fw-semibold">Created</div></div></div></div>
                        <div className="col"><div className="card rounded-3 border h-100"><div className="card-body text-center p-3"><div className="h3 fw-bold text-info mb-1">{report.resource_lifecycle.deleted_during_execution}</div><div className="small text-muted fw-semibold">Deleted (Exec)</div></div></div></div>
                        <div className="col"><div className="card rounded-3 border h-100"><div className="card-body text-center p-3"><div className="h3 fw-bold text-success mb-1">{report.resource_lifecycle.cleanup_success}</div><div className="small text-muted fw-semibold">Cleanup OK</div></div></div></div>
                        <div className="col"><div className="card rounded-3 border h-100"><div className="card-body text-center p-3"><div className={`h3 fw-bold mb-1 ${report.resource_lifecycle.cleanup_failed > 0 ? 'text-danger' : 'text-success'}`}>{report.resource_lifecycle.cleanup_failed}</div><div className="small text-muted fw-semibold">Cleanup Failed</div></div></div></div>
                        <div className="col"><div className="card rounded-3 border h-100"><div className="card-body text-center p-3"><div className={`h3 fw-bold mb-1 ${report.resource_lifecycle.potentially_leaked > 0 ? 'text-danger' : 'text-success'}`}>{report.resource_lifecycle.potentially_leaked}</div><div className="small text-muted fw-semibold">Leaked</div></div></div></div>
                      </div>
                      <div className={`alert ${report.resource_lifecycle.potentially_leaked === 0 ? 'alert-success' : 'alert-danger'} rounded-3 text-center fw-semibold`}>
                        {report.resource_lifecycle.leak_verdict}
                      </div>
                      {report.resource_lifecycle.resources?.length > 0 && (
                        <div className="table-responsive" style={{ maxHeight: 400, overflowY: 'auto' }}>
                          <table className="table table-sm table-hover align-middle mb-0">
                            <thead className="table-light sticky-top"><tr><th>Type</th><th>Name</th><th>UUID</th><th>Created</th><th>Deleted</th><th>Cleanup</th></tr></thead>
                            <tbody>
                              {report.resource_lifecycle.resources.map((r, i) => (
                                <tr key={i}>
                                  <td>{r.entity_type}</td>
                                  <td>{r.entity_name}</td>
                                  <td style={{ fontSize: 11, fontFamily: 'monospace' }}>{r.entity_uuid?.slice(0, 12)}…</td>
                                  <td style={{ fontSize: 12 }}>{r.created_at ? new Date(r.created_at).toLocaleTimeString() : '—'}</td>
                                  <td style={{ fontSize: 12 }}>{r.deleted_at ? new Date(r.deleted_at).toLocaleTimeString() : '—'}</td>
                                  <td><span className={`badge ${r.cleanup_status === 'cleanup_success' ? 'bg-success bg-opacity-10 text-success' : r.cleanup_status === 'cleanup_failed' ? 'bg-danger bg-opacity-10 text-danger' : 'bg-light text-dark'}`} style={{ fontSize: 10 }}>{r.cleanup_status}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>inventory_2</i>
                      <div>No resource lifecycle data available</div>
                    </div>
                  )}
                </div>
              )}

              {/* CONFIG TAB */}
              {activeTab === 'config' && (
                <div>
                  <h6 className="fw-semibold mb-3">Execution Configuration</h6>
                  <div className="table-responsive">
                    <table className="table table-sm mb-0">
                      <tbody>
                        <tr><td className="fw-semibold" style={{ width: 200 }}>Execution ID</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{report?.execution_id}</td></tr>
                        <tr><td className="fw-semibold">Testbed</td><td>{report?.testbed_label}</td></tr>
                        <tr><td className="fw-semibold">CPU Threshold</td><td>{report?.target_config?.cpu_threshold}%</td></tr>
                        <tr><td className="fw-semibold">Memory Threshold</td><td>{report?.target_config?.memory_threshold}%</td></tr>
                        <tr><td className="fw-semibold">Stop Condition</td><td>{report?.target_config?.stop_condition}</td></tr>
                        <tr><td className="fw-semibold">Start Time</td><td>{report?.start_time ? new Date(report.start_time).toLocaleString() : '—'}</td></tr>
                        <tr><td className="fw-semibold">End Time</td><td>{report?.end_time ? new Date(report.end_time).toLocaleString() : '—'}</td></tr>
                        <tr><td className="fw-semibold">Duration</td><td>{report?.duration_minutes?.toFixed(1)} min</td></tr>
                      </tbody>
                    </table>
                  </div>

                  {report?.data_quality && (
                    <>
                      <h6 className="fw-semibold mt-4 mb-3">Data Quality</h6>
                      <div className={`alert ${report.data_quality.score === 'HIGH' ? 'alert-success' : report.data_quality.score === 'MEDIUM' ? 'alert-warning' : 'alert-danger'} rounded-3 d-flex align-items-center gap-2`}>
                        <strong>Score: {report.data_quality.score}</strong>
                        <span className="ms-2 small text-muted">
                          {report.data_quality.operations_recorded} ops, {report.data_quality.metrics_samples} metric samples, {report.data_quality.real_operations_percent?.toFixed(0)}% real
                        </span>
                      </div>
                      {report.data_quality.issues.length > 0 && (
                        <ul className="small text-muted mt-2">
                          {report.data_quality.issues.map((iss, i) => <li key={i}>{iss}</li>)}
                        </ul>
                      )}
                    </>
                  )}

                  {report?.metrics_stats?.cpu && (
                    <>
                      <h6 className="fw-semibold mt-4 mb-3">Metrics Statistics</h6>
                      <div className="table-responsive">
                        <table className="table table-sm table-bordered mb-0" style={{ fontSize: 13 }}>
                          <thead className="table-light"><tr><th>Metric</th><th>Start of Test</th><th>Min</th><th>Avg</th><th>P50</th><th>P95</th><th>Max</th><th>End of Test</th><th>Samples</th></tr></thead>
                          <tbody>
                            <tr><td className="fw-semibold">CPU %</td><td>{report.metrics_stats.cpu.baseline}</td><td>{report.metrics_stats.cpu.min}</td><td>{report.metrics_stats.cpu.avg}</td><td>{report.metrics_stats.cpu.p50}</td><td>{report.metrics_stats.cpu.p95}</td><td>{report.metrics_stats.cpu.max}</td><td>{report.metrics_stats.cpu.final}</td><td>{report.metrics_stats.cpu.samples}</td></tr>
                            {report.metrics_stats.memory && <tr><td className="fw-semibold">Memory %</td><td>{report.metrics_stats.memory.baseline}</td><td>{report.metrics_stats.memory.min}</td><td>{report.metrics_stats.memory.avg}</td><td>{report.metrics_stats.memory.p50}</td><td>{report.metrics_stats.memory.p95}</td><td>{report.metrics_stats.memory.max}</td><td>{report.metrics_stats.memory.final}</td><td>{report.metrics_stats.memory.samples}</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Target Configuration Card */}
        <div className="card rounded-4 shadow-none border mb-3">
          <div className="card-header bg-transparent border-bottom p-4">
            <h5 className="mb-0 d-flex align-items-center gap-2">
              <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                width: 40,
                height: 40,
                background: 'linear-gradient(135deg, #0078d4 0%, #005a9e 100%)'
              }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>track_changes</i>
              </div>
              <span className="fw-semibold">Target Configuration</span>
            </h5>
          </div>
          <div className="card-body p-4">
            <div className="row g-4">
              <div className="col-md-4">
                <label className="form-label fw-semibold mb-3 d-flex align-items-center gap-2">
                  <i className="material-icons-outlined text-info" style={{ fontSize: 20 }}>memory</i>
                  CPU Threshold
                </label>
                <div className="progress rounded-4" style={{ height: 32 }}>
                  <div 
                    className="progress-bar bg-info progress-bar-striped progress-bar-animated" 
                    style={{ width: `${report.target_config?.cpu_threshold || 0}%` }}
                  >
                    {report.target_config?.cpu_threshold || 0}%
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold mb-3 d-flex align-items-center gap-2">
                  <i className="material-icons-outlined text-warning" style={{ fontSize: 20 }}>storage</i>
                  Memory Threshold
                </label>
                <div className="progress rounded-4" style={{ height: 32 }}>
                  <div 
                    className="progress-bar bg-warning progress-bar-striped progress-bar-animated" 
                    style={{ width: `${report.target_config?.memory_threshold || 0}%` }}
                  >
                    {report.target_config?.memory_threshold || 0}%
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold mb-3 d-flex align-items-center gap-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>settings</i>
                  Stop Condition
                </label>
                <div>
                  <span className="badge bg-secondary rounded-pill px-3 py-2" style={{ fontSize: '1em' }}>
                    {(report.target_config?.stop_condition || 'any').toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Metrics Summary Card — start / final; uses enhanced effective_metrics when stored finals were zero */}
        <div className="card rounded-4 shadow-none border mb-3">
          <div className="card-header bg-transparent border-bottom p-4">
            <h5 className="mb-0 d-flex align-items-center gap-2">
              <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                width: 40,
                height: 40,
                background: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)'
              }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>trending_up</i>
              </div>
              <span className="fw-semibold">Metrics Summary</span>
            </h5>
            {enhanced?.effective_metrics?.resolution_note && enhanced.effective_metrics.resolution_note !== 'stored' && (
              <p className="text-muted small mb-0 mt-2">
                Final/start values shown using last/first <code>metrics_history</code> samples when stored values were missing ({enhanced.effective_metrics.resolution_note}).
              </p>
            )}
          </div>
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th className="ps-4">Metric</th>
                    <th className="text-center">Start of Test</th>
                    <th className="text-center pe-4">End of Test</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="ps-4">
                      <div className="d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-info" style={{ fontSize: 20 }}>memory</i>
                        <strong>CPU Usage</strong>
                      </div>
                    </td>
                    <td className="text-center">
                      <span className="badge bg-secondary rounded-pill px-3 py-2">
                        {(enhanced?.effective_metrics?.baseline?.cpu_percent ?? report.baseline_metrics?.cpu_percent ?? 0).toFixed(1)}%
                      </span>
                    </td>
                    <td className="text-center pe-4">
                      <span className="badge bg-info rounded-pill px-3 py-2">
                        {(enhanced?.effective_metrics?.final?.cpu_percent ?? report.current_metrics?.cpu_percent ?? 0).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="ps-4">
                      <div className="d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-warning" style={{ fontSize: 20 }}>storage</i>
                        <strong>Memory Usage</strong>
                      </div>
                    </td>
                    <td className="text-center">
                      <span className="badge bg-secondary rounded-pill px-3 py-2">
                        {(enhanced?.effective_metrics?.baseline?.memory_percent ?? report.baseline_metrics?.memory_percent ?? 0).toFixed(1)}%
                      </span>
                    </td>
                    <td className="text-center pe-4">
                      <span className="badge bg-warning rounded-pill px-3 py-2">
                        {(enhanced?.effective_metrics?.final?.memory_percent ?? report.current_metrics?.memory_percent ?? 0).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* AI Insights Section */}
        {(report.ai_insights || report.ai_enabled || report.pid_stats || report.ml_stats) && (
          <div className="card rounded-4 shadow-none border mb-3" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)' }}>
            <div className="card-header border-bottom p-4" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)' }}>
              <h5 className="mb-0 d-flex align-items-center gap-2 text-white">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                  width: 40,
                  height: 40,
                  background: 'rgba(255, 255, 255, 0.2)',
                  backdropFilter: 'blur(10px)'
                }}>
                  <i className="material-icons-outlined" style={{ fontSize: 24 }}>psychology</i>
                </div>
                <span className="fw-semibold"><i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>psychology</i> AI Insights</span>
              </h5>
              {report.ai_enabled && (
                <p className="text-white-50 mb-0 mt-2" style={{ fontSize: '0.9rem' }}>
                  This execution used AI-powered control with PID controllers and Machine Learning
                </p>
              )}
            </div>
            <div className="card-body p-4">
              
              {/* PID Controller Performance */}
              {(report.pid_stats || report.ai_insights?.pid_performance) && (
                <div className="mb-4">
                  <h6 className="fw-bold text-primary mb-3">
                    <i className="material-icons-outlined align-middle me-2" style={{ fontSize: 20 }}>tune</i>
                    PID Controller Performance
                  </h6>
                  <div className="row g-3">
                    {report.pid_stats?.current_ops_per_min && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">Final Operations/Minute</div>
                          <div className="h4 mb-0 text-primary">{report.pid_stats.current_ops_per_min.toFixed(1)}</div>
                        </div>
                      </div>
                    )}
                    {report.pid_stats?.phase && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">Final Phase</div>
                          <div className="h5 mb-0">
                            <span className="badge bg-success">{report.pid_stats.phase.replace(/_/g, ' ').toUpperCase()}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {report.pid_stats?.iteration && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">Total Iterations</div>
                          <div className="h4 mb-0 text-info">{report.pid_stats.iteration}</div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {(report.pid_stats?.cpu_pid || report.pid_stats?.memory_pid) && (
                    <div className="mt-3 p-3 bg-white rounded-3 border">
                      <div className="row">
                        {report.pid_stats?.cpu_pid && (
                          <div className="col-md-6">
                            <h6 className="text-muted small mb-2">CPU PID Parameters</h6>
                            <div className="d-flex gap-3 flex-wrap">
                              <div>
                                <span className="text-muted small">Kp:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.cpu_pid.Kp}</span>
                              </div>
                              <div>
                                <span className="text-muted small">Ki:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.cpu_pid.Ki}</span>
                              </div>
                              <div>
                                <span className="text-muted small">Kd:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.cpu_pid.Kd}</span>
                              </div>
                            </div>
                          </div>
                        )}
                        {report.pid_stats?.memory_pid && (
                          <div className="col-md-6">
                            <h6 className="text-muted small mb-2">Memory PID Parameters</h6>
                            <div className="d-flex gap-3 flex-wrap">
                              <div>
                                <span className="text-muted small">Kp:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.memory_pid.Kp}</span>
                              </div>
                              <div>
                                <span className="text-muted small">Ki:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.memory_pid.Ki}</span>
                              </div>
                              <div>
                                <span className="text-muted small">Kd:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.memory_pid.Kd}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ML Model Performance */}
              {(report.ml_stats || report.ai_insights?.ml_performance) && (
                <div className="mb-4">
                  <h6 className="fw-bold text-success mb-3">
                    <i className="material-icons-outlined align-middle me-2" style={{ fontSize: 20 }}>model_training</i>
                    Machine Learning Performance
                  </h6>
                  <div className="row g-3">
                    {report.ml_stats?.model_trained !== undefined && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">Model Status</div>
                          <div className="h5 mb-0">
                            {report.ml_stats.model_trained ? (
                              <span className="badge bg-success"><i className="material-icons-outlined" style={{ fontSize: 14 }}>check</i> Trained</span>
                            ) : (
                              <span className="badge bg-warning">⏳ Training</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {report.ml_stats?.training_samples && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">Training Samples</div>
                          <div className="h4 mb-0 text-success">{report.ml_stats.training_samples}</div>
                        </div>
                      </div>
                    )}
                    {report.ml_stats?.cpu_model_r2 !== undefined && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">CPU Model Accuracy (R²)</div>
                          <div className="h4 mb-0 text-info">{(report.ml_stats.cpu_model_r2 * 100).toFixed(1)}%</div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {report.ml_stats?.feature_importance && (
                    <div className="mt-3 p-3 bg-white rounded-3 border">
                      <h6 className="text-muted small mb-2">Feature Importance (CPU Model)</h6>
                      <div className="row">
                        {Object.entries(report.ml_stats.feature_importance.cpu_model || {}).map(([feature, importance]: [string, any]) => (
                          <div key={feature} className="col-md-6 mb-2">
                            <div className="d-flex justify-content-between align-items-center">
                              <span className="small text-muted">{feature.replace(/_/g, ' ')}</span>
                              <span className="badge bg-light text-dark">{(importance * 100).toFixed(1)}%</span>
                            </div>
                            <div className="progress" style={{ height: 4 }}>
                              <div 
                                className="progress-bar bg-success" 
                                style={{ width: `${importance * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* AI Decisions Timeline */}
              {report.ai_insights?.ai_decisions && report.ai_insights.ai_decisions.length > 0 && (
                <div className="mb-4">
                  <h6 className="fw-bold text-warning mb-3">
                    <i className="material-icons-outlined align-middle me-2" style={{ fontSize: 20 }}>timeline</i>
                    AI Decision Timeline
                  </h6>
                  <div className="bg-white rounded-3 border p-3">
                    <div className="timeline">
                      {report.ai_insights.ai_decisions.slice(-5).map((decision, idx) => (
                        <div key={idx} className="mb-3 pb-3 border-bottom">
                          <div className="d-flex align-items-start gap-3">
                            <div className="badge bg-primary rounded-circle" style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {decision.iteration}
                            </div>
                            <div className="flex-grow-1">
                              <div className="d-flex justify-content-between align-items-center mb-1">
                                <span className="badge bg-secondary">{decision.phase.replace(/_/g, ' ').toUpperCase()}</span>
                              </div>
                              <p className="text-muted small mb-0">{decision.reasoning}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {report.ai_insights?.recommendations && report.ai_insights.recommendations.length > 0 && (
                <div>
                  <h6 className="fw-bold text-info mb-3">
                    <i className="material-icons-outlined align-middle me-2" style={{ fontSize: 20 }}>lightbulb</i>
                    Recommendations for Next Execution
                  </h6>
                  <div className="bg-white rounded-3 border p-3">
                    <ul className="mb-0">
                      {report.ai_insights.recommendations.map((rec, idx) => (
                        <li key={idx} className="mb-2 text-muted">{rec}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* Entity Breakdown */}
        {report.entity_breakdown && typeof report.entity_breakdown === 'object' && Object.keys(report.entity_breakdown).length > 0 && (
          <div className="card rounded-4 shadow-none border mb-3">
            <div className="card-header bg-transparent border-bottom p-4">
              <h5 className="mb-0 d-flex align-items-center gap-2">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                  width: 40,
                  height: 40,
                  background: 'linear-gradient(135deg, #17a2b8 0%, #138496 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>category</i>
                </div>
                <span className="fw-semibold">Entity Breakdown</span>
              </h5>
            </div>
            <div className="card-body p-4">
              <div className="row g-3">
                {Object.entries(report.entity_breakdown).map(([entity, stats]: [string, any]) => (
                  <div key={entity} className="col-md-4">
                    <div className="card rounded-4 shadow-none border h-100">
                      <div className="card-body p-4">
                        <h6 className="fw-semibold mb-3 d-flex align-items-center gap-2">
                          <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>label</i>
                          {entity}
                        </h6>
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <span className="text-muted">Total:</span>
                          <span className="badge bg-primary rounded-pill px-3 py-2">{stats.total || 0}</span>
                        </div>
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <span className="text-success">Success:</span>
                          <span className="badge bg-success rounded-pill px-3 py-2">{stats.success || 0}</span>
                        </div>
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <span className="text-danger">Failed:</span>
                          <span className="badge bg-danger rounded-pill px-3 py-2">{stats.failed || 0}</span>
                        </div>
                        {stats.total > 0 && (
                          <div>
                            <div className="d-flex justify-content-between small mb-1">
                              <span className="text-muted">Success Rate</span>
                              <strong>{((stats.success || 0) / stats.total * 100).toFixed(0)}%</strong>
                            </div>
                            <div className="progress" style={{ height: 6 }}>
                              <div className={`progress-bar ${(stats.success / stats.total * 100) >= 80 ? 'bg-success' : (stats.success / stats.total * 100) >= 50 ? 'bg-warning' : 'bg-danger'}`} style={{ width: `${(stats.success / stats.total * 100)}%` }}></div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Operation Details Card */}
        <div className="card rounded-4 shadow-none border">
          <div className="card-header bg-transparent border-bottom p-4">
            <h5 className="mb-0 d-flex align-items-center gap-2">
              <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                width: 40,
                height: 40,
                background: 'linear-gradient(135deg, #6c757d 0%, #495057 100%)'
              }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>list</i>
              </div>
              <span className="fw-semibold">Operation Details</span>
              <span className="badge bg-secondary rounded-pill ms-2">
                Last {(report.operations_history && Array.isArray(report.operations_history) ? report.operations_history.slice(-20).length : 0)}
              </span>
            </h5>
          </div>
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th className="ps-4">#</th>
                    <th>Timestamp</th>
                    <th>Entity</th>
                    <th>Operation</th>
                    <th>Name</th>
                    <th className="text-center">Duration</th>
                    <th className="text-center pe-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.operations_history && Array.isArray(report.operations_history) ? report.operations_history.slice(-20) : []).map((op, idx) => (
                    <tr key={idx}>
                      <td className="ps-4">
                        <span className="badge bg-light text-dark rounded-pill">{idx + 1}</span>
                      </td>
                      <td className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtTs(op.timestamp)}</td>
                      <td>
                        <span className="badge bg-secondary rounded-pill px-3 py-2">
                          {op.entity_type || 'Unknown'}
                        </span>
                      </td>
                      <td>
                        <code className="small">{op.operation || 'N/A'}</code>
                      </td>
                      <td>
                        <code className="font-monospace small text-muted">{op.entity_name || 'N/A'}</code>
                      </td>
                      <td className="text-center">
                        <span className="badge bg-light text-dark rounded-pill px-3 py-2">
                          {op.duration_seconds ? op.duration_seconds.toFixed(2) : '0.00'}s
                        </span>
                      </td>
                      <td className="text-center pe-4">
                        <span className={`badge rounded-pill px-3 py-2 ${
                          op.status === 'SUCCESS' ? 'bg-success' : 'bg-danger'
                        }`}>
                          {op.status || 'UNKNOWN'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(!report.operations_history || !Array.isArray(report.operations_history) || report.operations_history.length === 0) && (
                    <tr>
                      <td colSpan={7} className="text-center text-muted py-5">
                        <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>inbox</i>
                        <div>No operation details available</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      {/* Longevity Health Check Results */}
      {report.longevity?.enabled && (
        <div className="card shadow-sm border-0 mb-4 overflow-hidden">
          <div className="card-header bg-white border-bottom d-flex align-items-center py-3 px-4">
            <i className="material-icons-outlined text-info me-2">health_and_safety</i>
            <h5 className="mb-0">
              <span className="fw-semibold">Longevity Health Checks</span>
              <span className="badge bg-info rounded-pill ms-2">
                {report.longevity.total_health_checks || 0} checks
              </span>
            </h5>
          </div>
          <div className="card-body">
            {/* Latest verdict */}
            <div className="d-flex align-items-center mb-3">
              <span className="me-2">Latest Verdict:</span>
              <span className={`badge rounded-pill px-3 py-2 ${
                report.longevity.latest_health_verdict === 'PASS' ? 'bg-success' :
                report.longevity.latest_health_verdict === 'WARN' ? 'bg-warning text-dark' :
                report.longevity.latest_health_verdict === 'FAIL' ? 'bg-danger' : 'bg-secondary'
              }`}>
                {report.longevity.latest_health_verdict || 'N/A'}
              </span>
            </div>

            {/* Health check results table */}
            {report.longevity.health_check_results && report.longevity.health_check_results.length > 0 && (
              <div className="table-responsive mb-3">
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Timestamp</th>
                      <th>FATAL Scan</th>
                      <th>Process Restarts</th>
                      <th>Cgroup OOM</th>
                      <th>Thread Count</th>
                      <th>Disk Usage</th>
                      <th>Core Dumps</th>
                      <th>Memory Leaks</th>
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.longevity.health_check_results.slice(-10).map((hc: any, idx: number) => {
                      const statusBadge = (s: string) => {
                        const cls = s === 'PASS' ? 'bg-success' : s === 'WARN' ? 'bg-warning text-dark' : s === 'FAIL' ? 'bg-danger' : 'bg-secondary';
                        return <span className={`badge rounded-pill ${cls}`}>{s}</span>;
                      };
                      return (
                        <tr key={idx}>
                          <td className="text-muted small">{hc.timestamp ? new Date(hc.timestamp).toLocaleString() : '-'}</td>
                          <td>{statusBadge(hc.fatal_scan?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.process_restarts?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.cgroup_oom?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.thread_count?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.disk_usage?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.core_dumps?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.memory_leaks?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.verdict?.verdict || 'N/A')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Checkpoint reports */}
            {report.longevity.checkpoint_reports && report.longevity.checkpoint_reports.length > 0 && (
              <>
                <h6 className="mt-3 mb-2">
                  <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>flag</i>
                  Checkpoint Reports
                </h6>
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>#</th>
                        <th>Time</th>
                        <th>Elapsed</th>
                        <th>CPU</th>
                        <th>Memory</th>
                        <th>Total Ops</th>
                        <th>Success Rate</th>
                        <th>Health</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.longevity.checkpoint_reports.map((cp: any, idx: number) => (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td className="text-muted small">{cp.timestamp ? new Date(cp.timestamp).toLocaleString() : '-'}</td>
                          <td>{cp.elapsed_minutes ? `${cp.elapsed_minutes.toFixed(0)}m` : '-'}</td>
                          <td>{cp.cpu?.toFixed(1)}%</td>
                          <td>{cp.memory?.toFixed(1)}%</td>
                          <td>{cp.total_operations}</td>
                          <td>
                            <span className={`badge rounded-pill ${cp.success_rate >= 90 ? 'bg-success' : cp.success_rate >= 70 ? 'bg-warning text-dark' : 'bg-danger'}`}>
                              {cp.success_rate?.toFixed(1)}%
                            </span>
                          </td>
                          <td>
                            <span className={`badge rounded-pill ${
                              cp.latest_health_verdict === 'PASS' ? 'bg-success' :
                              cp.latest_health_verdict === 'WARN' ? 'bg-warning text-dark' : 'bg-secondary'
                            }`}>
                              {cp.latest_health_verdict || 'N/A'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Report Metadata Footer */}
      {report && (
        <div className="card rounded-4 shadow-none border mt-3 mb-3">
          <div className="card-body p-3 d-flex flex-wrap gap-4" style={{ fontSize: 12, color: '#94a3b8' }}>
            <div><i className="material-icons-outlined me-1" style={{ fontSize: 14, verticalAlign: 'middle' }}>schedule</i> Generated: {new Date().toUTCString()}</div>
            <div><i className="material-icons-outlined me-1" style={{ fontSize: 14, verticalAlign: 'middle' }}>storage</i> Source: {enhanced?.report_metadata?.prometheus_configured ? 'Live Prometheus + DB' : 'Persisted snapshot'}</div>
            <div><i className="material-icons-outlined me-1" style={{ fontSize: 14, verticalAlign: 'middle' }}>analytics</i> Samples: {enhanced?.report_metadata?.metrics_samples ?? report.metrics_history?.length ?? 0}</div>
            <div><i className="material-icons-outlined me-1" style={{ fontSize: 14, verticalAlign: 'middle' }}>list</i> Operations: {enhanced?.report_metadata?.operations_recorded ?? report.total_operations ?? 0}</div>
            <div><i className="material-icons-outlined me-1" style={{ fontSize: 14, verticalAlign: 'middle' }}>fingerprint</i> ID: {executionId}</div>
          </div>
        </div>
      )}

      </div>
  );
};

export default SmartExecutionReport;
