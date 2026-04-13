/**
 * Smart Execution AI Monitoring Dashboard
 * 
 * Real-time monitoring for AI-powered Smart Execution with:
 * - Live CPU/Memory graphs
 * - PID controller stats
 * - ML recommendations
 * - Phase tracking
 * - Emergency stop
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import '../styles/SmartExecutionMonitorAI.css';
import { getApiBase } from '../utils/backendUrl';

interface MonitorData {
  execution_id: string;
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
}

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'STOPPED', 'THRESHOLD_REACHED', 'TIMEOUT'];
const ACTIVE_STATUSES = ['RUNNING', 'SUSTAINING', 'LONGEVITY_SUSTAINING'];

const isTerminalStatus = (status: string | undefined): boolean => {
  if (!status) return false;
  return TERMINAL_STATUSES.includes(status.toUpperCase());
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
      console.error('Error fetching monitor data:', err);
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
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      abortRef.current?.abort();
    };
  }, [executionId, autoRefresh]);

  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
    } catch (err) {
      console.error('Error triggering emergency stop:', err);
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
    } catch (_err) {
      setActionMessage({ type: 'error', text: 'Could not reach backend for cleanup' });
    } finally {
      setCleaningUp(false);
    }
  };

  const getPhaseEmoji = (phase: string): string => {
    const phaseEmojis: Record<string, string> = {
      'initializing': '🔧',
      'ramp_up': '⬆️',
      'maintain': '✅',
      'sustaining': '📌',
      'longevity_sustaining': '📌',
      'ramp_down': '⬇️',
      'fine_tune': '🎯',
      'completed': '🏁',
      'failed': '❌',
      'emergency_stop': '🚨'
    };
    return phaseEmojis[phase] || '⏳';
  };

  // Get phase color
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

  const renderMetricsGraph = () => {
    if (!monitorData?.metrics_history?.length) {
      return <div className="no-data">No metrics data yet</div>;
    }
    
    const maxDataPoints = 20;
    const history = monitorData.metrics_history.slice(-maxDataPoints);
    const targetCpu = monitorData.target_metrics?.cpu ?? 0;
    const targetMem = monitorData.target_metrics?.memory ?? 0;
    const maxCpu = Math.max(...history.map(h => h.cpu ?? 0), targetCpu, 1);
    const maxMemory = Math.max(...history.map(h => h.memory ?? 0), targetMem, 1);
    
    return (
      <div className="metrics-graph">
        <div className="graph-container">
          <div className="chart">
            <h4>CPU Usage Over Time</h4>
            <div className="chart-bars">
              {history.map((point, idx) => (
                <div key={idx} className="bar-wrapper">
                  <div
                    className="bar cpu-bar"
                    style={{ height: `${((point.cpu ?? 0) / maxCpu) * 100}%` }}
                    title={`${(point.cpu ?? 0).toFixed(1)}%`}
                  />
                </div>
              ))}
            </div>
            <div className="chart-target" style={{ bottom: `${(targetCpu / maxCpu) * 100}%` }}>
              Target: {targetCpu}%
            </div>
          </div>
          
          <div className="chart">
            <h4>Memory Usage Over Time</h4>
            <div className="chart-bars">
              {history.map((point, idx) => (
                <div key={idx} className="bar-wrapper">
                  <div
                    className="bar memory-bar"
                    style={{ height: `${((point.memory ?? 0) / maxMemory) * 100}%` }}
                    title={`${(point.memory ?? 0).toFixed(1)}%`}
                  />
                </div>
              ))}
            </div>
            <div className="chart-target" style={{ bottom: `${(targetMem / maxMemory) * 100}%` }}>
              Target: {targetMem}%
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading && !monitorData) {
    return (
      <div className="monitor-loading">
        <div className="spinner"></div>
        <p>Loading monitoring dashboard...</p>
      </div>
    );
  }

  if (error && !monitorData) {
    return (
      <div className="monitor-error">
        <h2>❌ Error</h2>
        <p>{error}</p>
        <button onClick={() => navigate('/smart-execution/history')}>
          Back to History
        </button>
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

  return (
    <div className="smart-execution-monitor-ai">
      {/* Action Messages */}
      {actionMessage && (
        <div className={`action-message ${actionMessage.type}`} style={{
          padding: '12px 20px', margin: '0 0 12px', borderRadius: 8,
          background: actionMessage.type === 'success' ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${actionMessage.type === 'success' ? '#22c55e' : '#ef4444'}`,
          color: actionMessage.type === 'success' ? '#166534' : '#991b1b',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <span>{actionMessage.text}</span>
          <button onClick={() => setActionMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
      )}

      {/* Inline Confirmation Dialogs */}
      {showStopConfirm && (
        <div style={{ padding: '16px 20px', margin: '0 0 12px', borderRadius: 8, background: '#fef2f2', border: '2px solid #ef4444' }}>
          <strong>⚠️ Are you sure you want to trigger EMERGENCY STOP?</strong>
          <p style={{ margin: '8px 0', fontSize: 14, color: '#991b1b' }}>This cannot be undone. The execution will be halted immediately.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleEmergencyStop} style={{ padding: '6px 16px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Confirm Stop</button>
            <button onClick={() => setShowStopConfirm(false)} style={{ padding: '6px 16px', background: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {showCleanupConfirm && (
        <div style={{ padding: '16px 20px', margin: '0 0 12px', borderRadius: 8, background: '#fff7ed', border: '2px solid #f59e0b' }}>
          <strong>Delete all entities created by this execution?</strong>
          <p style={{ margin: '8px 0', fontSize: 14, color: '#92400e' }}>VMs, projects, blueprints, etc. will be permanently removed.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleCleanup} style={{ padding: '6px 16px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Confirm Cleanup</button>
            <button onClick={() => setShowCleanupConfirm(false)} style={{ padding: '6px 16px', background: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="monitor-header">
        <div className="header-left">
          <h1>🤖 AI Execution Monitor</h1>
          <p className="execution-id">{monitorData.execution_id}</p>
          {isTerminal && (
            <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, background: '#f0fdf4', color: '#166534', fontSize: 12, fontWeight: 600 }}>
              Execution finished — auto-refresh stopped
            </span>
          )}
        </div>
        
        <div className="header-right">
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (2s)
          </label>
          
          <button onClick={fetchMonitorData} className="btn-refresh">
            🔄 Refresh
          </button>
          
          <button
            onClick={() => setShowCleanupConfirm(true)}
            className="btn-refresh"
            disabled={cleaningUp || ACTIVE_STATUSES.includes(statusUpper)}
            style={{ background: '#f59e0b', color: 'white' }}
          >
            {cleaningUp ? '⏳ Cleaning...' : '🧹 Cleanup Entities'}
          </button>
          
          <button
            onClick={() => setShowStopConfirm(true)}
            className="btn-emergency"
            disabled={monitorData.emergency_stop || isTerminal}
          >
            🚨 EMERGENCY STOP
          </button>
          
          <button onClick={() => navigate('/smart-execution/history')} className="btn-back">
            ← Back
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <div className="status-banner" style={{ backgroundColor: getPhaseColor(phaseNorm) }}>
        <div className="status-info">
          <span className="status-emoji">{getPhaseEmoji(phaseNorm)}</span>
          <span className="status-text">
            {(monitorData.phase || monitorData.status || '').toUpperCase().replace(/_/g, ' ')}
          </span>
        </div>
        <div className="status-details">
          Iteration {monitorData.iteration} | {monitorData.total_operations} operations executed
          {(phaseNorm === 'sustaining' || phaseNorm === 'longevity_sustaining' || statusUpper === 'SUSTAINING' || statusUpper === 'LONGEVITY_SUSTAINING') && (monitorData as any).sustain && (() => {
            const s = (monitorData as any).sustain;
            const elapsed = s.sustain_elapsed_seconds || 0;
            const total = (s.sustain_minutes || 5) * 60;
            const pct = Math.min(100, Math.round((elapsed / total) * 100));
            const stats = s.stats || {};
            return (
              <span style={{ marginLeft: 12, fontWeight: 600 }}>
                | 📌 Sustaining: {Math.floor(elapsed / 60)}m{Math.floor(elapsed % 60)}s / {s.sustain_minutes}m ({pct}%)
                {stats.ops_during_sustain > 0 && <> | {stats.ops_during_sustain} ops ({stats.sustain_ops_per_minute || 0}/min)</>}
                {stats.reescalations > 0 && <> | {stats.reescalations} re-escalations</>}
              </span>
            );
          })()}
        </div>
      </div>

      {/* Main Grid */}
      <div className="monitor-grid">
        {/* Current Metrics */}
        <div className="monitor-card metrics-card">
          <h2>📊 Current Metrics</h2>
          <div className="metrics-display">
            <div className="metric">
              <div className="metric-label">CPU Usage</div>
              <div className="metric-value">{cpuVal.toFixed(1)}%</div>
              <div className="metric-target">Target: {cpuTarget}%</div>
              <div className="metric-bar">
                <div
                  className="metric-fill cpu-fill"
                  style={{ width: `${Math.min(cpuVal, 100)}%` }}
                />
              </div>
            </div>
            
            <div className="metric">
              <div className="metric-label">Memory Usage</div>
              <div className="metric-value">{memVal.toFixed(1)}%</div>
              <div className="metric-target">Target: {memTarget}%</div>
              <div className="metric-bar">
                <div
                  className="metric-fill memory-fill"
                  style={{ width: `${Math.min(memVal, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Operations Control */}
        <div className="monitor-card control-card">
          <h2>⚙️ AI Control</h2>
          <div className="control-info">
            <div className="control-row">
              <span className="control-label">Operations/Minute:</span>
              <span className="control-value">{(monitorData.operations_per_minute ?? 0).toFixed(1)}</span>
            </div>
            <div className="control-row">
              <span className="control-label">Phase:</span>
              <span className="control-value">{monitorData.phase}</span>
            </div>
            <div className="control-row">
              <span className="control-label">Total Operations:</span>
              <span className="control-value">{monitorData.total_operations}</span>
            </div>
            {monitorData.circuit_breaker_trips > 0 && (
              <div className="control-row warning">
                <span className="control-label">⚠️ Circuit Breaker Trips:</span>
                <span className="control-value">{monitorData.circuit_breaker_trips}</span>
              </div>
            )}
          </div>
        </div>

        {/* PID Stats */}
        {monitorData.pid_stats && (
          <div className="monitor-card pid-card">
            <h2>🎛️ PID Controller Stats</h2>
            <div className="pid-stats">
              <div className="pid-row">
                <strong>CPU PID:</strong>
                <span>Kp={monitorData.pid_stats.cpu_pid?.Kp}, Ki={monitorData.pid_stats.cpu_pid?.Ki}, Kd={monitorData.pid_stats.cpu_pid?.Kd}</span>
              </div>
              <div className="pid-row">
                <strong>Memory PID:</strong>
                <span>Kp={monitorData.pid_stats.memory_pid?.Kp}, Ki={monitorData.pid_stats.memory_pid?.Ki}, Kd={monitorData.pid_stats.memory_pid?.Kd}</span>
              </div>
              <div className="pid-row">
                <strong>Current Ops/Min:</strong>
                <span>{monitorData.pid_stats.current_ops_per_min?.toFixed(1)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Execution Config */}
        {monitorData.execution_config && (
          <div className="monitor-card control-card">
            <h2>📋 Execution Config</h2>
            <div className="control-info">
              <div className="control-row">
                <span className="control-label">Profile:</span>
                <span className="control-value" style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 13,
                  background: monitorData.execution_config.workload_profile === 'chaos' ? '#fef2f2' :
                    monitorData.execution_config.workload_profile === 'burst' ? '#fff7ed' :
                    monitorData.execution_config.workload_profile === 'ramp_up' ? '#eff6ff' : '#f0fdf4',
                  color: monitorData.execution_config.workload_profile === 'chaos' ? '#dc2626' :
                    monitorData.execution_config.workload_profile === 'burst' ? '#ea580c' :
                    monitorData.execution_config.workload_profile === 'ramp_up' ? '#2563eb' : '#16a34a'
                }}>
                  {monitorData.execution_config.workload_profile.replace(/_/g, ' ').toUpperCase()}
                </span>
              </div>
              <div className="control-row">
                <span className="control-label">Parallel:</span>
                <span className="control-value">
                  {monitorData.execution_config.parallel_execution ? `Yes (max ${monitorData.execution_config.max_parallel_operations})` : 'Sequential'}
                </span>
              </div>
              <div className="control-row">
                <span className="control-label">Ops/Iteration:</span>
                <span className="control-value">{monitorData.execution_config.operations_per_iteration}</span>
              </div>
              <div className="control-row">
                <span className="control-label">Auto-cleanup:</span>
                <span className="control-value">{monitorData.execution_config.auto_cleanup ? '✅ Yes' : '❌ No'}</span>
              </div>
            </div>
          </div>
        )}

        {/* API Latency */}
        {monitorData.latency_summary && monitorData.latency_summary.overall && monitorData.latency_summary.overall.count && monitorData.latency_summary.overall.count > 0 && (
          <div className="monitor-card control-card">
            <h2>⏱ API Latency</h2>
            <div className="control-info">
              <div className="control-row">
                <span className="control-label">Avg:</span>
                <span className="control-value">{monitorData.latency_summary.overall.avg?.toFixed(1)}s</span>
              </div>
              <div className="control-row">
                <span className="control-label">P50:</span>
                <span className="control-value">{monitorData.latency_summary.overall.p50?.toFixed(1)}s</span>
              </div>
              <div className="control-row">
                <span className="control-label">P95:</span>
                <span className="control-value" style={{
                  color: (monitorData.latency_summary.overall.p95 || 0) > 30 ? '#dc2626' : '#16a34a'
                }}>
                  {monitorData.latency_summary.overall.p95?.toFixed(1)}s
                </span>
              </div>
              <div className="control-row">
                <span className="control-label">Total Calls:</span>
                <span className="control-value">{monitorData.latency_summary.overall.count}</span>
              </div>
              {Object.entries(monitorData.latency_summary.per_operation || {}).slice(0, 5).map(([key, stats]) => (
                <div key={key} className="control-row" style={{ fontSize: 12, borderTop: '1px solid #e2e8f0', paddingTop: 4, marginTop: 4 }}>
                  <span className="control-label">{key}:</span>
                  <span className="control-value">avg {stats.avg?.toFixed(1)}s ({stats.count} calls)</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {monitorData.tags && monitorData.tags.length > 0 && (
          <div className="monitor-card control-card">
            <h2>🏷 Tags</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {monitorData.tags.map((tag, i) => (
                <span key={i} style={{ padding: '4px 10px', borderRadius: 12, background: '#e0f2fe', color: '#0369a1', fontSize: 13 }}>{tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* Learning Summary */}
        {monitorData.learning_summary && (
          <div className="monitor-card control-card">
            <h2>📝 Learning Summary</h2>
            <p style={{ margin: 0, lineHeight: 1.6, fontSize: 14 }}>{monitorData.learning_summary}</p>
          </div>
        )}

        {/* ML Recommendations */}
        {monitorData.ml_recommendations && monitorData.ml_recommendations.length > 0 && (
          <div className="monitor-card ml-card">
            <h2>💡 ML Recommendations</h2>
            <div className="ml-recommendations">
              {monitorData.ml_recommendations.slice(0, 5).map((rec, idx) => (
                <div key={idx} className="ml-rec-item">
                  <span className="ml-rec-rank">#{idx + 1}</span>
                  <span className="ml-rec-entity">{rec.entity}</span>
                  <span className="ml-rec-op">{rec.operation}</span>
                  <span className="ml-rec-impact">
                    CPU+{rec.cpu_impact.toFixed(1)}%, Mem+{rec.memory_impact.toFixed(1)}%
                  </span>
                  <span className="ml-rec-score">Score: {rec.score.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Metrics History Graph */}
      <div className="monitor-card full-width">
        <h2>📈 Metrics History</h2>
        {renderMetricsGraph()}
      </div>
    </div>
  );
};

export default SmartExecutionMonitorAI;
