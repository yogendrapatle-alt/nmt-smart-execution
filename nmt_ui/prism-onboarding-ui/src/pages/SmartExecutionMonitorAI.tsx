import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactApexChart from 'react-apexcharts';
import { getApiBase } from '../utils/backendUrl';

interface MonitorData {
  execution_id: string;
  execution_name?: string;
  execution_description?: string;
  status: string;
  iteration: number;
  operations_per_minute: number;
  current_metrics: {
    cpu: number;
    memory: number;
  };
  target_metrics: {
    cpu: number;
    memory: number;
  };
  phase: string;
  total_operations: number;
  metrics_history: Array<{
    timestamp: string;
    cpu: number;
    memory: number;
    phase: string;
  }>;
  pid_stats?: any;
  ml_recommendations?: Array<{
    entity: string;
    operation: string;
    cpu_impact: number;
    memory_impact: number;
    score: number;
    confidence: number;
  }>;
  emergency_stop: boolean;
  circuit_breaker_trips: number;
  recent_operations?: Array<{
    entity_type?: string;
    operation?: string;
    success?: boolean;
    duration?: number;
    timestamp?: string;
  }>;
  execution_config?: {
    workload_profile: string;
    max_parallel_operations: number;
    parallel_execution: boolean;
    operations_per_iteration: number;
    auto_cleanup: boolean;
  };
  latency_summary?: {
    overall: { min?: number; max?: number; avg?: number; p50?: number; p95?: number; count?: number };
    per_operation: Record<string, { avg?: number; p95?: number; count?: number }>;
  };
  tags?: string[];
  learning_summary?: string;
  alert_thresholds_config?: Record<string, number>;
  sustain?: {
    sustain_minutes: number;
    is_sustaining: boolean;
    sustain_start_time: string | null;
    sustain_elapsed_seconds: number;
    stats: {
      ops_during_sustain?: number;
      sustain_ops_per_minute?: number;
      reescalations?: number;
    };
  };
}

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'STOPPED', 'THRESHOLD_REACHED', 'TIMEOUT'];
const ACTIVE_STATUSES = ['RUNNING', 'SUSTAINING', 'LONGEVITY_SUSTAINING'];

const isTerminalStatus = (status: string | undefined): boolean => {
  if (!status) return false;
  return TERMINAL_STATUSES.includes(status.toUpperCase());
};

const getPhaseIcon = (phase: string): string => {
  const icons: Record<string, string> = {
    'initializing': 'settings',
    'ramp_up': 'trending_up',
    'maintain': 'check_circle',
    'sustaining': 'push_pin',
    'longevity_sustaining': 'push_pin',
    'ramp_down': 'trending_down',
    'fine_tune': 'tune',
    'completed': 'flag',
    'failed': 'error',
    'emergency_stop': 'report'
  };
  return icons[phase] || 'hourglass_empty';
};

const getPhaseColor = (phase: string): string => {
  const colors: Record<string, string> = {
    'initializing': '#94a3b8',
    'ramp_up': '#3b82f6',
    'maintain': '#10b981',
    'sustaining': '#059669',
    'longevity_sustaining': '#059669',
    'ramp_down': '#f59e0b',
    'fine_tune': '#8b5cf6',
    'completed': '#22c55e',
    'failed': '#ef4444',
    'emergency_stop': '#dc2626'
  };
  return colors[phase] || '#64748b';
};

const SmartExecutionMonitorAI: React.FC = () => {
  const { executionId } = useParams<{ executionId: string }>();
  const navigate = useNavigate();

  const [monitorData, setMonitorData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [cleaningUp, setCleaningUp] = useState<boolean>(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchMonitorData = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(
        `${getApiBase()}/api/smart-execution/monitor/${executionId}`,
        { signal: controller.signal }
      );
      if (!response.ok) {
        setError(`Failed to fetch monitoring data (${response.status})`);
        return;
      }
      const data = await response.json();
      if (data.success) {
        setMonitorData(data);
        setError('');
        if (isTerminalStatus(data.status)) {
          setAutoRefresh(false);
        }
      } else {
        setError(data.error || 'Failed to fetch data');
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError('Error connecting to backend. Check that the API is reachable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMonitorData();
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchMonitorData, 2000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
  }, [executionId, autoRefresh]);

  const handleEmergencyStop = async () => {
    setShowStopConfirm(false);
    try {
      const response = await fetch(`${getApiBase()}/api/smart-execution/emergency-stop/${executionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Manual emergency stop from UI' })
      });
      if (response.ok) {
        setActionMessage({ type: 'success', text: 'Emergency stop triggered successfully' });
        fetchMonitorData();
      } else {
        setActionMessage({ type: 'error', text: 'Failed to trigger emergency stop' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Could not reach backend for emergency stop' });
    }
  };

  const handleCleanup = async () => {
    setShowCleanupConfirm(false);
    setCleaningUp(true);
    try {
      const res = await fetch(`${getApiBase()}/api/smart-execution/cleanup/${executionId}`, { method: 'POST' });
      if (!res.ok) {
        setActionMessage({ type: 'error', text: `Cleanup failed (HTTP ${res.status})` });
        return;
      }
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: `Cleanup done: ${data.cleanup_summary?.success || 0}/${data.cleanup_summary?.total || 0} deleted` });
      } else {
        setActionMessage({ type: 'error', text: `Cleanup error: ${data.error || 'Unknown'}` });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Could not reach backend for cleanup' });
    } finally {
      setCleaningUp(false);
    }
  };

  // Loading state
  if (loading && !monitorData) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center py-5">
        <div className="spinner-border text-primary mb-3" role="status" style={{ width: 48, height: 48 }}>
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="text-muted">Loading monitoring dashboard...</p>
      </div>
    );
  }

  // Error state
  if (error && !monitorData) {
    return (
      <div className="container py-5">
        <div className="card border-danger rounded-4 shadow-sm">
          <div className="card-body text-center py-5">
            <i className="material-icons-outlined text-danger" style={{ fontSize: 48 }}>error</i>
            <h4 className="mt-3 text-danger">Connection Error</h4>
            <p className="text-muted">{error}</p>
            <button className="btn btn-outline-primary rounded-3" onClick={() => navigate('/smart-execution/history')}>
              <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle' }}>arrow_back</i> Back to History
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!monitorData) return null;

  const statusUpper = (monitorData.status || '').toUpperCase();
  const phaseNorm = (monitorData.phase || monitorData.status || '').toLowerCase();
  const isTerminal = isTerminalStatus(monitorData.status);
  const cpuVal = monitorData.current_metrics?.cpu ?? 0;
  const memVal = monitorData.current_metrics?.memory ?? 0;
  const cpuTarget = monitorData.target_metrics?.cpu ?? 0;
  const memTarget = monitorData.target_metrics?.memory ?? 0;

  const successRate = monitorData.total_operations > 0
    ? ((monitorData.total_operations - (monitorData.recent_operations?.filter(o => !o.success).length || 0)) / monitorData.total_operations * 100)
    : 0;

  // Chart data
  const metricsHistory = monitorData.metrics_history || [];
  const chartCategories = metricsHistory.map((_h, i) => `${i + 1}`);
  const cpuSeries = metricsHistory.map(h => parseFloat((h.cpu ?? 0).toFixed(1)));
  const memSeries = metricsHistory.map(h => parseFloat((h.memory ?? 0).toFixed(1)));

  const sustain = monitorData.sustain || (monitorData as any).sustain;

  return (
    <div className="container-fluid px-4 py-3">
      {/* Action Messages (Toast-style) */}
      {actionMessage && (
        <div className={`alert ${actionMessage.type === 'success' ? 'alert-success' : 'alert-danger'} alert-dismissible fade show rounded-3 shadow-sm`} role="alert">
          <i className="material-icons-outlined me-2" style={{ fontSize: 18, verticalAlign: 'middle' }}>
            {actionMessage.type === 'success' ? 'check_circle' : 'error'}
          </i>
          {actionMessage.text}
          <button type="button" className="btn-close" onClick={() => setActionMessage(null)} />
        </div>
      )}

      {/* Confirmation Dialogs */}
      {showStopConfirm && (
        <div className="alert alert-danger rounded-3 shadow-sm border-danger">
          <div className="d-flex align-items-start gap-2">
            <i className="material-icons-outlined text-danger mt-1" style={{ fontSize: 20 }}>warning</i>
            <div className="flex-grow-1">
              <strong>Are you sure you want to trigger EMERGENCY STOP?</strong>
              <p className="mb-2 small text-muted">This cannot be undone. The execution will be halted immediately.</p>
              <div className="d-flex gap-2">
                <button className="btn btn-danger btn-sm rounded-3" onClick={handleEmergencyStop}>Confirm Stop</button>
                <button className="btn btn-light btn-sm rounded-3" onClick={() => setShowStopConfirm(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showCleanupConfirm && (
        <div className="alert alert-warning rounded-3 shadow-sm border-warning">
          <div className="d-flex align-items-start gap-2">
            <i className="material-icons-outlined text-warning mt-1" style={{ fontSize: 20 }}>delete_sweep</i>
            <div className="flex-grow-1">
              <strong>Delete all entities created by this execution?</strong>
              <p className="mb-2 small text-muted">VMs, projects, blueprints, etc. will be permanently removed.</p>
              <div className="d-flex gap-2">
                <button className="btn btn-warning btn-sm rounded-3" onClick={handleCleanup}>Confirm Cleanup</button>
                <button className="btn btn-light btn-sm rounded-3" onClick={() => setShowCleanupConfirm(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Breadcrumb + Header */}
      <nav aria-label="breadcrumb" className="mb-2">
        <ol className="breadcrumb mb-0 small">
          <li className="breadcrumb-item"><a href="#" onClick={(e) => { e.preventDefault(); navigate('/'); }} className="text-decoration-none">Dashboard</a></li>
          <li className="breadcrumb-item"><a href="#" onClick={(e) => { e.preventDefault(); navigate('/smart-execution/history'); }} className="text-decoration-none">Execution History</a></li>
          <li className="breadcrumb-item active" aria-current="page">Monitor</li>
        </ol>
      </nav>

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
        <div>
          <h2 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 22 }}>smart_toy</i>
            </div>
            {monitorData.execution_name || 'AI Execution Monitor'}
          </h2>
          <p className="text-muted mb-0 small">
            <code className="font-monospace">{monitorData.execution_id}</code>
            {isTerminal && (
              <span className="badge bg-success bg-opacity-10 text-success ms-2">
                <i className="material-icons-outlined" style={{ fontSize: 12, verticalAlign: 'middle' }}>check</i> Finished
              </span>
            )}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <div className="form-check form-switch me-2">
            <input className="form-check-input" type="checkbox" id="autoRefreshToggle" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            <label className="form-check-label small" htmlFor="autoRefreshToggle">Auto-refresh</label>
          </div>
          <button className="btn btn-outline-secondary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={fetchMonitorData}>
            <i className="material-icons-outlined" style={{ fontSize: 16 }}>refresh</i> Refresh
          </button>
          <button
            className="btn btn-outline-warning btn-sm rounded-3 d-flex align-items-center gap-1"
            onClick={() => setShowCleanupConfirm(true)}
            disabled={cleaningUp || ACTIVE_STATUSES.includes(statusUpper)}
          >
            <i className="material-icons-outlined" style={{ fontSize: 16 }}>cleaning_services</i>
            {cleaningUp ? 'Cleaning...' : 'Cleanup'}
          </button>
          <button
            className="btn btn-danger btn-sm rounded-3 d-flex align-items-center gap-1"
            onClick={() => setShowStopConfirm(true)}
            disabled={monitorData.emergency_stop || isTerminal}
          >
            <i className="material-icons-outlined" style={{ fontSize: 16 }}>report</i> STOP
          </button>
          <button className="btn btn-outline-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => navigate(`/smart-execution/report/${executionId}`)}>
            <i className="material-icons-outlined" style={{ fontSize: 16 }}>assessment</i> Report
          </button>
          <button className="btn btn-light btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => navigate('/smart-execution/history')}>
            <i className="material-icons-outlined" style={{ fontSize: 16 }}>arrow_back</i> Back
          </button>
        </div>
      </div>

      {/* Phase Banner */}
      <div className="card border-0 rounded-4 shadow-sm mb-3" style={{ background: `linear-gradient(135deg, ${getPhaseColor(phaseNorm)}ee, ${getPhaseColor(phaseNorm)}88)` }}>
        <div className="card-body py-3 px-4 text-white d-flex flex-wrap align-items-center justify-content-between">
          <div className="d-flex align-items-center gap-3">
            <i className="material-icons-outlined" style={{ fontSize: 32 }}>{getPhaseIcon(phaseNorm)}</i>
            <div>
              <h5 className="mb-0 fw-bold">{(monitorData.phase || monitorData.status || '').toUpperCase().replace(/_/g, ' ')}</h5>
              <span className="small opacity-75">Iteration {monitorData.iteration} &middot; {monitorData.total_operations} operations executed</span>
            </div>
          </div>
          {sustain && (sustain.is_sustaining || phaseNorm === 'sustaining' || phaseNorm === 'longevity_sustaining') && (() => {
            const elapsed = sustain.sustain_elapsed_seconds || 0;
            const total = (sustain.sustain_minutes || 5) * 60;
            const pct = Math.min(100, Math.round((elapsed / total) * 100));
            return (
              <div className="text-end">
                <div className="small opacity-75">Sustaining: {Math.floor(elapsed / 60)}m {Math.floor(elapsed % 60)}s / {sustain.sustain_minutes}m</div>
                <div className="progress mt-1" style={{ height: 6, width: 160, background: 'rgba(255,255,255,0.3)' }}>
                  <div className="progress-bar bg-white" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Quick Stat Cards Row */}
      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3">
          <div className="card border-0 rounded-4 shadow-sm h-100">
            <div className="card-body text-center py-3">
              <div className="text-muted small mb-1">CPU Usage</div>
              <h3 className={`fw-bold mb-1 ${cpuVal >= cpuTarget ? 'text-danger' : cpuVal >= cpuTarget * 0.8 ? 'text-warning' : 'text-primary'}`}>
                {cpuVal.toFixed(1)}%
              </h3>
              <div className="progress rounded-pill" style={{ height: 6 }}>
                <div className={`progress-bar ${cpuVal >= cpuTarget ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${Math.min(cpuVal, 100)}%` }} />
              </div>
              <div className="text-muted mt-1" style={{ fontSize: 11 }}>Target: {cpuTarget}%</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-lg-3">
          <div className="card border-0 rounded-4 shadow-sm h-100">
            <div className="card-body text-center py-3">
              <div className="text-muted small mb-1">Memory Usage</div>
              <h3 className={`fw-bold mb-1 ${memVal >= memTarget ? 'text-danger' : memVal >= memTarget * 0.8 ? 'text-warning' : 'text-success'}`}>
                {memVal.toFixed(1)}%
              </h3>
              <div className="progress rounded-pill" style={{ height: 6 }}>
                <div className={`progress-bar ${memVal >= memTarget ? 'bg-danger' : 'bg-success'}`} style={{ width: `${Math.min(memVal, 100)}%` }} />
              </div>
              <div className="text-muted mt-1" style={{ fontSize: 11 }}>Target: {memTarget}%</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-lg-3">
          <div className="card border-0 rounded-4 shadow-sm h-100">
            <div className="card-body text-center py-3">
              <div className="text-muted small mb-1">Ops/Minute</div>
              <h3 className="fw-bold mb-1 text-info">{(monitorData.operations_per_minute ?? 0).toFixed(1)}</h3>
              <div className="text-muted" style={{ fontSize: 11 }}>{monitorData.total_operations} total operations</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-lg-3">
          <div className="card border-0 rounded-4 shadow-sm h-100">
            <div className="card-body text-center py-3">
              <div className="text-muted small mb-1">Success Rate</div>
              <h3 className={`fw-bold mb-1 ${successRate >= 90 ? 'text-success' : successRate >= 70 ? 'text-warning' : 'text-danger'}`}>
                {successRate.toFixed(0)}%
              </h3>
              {monitorData.circuit_breaker_trips > 0 && (
                <span className="badge bg-warning bg-opacity-10 text-warning small">
                  <i className="material-icons-outlined" style={{ fontSize: 12, verticalAlign: 'middle' }}>warning</i> {monitorData.circuit_breaker_trips} trips
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Charts Row */}
      <div className="row g-3 mb-3">
        <div className="col-12">
          <div className="card border-0 rounded-4 shadow-sm">
            <div className="card-header bg-transparent border-0 pt-3 pb-0 px-4">
              <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
                <i className="material-icons-outlined" style={{ fontSize: 20 }}>show_chart</i> Resource Usage Over Time
              </h6>
            </div>
            <div className="card-body pt-0">
              {metricsHistory.length > 0 ? (
                <ReactApexChart
                  type="area"
                  height={300}
                  series={[
                    { name: 'CPU %', data: cpuSeries },
                    { name: 'Memory %', data: memSeries }
                  ]}
                  options={{
                    chart: { toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'inherit' },
                    colors: ['#3b82f6', '#10b981'],
                    dataLabels: { enabled: false },
                    stroke: { curve: 'smooth', width: 2.5 },
                    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 100] } },
                    xaxis: { categories: chartCategories, labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },
                    yaxis: { min: 0, max: 100, labels: { formatter: (v: number) => `${v.toFixed(0)}%` } },
                    annotations: {
                      yaxis: [
                        { y: cpuTarget, borderColor: '#3b82f6', strokeDashArray: 4, label: { text: `CPU Target ${cpuTarget}%`, style: { color: '#3b82f6', background: '#eff6ff' } } },
                        { y: memTarget, borderColor: '#10b981', strokeDashArray: 4, label: { text: `Mem Target ${memTarget}%`, style: { color: '#10b981', background: '#f0fdf4' }, position: 'front' } }
                      ]
                    },
                    tooltip: { y: { formatter: (v: number) => `${v.toFixed(1)}%` } },
                    grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
                    legend: { position: 'top' as const, horizontalAlign: 'right' as const }
                  }}
                />
              ) : (
                <div className="text-center text-muted py-5">
                  <i className="material-icons-outlined" style={{ fontSize: 40 }}>hourglass_empty</i>
                  <p className="mt-2">Waiting for metrics data...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Details Row: AI Control + Config + Latency */}
      <div className="row g-3 mb-3">
        {/* AI Control */}
        <div className="col-md-4">
          <div className="card border-0 rounded-4 shadow-sm h-100">
            <div className="card-header bg-transparent border-0 pt-3 px-4">
              <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
                <i className="material-icons-outlined" style={{ fontSize: 20 }}>psychology</i> AI Control
              </h6>
            </div>
            <div className="card-body pt-2">
              <table className="table table-sm table-borderless mb-0 small">
                <tbody>
                  <tr><td className="text-muted">Ops/Minute</td><td className="fw-semibold text-end">{(monitorData.operations_per_minute ?? 0).toFixed(1)}</td></tr>
                  <tr><td className="text-muted">Phase</td><td className="fw-semibold text-end">{monitorData.phase}</td></tr>
                  <tr><td className="text-muted">Total Operations</td><td className="fw-semibold text-end">{monitorData.total_operations}</td></tr>
                  <tr><td className="text-muted">Iteration</td><td className="fw-semibold text-end">{monitorData.iteration}</td></tr>
                  {monitorData.circuit_breaker_trips > 0 && (
                    <tr><td className="text-warning"><i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>warning</i> Circuit Trips</td><td className="fw-semibold text-end text-warning">{monitorData.circuit_breaker_trips}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* PID Stats */}
        {monitorData.pid_stats && (
          <div className="col-md-4">
            <div className="card border-0 rounded-4 shadow-sm h-100">
              <div className="card-header bg-transparent border-0 pt-3 px-4">
                <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
                  <i className="material-icons-outlined" style={{ fontSize: 20 }}>tune</i> PID Controller
                </h6>
              </div>
              <div className="card-body pt-2">
                <table className="table table-sm table-borderless mb-0 small">
                  <tbody>
                    <tr><td className="text-muted">CPU PID</td><td className="font-monospace text-end" style={{ fontSize: 11 }}>Kp={monitorData.pid_stats.cpu_pid?.Kp} Ki={monitorData.pid_stats.cpu_pid?.Ki} Kd={monitorData.pid_stats.cpu_pid?.Kd}</td></tr>
                    <tr><td className="text-muted">Mem PID</td><td className="font-monospace text-end" style={{ fontSize: 11 }}>Kp={monitorData.pid_stats.memory_pid?.Kp} Ki={monitorData.pid_stats.memory_pid?.Ki} Kd={monitorData.pid_stats.memory_pid?.Kd}</td></tr>
                    <tr><td className="text-muted">Current Ops/Min</td><td className="fw-semibold text-end">{monitorData.pid_stats.current_ops_per_min?.toFixed(1)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Execution Config */}
        {monitorData.execution_config && (
          <div className={`col-md-4`}>
            <div className="card border-0 rounded-4 shadow-sm h-100">
              <div className="card-header bg-transparent border-0 pt-3 px-4">
                <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
                  <i className="material-icons-outlined" style={{ fontSize: 20 }}>settings</i> Config
                </h6>
              </div>
              <div className="card-body pt-2">
                <table className="table table-sm table-borderless mb-0 small">
                  <tbody>
                    <tr>
                      <td className="text-muted">Profile</td>
                      <td className="text-end">
                        <span className={`badge rounded-pill ${
                          monitorData.execution_config.workload_profile === 'chaos' ? 'bg-danger bg-opacity-10 text-danger' :
                          monitorData.execution_config.workload_profile === 'burst' ? 'bg-warning bg-opacity-10 text-warning' :
                          'bg-success bg-opacity-10 text-success'
                        }`}>
                          {monitorData.execution_config.workload_profile.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </td>
                    </tr>
                    <tr><td className="text-muted">Parallel</td><td className="text-end">{monitorData.execution_config.parallel_execution ? `Yes (max ${monitorData.execution_config.max_parallel_operations})` : 'Sequential'}</td></tr>
                    <tr><td className="text-muted">Ops/Iteration</td><td className="fw-semibold text-end">{monitorData.execution_config.operations_per_iteration}</td></tr>
                    <tr><td className="text-muted">Auto-cleanup</td><td className="text-end">{monitorData.execution_config.auto_cleanup ? <span className="text-success">Yes</span> : <span className="text-muted">No</span>}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Latency + Tags + Learning + ML Recs */}
      <div className="row g-3 mb-3">
        {/* API Latency */}
        {monitorData.latency_summary?.overall?.count && monitorData.latency_summary.overall.count > 0 && (
          <div className="col-md-4">
            <div className="card border-0 rounded-4 shadow-sm h-100">
              <div className="card-header bg-transparent border-0 pt-3 px-4">
                <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
                  <i className="material-icons-outlined" style={{ fontSize: 20 }}>timer</i> API Latency
                </h6>
              </div>
              <div className="card-body pt-2">
                <table className="table table-sm table-borderless mb-0 small">
                  <tbody>
                    <tr><td className="text-muted">Average</td><td className="fw-semibold text-end">{monitorData.latency_summary.overall.avg?.toFixed(1)}s</td></tr>
                    <tr><td className="text-muted">P50</td><td className="text-end">{monitorData.latency_summary.overall.p50?.toFixed(1)}s</td></tr>
                    <tr>
                      <td className="text-muted">P95</td>
                      <td className={`fw-semibold text-end ${(monitorData.latency_summary.overall.p95 || 0) > 30 ? 'text-danger' : 'text-success'}`}>
                        {monitorData.latency_summary.overall.p95?.toFixed(1)}s
                      </td>
                    </tr>
                    <tr><td className="text-muted">Total Calls</td><td className="text-end">{monitorData.latency_summary.overall.count}</td></tr>
                  </tbody>
                </table>
                {Object.entries(monitorData.latency_summary.per_operation || {}).length > 0 && (
                  <div className="border-top mt-2 pt-2" style={{ fontSize: 11 }}>
                    {Object.entries(monitorData.latency_summary.per_operation).slice(0, 5).map(([key, stats]) => (
                      <div key={key} className="d-flex justify-content-between text-muted">
                        <span>{key}</span>
                        <span>avg {stats.avg?.toFixed(1)}s ({stats.count})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tags */}
        {monitorData.tags && monitorData.tags.length > 0 && (
          <div className="col-md-4">
            <div className="card border-0 rounded-4 shadow-sm h-100">
              <div className="card-header bg-transparent border-0 pt-3 px-4">
                <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
                  <i className="material-icons-outlined" style={{ fontSize: 20 }}>label</i> Tags
                </h6>
              </div>
              <div className="card-body pt-2">
                <div className="d-flex gap-2 flex-wrap">
                  {monitorData.tags.map((tag, i) => (
                    <span key={i} className="badge bg-info bg-opacity-10 text-info rounded-pill px-3 py-2">{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Learning Summary */}
        {monitorData.learning_summary && (
          <div className="col-md-4">
            <div className="card border-0 rounded-4 shadow-sm h-100">
              <div className="card-header bg-transparent border-0 pt-3 px-4">
                <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
                  <i className="material-icons-outlined" style={{ fontSize: 20 }}>auto_stories</i> Learning Summary
                </h6>
              </div>
              <div className="card-body pt-2">
                <p className="small text-muted mb-0" style={{ lineHeight: 1.6 }}>{monitorData.learning_summary}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ML Recommendations */}
      {monitorData.ml_recommendations && monitorData.ml_recommendations.length > 0 && (
        <div className="card border-0 rounded-4 shadow-sm mb-3">
          <div className="card-header bg-transparent border-0 pt-3 px-4">
            <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
              <i className="material-icons-outlined" style={{ fontSize: 20 }}>lightbulb</i> ML Recommendations
            </h6>
          </div>
          <div className="card-body pt-0">
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0 small">
                <thead className="table-light">
                  <tr>
                    <th>#</th>
                    <th>Entity</th>
                    <th>Operation</th>
                    <th className="text-end">CPU Impact</th>
                    <th className="text-end">Memory Impact</th>
                    <th className="text-end">Score</th>
                    <th className="text-end">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {monitorData.ml_recommendations.slice(0, 5).map((rec, idx) => (
                    <tr key={idx}>
                      <td className="text-muted">{idx + 1}</td>
                      <td className="fw-semibold">{rec.entity}</td>
                      <td><span className="badge bg-secondary bg-opacity-10 text-secondary rounded-pill">{rec.operation}</span></td>
                      <td className="text-end">+{rec.cpu_impact.toFixed(1)}%</td>
                      <td className="text-end">+{rec.memory_impact.toFixed(1)}%</td>
                      <td className="text-end fw-semibold">{rec.score.toFixed(2)}</td>
                      <td className="text-end">{(rec.confidence * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Recent Operations Feed */}
      {monitorData.recent_operations && monitorData.recent_operations.length > 0 && (
        <div className="card border-0 rounded-4 shadow-sm mb-3">
          <div className="card-header bg-transparent border-0 pt-3 px-4">
            <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
              <i className="material-icons-outlined" style={{ fontSize: 20 }}>receipt_long</i> Recent Operations
            </h6>
          </div>
          <div className="card-body pt-0" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {monitorData.recent_operations.slice().reverse().map((op, idx) => (
              <div key={idx} className="d-flex align-items-center gap-2 py-1 border-bottom" style={{ fontSize: 12 }}>
                <i className="material-icons-outlined" style={{ fontSize: 14, color: op.success ? '#22c55e' : '#ef4444' }}>
                  {op.success ? 'check_circle' : 'cancel'}
                </i>
                <span className="text-muted font-monospace" style={{ minWidth: 50 }}>{op.entity_type}</span>
                <span className="badge bg-light text-dark rounded-pill" style={{ fontSize: 10 }}>{op.operation}</span>
                {op.duration != null && <span className="text-muted ms-auto">{op.duration.toFixed(1)}s</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartExecutionMonitorAI;
