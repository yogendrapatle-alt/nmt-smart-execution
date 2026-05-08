import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader';
import { useToast } from '../context/ToastContext';
import { getApiBase } from '../utils/backendUrl';

interface MonitorRecord {
  monitor_id: string;
  testbed_id: string;
  name?: string;
  description?: string;
  status: string;
  last_error?: string;
  started_at?: string;
  stopped_at?: string;
  last_poll_at?: string;
  poll_interval_s: number;
  duration_hours?: number | null;
  rule_config?: { monitoring_rules?: unknown[] };
  total_polls: number;
  total_violations: number;
  is_running?: boolean;
  live_violations?: number;
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
  STOPPED: '#6b7280',
  FAILED: '#ef4444',
};

const SEVERITY_COLORS: Record<string, string> = {
  Critical: '#ef4444', critical: '#ef4444',
  Moderate: '#f59e0b', warning: '#f59e0b',
  Low: '#22c55e', info: '#0ea5e9',
};

const MonitorOnlyRun: React.FC = () => {
  const { monitorId } = useParams<{ monitorId: string }>();
  const navigate = useNavigate();
  const { addToast, confirm } = useToast();

  const [monitor, setMonitor] = useState<MonitorRecord | null>(null);
  const [violations, setViolations] = useState<ViolationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollerRef = useRef<number | null>(null);

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

  if (loading) return <div className="container-fluid py-3"><div className="text-muted">Loading…</div></div>;
  if (error) return (
    <div className="container-fluid py-3">
      <div className="alert alert-danger">{error}</div>
      <button className="btn btn-outline-secondary" onClick={() => navigate('/monitor-only')}>← Back</button>
    </div>
  );
  if (!monitor) return <div className="container-fluid py-3"><div className="alert alert-warning">No monitor data</div></div>;

  const ruleCount = Array.isArray(monitor.rule_config?.monitoring_rules) ? monitor.rule_config!.monitoring_rules!.length : 0;
  const isLive = monitor.status === 'RUNNING' || monitor.status === 'STARTING';
  const statusColor = STATUS_COLORS[monitor.status] || '#6b7280';

  return (
    <div className="container-fluid py-3">
      <PageHeader
        icon="visibility"
        iconGradient="linear-gradient(135deg, #0ea5e9, #0369a1)"
        title={monitor.name || `Monitor ${monitor.monitor_id}`}
        subtitle={`Testbed ${monitor.testbed_id} · ${ruleCount} rule${ruleCount !== 1 ? 's' : ''} · poll ${monitor.poll_interval_s}s`}
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

      {/* Status grid */}
      <div className="row g-3 mb-3">
        <div className="col-md-3">
          <div className="card h-100">
            <div className="card-body">
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Status</div>
              <div style={{
                display: 'inline-block', padding: '4px 12px', borderRadius: 999,
                background: `${statusColor}1a`, color: statusColor, fontSize: 14, fontWeight: 700,
                marginTop: 6,
              }}>
                {monitor.status}
              </div>
              {monitor.last_error && <div className="text-danger" style={{ fontSize: 11, marginTop: 4 }}>{monitor.last_error}</div>}
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card h-100">
            <div className="card-body">
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Polls</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary)' }}>{monitor.total_polls}</div>
              {monitor.last_poll_at && <div className="text-muted" style={{ fontSize: 11 }}>last {new Date(monitor.last_poll_at).toLocaleTimeString()}</div>}
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card h-100">
            <div className="card-body">
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Violations</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: monitor.total_violations > 0 ? '#ef4444' : '#22c55e' }}>{monitor.total_violations}</div>
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card h-100">
            <div className="card-body">
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Started</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{monitor.started_at ? new Date(monitor.started_at).toLocaleString() : '—'}</div>
              {monitor.duration_hours ? <div className="text-muted" style={{ fontSize: 11 }}>auto-stops after {monitor.duration_hours}h</div> :
                <div className="text-muted" style={{ fontSize: 11 }}>runs until stopped</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Violations table */}
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
    </div>
  );
};

export default MonitorOnlyRun;
