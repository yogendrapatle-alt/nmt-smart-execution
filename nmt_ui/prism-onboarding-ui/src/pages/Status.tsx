import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBase } from '../utils/backendUrl';
import { IS_FAKE_MODE } from '../config/fakeMode';
import { getFakeTestbeds, getFakeAlertsByTestbed, getFakeExecutionsByTestbed } from '../fake-data';

interface Testbed {
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string;
  ncm_ip?: string;
  prometheus_url?: string;
  username: string;
  password: string;
  timestamp: string;
  testbed_json?: {
    prometheus_endpoint?: string;
    [key: string]: any;
  };
}

interface Alert {
  id: string;
  testbed_id: string;
  alert_name: string;
  severity: string;
  status: string;
  description: string;
  timestamp: string;
}

interface ExecutionRecord {
  execution_id: string;
  testbed_id: string;
  status: string;
  start_time?: string;
  started_at?: string;
  end_time?: string;
  completed_at?: string;
  duration_minutes?: number;
  total_operations?: number;
  successful_operations?: number;
  failed_operations?: number;
  success_rate?: number;
  testbed_label?: string;
}

const AUTO_REFRESH_INTERVALS = [
  { label: 'Off', value: 0 },
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
  { label: '1m', value: 60000 },
  { label: '5m', value: 300000 },
];

const Status: React.FC = () => {
  const navigate = useNavigate();
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbed, setSelectedTestbed] = useState<string>('');
  const [selectedTestbedDetails, setSelectedTestbedDetails] = useState<Testbed | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prometheusStatus, setPrometheusStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(30000);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { fetchTestbeds(); }, []);

  useEffect(() => {
    if (selectedTestbed) {
      const testbed = testbeds.find(t => t.unique_testbed_id === selectedTestbed);
      setSelectedTestbedDetails(testbed || null);
      fetchAlerts(selectedTestbed);
      fetchExecutions(selectedTestbed);
      const promUrl = getPrometheusUrl(testbed);
      checkPrometheusStatus(promUrl);
    }
  }, [selectedTestbed, testbeds]);

  const refreshAll = useCallback(() => {
    if (!selectedTestbed) return;
    fetchAlerts(selectedTestbed);
    fetchExecutions(selectedTestbed);
    const testbed = testbeds.find(t => t.unique_testbed_id === selectedTestbed);
    checkPrometheusStatus(getPrometheusUrl(testbed));
    setLastRefreshed(new Date());
  }, [selectedTestbed, testbeds]);

  useEffect(() => {
    if (refreshTimerRef.current) { clearInterval(refreshTimerRef.current); refreshTimerRef.current = null; }
    if (autoRefreshInterval > 0 && selectedTestbed) {
      refreshTimerRef.current = setInterval(refreshAll, autoRefreshInterval);
    }
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [autoRefreshInterval, refreshAll, selectedTestbed]);

  const getPrometheusUrl = (testbed?: Testbed | null): string | undefined => {
    if (!testbed) return undefined;
    if (testbed.prometheus_url) return testbed.prometheus_url;
    if (testbed.testbed_json?.prometheus_endpoint) return testbed.testbed_json.prometheus_endpoint;
    return undefined;
  };

  const fetchTestbeds = async () => {
    try {
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const data = getFakeTestbeds();
        if (data.success && data.testbeds) {
          setTestbeds(data.testbeds as any);
          if (data.testbeds.length > 0 && !selectedTestbed) setSelectedTestbed(data.testbeds[0].unique_testbed_id);
        }
        setLoading(false);
        return;
      }
      const base = getApiBase();
      const response = await fetch(`${base}/api/get-testbeds`);
      const data = await response.json();
      if (data.success && data.testbeds) {
        setTestbeds(data.testbeds);
        if (data.testbeds.length > 0 && !selectedTestbed) setSelectedTestbed(data.testbeds[0].unique_testbed_id);
      }
    } catch (err) {
      console.error('Error fetching testbeds:', err);
      setError('Failed to fetch testbeds');
    } finally {
      setLoading(false);
    }
  };

  const fetchAlerts = async (testbedId: string) => {
    try {
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const data = getFakeAlertsByTestbed(testbedId);
        setAlerts(data.alerts as any || []);
        return;
      }
      const base = getApiBase();
      const response = await fetch(`${base}/api/alerts/${testbedId}`);
      const data = await response.json();
      if (data.success) setAlerts(data.alerts || []);
    } catch (err) {
      console.warn('Error fetching alerts:', err);
    }
  };

  const fetchExecutions = async (testbedId: string) => {
    try {
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const data = getFakeExecutionsByTestbed(testbedId);
        setExecutions(data.executions as any || []);
        return;
      }
      const base = getApiBase();
      const response = await fetch(`${base}/api/smart-execution/history?testbed_id=${testbedId}`);
      const data = await response.json();
      if (data.success) setExecutions(data.executions || []);
    } catch (err) {
      console.warn('Error fetching executions:', err);
    }
  };

  const checkPrometheusStatus = async (url?: string) => {
    if (!url) { setPrometheusStatus('offline'); return; }
    try {
      setPrometheusStatus('checking');
      const base = getApiBase();
      const response = await fetch(`${base}/api/check-prometheus?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      setPrometheusStatus(data.status === 'online' ? 'online' : 'offline');
    } catch (err) {
      console.warn('Error checking Prometheus status:', err);
      setPrometheusStatus('offline');
    }
  };

  const getExecStartTime = (exec: ExecutionRecord): string | undefined => exec.start_time || exec.started_at;

  const getExecutionStatusColor = (status: string) => {
    switch (status.toUpperCase()) {
      case 'COMPLETED': return 'bg-success';
      case 'FAILED': case 'TIMEOUT': return 'bg-danger';
      case 'RUNNING': return 'bg-primary';
      case 'STOPPED': return 'bg-secondary';
      default: return 'bg-secondary';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'critical': return 'bg-danger';
      case 'warning': return 'bg-warning text-dark';
      case 'info': return 'bg-info';
      default: return 'bg-secondary';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active': case 'firing': return 'bg-danger';
      case 'pending': return 'bg-warning text-dark';
      case 'resolved': return 'bg-success';
      default: return 'bg-secondary';
    }
  };

  const totalExecs = executions.length;
  const completedExecs = executions.filter(e => e.status?.toUpperCase() === 'COMPLETED').length;
  const failedExecs = executions.filter(e => ['FAILED', 'TIMEOUT'].includes(e.status?.toUpperCase())).length;
  const runningExecs = executions.filter(e => e.status?.toUpperCase() === 'RUNNING').length;
  const avgSuccessRate = executions.length > 0 ? executions.reduce((sum, e) => sum + (e.success_rate || 0), 0) / executions.length : 0;
  const activeAlerts = alerts.filter(a => ['active', 'firing'].includes(a.status.toLowerCase())).length;
  const criticalAlerts = alerts.filter(a => a.severity.toLowerCase() === 'critical').length;

  return (
    <div className="main-content">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-3">
        <div>
          <h2 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>monitoring</i>
            </div>
            Testbed Health & Status
          </h2>
          <p className="text-muted mb-0" style={{ maxWidth: 700 }}>
            Real-time health overview of your testbed. See active alerts, execution history, and service connectivity at a glance. Select a testbed below to view its current status.
          </p>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span className="text-muted" style={{ fontSize: '0.78rem' }}>Updated {lastRefreshed.toLocaleTimeString()}</span>
          <select className="form-select form-select-sm rounded-3" value={autoRefreshInterval} onChange={e => setAutoRefreshInterval(Number(e.target.value))} style={{ width: 'auto' }}>
            {AUTO_REFRESH_INTERVALS.map(opt => <option key={opt.value} value={opt.value}>Auto: {opt.label}</option>)}
          </select>
          <button className="btn btn-outline-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={refreshAll}>
            <i className="material-icons-outlined" style={{ fontSize: 18 }}>refresh</i>
          </button>
        </div>
      </div>

      {/* Testbed Selector */}
      <div className="card rounded-4 border shadow-none mb-4">
        <div className="card-body p-4">
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 40, height: 40, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>dns</i>
            </div>
            <div className="flex-grow-1" style={{ maxWidth: 400 }}>
              <label className="form-label fw-semibold small mb-1">Select Testbed</label>
              {loading ? (
                <div className="d-flex align-items-center gap-2 text-muted"><span className="spinner-border spinner-border-sm"></span>Loading testbeds...</div>
              ) : error ? (
                <div className="text-danger small">{error}</div>
              ) : (
                <select className="form-select form-select-sm rounded-3" value={selectedTestbed} onChange={e => setSelectedTestbed(e.target.value)}>
                  <option value="">-- Select a testbed --</option>
                  {testbeds.map(tb => <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>{tb.testbed_label} ({tb.pc_ip})</option>)}
                </select>
              )}
            </div>
            {selectedTestbedDetails && (
              <div className="d-flex gap-4 ms-auto flex-wrap">
                {selectedTestbedDetails.pc_ip && (
                  <div className="small"><span className="text-muted">PC:</span> <code className="ms-1">{selectedTestbedDetails.pc_ip}</code></div>
                )}
                {selectedTestbedDetails.ncm_ip && (
                  <div className="small"><span className="text-muted">NCM:</span> <code className="ms-1">{selectedTestbedDetails.ncm_ip}</code></div>
                )}
                <div className="small"><span className="text-muted">Onboarded:</span> <span className="ms-1">{new Date(selectedTestbedDetails.timestamp).toLocaleDateString()}</span></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {!selectedTestbed && !loading && (
        <div className="card rounded-4 border shadow-none">
          <div className="card-body p-5 text-center">
            <i className="material-icons-outlined text-muted mb-3" style={{ fontSize: 64, opacity: 0.3 }}>monitor_heart</i>
            <h5 className="fw-semibold mb-2">Select a Testbed to View Status</h5>
            <p className="text-muted mb-0" style={{ maxWidth: 500, margin: '0 auto' }}>
              Choose a testbed from the dropdown above to see its health status, active alerts, Prometheus connectivity, and recent execution history.
            </p>
          </div>
        </div>
      )}

      {selectedTestbedDetails && (
        <>
          {/* Summary Cards */}
          <div className="row g-3 mb-4">
            {[
              { icon: 'history', label: 'Total Executions', value: totalExecs, color: '#8b5cf6', sub: `${completedExecs} completed` },
              { icon: runningExecs > 0 ? 'play_circle' : 'check_circle', label: runningExecs > 0 ? 'Running Now' : 'Completed', value: runningExecs > 0 ? runningExecs : completedExecs, color: runningExecs > 0 ? '#3b82f6' : '#22c55e', sub: runningExecs > 0 ? 'In progress' : `${failedExecs} failed` },
              { icon: 'trending_up', label: 'Avg Success Rate', value: `${avgSuccessRate.toFixed(1)}%`, color: avgSuccessRate >= 80 ? '#22c55e' : avgSuccessRate >= 50 ? '#f59e0b' : '#ef4444', sub: 'Across all executions' },
              { icon: 'warning', label: 'Active Alerts', value: activeAlerts, color: activeAlerts > 0 ? '#ef4444' : '#22c55e', sub: criticalAlerts > 0 ? `${criticalAlerts} critical` : 'No critical alerts' },
            ].map((c, i) => (
              <div className="col-md-3" key={i}>
                <div className="card rounded-4 border shadow-none h-100">
                  <div className="card-body d-flex align-items-center gap-3 p-3">
                    <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 48, height: 48, background: `${c.color}15` }}>
                      <i className="material-icons-outlined" style={{ fontSize: 26, color: c.color }}>{c.icon}</i>
                    </div>
                    <div>
                      <div className="text-muted small">{c.label}</div>
                      <div className="fw-bold fs-4" style={{ color: c.color }}>{c.value}</div>
                      <div className="text-muted" style={{ fontSize: '0.72rem' }}>{c.sub}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Prometheus + Testbed Info Row */}
          <div className="row g-3 mb-4">
            <div className="col-md-6">
              <div className="card rounded-4 border shadow-none h-100">
                <div className="card-header bg-transparent border-bottom p-4">
                  <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
                    <i className="material-icons-outlined" style={{ fontSize: 20, color: prometheusStatus === 'online' ? '#22c55e' : prometheusStatus === 'offline' ? '#ef4444' : '#f59e0b' }}>
                      {prometheusStatus === 'online' ? 'cloud_done' : prometheusStatus === 'offline' ? 'cloud_off' : 'cloud_sync'}
                    </i>
                    Prometheus Monitoring
                    <span className={`badge rounded-pill ms-2 ${prometheusStatus === 'online' ? 'bg-success' : prometheusStatus === 'offline' ? 'bg-danger' : 'bg-warning text-dark'}`} style={{ fontSize: '0.7rem' }}>
                      {prometheusStatus === 'online' ? 'Connected' : prometheusStatus === 'offline' ? 'Disconnected' : 'Checking...'}
                    </span>
                  </h6>
                </div>
                <div className="card-body p-4">
                  <p className="text-muted small mb-3">
                    Prometheus collects real-time metrics (CPU, memory, disk) from your cluster. When connected, it powers the alert system and resource monitoring.
                  </p>
                  {getPrometheusUrl(selectedTestbedDetails) ? (
                    <div className="d-flex align-items-center gap-2">
                      <span className="text-muted small">Endpoint:</span>
                      <code className="small">{getPrometheusUrl(selectedTestbedDetails)}</code>
                    </div>
                  ) : (
                    <div className="text-muted small fst-italic">No Prometheus endpoint configured for this testbed</div>
                  )}
                  <button className="btn btn-outline-primary btn-sm rounded-3 mt-3 d-flex align-items-center gap-1" onClick={() => checkPrometheusStatus(getPrometheusUrl(selectedTestbedDetails))}>
                    <i className="material-icons-outlined" style={{ fontSize: 16 }}>refresh</i>Check Connection
                  </button>
                </div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="card rounded-4 border shadow-none h-100">
                <div className="card-header bg-transparent border-bottom p-4">
                  <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
                    <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>info</i>
                    Testbed Details
                  </h6>
                </div>
                <div className="card-body p-4">
                  <div className="row g-3">
                    {[
                      { label: 'Name', value: selectedTestbedDetails.testbed_label },
                      { label: 'PC IP', value: selectedTestbedDetails.pc_ip, code: true },
                      ...(selectedTestbedDetails.ncm_ip ? [{ label: 'NCM IP', value: selectedTestbedDetails.ncm_ip, code: true }] : []),
                      { label: 'Onboarded', value: new Date(selectedTestbedDetails.timestamp).toLocaleString() },
                    ].map((row, i) => (
                      <div className="col-6" key={i}>
                        <div className="text-muted small">{row.label}</div>
                        <div className="fw-medium small">{(row as any).code ? <code>{row.value}</code> : row.value}</div>
                      </div>
                    ))}
                    <div className="col-12">
                      <div className="text-muted small">Testbed ID</div>
                      <code style={{ fontSize: '0.72rem' }}>{selectedTestbedDetails.unique_testbed_id}</code>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Active Alerts */}
          <div className="card rounded-4 border shadow-none mb-4">
            <div className="card-header bg-transparent border-bottom p-4 d-flex justify-content-between align-items-center">
              <div>
                <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
                  <i className="material-icons-outlined" style={{ fontSize: 20, color: alerts.length > 0 ? '#ef4444' : '#22c55e' }}>
                    {alerts.length > 0 ? 'warning' : 'verified'}
                  </i>
                  Active Alerts
                  {alerts.length > 0 && <span className="badge bg-danger rounded-pill">{alerts.length}</span>}
                </h6>
                <p className="text-muted small mb-0 mt-1">Resource alerts fired by Prometheus for this testbed (e.g. high CPU, memory, or disk usage)</p>
              </div>
              <button className="btn btn-outline-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => navigate('/alert-summary')}>
                <i className="material-icons-outlined" style={{ fontSize: 16 }}>open_in_new</i>Full Alert Dashboard
              </button>
            </div>
            <div className="card-body p-4">
              {alerts.length === 0 ? (
                <div className="d-flex align-items-center gap-2 p-3 rounded-3" style={{ background: '#dcfce7', border: '1px solid #86efac' }}>
                  <i className="material-icons-outlined" style={{ color: '#166534', fontSize: 22 }}>check_circle</i>
                  <span style={{ color: '#166534', fontWeight: 500 }}>No active alerts — all systems healthy for this testbed</span>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.82rem' }}>
                    <thead className="table-light">
                      <tr><th className="ps-3">Alert</th><th>Severity</th><th>Status</th><th>Description</th><th>Time</th></tr>
                    </thead>
                    <tbody>
                      {alerts.slice(0, 10).map(alert => (
                        <tr key={alert.id}>
                          <td className="ps-3 fw-medium">{alert.alert_name}</td>
                          <td><span className={`badge rounded-pill ${getSeverityBadge(alert.severity)}`}>{alert.severity}</span></td>
                          <td><span className={`badge rounded-pill ${getStatusBadge(alert.status)}`}>{alert.status}</span></td>
                          <td className="text-muted" style={{ maxWidth: 300 }}>{alert.description.length > 100 ? alert.description.slice(0, 100) + '...' : alert.description}</td>
                          <td className="text-muted text-nowrap">{new Date(alert.timestamp).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {alerts.length > 10 && <div className="text-center mt-3"><button className="btn btn-link btn-sm" onClick={() => navigate('/alert-summary')}>View all {alerts.length} alerts</button></div>}
                </div>
              )}
            </div>
          </div>

          {/* Recent Executions */}
          <div className="card rounded-4 border shadow-none">
            <div className="card-header bg-transparent border-bottom p-4 d-flex justify-content-between align-items-center">
              <div>
                <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>history</i>
                  Recent Executions
                  <span className="badge bg-light text-muted rounded-pill">{executions.length}</span>
                </h6>
                <p className="text-muted small mb-0 mt-1">Smart Execution runs on this testbed — click any row to view its report or live monitor</p>
              </div>
              <button className="btn btn-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => navigate('/smart-execution/history')}>
                <i className="material-icons-outlined" style={{ fontSize: 16 }}>list</i>View All
              </button>
            </div>
            <div className="card-body p-0">
              {executions.length === 0 ? (
                <div className="text-center py-5">
                  <i className="material-icons-outlined text-muted mb-2" style={{ fontSize: 48, opacity: 0.3 }}>rocket_launch</i>
                  <p className="text-muted mb-0">No executions yet for this testbed</p>
                  <button className="btn btn-primary btn-sm rounded-3 mt-3" onClick={() => navigate('/smart-execution/configure')}>Start First Execution</button>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.82rem' }}>
                    <thead className="table-light">
                      <tr><th className="ps-4">Execution</th><th>Status</th><th>Started</th><th>Duration</th><th>Operations</th><th>Success Rate</th><th></th></tr>
                    </thead>
                    <tbody>
                      {executions.slice(0, 10).map(exec => {
                        const startTime = getExecStartTime(exec);
                        const isRunning = exec.status?.toUpperCase() === 'RUNNING';
                        return (
                          <tr key={exec.execution_id} style={{ cursor: 'pointer' }}
                            onClick={() => navigate(isRunning ? `/smart-execution/monitor/${exec.execution_id}` : `/smart-execution/report/${exec.execution_id}`)}>
                            <td className="ps-4">
                              <code style={{ fontSize: '0.72rem' }}>{exec.execution_id.length > 28 ? exec.execution_id.substring(0, 28) + '...' : exec.execution_id}</code>
                            </td>
                            <td><span className={`badge rounded-pill ${getExecutionStatusColor(exec.status)}`}>{exec.status}</span></td>
                            <td className="text-muted">{startTime ? new Date(startTime).toLocaleString() : '—'}</td>
                            <td>{exec.duration_minutes != null ? `${exec.duration_minutes.toFixed(1)} min` : '—'}</td>
                            <td>{exec.successful_operations != null && exec.total_operations != null ? <><span className="fw-medium">{exec.successful_operations}</span><span className="text-muted">/{exec.total_operations}</span></> : '—'}</td>
                            <td>
                              {exec.success_rate != null ? (
                                <span className={`fw-semibold ${exec.success_rate >= 80 ? 'text-success' : exec.success_rate >= 50 ? 'text-warning' : 'text-danger'}`}>{exec.success_rate.toFixed(1)}%</span>
                              ) : '—'}
                            </td>
                            <td><i className="material-icons-outlined text-muted" style={{ fontSize: 18 }}>{isRunning ? 'visibility' : 'description'}</i></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Status;
