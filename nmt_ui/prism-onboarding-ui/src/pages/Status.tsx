import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBase } from '../utils/backendUrl';
import { IS_FAKE_MODE } from '../config/fakeMode';
import { getFakeTestbeds, getFakeAlertsByTestbed, getFakeExecutionsByTestbed } from '../fake-data';
import { PageHeader, MetricCard, StatusBadge, EmptyState } from '../components/ui';
import { SkeletonMetricRow, SkeletonTable } from '../components/ui/LoadingSkeleton';

interface Testbed {
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string;
  ncm_ip?: string;
  prometheus_url?: string;
  username: string;
  password: string;
  timestamp: string;
  testbed_json?: { prometheus_endpoint?: string; [key: string]: any };
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
      checkPrometheusStatus(getPrometheusUrl(testbed));
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
    return testbed.prometheus_url || testbed.testbed_json?.prometheus_endpoint || undefined;
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
      const [tbRes, histRes] = await Promise.all([
        fetch(`${base}/api/get-testbeds`),
        fetch(`${base}/api/smart-execution/history`),
      ]);
      const data = await tbRes.json();
      if (data.success && data.testbeds) {
        setTestbeds(data.testbeds);
        if (data.testbeds.length > 0 && !selectedTestbed) {
          let bestId = data.testbeds[0].unique_testbed_id;
          try {
            const histData = await histRes.json();
            const execs = histData.executions || [];
            if (execs.length > 0) {
              const counts: Record<string, number> = {};
              execs.forEach((e: any) => { counts[e.testbed_id] = (counts[e.testbed_id] || 0) + 1; });
              const tbIds = new Set(data.testbeds.map((t: any) => t.unique_testbed_id));
              const best = Object.entries(counts).filter(([id]) => tbIds.has(id)).sort((a, b) => b[1] - a[1])[0];
              if (best) bestId = best[0];
            }
          } catch { /* best-effort */ }
          setSelectedTestbed(bestId);
        }
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
      const response = await fetch(`${getApiBase()}/api/alerts/${testbedId}`);
      const data = await response.json();
      if (data.success) setAlerts(data.alerts || []);
    } catch (err) { console.warn('Error fetching alerts:', err); }
  };

  const fetchExecutions = async (testbedId: string) => {
    try {
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const data = getFakeExecutionsByTestbed(testbedId);
        setExecutions(data.executions as any || []);
        return;
      }
      const response = await fetch(`${getApiBase()}/api/smart-execution/history?testbed_id=${testbedId}`);
      const data = await response.json();
      if (data.success) setExecutions(data.executions || []);
    } catch (err) { console.warn('Error fetching executions:', err); }
  };

  const checkPrometheusStatus = async (url?: string) => {
    if (!url) { setPrometheusStatus('offline'); return; }
    try {
      setPrometheusStatus('checking');
      const response = await fetch(`${getApiBase()}/api/check-prometheus?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      setPrometheusStatus(data.status === 'online' ? 'online' : 'offline');
    } catch { setPrometheusStatus('offline'); }
  };

  const getExecStartTime = (exec: ExecutionRecord) => exec.start_time || exec.started_at;

  const execStatusVariant = (status: string): 'success' | 'danger' | 'primary' | 'neutral' => {
    const s = status.toUpperCase();
    if (s === 'COMPLETED') return 'success';
    if (s === 'FAILED' || s === 'TIMEOUT') return 'danger';
    if (s === 'RUNNING') return 'primary';
    return 'neutral';
  };

  const alertSeverityVariant = (severity: string): 'danger' | 'warning' | 'info' | 'neutral' => {
    const s = severity.toLowerCase();
    if (s === 'critical') return 'danger';
    if (s === 'warning' || s === 'moderate') return 'warning';
    if (s === 'info' || s === 'low') return 'info';
    return 'neutral';
  };

  const alertStatusVariant = (status: string): 'danger' | 'warning' | 'success' | 'neutral' => {
    const s = status.toLowerCase();
    if (s === 'active' || s === 'firing') return 'danger';
    if (s === 'pending') return 'warning';
    if (s === 'resolved') return 'success';
    return 'neutral';
  };

  const totalExecs = executions.length;
  const completedExecs = executions.filter(e => e.status?.toUpperCase() === 'COMPLETED').length;
  const failedExecs = executions.filter(e => ['FAILED', 'TIMEOUT'].includes(e.status?.toUpperCase())).length;
  const runningExecs = executions.filter(e => e.status?.toUpperCase() === 'RUNNING').length;
  const avgSuccessRate = executions.length > 0 ? executions.reduce((sum, e) => sum + (e.success_rate || 0), 0) / executions.length : 0;
  const activeAlerts = alerts.filter(a => ['active', 'firing'].includes(a.status.toLowerCase())).length;
  const resolvedAlerts = alerts.filter(a => a.status.toLowerCase() === 'resolved').length;
  const criticalAlerts = alerts.filter(a => a.severity.toLowerCase() === 'critical').length;
  const successRateVariant: 'success' | 'warning' | 'danger' = avgSuccessRate >= 80 ? 'success' : avgSuccessRate >= 50 ? 'warning' : 'danger';

  const promVariant: 'success' | 'danger' | 'warning' = prometheusStatus === 'online' ? 'success' : prometheusStatus === 'offline' ? 'danger' : 'warning';
  const promLabel = prometheusStatus === 'online' ? 'Connected' : prometheusStatus === 'offline' ? 'Disconnected' : 'Checking…';

  return (
    <div className="main-content">
      <PageHeader
        icon="monitoring"
        iconGradient="linear-gradient(135deg, #10b981, #059669)"
        title="Testbed Health & Status"
        subtitle="Real-time health overview — alerts, execution history, and service connectivity at a glance."
        actions={
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Updated {lastRefreshed.toLocaleTimeString()}</span>
            <select className="form-select form-select-sm rounded-3" value={autoRefreshInterval} onChange={e => setAutoRefreshInterval(Number(e.target.value))} style={{ width: 'auto' }}>
              {AUTO_REFRESH_INTERVALS.map(opt => <option key={opt.value} value={opt.value}>Auto: {opt.label}</option>)}
            </select>
            <button className="btn btn-outline-primary btn-sm rounded-3 d-flex align-items-center" onClick={refreshAll}>
              <i className="material-icons-outlined" style={{ fontSize: 18 }}>refresh</i>
            </button>
          </div>
        }
      />

      {/* Testbed Selector */}
      <div className="card border-0 rounded-3 mb-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="card-body p-4">
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 40, height: 40, background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>dns</i>
            </div>
            <div className="flex-grow-1" style={{ maxWidth: 400 }}>
              <label className="form-label fw-semibold mb-1" style={{ fontSize: 'var(--text-sm)' }}>Select Testbed</label>
              {loading ? (
                <div className="d-flex align-items-center gap-2" style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
                  <span className="spinner-border spinner-border-sm" />Loading testbeds…
                </div>
              ) : error ? (
                <div className="text-danger" style={{ fontSize: 'var(--text-sm)' }}>{error}</div>
              ) : (
                <select className="form-select form-select-sm rounded-3" value={selectedTestbed} onChange={e => setSelectedTestbed(e.target.value)}>
                  <option value="">-- Select a testbed --</option>
                  {testbeds.map(tb => <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>{tb.testbed_label} ({tb.pc_ip})</option>)}
                </select>
              )}
            </div>
            {selectedTestbedDetails && (
              <div className="d-flex gap-4 ms-auto flex-wrap">
                {selectedTestbedDetails.pc_ip && <div style={{ fontSize: 'var(--text-sm)' }}><span style={{ color: 'var(--color-text-muted)' }}>PC:</span> <code className="ms-1">{selectedTestbedDetails.pc_ip}</code></div>}
                {selectedTestbedDetails.ncm_ip && <div style={{ fontSize: 'var(--text-sm)' }}><span style={{ color: 'var(--color-text-muted)' }}>NCM:</span> <code className="ms-1">{selectedTestbedDetails.ncm_ip}</code></div>}
                <div style={{ fontSize: 'var(--text-sm)' }}><span style={{ color: 'var(--color-text-muted)' }}>Onboarded:</span> <span className="ms-1">{new Date(selectedTestbedDetails.timestamp).toLocaleDateString()}</span></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* No testbed selected */}
      {!selectedTestbed && !loading && (
        <EmptyState icon="monitor_heart" title="Select a Testbed to View Status" description="Choose a testbed from the dropdown above to see health status, active alerts, Prometheus connectivity, and execution history." />
      )}

      {/* Loading skeleton while testbed content loads */}
      {loading && (
        <>
          <SkeletonMetricRow count={4} />
          <SkeletonTable rows={4} cols={5} />
        </>
      )}

      {selectedTestbedDetails && (
        <>
          {/* Summary Metric Cards */}
          <div className="row row-cols-1 row-cols-md-2 row-cols-xl-4 g-3 mb-4">
            <div className="col">
              <MetricCard icon="history" iconGradient="linear-gradient(135deg, #8b5cf6, #7c3aed)" label="Total Executions" value={totalExecs} detail={`${completedExecs} completed`} />
            </div>
            <div className="col">
              <MetricCard
                icon={runningExecs > 0 ? 'play_circle' : 'check_circle'}
                variant={runningExecs > 0 ? 'default' : 'success'}
                label={runningExecs > 0 ? 'Running Now' : 'Completed'}
                value={runningExecs > 0 ? runningExecs : completedExecs}
                detail={runningExecs > 0 ? 'In progress' : `${failedExecs} failed`}
              />
            </div>
            <div className="col">
              <MetricCard icon="trending_up" variant={successRateVariant} label="Avg Success Rate" value={`${avgSuccessRate.toFixed(1)}`} suffix="%" detail="Across all executions" />
            </div>
            <div className="col">
              <MetricCard
                icon="warning"
                variant={activeAlerts > 0 ? 'danger' : 'success'}
                label="Alerts"
                value={alerts.length}
                detail={activeAlerts > 0 ? `${activeAlerts} active, ${criticalAlerts} critical` : `${resolvedAlerts} resolved`}
              />
            </div>
          </div>

          {/* Prometheus + Testbed Details */}
          <div className="row g-3 mb-4">
            <div className="col-md-6">
              <div className="card border-0 rounded-3 h-100" style={{ boxShadow: 'var(--shadow-sm)' }}>
                <div className="card-body p-4">
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <i className="material-icons-outlined" style={{ fontSize: 20, color: promVariant === 'success' ? 'var(--color-success)' : promVariant === 'danger' ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                      {prometheusStatus === 'online' ? 'cloud_done' : prometheusStatus === 'offline' ? 'cloud_off' : 'cloud_sync'}
                    </i>
                    <h6 className="mb-0 fw-semibold" style={{ fontSize: 'var(--text-md)' }}>Prometheus Monitoring</h6>
                    <StatusBadge label={promLabel} variant={promVariant} dot size="sm" />
                  </div>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }} className="mb-3">
                    Prometheus collects real-time metrics (CPU, memory, disk) from your cluster and powers the alert system.
                  </p>
                  {getPrometheusUrl(selectedTestbedDetails) ? (
                    <div className="d-flex align-items-center gap-2 mb-3">
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Endpoint:</span>
                      <code style={{ fontSize: 'var(--text-sm)' }}>{getPrometheusUrl(selectedTestbedDetails)}</code>
                    </div>
                  ) : (
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', fontStyle: 'italic' }} className="mb-3">No Prometheus endpoint configured</div>
                  )}
                  <button className="btn btn-outline-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => checkPrometheusStatus(getPrometheusUrl(selectedTestbedDetails))}>
                    <i className="material-icons-outlined" style={{ fontSize: 16 }}>refresh</i>Check Connection
                  </button>
                </div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="card border-0 rounded-3 h-100" style={{ boxShadow: 'var(--shadow-sm)' }}>
                <div className="card-body p-4">
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <i className="material-icons-outlined" style={{ fontSize: 20, color: 'var(--color-primary)' }}>info</i>
                    <h6 className="mb-0 fw-semibold" style={{ fontSize: 'var(--text-md)' }}>Testbed Details</h6>
                  </div>
                  <div className="row g-3">
                    {[
                      { label: 'Name', value: selectedTestbedDetails.testbed_label },
                      { label: 'PC IP', value: selectedTestbedDetails.pc_ip, code: true },
                      ...(selectedTestbedDetails.ncm_ip ? [{ label: 'NCM IP', value: selectedTestbedDetails.ncm_ip, code: true }] : []),
                      { label: 'Onboarded', value: new Date(selectedTestbedDetails.timestamp).toLocaleString() },
                    ].map((row, i) => (
                      <div className="col-6" key={i}>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{row.label}</div>
                        <div className="fw-medium" style={{ fontSize: 'var(--text-sm)' }}>{(row as any).code ? <code>{row.value}</code> : row.value}</div>
                      </div>
                    ))}
                    <div className="col-12">
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Testbed ID</div>
                      <code style={{ fontSize: 'var(--text-xs)' }}>{selectedTestbedDetails.unique_testbed_id}</code>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Active Alerts */}
          <div className="card border-0 rounded-3 mb-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="card-body p-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center gap-2">
                  <i className="material-icons-outlined" style={{ fontSize: 20, color: activeAlerts > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                    {activeAlerts > 0 ? 'warning' : 'verified'}
                  </i>
                  <h6 className="mb-0 fw-semibold" style={{ fontSize: 'var(--text-md)' }}>Alerts</h6>
                  {alerts.length > 0 && (
                    <div className="d-flex gap-1">
                      {activeAlerts > 0 && <StatusBadge label={`${activeAlerts} active`} variant="danger" size="sm" />}
                      {resolvedAlerts > 0 && <StatusBadge label={`${resolvedAlerts} resolved`} variant="success" size="sm" />}
                    </div>
                  )}
                </div>
                <button className="btn btn-outline-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => navigate('/alert-summary')}>
                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>open_in_new</i>Full Alert Dashboard
                </button>
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }} className="mb-3">Resource alerts fired by Prometheus for this testbed</p>

              {alerts.length === 0 ? (
                <div className="d-flex align-items-center gap-2 p-3 rounded-3" style={{ background: 'var(--color-success-light)' }}>
                  <i className="material-icons-outlined" style={{ color: 'var(--color-success)', fontSize: 22 }}>check_circle</i>
                  <span style={{ color: 'var(--color-success)', fontWeight: 500, fontSize: 'var(--text-base)' }}>No alerts recorded for this testbed</span>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: 'var(--text-sm)' }}>
                    <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                      <th className="fw-semibold border-0 pb-2 ps-3">Alert</th>
                      <th className="fw-semibold border-0 pb-2">Severity</th>
                      <th className="fw-semibold border-0 pb-2">Status</th>
                      <th className="fw-semibold border-0 pb-2">Description</th>
                      <th className="fw-semibold border-0 pb-2">Time</th>
                    </tr></thead>
                    <tbody>
                      {alerts.slice(0, 10).map(alert => (
                        <tr key={alert.id}>
                          <td className="ps-3 fw-medium border-0">{alert.alert_name}</td>
                          <td className="border-0"><StatusBadge label={alert.severity} variant={alertSeverityVariant(alert.severity)} size="sm" /></td>
                          <td className="border-0"><StatusBadge label={alert.status} variant={alertStatusVariant(alert.status)} dot size="sm" /></td>
                          <td className="border-0" style={{ maxWidth: 300, color: 'var(--color-text-secondary)' }}>
                            {alert.description ? (alert.description.length > 100 ? alert.description.slice(0, 100) + '…' : alert.description) : (alert as any).metric_value != null ? `Value: ${(alert as any).metric_value?.toFixed?.(1) ?? (alert as any).metric_value} / Threshold: ${(alert as any).threshold_value?.toFixed?.(1) ?? '—'}` : '—'}
                          </td>
                          <td className="border-0 text-nowrap" style={{ color: 'var(--color-text-muted)' }}>{new Date(alert.timestamp).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {alerts.length > 10 && (
                    <div className="text-center mt-3">
                      <button className="btn btn-link btn-sm" onClick={() => navigate('/alert-summary')}>View all {alerts.length} alerts</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Recent Executions */}
          <div className="card border-0 rounded-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="card-body p-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center gap-2">
                  <i className="material-icons-outlined" style={{ fontSize: 20, color: 'var(--color-primary)' }}>history</i>
                  <h6 className="mb-0 fw-semibold" style={{ fontSize: 'var(--text-md)' }}>Recent Executions</h6>
                  <StatusBadge label={String(executions.length)} variant="neutral" size="sm" />
                </div>
                <button className="btn btn-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => navigate('/smart-execution/history')}>
                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>list</i>View All
                </button>
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }} className="mb-3">Smart Execution runs on this testbed — click any row to view its report or live monitor</p>

              {executions.length === 0 ? (
                <EmptyState icon="rocket_launch" title="No executions yet" description="No Smart Executions have been run on this testbed."
                  action={<button className="btn btn-primary btn-sm rounded-3" onClick={() => navigate('/smart-execution/configure')}>Start First Execution</button>} />
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: 'var(--text-sm)' }}>
                    <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                      <th className="fw-semibold border-0 pb-2 ps-3">Execution</th>
                      <th className="fw-semibold border-0 pb-2">Status</th>
                      <th className="fw-semibold border-0 pb-2">Started</th>
                      <th className="fw-semibold border-0 pb-2">Duration</th>
                      <th className="fw-semibold border-0 pb-2">Operations</th>
                      <th className="fw-semibold border-0 pb-2">Success Rate</th>
                      <th className="border-0"></th>
                    </tr></thead>
                    <tbody>
                      {executions.slice(0, 10).map(exec => {
                        const startTime = getExecStartTime(exec);
                        const isRunning = exec.status?.toUpperCase() === 'RUNNING';
                        return (
                          <tr key={exec.execution_id} style={{ cursor: 'pointer' }}
                            onClick={() => navigate(isRunning ? `/smart-execution/monitor/${exec.execution_id}` : `/smart-execution/report/${exec.execution_id}`)}>
                            <td className="ps-3 border-0">
                              <code style={{ fontSize: 'var(--text-xs)' }}>{exec.execution_id.length > 28 ? exec.execution_id.substring(0, 28) + '…' : exec.execution_id}</code>
                            </td>
                            <td className="border-0"><StatusBadge label={exec.status} variant={execStatusVariant(exec.status)} dot size="sm" /></td>
                            <td className="border-0" style={{ color: 'var(--color-text-muted)' }}>{startTime ? new Date(startTime).toLocaleString() : '—'}</td>
                            <td className="border-0">{exec.duration_minutes != null ? `${exec.duration_minutes.toFixed(1)} min` : '—'}</td>
                            <td className="border-0">
                              {exec.successful_operations != null && exec.total_operations != null
                                ? <><span className="fw-medium">{exec.successful_operations}</span><span style={{ color: 'var(--color-text-muted)' }}>/{exec.total_operations}</span></>
                                : '—'}
                            </td>
                            <td className="border-0">
                              {exec.success_rate != null ? (
                                <span className="fw-semibold" style={{ color: exec.success_rate >= 80 ? 'var(--color-success)' : exec.success_rate >= 50 ? 'var(--color-warning)' : 'var(--color-danger)' }}>{exec.success_rate.toFixed(1)}%</span>
                              ) : '—'}
                            </td>
                            <td className="border-0"><i className="material-icons-outlined" style={{ fontSize: 18, color: 'var(--color-text-muted)' }}>{isRunning ? 'visibility' : 'description'}</i></td>
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
