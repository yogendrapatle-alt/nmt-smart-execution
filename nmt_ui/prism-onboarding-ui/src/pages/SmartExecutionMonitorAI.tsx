import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getApiBase } from '../utils/backendUrl';
import { SkeletonMetricRow, SkeletonCard } from '../components/ui/LoadingSkeleton';
import {
  PhaseBanner,
  MetricsOverview,
  ResourceChart,
  DetailPanels,
  MLRecommendationsPanel,
  OperationsFeed,
  isTerminalStatus,
  ACTIVE_STATUSES,
  type MonitorData,
} from '../components/execution-monitor';
import '../styles/SmartExecutionMonitorAI.css';

const MAX_NOT_FOUND_RETRIES = 15;

const SmartExecutionMonitorAI: React.FC = () => {
  const { executionId } = useParams<{ executionId: string }>();
  const navigate = useNavigate();

  const [monitorData, setMonitorData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const notFoundCountRef = useRef(0);

  /* ── Data Fetching ───────────────────────────────────── */

  const fetchMonitorData = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(
        `${getApiBase()}/api/smart-execution/monitor/${executionId}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        if (response.status === 404) {
          notFoundCountRef.current += 1;
          if (notFoundCountRef.current >= MAX_NOT_FOUND_RETRIES) {
            setError(`Execution "${executionId}" was not found after ${MAX_NOT_FOUND_RETRIES} attempts. It may have failed to start or was lost during a backend restart.`);
            setAutoRefresh(false);
            return;
          }
          setError(`Waiting for execution to initialize... (attempt ${notFoundCountRef.current}/${MAX_NOT_FOUND_RETRIES})`);
        } else {
          setError(`Failed to fetch monitoring data (${response.status})`);
        }
        return;
      }
      const data = await response.json();
      if (data.success) {
        notFoundCountRef.current = 0;
        setMonitorData(data);
        setError('');
        if (isTerminalStatus(data.status)) setAutoRefresh(false);
      } else if (data.error === 'Execution not found') {
        notFoundCountRef.current += 1;
        if (notFoundCountRef.current >= MAX_NOT_FOUND_RETRIES) {
          setError(`Execution "${executionId}" was not found. It may have failed to start.`);
          setAutoRefresh(false);
          return;
        }
        setError(`Waiting for execution to initialize... (attempt ${notFoundCountRef.current}/${MAX_NOT_FOUND_RETRIES})`);
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

  /* ── Actions ─────────────────────────────────────────── */

  const handleEmergencyStop = async () => {
    setShowStopConfirm(false);
    try {
      const res = await fetch(`${getApiBase()}/api/smart-execution/emergency-stop/${executionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Manual emergency stop from UI' }),
      });
      setActionMessage(res.ok
        ? { type: 'success', text: 'Emergency stop triggered successfully' }
        : { type: 'error', text: 'Failed to trigger emergency stop' });
      if (res.ok) fetchMonitorData();
    } catch {
      setActionMessage({ type: 'error', text: 'Could not reach backend for emergency stop' });
    }
  };

  const pollCleanupStatus = async () => {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const res = await fetch(`${getApiBase()}/api/smart-execution/cleanup/${executionId}/status`);
        const data = await res.json();
        const summary = data.cleanup_summary;
        if (summary?.status === 'completed') {
          setActionMessage({ type: 'success', text: `Cleanup complete: ${summary.success}/${summary.total} entities deleted` });
          setCleaningUp(false);
          return;
        } else if (summary?.status === 'failed') {
          setActionMessage({ type: 'error', text: `Cleanup failed: ${summary.message || 'Unknown error'}` });
          setCleaningUp(false);
          return;
        }
      } catch { /* retry */ }
    }
    setActionMessage({ type: 'success', text: 'Cleanup still running in background. Refresh later.' });
    setCleaningUp(false);
  };

  const handleCleanup = async () => {
    setShowCleanupConfirm(false);
    setCleaningUp(true);
    try {
      const res = await fetch(`${getApiBase()}/api/smart-execution/cleanup/${executionId}`, { method: 'POST' });
      if (!res.ok) { setActionMessage({ type: 'error', text: `Cleanup failed (HTTP ${res.status})` }); setCleaningUp(false); return; }
      const data = await res.json();
      if (res.status === 202) {
        setActionMessage({ type: 'success', text: `Cleanup started for ${data.cleanup_summary?.total || '?'} entities. Please wait...` });
        pollCleanupStatus();
        return;
      }
      setActionMessage(data.success
        ? { type: 'success', text: `Cleanup done: ${data.cleanup_summary?.success || 0}/${data.cleanup_summary?.total || 0} deleted` }
        : { type: 'error', text: `Cleanup error: ${data.error || 'Unknown'}` });
      setCleaningUp(false);
    } catch {
      setActionMessage({ type: 'error', text: 'Could not reach backend for cleanup' });
      setCleaningUp(false);
    }
  };

  /* ── Loading / Error gates ───────────────────────────── */

  if (loading && !monitorData) {
    return (
      <div className="py-4">
        <SkeletonMetricRow count={4} />
        <SkeletonCard lines={8} />
      </div>
    );
  }

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

  /* ── Derived values ──────────────────────────────────── */

  const statusUpper = (monitorData.status || '').toUpperCase();
  const isTerminal = isTerminalStatus(monitorData.status);
  const cpuVal = monitorData.current_metrics?.cpu ?? 0;
  const memVal = monitorData.current_metrics?.memory ?? 0;
  const cpuTarget = monitorData.target_metrics?.cpu ?? 0;
  const memTarget = monitorData.target_metrics?.memory ?? 0;
  const failedOps = monitorData.recent_operations?.filter(o => !o.success).length || 0;
  const successRate = monitorData.total_operations > 0
    ? ((monitorData.total_operations - failedOps) / monitorData.total_operations * 100) : 0;

  /* ── Render ──────────────────────────────────────────── */

  return (
    <div className="container-fluid px-4 py-3">
      {/* Toast */}
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
          <li className="breadcrumb-item"><a href="#" onClick={e => { e.preventDefault(); navigate('/'); }} className="text-decoration-none">Dashboard</a></li>
          <li className="breadcrumb-item"><a href="#" onClick={e => { e.preventDefault(); navigate('/smart-execution/history'); }} className="text-decoration-none">Execution History</a></li>
          <li className="breadcrumb-item active" aria-current="page">Monitor</li>
        </ol>
      </nav>

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
        <div>
          <h2 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            <input className="form-check-input" type="checkbox" id="autoRefreshToggle" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            <label className="form-check-label small" htmlFor="autoRefreshToggle">Auto-refresh</label>
          </div>
          <button className="btn btn-outline-secondary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={fetchMonitorData}>
            <i className="material-icons-outlined" style={{ fontSize: 16 }}>refresh</i> Refresh
          </button>
          <button className="btn btn-outline-warning btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => setShowCleanupConfirm(true)} disabled={cleaningUp || ACTIVE_STATUSES.includes(statusUpper)}>
            <i className="material-icons-outlined" style={{ fontSize: 16 }}>cleaning_services</i>
            {cleaningUp ? 'Cleaning...' : 'Cleanup'}
          </button>
          <button className="btn btn-danger btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => setShowStopConfirm(true)} disabled={monitorData.emergency_stop || isTerminal}>
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

      {/* Subcomponents */}
      <PhaseBanner
        phase={monitorData.phase}
        status={monitorData.status}
        iteration={monitorData.iteration}
        totalOperations={monitorData.total_operations}
        sustain={monitorData.sustain}
      />

      <MetricsOverview
        cpuVal={cpuVal}
        cpuTarget={cpuTarget}
        memVal={memVal}
        memTarget={memTarget}
        opsPerMinute={monitorData.operations_per_minute ?? 0}
        totalOperations={monitorData.total_operations}
        successRate={successRate}
        circuitBreakerTrips={monitorData.circuit_breaker_trips}
      />

      <ResourceChart
        metricsHistory={monitorData.metrics_history || []}
        cpuTarget={cpuTarget}
        memTarget={memTarget}
      />

      <DetailPanels data={monitorData} />

      <MLRecommendationsPanel recommendations={monitorData.ml_recommendations || []} />

      <OperationsFeed operations={monitorData.recent_operations || []} />
    </div>
  );
};

export default SmartExecutionMonitorAI;
