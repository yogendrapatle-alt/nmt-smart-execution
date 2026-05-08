import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader';
import { useToast } from '../context/ToastContext';
import { getApiBase } from '../utils/backendUrl';

interface MonitorRow {
  monitor_id: string;
  testbed_id: string;
  name?: string;
  status: string;
  started_at?: string;
  stopped_at?: string;
  poll_interval_s: number;
  duration_hours?: number | null;
  total_polls: number;
  total_violations: number;
}

const STATUS_COLORS: Record<string, string> = {
  STARTING: '#f59e0b',
  RUNNING: '#22c55e',
  STOPPED: '#6b7280',
  FAILED: '#ef4444',
};

const MonitorOnlySessions: React.FC = () => {
  const navigate = useNavigate();
  const { addToast, confirm } = useToast();
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const url = `${getApiBase()}/api/monitor-only/list${filterStatus ? `?status=${filterStatus}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data?.success) setRows(data.monitors || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 10000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const stop = async (monitorId: string) => {
    const ok = await confirm({ title: 'Stop monitor?', message: monitorId, confirmLabel: 'Stop', variant: 'warning' });
    if (!ok) return;
    try {
      const res = await fetch(`${getApiBase()}/api/monitor-only/stop/${monitorId}`, { method: 'POST' });
      const data = await res.json();
      if (data?.success) {
        addToast('success', 'Stop signal sent');
        refresh();
      } else {
        addToast('error', data?.error || 'Failed');
      }
    } catch (e: unknown) {
      addToast('error', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="container-fluid py-3">
      <PageHeader
        icon="visibility"
        iconGradient="linear-gradient(135deg, #0ea5e9, #0369a1)"
        title="Monitor-Only Sessions"
        subtitle="Standalone Prometheus rule watchers — past and live."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => navigate('/monitor-only')}>
            <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>add</i>
            Start a new monitor
          </button>
        }
      />

      <div className="d-flex gap-2 mb-3 align-items-center">
        <span className="text-muted" style={{ fontSize: 12 }}>Filter:</span>
        {['', 'RUNNING', 'STOPPED', 'FAILED'].map(s => (
          <button key={s || 'all'} type="button"
            className={`btn btn-sm ${filterStatus === s ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setFilterStatus(s)}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="alert alert-info">No monitor sessions yet. Click <strong>Start a new monitor</strong>.</div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-sm mb-0" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Name / ID</th>
                  <th>Testbed</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 120 }}>Started</th>
                  <th className="text-center" style={{ width: 80 }}>Polls</th>
                  <th className="text-center" style={{ width: 100 }}>Violations</th>
                  <th style={{ width: 200 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const sc = STATUS_COLORS[r.status] || '#6b7280';
                  const isLive = r.status === 'RUNNING' || r.status === 'STARTING';
                  return (
                    <tr key={r.monitor_id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.name || r.monitor_id}</div>
                        <div className="text-muted" style={{ fontSize: 10, fontFamily: 'monospace' }}>{r.monitor_id}</div>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.testbed_id}</td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 999, background: `${sc}1a`, color: sc, fontSize: 11, fontWeight: 700 }}>
                          {r.status}
                        </span>
                      </td>
                      <td className="text-muted" style={{ fontSize: 11 }}>{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</td>
                      <td className="text-center">{r.total_polls}</td>
                      <td className="text-center">
                        <span style={{ color: r.total_violations > 0 ? '#ef4444' : 'var(--color-text-muted)', fontWeight: 600 }}>
                          {r.total_violations}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline-primary me-2" onClick={() => navigate(`/monitor-only/run/${r.monitor_id}`)}>
                          <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>open_in_new</i> Live
                        </button>
                        <button className="btn btn-sm btn-outline-secondary me-2" onClick={() => navigate(`/monitor-only/report/${r.monitor_id}`)}>
                          <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>description</i> Report
                        </button>
                        {isLive && (
                          <button className="btn btn-sm btn-outline-danger" onClick={() => stop(r.monitor_id)}>
                            <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>stop_circle</i> Stop
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitorOnlySessions;
