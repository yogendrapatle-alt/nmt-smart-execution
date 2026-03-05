/**
 * Multi-Testbed Monitor Page
 * 
 * Live progress dashboard for multi-testbed executions
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import '../styles/MultiTestbedMonitor.css';

interface ExecutionStatus {
  status: string;
  total_testbeds: number;
  completed_testbeds: number;
  failed_testbeds: number;
  started_at: string;
  completed_at?: string;
  progress: Record<string, {
    status: string;
    execution_id?: string;
    error?: string;
  }>;
  aggregate_metrics?: {
    total_operations: number;
    successful_operations: number;
    avg_cpu_achieved: number;
    avg_memory_achieved: number;
  };
}

const MultiTestbedMonitor: React.FC = () => {
  const { multiExecutionId } = useParams<{ multiExecutionId: string }>();
  const navigate = useNavigate();
  
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    fetchStatus();
    
    // Auto-refresh every 3 seconds if enabled and not completed
    let interval: NodeJS.Timeout | null = null;
    
    if (autoRefresh && status?.status === 'running') {
      interval = setInterval(fetchStatus, 3000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [multiExecutionId, autoRefresh, status?.status]);

  const fetchStatus = async () => {
    try {
      const response = await fetch(`/api/multi-testbed/status/${multiExecutionId}`);
      const data = await response.json();
      
      if (data.success) {
        setStatus(data);
        setLoading(false);
      }
    } catch (err) {
      console.error('Error fetching status:', err);
    }
  };

  const getProgressPercentage = () => {
    if (!status) return 0;
    return Math.round((status.completed_testbeds / status.total_testbeds) * 100);
  };

  const getStatusIcon = (testbedStatus: string) => {
    switch (testbedStatus) {
      case 'completed': return '✅';
      case 'running': return '⏳';
      case 'failed': return '❌';
      default: return '⏸️';
    }
  };

  const getStatusClass = (testbedStatus: string) => {
    switch (testbedStatus) {
      case 'completed': return 'status-completed';
      case 'running': return 'status-running';
      case 'failed': return 'status-failed';
      default: return 'status-pending';
    }
  };

  if (loading) {
    return (
      <div className="multi-testbed-monitor">
        <div className="loading">Loading execution status...</div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="multi-testbed-monitor">
        <div className="error">Execution not found</div>
      </div>
    );
  }

  const progressPercentage = getProgressPercentage();
  const isCompleted = status.status === 'completed' || status.status === 'partial' || status.status === 'failed';

  return (
    <div className="multi-testbed-monitor">
      <div className="page-header">
        <h1>📊 Multi-Testbed Execution Monitor</h1>
        <p>Execution ID: <code>{multiExecutionId}</code></p>
      </div>

      {/* Overall Status */}
      <div className="status-card overall-status">
        <div className="status-header">
          <h2>Overall Status</h2>
          <div className={`status-badge ${getStatusClass(status.status)}`}>
            {status.status.toUpperCase()}
          </div>
        </div>

        <div className="progress-section">
          <div className="progress-info">
            <span>Progress</span>
            <span className="progress-percentage">{progressPercentage}%</span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <div className="progress-details">
            <span>✅ Completed: {status.completed_testbeds}</span>
            <span>⏳ Running: {status.total_testbeds - status.completed_testbeds - status.failed_testbeds}</span>
            <span>❌ Failed: {status.failed_testbeds}</span>
            <span>📊 Total: {status.total_testbeds}</span>
          </div>
        </div>

        {/* Aggregate Metrics (if available) */}
        {status.aggregate_metrics && (
          <div className="aggregate-metrics">
            <div className="metric-item">
              <div className="metric-label">Total Operations</div>
              <div className="metric-value">{status.aggregate_metrics.total_operations}</div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Success Rate</div>
              <div className="metric-value">
                {Math.round((status.aggregate_metrics.successful_operations / status.aggregate_metrics.total_operations) * 100)}%
              </div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Avg CPU</div>
              <div className="metric-value">{status.aggregate_metrics.avg_cpu_achieved.toFixed(1)}%</div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Avg Memory</div>
              <div className="metric-value">{status.aggregate_metrics.avg_memory_achieved.toFixed(1)}%</div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="monitor-controls">
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              disabled={isCompleted}
            />
            <span>Auto-refresh ({autoRefresh && !isCompleted ? 'every 3s' : 'off'})</span>
          </label>

          {isCompleted && (
            <button 
              className="btn-primary"
              onClick={() => navigate(`/multi-testbed/report/${multiExecutionId}`)}
            >
              View Full Report
            </button>
          )}
        </div>
      </div>

      {/* Per-Testbed Status */}
      <div className="status-card testbed-status">
        <h2>Testbed Progress</h2>
        
        <div className="testbed-grid">
          {Object.entries(status.progress || {}).map(([testbedId, progress]) => (
            <div key={testbedId} className={`testbed-card ${getStatusClass(progress.status)}`}>
              <div className="testbed-card-header">
                <span className="status-icon">{getStatusIcon(progress.status)}</span>
                <span className="testbed-id">{testbedId.substring(0, 12)}...</span>
              </div>
              
              <div className="testbed-card-body">
                <div className="testbed-status-text">{progress.status}</div>
                
                {progress.execution_id && (
                  <div className="testbed-execution-id">
                    <small>ID: {progress.execution_id.substring(0, 16)}...</small>
                  </div>
                )}
                
                {progress.error && (
                  <div className="testbed-error">
                    <small>Error: {progress.error}</small>
                  </div>
                )}
              </div>

              {progress.status === 'completed' && progress.execution_id && (
                <button 
                  className="btn-link btn-small"
                  onClick={() => navigate(`/smart-execution/report/${progress.execution_id}`)}
                >
                  View Report →
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="status-card timeline-section">
        <h2>Timeline</h2>
        <div className="timeline">
          <div className="timeline-item">
            <div className="timeline-icon">🚀</div>
            <div className="timeline-content">
              <div className="timeline-title">Execution Started</div>
              <div className="timeline-time">{new Date(status.started_at).toLocaleString()}</div>
            </div>
          </div>

          {status.completed_at && (
            <div className="timeline-item">
              <div className="timeline-icon">✅</div>
              <div className="timeline-content">
                <div className="timeline-title">Execution Completed</div>
                <div className="timeline-time">{new Date(status.completed_at).toLocaleString()}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MultiTestbedMonitor;
