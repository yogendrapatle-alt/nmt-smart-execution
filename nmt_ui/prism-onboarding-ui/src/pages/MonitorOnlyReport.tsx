import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getApiBase } from '../utils/backendUrl';
import PageHeader from '../components/ui/PageHeader';

// We render the resource trend with a tiny inline SVG so we don't need to
// add a chart library dependency. Keeps the report page lightweight.

type TabId = 'overview' | 'violations' | 'rules' | 'trend' | 'logs' | 'config';

interface LogBundle {
  id: number; rule_id?: string; rule_name?: string; severity?: string;
  status: string; pc_ip?: string; ncm_ip?: string; duration_hours?: number;
  requested_at?: string; started_at?: string; completed_at?: string;
  error?: string; bundle_path?: string; bundle_size_bytes?: number;
  stdout_tail?: string; metadata?: { has_pc_creds?: boolean; paramiko_available?: boolean };
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
  config_dump: { rule_config?: any; settings?: any };
}

const SEV_COLOR: Record<string, string> = { Critical: '#ef4444', Moderate: '#f59e0b', Low: '#22c55e' };
const VERDICT_BG: Record<string, string> = {
  pass: 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)',
  warn: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
  fail: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
};
const VERDICT_BORDER: Record<string, string> = { pass: '#22c55e', warn: '#f59e0b', fail: '#ef4444' };

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

const Tab: React.FC<{ active: boolean; label: string; count?: number; onClick: () => void }> = ({ active, label, count, onClick }) => (
  <button type="button" onClick={onClick}
    style={{
      padding: '8px 16px', border: 'none', background: 'transparent',
      borderBottom: active ? '3px solid #3b82f6' : '3px solid transparent',
      color: active ? '#3b82f6' : '#64748b',
      fontWeight: active ? 700 : 500, fontSize: 13, cursor: 'pointer',
    }}>
    {label}{typeof count === 'number' && <span style={{ marginLeft: 6, fontSize: 11,
      background: active ? '#dbeafe' : '#f1f5f9', color: active ? '#1e40af' : '#64748b',
      padding: '1px 7px', borderRadius: 999 }}>{count}</span>}
  </button>
);

// ── Main page ──────────────────────────────────────────────────────
const MonitorOnlyReport: React.FC = () => {
  const { monitorId } = useParams<{ monitorId: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = React.useCallback(async () => {
    if (!monitorId) return;
    try {
      const res = await fetch(`${getApiBase()}/api/monitor-only/${monitorId}/report`);
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Failed to load report');
      setReport(data.report);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [monitorId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh || !report?.overview?.is_running) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [autoRefresh, report?.overview?.is_running, load]);

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

  if (loading) return <div style={{ padding: 24 }}>Loading report…</div>;
  if (error || !report) {
    return (
      <div style={{ padding: 24 }}>
        <PageHeader title="Monitor Report" subtitle={monitorId || ''} />
        <div style={{ color: '#ef4444' }}>{error || 'No data'}</div>
      </div>
    );
  }

  const o = report.overview;
  const v = report.verdict;
  const apiBase = getApiBase();

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <PageHeader
        title={`Monitor Report — ${o.name || o.monitor_id}`}
        subtitle={`${o.monitor_id} • testbed ${o.testbed_id}`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load}
              style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 6,
                background: 'white', cursor: 'pointer', fontSize: 12 }}>
              Refresh
            </button>
            <a href={`${apiBase}/api/monitor-only/${o.monitor_id}/report.html`} target="_blank" rel="noreferrer"
              style={{ padding: '6px 14px', border: '1px solid #3b82f6', borderRadius: 6,
                background: '#3b82f6', color: 'white', textDecoration: 'none', fontSize: 12 }}>
              Open HTML (print → PDF)
            </a>
            <a href={`${apiBase}/api/monitor-only/${o.monitor_id}/report.json`}
              style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 6,
                background: 'white', color: '#1e293b', textDecoration: 'none', fontSize: 12 }}>
              JSON
            </a>
            <a href={`${apiBase}/api/monitor-only/${o.monitor_id}/violations.csv`}
              style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 6,
                background: 'white', color: '#1e293b', textDecoration: 'none', fontSize: 12 }}>
              CSV
            </a>
          </div>
        }
      />

      {/* Verdict banner */}
      <div style={{
        background: VERDICT_BG[v.level], borderLeft: `6px solid ${VERDICT_BORDER[v.level]}`,
        borderRadius: 12, padding: '20px 26px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24,
      }}>
        <div style={{ fontSize: 40 }}>{v.icon}</div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{v.label}</div>
          <div style={{ color: '#64748b', marginTop: 4 }}>{v.summary}</div>
          {o.is_running && (
            <span style={{ marginTop: 6, display: 'inline-block', padding: '2px 8px',
              background: '#dbeafe', color: '#1e40af', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
              ● LIVE — auto-refresh {autoRefresh ? 'on' : 'off'}
              <button onClick={() => setAutoRefresh(a => !a)}
                style={{ marginLeft: 6, background: 'none', border: 'none', color: '#1e40af',
                  cursor: 'pointer', textDecoration: 'underline' }}>
                {autoRefresh ? 'pause' : 'resume'}
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        <Tab active={tab === 'overview'} label="Overview" onClick={() => setTab('overview')} />
        <Tab active={tab === 'violations'} label="Violations" count={report.violations.length} onClick={() => setTab('violations')} />
        <Tab active={tab === 'rules'} label="Rule Health" count={report.rules.length} onClick={() => setTab('rules')} />
        <Tab active={tab === 'trend'} label="Resource Trend" onClick={() => setTab('trend')} />
        <Tab active={tab === 'logs'} label="Log Bundles" count={(report.log_bundles || []).length} onClick={() => setTab('logs')} />
        <Tab active={tab === 'config'} label="Config" onClick={() => setTab('config')} />
      </div>

      {tab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
            <StatCard label="Polls" value={o.total_polls} />
            <StatCard label="Violations" value={o.total_violations} />
            <StatCard label="Rules" value={o.rule_count} />
            <StatCard label="Poll interval" value={`${o.poll_interval_s}s`} />
            <StatCard label="Wall-clock" value={fmtSec(o.duration_seconds)} sub={o.duration_hours_target ? `target ${o.duration_hours_target}h` : 'unbounded'} />
            <StatCard label="Status" value={o.status} />
          </div>
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
