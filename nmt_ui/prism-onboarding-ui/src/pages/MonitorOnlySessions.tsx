import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { SkeletonTable } from '../components/ui/LoadingSkeleton';
import { getApiBase } from '../utils/backendUrl';

// ─────────────────────────────────────────────────────────────────────────────
// MonitorOnlySessions — v6 (Bootstrap visual parity with SmartExecutionHistory)
//
// The previous build used a custom flexbox layout that looked sparse next to
// the polished Smart Execution History page. This rewrite reuses *exactly* the
// same Bootstrap idioms (gradient-icon header, rounded-4 cards, table-hover
// with badge cells, action buttons row, view-mode toggle, KPI strip, filter
// card) so a tester switching between the two pages can't tell them apart.
// All data still comes from the slim ``/api/monitor-only/list`` shape we
// shipped in Phase 1 — no backend change here.
// ─────────────────────────────────────────────────────────────────────────────

interface AlertSummary {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

interface MonitorRow {
  monitor_id: string;
  testbed_id: string;
  testbed_name?: string;
  pc_ip?: string | null;
  name?: string;
  description?: string | null;
  status: string;
  last_error?: string | null;
  started_at?: string;
  stopped_at?: string;
  last_poll_at?: string | null;
  poll_interval_s: number;
  duration_hours?: number | null;
  duration_elapsed_seconds?: number | null;
  duration_remaining_seconds?: number | null;
  total_polls: number;
  total_violations: number;
  consecutive_failed_polls?: number;
  last_prometheus_error?: string | null;
  rule_count?: number;
  alert_summary?: AlertSummary;
  is_running?: boolean;
  slack_channel_override?: string | null;
}

const STATUS_BADGE: Record<string, { bg: string; icon: string }> = {
  STARTING:  { bg: 'bg-warning text-dark',           icon: 'hourglass_empty' },
  RUNNING:   { bg: 'bg-success bg-opacity-25 text-success', icon: 'monitor_heart' },
  DEGRADED:  { bg: 'bg-warning text-dark',           icon: 'warning' },
  STOPPED:   { bg: 'bg-secondary bg-opacity-25 text-secondary', icon: 'stop_circle' },
  FAILED:    { bg: 'bg-danger bg-opacity-25 text-danger', icon: 'error' },
};

const PAGE_SIZE = 50;

const fmtDuration = (sec: number | null | undefined): string => {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
};

const fmtRelative = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '—';
    const delta = Math.max(0, (Date.now() - t) / 1000);
    if (delta < 60) return `${Math.floor(delta)}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return '—'; }
};

// Inline alert pills — same Bootstrap badge palette as SmartExecutionHistory
const AlertCell: React.FC<{ summary?: AlertSummary }> = ({ summary }) => {
  const s = summary || { critical: 0, warning: 0, info: 0, total: 0 };
  if (!s.total) {
    return (
      <span className="badge bg-success bg-opacity-25 text-success rounded-pill px-2 py-1">
        <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>check_circle</i>
      </span>
    );
  }
  return (
    <div className="d-flex gap-1 justify-content-center flex-wrap">
      {s.critical > 0 && (
        <span className="badge bg-danger rounded-pill px-2" title={`${s.critical} critical`}>
          <i className="material-icons-outlined" style={{ fontSize: 12, verticalAlign: 'middle' }}>error</i> {s.critical}
        </span>
      )}
      {s.warning > 0 && (
        <span className="badge bg-warning text-dark rounded-pill px-2" title={`${s.warning} warning`}>
          <i className="material-icons-outlined" style={{ fontSize: 12, verticalAlign: 'middle' }}>warning</i> {s.warning}
        </span>
      )}
      {s.info > 0 && (
        <span className="badge bg-info text-dark rounded-pill px-2" title={`${s.info} info`}>
          <i className="material-icons-outlined" style={{ fontSize: 12, verticalAlign: 'middle' }}>info</i> {s.info}
        </span>
      )}
    </div>
  );
};

const MonitorOnlySessions: React.FC = () => {
  const navigate = useNavigate();
  const { addToast, confirm } = useToast();
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTestbed, setFilterTestbed] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  // First load shows skeleton; subsequent auto-refreshes don't, otherwise the
  // page flickers every 10s. Track with a ref so the polling effect can read
  // it without forcing a re-render.
  const firstLoad = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      const res = await fetch(`${getApiBase()}/api/monitor-only/list?${params.toString()}`);
      const data = await res.json();
      if (data?.success) {
        setRows(data.monitors || []);
        setTotal(typeof data.total === 'number' ? data.total : (data.monitors?.length || 0));
        setError(null);
      } else {
        setError(data?.error || 'Failed to load monitors');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (firstLoad.current) {
        setLoading(false);
        firstLoad.current = false;
      }
    }
  }, [filterStatus, offset]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 10000);
    return () => window.clearInterval(t);
  }, [refresh]);

  useEffect(() => { setOffset(0); }, [filterStatus]);

  // Derived: filter by testbed + search client-side (server already filtered status)
  const filteredRows = useMemo(() => {
    let out = rows;
    if (filterTestbed !== 'all') {
      out = out.filter(r => (r.testbed_name || r.testbed_id) === filterTestbed);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      out = out.filter(r => {
        const hay = `${r.name || ''} ${r.monitor_id} ${r.testbed_name || ''} ${r.testbed_id} ${r.pc_ip || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return out;
  }, [rows, filterTestbed, searchQuery]);

  // KPI strip aggregates (across all rows on the current page)
  const kpis = useMemo(() => {
    const k = {
      total: total,
      running: 0,
      degraded: 0,
      stopped: 0,
      failed: 0,
      total_polls: 0,
      total_violations: 0,
      total_alerts: 0,
      total_critical: 0,
    };
    for (const r of rows) {
      if (r.status === 'RUNNING' || r.status === 'STARTING') k.running++;
      else if (r.status === 'DEGRADED') k.degraded++;
      else if (r.status === 'STOPPED') k.stopped++;
      else if (r.status === 'FAILED') k.failed++;
      k.total_polls += r.total_polls || 0;
      k.total_violations += r.total_violations || 0;
      k.total_alerts += r.alert_summary?.total || 0;
      k.total_critical += r.alert_summary?.critical || 0;
    }
    return k;
  }, [rows, total]);

  const uniqueTestbeds = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => { if (r.testbed_name || r.testbed_id) s.add(r.testbed_name || r.testbed_id); });
    return Array.from(s).sort();
  }, [rows]);

  const statuses = ['STARTING', 'RUNNING', 'DEGRADED', 'STOPPED', 'FAILED'];

  const stop = async (monitorId: string) => {
    const ok = await confirm({
      title: 'Stop monitor?',
      message: 'This will stop polling Prometheus. The session record stays for review.',
      confirmLabel: 'Stop', variant: 'warning',
    });
    if (!ok) return;
    setStoppingId(monitorId);
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
      addToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setStoppingId(null);
    }
  };

  const remove = async (monitorId: string, status: string) => {
    if (status === 'RUNNING' || status === 'STARTING' || status === 'DEGRADED') {
      addToast('warning', 'Stop the monitor before deleting it');
      return;
    }
    const ok = await confirm({
      title: 'Delete this monitor session?',
      message: `${monitorId} — the session row is removed permanently. Alerts on the Alerts page are preserved.`,
      confirmLabel: 'Delete', variant: 'danger',
    });
    if (!ok) return;
    setDeletingId(monitorId);
    try {
      const res = await fetch(`${getApiBase()}/api/monitor-only/${monitorId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data?.success) {
        addToast('success', 'Monitor session deleted');
        refresh();
      } else {
        addToast('error', data?.error || 'Failed to delete');
      }
    } catch (e: unknown) {
      addToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const downloadReport = async (monitorId: string) => {
    // Same pattern as SmartExecutionHistory.downloadReport: fetch, blob,
    // synthesise an <a> click. Going through the JS fetch avoids the
    // browser's `target=_blank → 60s blank window` UX while /report.html
    // is rebuilding pod/cluster data.
    try {
      const res = await fetch(`${getApiBase()}/api/monitor-only/${monitorId}/report.html?download=1`);
      if (!res.ok) {
        addToast('error', `Failed to download report (HTTP ${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monitor-${monitorId}.html`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e: unknown) {
      addToast('error', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="main-content">
      {/* ── Page Header (gradient icon, subtitle, primary CTA) ─────────── */}
      <div className="mb-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h2 className="fw-bold mb-2 d-flex align-items-center gap-2">
              <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                width: 48, height: 48,
                background: 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)',
              }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>visibility</i>
              </div>
              Monitor-Only Sessions
            </h2>
            <p className="text-muted mb-0">Standalone Prometheus rule watchers — past and live.</p>
          </div>
          <div className="d-flex gap-2">
            <button
              className="btn btn-outline-secondary btn-lg rounded-4 d-flex align-items-center gap-2"
              onClick={refresh}
              disabled={loading}
              title="Refresh the session list"
            >
              <i className="material-icons-outlined" style={{ fontSize: 20 }}>refresh</i>
              Refresh
            </button>
            <button
              className="btn btn-primary btn-lg rounded-4 d-flex align-items-center gap-2"
              onClick={() => navigate('/monitor-only')}
              title="Start a new monitor"
            >
              <i className="material-icons-outlined" style={{ fontSize: 20 }}>add</i>
              New Monitor
            </button>
          </div>
        </div>
      </div>

      {/* ── Error Alert ─────────────────────────────────────────────────── */}
      {error && (
        <div className="alert alert-danger alert-dismissible fade show rounded-4 d-flex align-items-center mb-3" role="alert">
          <i className="material-icons-outlined me-2">error_outline</i>
          <div className="flex-grow-1"><strong>Error:</strong> {error}</div>
          <button type="button" className="btn-close" onClick={() => setError(null)} aria-label="Close" />
        </div>
      )}

      {/* ── KPI Strip ───────────────────────────────────────────────────── */}
      <div className="row g-3 mb-3">
        <div className="col-md-3 col-xl">
          <div className="card rounded-4 border h-100">
            <div className="card-body p-3">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="text-muted small fw-semibold text-uppercase mb-1" style={{ letterSpacing: 0.4, fontSize: 11 }}>Total</div>
                  <div className="h3 fw-bold mb-0">{kpis.total}</div>
                </div>
                <i className="material-icons-outlined text-primary opacity-50" style={{ fontSize: 36 }}>dataset</i>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-3 col-xl">
          <div className="card rounded-4 border h-100">
            <div className="card-body p-3">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="text-muted small fw-semibold text-uppercase mb-1" style={{ letterSpacing: 0.4, fontSize: 11 }}>Live Now</div>
                  <div className="h3 fw-bold mb-0 text-success">{kpis.running}</div>
                  {kpis.degraded > 0 && (
                    <div className="small text-warning fw-semibold">+{kpis.degraded} degraded</div>
                  )}
                </div>
                <i className="material-icons-outlined text-success opacity-50" style={{ fontSize: 36 }}>monitor_heart</i>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-3 col-xl">
          <div className="card rounded-4 border h-100">
            <div className="card-body p-3">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="text-muted small fw-semibold text-uppercase mb-1" style={{ letterSpacing: 0.4, fontSize: 11 }}>Total Polls</div>
                  <div className="h3 fw-bold mb-0 text-info">{kpis.total_polls.toLocaleString()}</div>
                </div>
                <i className="material-icons-outlined text-info opacity-50" style={{ fontSize: 36 }}>sync</i>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-3 col-xl">
          <div className="card rounded-4 border h-100">
            <div className="card-body p-3">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="text-muted small fw-semibold text-uppercase mb-1" style={{ letterSpacing: 0.4, fontSize: 11 }}>Violations</div>
                  <div className={`h3 fw-bold mb-0 ${kpis.total_violations > 0 ? 'text-danger' : 'text-success'}`}>
                    {kpis.total_violations.toLocaleString()}
                  </div>
                </div>
                <i className={`material-icons-outlined opacity-50 ${kpis.total_violations > 0 ? 'text-danger' : 'text-success'}`} style={{ fontSize: 36 }}>report_problem</i>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-3 col-xl">
          <div className="card rounded-4 border h-100">
            <div className="card-body p-3">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="text-muted small fw-semibold text-uppercase mb-1" style={{ letterSpacing: 0.4, fontSize: 11 }}>Alerts</div>
                  <div className={`h3 fw-bold mb-0 ${kpis.total_critical > 0 ? 'text-danger' : (kpis.total_alerts > 0 ? 'text-warning' : 'text-success')}`}>
                    {kpis.total_alerts.toLocaleString()}
                  </div>
                  {kpis.total_critical > 0 && (
                    <div className="small text-danger fw-semibold">{kpis.total_critical} critical</div>
                  )}
                </div>
                <i className={`material-icons-outlined opacity-50 ${kpis.total_critical > 0 ? 'text-danger' : 'text-warning'}`} style={{ fontSize: 36 }}>notifications_active</i>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Filters Card ────────────────────────────────────────────────── */}
      <div className="card rounded-4 shadow-none border mb-3">
        <div className="card-body p-4">
          <h5 className="card-title d-flex align-items-center gap-2 mb-4">
            <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
              width: 40, height: 40,
              background: 'linear-gradient(135deg, #0078d4 0%, #005a9e 100%)',
            }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>filter_list</i>
            </div>
            <span className="fw-semibold">Filters</span>
          </h5>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label fw-semibold mb-2">
                <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>search</i>
                Search
              </label>
              <div className="position-relative">
                <i className="material-icons-outlined position-absolute translate-middle-y" style={{ left: 12, top: '50%', fontSize: 20, color: '#6c757d' }}>search</i>
                <input
                  type="text"
                  className="form-control rounded-3 ps-5"
                  placeholder="Search by monitor name, ID, testbed or PC IP..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="col-md-4">
              <label className="form-label fw-semibold mb-2">
                <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>flag</i>
                Status
              </label>
              <select
                className="form-select rounded-3"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All Statuses</option>
                {statuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label fw-semibold mb-2">
                <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>dns</i>
                Testbed
              </label>
              <select
                className="form-select rounded-3"
                value={filterTestbed}
                onChange={(e) => setFilterTestbed(e.target.value)}
              >
                <option value="all">All Testbeds</option>
                {uniqueTestbeds.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── Sessions Table Card ─────────────────────────────────────────── */}
      <div className="card rounded-4 shadow-none border">
        <div className="card-header bg-transparent border-bottom p-4">
          <div className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0 d-flex align-items-center gap-2">
              <i className="material-icons-outlined text-primary" style={{ fontSize: 24 }}>list</i>
              <span className="fw-semibold">Sessions</span>
              <span className="badge bg-primary rounded-pill">{filteredRows.length}</span>
              {total > filteredRows.length && (
                <span className="text-muted small">of {total}</span>
              )}
            </h5>
            <div className="d-flex gap-2">
              <div className="btn-group btn-group-sm" role="group">
                <button
                  type="button"
                  className={`btn ${viewMode === 'table' ? 'btn-primary' : 'btn-outline-secondary'} rounded-start-3`}
                  onClick={() => setViewMode('table')}
                  title="Table view"
                >
                  <i className="material-icons-outlined" style={{ fontSize: 18 }}>view_list</i>
                </button>
                <button
                  type="button"
                  className={`btn ${viewMode === 'card' ? 'btn-primary' : 'btn-outline-secondary'} rounded-end-3`}
                  onClick={() => setViewMode('card')}
                  title="Card view"
                >
                  <i className="material-icons-outlined" style={{ fontSize: 18 }}>grid_view</i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card-body p-0">
          {loading ? (
            <div className="p-4">
              <SkeletonTable rows={6} cols={8} />
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-5">
              <i className="material-icons-outlined text-muted" style={{ fontSize: 64, opacity: 0.3 }}>visibility_off</i>
              <p className="mt-3 text-muted">
                {rows.length === 0 ? 'No monitor sessions yet' : 'No sessions match the current filters'}
              </p>
              {rows.length === 0 && (
                <button
                  className="btn btn-primary rounded-4 mt-2"
                  onClick={() => navigate('/monitor-only')}
                >
                  <i className="material-icons-outlined me-2" style={{ fontSize: 18, verticalAlign: 'middle' }}>rocket_launch</i>
                  Start Your First Monitor
                </button>
              )}
            </div>
          ) : viewMode === 'card' ? (
            // ── Card view ─────────────────────────────────────────────
            <div className="row g-3 p-3">
              {filteredRows.map(r => {
                const si = STATUS_BADGE[r.status] || { bg: 'bg-secondary', icon: 'help' };
                const isLive = r.status === 'RUNNING' || r.status === 'STARTING' || r.status === 'DEGRADED';
                return (
                  <div key={r.monitor_id} className="col-md-6 col-xl-4">
                    <div
                      className="card border rounded-4 h-100 shadow-sm"
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/monitor-only/run/${r.monitor_id}`)}
                    >
                      <div className="card-body p-3">
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <div className="flex-grow-1">
                            <h6 className="fw-bold mb-0">{r.name || r.monitor_id}</h6>
                            <div className="text-muted small font-monospace">{r.monitor_id}</div>
                          </div>
                          <span className={`badge ${si.bg} rounded-pill px-2 py-1`}>
                            <i className="material-icons-outlined" style={{ fontSize: 12, verticalAlign: 'middle' }}>{si.icon}</i> {r.status}
                          </span>
                        </div>
                        <div className="mb-2">
                          <span className="badge bg-secondary rounded-pill px-3 py-2">
                            <i className="material-icons-outlined" style={{ fontSize: 13, verticalAlign: 'middle' }}>dns</i> {r.testbed_name || r.testbed_id}
                          </span>
                          {r.pc_ip && <span className="text-muted small ms-2 font-monospace">{r.pc_ip}</span>}
                        </div>
                        <div className="d-flex gap-3 text-muted small mb-2">
                          <span><i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>schedule</i> {fmtDate(r.started_at)}</span>
                          <span><i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>timer</i> {fmtDuration(r.duration_elapsed_seconds)}</span>
                        </div>
                        <div className="d-flex gap-2 align-items-center flex-wrap">
                          <span className="badge bg-info bg-opacity-10 text-info rounded-pill">{r.rule_count ?? 0} rules</span>
                          <span className="badge bg-primary bg-opacity-10 text-primary rounded-pill">{r.total_polls} polls</span>
                          {r.total_violations > 0 && (
                            <span className="badge bg-danger bg-opacity-10 text-danger rounded-pill">{r.total_violations} viol.</span>
                          )}
                          <AlertCell summary={r.alert_summary} />
                        </div>
                        {isLive && (r.consecutive_failed_polls || 0) > 0 && (
                          <div className="alert alert-warning mt-2 mb-0 p-2 small" role="alert">
                            <i className="material-icons-outlined me-1" style={{ fontSize: 14, verticalAlign: 'middle' }}>warning</i>
                            {r.consecutive_failed_polls} prometheus failures
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // ── Table view ────────────────────────────────────────────
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th className="ps-3">Monitor</th>
                    <th>Testbed</th>
                    <th className="text-center">Status</th>
                    <th>Started</th>
                    <th className="text-center">Duration</th>
                    <th className="text-center">Rules</th>
                    <th className="text-center">Polls</th>
                    <th className="text-center">Violations</th>
                    <th className="text-center">Alerts</th>
                    <th className="text-center pe-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(r => {
                    const si = STATUS_BADGE[r.status] || { bg: 'bg-secondary', icon: 'help' };
                    const isLive = r.status === 'RUNNING' || r.status === 'STARTING' || r.status === 'DEGRADED';
                    const promBad = (r.consecutive_failed_polls || 0) >= 3 || !!r.last_prometheus_error;
                    return (
                      <tr key={r.monitor_id}>
                        <td className="ps-3">
                          <div className="d-flex align-items-center gap-2">
                            <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                              width: 36, height: 36,
                              background: isLive ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '#e2e8f0',
                            }}>
                              <i className={`material-icons-outlined ${isLive ? 'text-white' : 'text-muted'}`} style={{ fontSize: 18 }}>
                                {isLive ? 'monitor_heart' : 'visibility'}
                              </i>
                            </div>
                            <div>
                              {r.name ? (
                                <div className="fw-semibold text-dark">{r.name}</div>
                              ) : (
                                <code className="font-monospace small text-muted">{r.monitor_id.substring(0, 20)}...</code>
                              )}
                              <div className="font-monospace text-muted" style={{ fontSize: '0.7rem' }}>{r.monitor_id}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="badge bg-secondary rounded-pill px-3 py-2">
                            {r.testbed_name || r.testbed_id}
                          </span>
                          {r.pc_ip && (
                            <div className="text-muted small mt-1 font-monospace">{r.pc_ip}</div>
                          )}
                        </td>
                        <td className="text-center">
                          <span className={`badge ${si.bg} rounded-pill px-3 py-2 d-inline-flex align-items-center gap-1`}>
                            <i className="material-icons-outlined" style={{ fontSize: 16 }}>{si.icon}</i>
                            {r.status}
                          </span>
                          {promBad && (
                            <div className="mt-1">
                              <span
                                className="badge bg-warning text-dark small"
                                title={r.last_prometheus_error || `${r.consecutive_failed_polls} failed polls`}
                              >
                                <i className="material-icons-outlined" style={{ fontSize: 12, verticalAlign: 'middle' }}>warning</i>
                                {' '}prometheus
                              </span>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="small">
                            <i className="material-icons-outlined me-1" style={{ fontSize: 16, verticalAlign: 'middle' }}>schedule</i>
                            {fmtDate(r.started_at)}
                          </div>
                          {r.last_poll_at && (
                            <div className="text-muted small">last poll {fmtRelative(r.last_poll_at)}</div>
                          )}
                        </td>
                        <td className="text-center">
                          <span className="badge bg-light text-dark rounded-pill px-3 py-2">
                            {fmtDuration(r.duration_elapsed_seconds)}
                          </span>
                          {r.duration_hours && r.duration_remaining_seconds != null && r.duration_remaining_seconds > 0 && (
                            <div className="text-muted small mt-1">{fmtDuration(r.duration_remaining_seconds)} left</div>
                          )}
                          {r.duration_hours && !r.duration_remaining_seconds && (
                            <div className="text-muted small mt-1">of {r.duration_hours}h</div>
                          )}
                        </td>
                        <td className="text-center">
                          <span className="badge bg-info bg-opacity-25 text-info rounded-pill px-2 py-1">
                            {r.rule_count ?? '—'}
                          </span>
                        </td>
                        <td className="text-center">
                          <span className="fw-bold text-primary">{r.total_polls}</span>
                        </td>
                        <td className="text-center">
                          {r.total_violations > 0 ? (
                            <span className="badge bg-danger rounded-pill px-2 py-1">
                              <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>report_problem</i>
                              {' '}{r.total_violations}
                            </span>
                          ) : (
                            <span className="badge bg-success bg-opacity-25 text-success rounded-pill px-2 py-1">
                              <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>check_circle</i>
                            </span>
                          )}
                        </td>
                        <td className="text-center"><AlertCell summary={r.alert_summary} /></td>
                        <td className="text-center pe-3">
                          <div className="d-flex align-items-center justify-content-center gap-1 flex-wrap">
                            {isLive && (
                              <button
                                className="btn btn-success btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                                onClick={() => navigate(`/monitor-only/run/${r.monitor_id}`)}
                                title="Live monitor view"
                              >
                                <i className="material-icons-outlined" style={{ fontSize: 16 }}>monitor_heart</i>
                                <span className="d-none d-xl-inline small">Live</span>
                              </button>
                            )}
                            <button
                              className="btn btn-outline-primary btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                              onClick={() => navigate(`/monitor-only/report/${r.monitor_id}`)}
                              title="View detailed monitor report"
                            >
                              <i className="material-icons-outlined" style={{ fontSize: 16 }}>visibility</i>
                              <span className="d-none d-xl-inline small">Report</span>
                            </button>
                            <button
                              className="btn btn-outline-success btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                              onClick={() => downloadReport(r.monitor_id)}
                              title="Download HTML report file"
                            >
                              <i className="material-icons-outlined" style={{ fontSize: 16 }}>download</i>
                              <span className="d-none d-xl-inline small">HTML</span>
                            </button>
                            {isLive && (
                              <button
                                className="btn btn-outline-warning btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                                onClick={() => navigate(`/monitor-only/run/${r.monitor_id}?edit=1`)}
                                title="Edit monitoring rules (hot-swap)"
                              >
                                <i className="material-icons-outlined" style={{ fontSize: 16 }}>edit_note</i>
                                <span className="d-none d-xl-inline small">Rules</span>
                              </button>
                            )}
                            {isLive ? (
                              <button
                                className="btn btn-danger btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                                onClick={() => stop(r.monitor_id)}
                                disabled={stoppingId === r.monitor_id}
                                title="Stop this monitor"
                              >
                                {stoppingId === r.monitor_id ? (
                                  <span className="spinner-border spinner-border-sm" role="status" />
                                ) : (
                                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>stop_circle</i>
                                )}
                                <span className="d-none d-xl-inline small">Stop</span>
                              </button>
                            ) : (
                              <button
                                className="btn btn-outline-danger btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                                onClick={() => remove(r.monitor_id, r.status)}
                                disabled={deletingId === r.monitor_id}
                                title="Delete this session"
                              >
                                {deletingId === r.monitor_id ? (
                                  <span className="spinner-border spinner-border-sm" role="status" />
                                ) : (
                                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>delete</i>
                                )}
                                <span className="d-none d-xl-inline small">Delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Pagination ─────────────────────────────────────────── */}
          {total > PAGE_SIZE && (
            <div className="d-flex justify-content-between align-items-center p-3 border-top">
              <span className="text-muted small">
                Showing {offset + 1}–{Math.min(offset + rows.length, total)} of {total}
              </span>
              <div className="d-flex gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary rounded-3"
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                >
                  <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>chevron_left</i>
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary rounded-3"
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total}
                >
                  Next
                  <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>chevron_right</i>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MonitorOnlySessions;
