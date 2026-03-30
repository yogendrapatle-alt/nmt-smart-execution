import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getApiBase } from '../utils/backendUrl';

interface AIInsights {
  ai_enabled?: boolean;
  pid_performance?: {
    final_operations_per_minute?: number;
    final_phase?: string;
    total_iterations?: number;
    cpu_pid_stats?: any;
    memory_pid_stats?: any;
  };
  ml_performance?: {
    model_trained?: boolean;
    training_samples?: number;
    feature_importance?: any;
  };
  ai_decisions?: Array<{
    iteration: number;
    phase: string;
    reasoning: string;
  }>;
  recommendations?: string[];
}

interface EnhancedReport {
  verdict: {
    result: string;
    summary: string;
    issues: string[];
    success_rate: number;
    threshold_reached: boolean;
    oom_kills: number;
    container_restarts: number;
    high_risk_spikes: number;
  };
  spike_analysis: {
    spikes: any[];
    total_spikes: number;
    avg_recovery_minutes: number;
    high_risk_count: number;
    medium_risk_count: number;
  };
  cluster_health: {
    cpu_throttling: any[];
    container_restarts: any[];
    oom_killed: any[];
    node_conditions: any[];
    pvc_health: any[];
    collection_status: string;
  };
  failure_analysis: {
    groups: any[];
    total_failures: number;
    unique_patterns: number;
  };
  operation_heatmap: {
    buckets: string[];
    entity_ops: string[];
    data: any;
  };
  pod_stability: any[];
  historical_comparison: {
    available: boolean;
    previous_executions?: any[];
    count?: number;
    reason?: string;
  };
  capacity_planning: {
    available: boolean;
    total_ops_executed?: number;
    cpu_per_operation?: number;
    memory_per_operation?: number;
    estimated_total_capacity_ops?: number;
    bottleneck?: string;
    recommendation?: string;
    entities_created?: Record<string, number>;
  };
  iteration_timeline?: {
    iterations: any[];
    total_iterations: number;
    total_spikes: number;
    summary?: any;
  };
  effective_metrics?: {
    baseline?: { cpu_percent?: number; memory_percent?: number };
    final?: { cpu_percent?: number; memory_percent?: number };
    resolution_note?: string;
  };
}

interface ReportData {
  execution_id: string;
  status: string;
  testbed_label: string;
  start_time: string;
  end_time?: string;
  duration_minutes: number;
  total_operations: number;
  successful_operations: number;
  failed_operations: number;
  success_rate: number;
  operations_per_minute: number;
  baseline_metrics: {
    cpu_percent: number;
    memory_percent: number;
  };
  current_metrics: {
    cpu_percent: number;
    memory_percent: number;
  };
  target_config: {
    cpu_threshold: number;
    memory_threshold: number;
    stop_condition: string;
  };
  entity_breakdown: any;
  operations_history: any[];
  metrics_history: any[];
  execution_context?: any;
  ai_insights?: AIInsights;
  ai_enabled?: boolean;
  ai_settings?: any;
  ml_stats?: any;
  pid_stats?: any;
  longevity?: {
    enabled: boolean;
    duration_hours?: number;
    health_check_results?: any[];
    health_baseline?: any;
    checkpoint_reports?: any[];
    entity_parity_snapshots?: any[];
    total_health_checks?: number;
    latest_health_verdict?: string;
  };
}

const SmartExecutionReport: React.FC = () => {
  const { executionId } = useParams<{ executionId: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportData | null>(null);
  const [enhanced, setEnhanced] = useState<EnhancedReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingEnhanced, setDownloadingEnhanced] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'spikes' | 'health' | 'failures' | 'capacity' | 'iterations' | 'heatmap'>('overview');
  const [expandedIterations, setExpandedIterations] = useState<Set<number>>(new Set());
  const [expandedEffectiveOps, setExpandedEffectiveOps] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchReport();
    fetchEnhancedReport();
  }, [executionId]);

  const fetchReport = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${getApiBase()}/api/smart-execution/report/${executionId}`);
      const data = await response.json();
      
      if (data.success) {
        setReport(data);
      } else {
        setError(data.error || 'Failed to fetch report');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchEnhancedReport = async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/smart-execution/report/${executionId}/enhanced?format=json`);
      const data = await response.json();
      if (data.success && data.enhanced_report) {
        setEnhanced(data.enhanced_report);
      }
    } catch {
      // Enhanced report is optional
    }
  };

  const downloadReport = async () => {
    try {
      setDownloading(true);
      const response = await fetch(`${getApiBase()}/api/smart-execution/report/${executionId}/download`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smart-execution-${executionId?.substring(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(`Failed to download report: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const downloadEnhancedReport = async () => {
    try {
      setDownloadingEnhanced(true);
      const response = await fetch(`${getApiBase()}/api/smart-execution/report/${executionId}/enhanced`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smart-execution-enhanced-${executionId?.substring(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(`Failed to download enhanced report: ${err.message}`);
    } finally {
      setDownloadingEnhanced(false);
    }
  };

  const getVerdictStyle = (result: string) => {
    switch (result) {
      case 'PASS': return { bg: '#dcfce7', border: '#22c55e', color: '#166534', icon: 'check_circle' };
      case 'WARN': return { bg: '#fef3c7', border: '#f59e0b', color: '#92400e', icon: 'warning' };
      case 'FAIL': return { bg: '#fee2e2', border: '#ef4444', color: '#991b1b', icon: 'error' };
      default: return { bg: '#f1f5f9', border: '#94a3b8', color: '#475569', icon: 'help_outline' };
    }
  };

  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-danger';
      case 'medium': return 'bg-warning text-dark';
      default: return 'bg-success';
    }
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 1) return `${Math.round(minutes * 60)}s`;
    if (minutes < 60) return `${Math.round(minutes)}m`;
    return `${(minutes / 60).toFixed(1)}h`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { bg: string; icon: string }> = {
      'RUNNING': { bg: 'bg-info', icon: 'play_circle' },
      'COMPLETED': { bg: 'bg-success', icon: 'check_circle' },
      'STOPPED': { bg: 'bg-warning', icon: 'stop_circle' },
      'FAILED': { bg: 'bg-danger', icon: 'error' },
      'THRESHOLD_REACHED': { bg: 'bg-primary', icon: 'flag' }
    };
    return badges[status] || { bg: 'bg-secondary', icon: 'help_outline' };
  };

  if (loading) {
    return (
      <div className="main-content">
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status" style={{ width: '3rem', height: '3rem' }}>
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-3 text-muted">Loading execution report...</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="main-content">
        <div className="alert alert-danger rounded-4 d-flex align-items-center" role="alert">
          <i className="material-icons-outlined me-2" style={{ fontSize: 24 }}>error_outline</i>
          <div className="flex-grow-1">
            <h4 className="alert-heading">Error Loading Report</h4>
            <p className="mb-0">{error || 'Report not found'}</p>
          </div>
          <button 
            className="btn btn-primary rounded-4"
            onClick={() => navigate('/smart-execution/history')}
          >
            <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>arrow_back</i>
            Back to History
          </button>
        </div>
      </div>
    );
  }

  const statusInfo = getStatusBadge(report.status);

  return (
    <div className="main-content">
        {/* Breadcrumb */}
        <div className="d-flex align-items-center mb-3">
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-0">
              <li className="breadcrumb-item">
                <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>
                  <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle' }}>home</i>
                </a>
              </li>
              <li className="breadcrumb-item">
                <a href="#" onClick={(e) => { e.preventDefault(); navigate('/smart-execution/history'); }}>
                  Execution History
                </a>
              </li>
              <li className="breadcrumb-item active">Report</li>
            </ol>
          </nav>
        </div>

        {/* Page Header */}
        <div className="mb-3">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h2 className="fw-bold mb-2 d-flex align-items-center gap-2">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                  width: 48,
                  height: 48,
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>assessment</i>
                </div>
                Smart Execution Report
              </h2>
              <p className="text-muted mb-0">
                Detailed analysis and metrics for execution <code className="small">{executionId?.substring(0, 20)}...</code>
              </p>
            </div>
            <div className="d-flex gap-2">
              <button 
                className="btn btn-primary btn-lg rounded-4 d-flex align-items-center gap-2"
                onClick={downloadEnhancedReport}
                disabled={downloadingEnhanced}
              >
                {downloadingEnhanced ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                    Generating...
                  </>
                ) : (
                  <>
                    <i className="material-icons-outlined" style={{ fontSize: 20 }}>analytics</i>
                    Enhanced Report
                  </>
                )}
              </button>
              <button 
                className="btn btn-outline-primary btn-lg rounded-4 d-flex align-items-center gap-2"
                onClick={downloadReport}
                disabled={downloading}
              >
                {downloading ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                    Downloading...
                  </>
                ) : (
                  <>
                    <i className="material-icons-outlined" style={{ fontSize: 20 }}>download</i>
                    Basic Report
                  </>
                )}
              </button>
              <button 
                className="btn btn-outline-secondary btn-lg rounded-4 d-flex align-items-center gap-2"
                onClick={() => navigate('/smart-execution/history')}
              >
                <i className="material-icons-outlined" style={{ fontSize: 20 }}>arrow_back</i>
                Back
              </button>
            </div>
          </div>
        </div>

        {/* Execution Info Card */}
        <div className="card rounded-4 shadow-none border mb-3">
          <div className="card-body p-4">
            <div className="row g-4">
              <div className="col-md-3">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>flag</i>
                  <span className="small text-muted fw-semibold">Status</span>
                </div>
                <span className={`badge ${statusInfo.bg} rounded-pill px-3 py-2 d-inline-flex align-items-center gap-1`}>
                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>{statusInfo.icon}</i>
                  {report.status}
                </span>
              </div>
              <div className="col-md-3">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>dns</i>
                  <span className="small text-muted fw-semibold">Testbed</span>
                </div>
                <div className="fw-semibold">
                  {report.testbed_label || (report.execution_context && report.execution_context.testbed_label) || 'Unknown'}
                </div>
              </div>
              <div className="col-md-3">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>schedule</i>
                  <span className="small text-muted fw-semibold">Started</span>
                </div>
                <div className="small">{formatDate(report.start_time)}</div>
              </div>
              <div className="col-md-3">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>timer</i>
                  <span className="small text-muted fw-semibold">Duration</span>
                </div>
                <div className="fw-semibold">{formatDuration(report.duration_minutes || 0)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Executive Summary Cards */}
        <div className="row g-3 mb-3">
          <div className="col-md-3">
            <div className="card rounded-4 shadow-none border h-100" style={{ borderLeft: '4px solid #667eea' }}>
              <div className="card-body p-4 text-center">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3 mb-3" style={{
                  width: 56,
                  height: 56,
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>list</i>
                </div>
                <h1 className="display-5 fw-bold text-primary mb-2">{report.total_operations || 0}</h1>
                <p className="text-muted mb-0 fw-semibold">Total Operations</p>
              </div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card rounded-4 shadow-none border h-100" style={{ borderLeft: '4px solid #28a745' }}>
              <div className="card-body p-4 text-center">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3 mb-3" style={{
                  width: 56,
                  height: 56,
                  background: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>check_circle</i>
                </div>
                <h1 className="display-5 fw-bold text-success mb-2">{(report.success_rate || 0).toFixed(1)}%</h1>
                <p className="text-muted mb-0 fw-semibold">Success Rate</p>
              </div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card rounded-4 shadow-none border h-100" style={{ borderLeft: '4px solid #17a2b8' }}>
              <div className="card-body p-4 text-center">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3 mb-3" style={{
                  width: 56,
                  height: 56,
                  background: 'linear-gradient(135deg, #17a2b8 0%, #138496 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>speed</i>
                </div>
                <h1 className="display-5 fw-bold text-info mb-2">{(report.operations_per_minute || 0).toFixed(1)}</h1>
                <p className="text-muted mb-0 fw-semibold">Ops/Min</p>
              </div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card rounded-4 shadow-none border h-100" style={{ borderLeft: '4px solid #ffc107' }}>
              <div className="card-body p-4 text-center">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3 mb-3" style={{
                  width: 56,
                  height: 56,
                  background: 'linear-gradient(135deg, #ffc107 0%, #ff9800 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>error</i>
                </div>
                <h1 className="display-5 fw-bold text-warning mb-2">{report.failed_operations || 0}</h1>
                <p className="text-muted mb-0 fw-semibold">Failed Ops</p>
              </div>
            </div>
          </div>
        </div>

        {/* AI Verdict Banner */}
        {enhanced?.verdict && (
          <div className="rounded-4 mb-3 p-4 d-flex align-items-start gap-3" style={{
            background: getVerdictStyle(enhanced.verdict.result).bg,
            borderLeft: `6px solid ${getVerdictStyle(enhanced.verdict.result).border}`,
          }}>
            <i className="material-icons-outlined" style={{ fontSize: 48, color: getVerdictStyle(enhanced.verdict.result).color }}>
              {getVerdictStyle(enhanced.verdict.result).icon}
            </i>
            <div>
              <h3 className="fw-bold mb-1" style={{ color: getVerdictStyle(enhanced.verdict.result).color }}>
                {enhanced.verdict.result}
              </h3>
              <p className="mb-2" style={{ color: getVerdictStyle(enhanced.verdict.result).color, opacity: 0.8 }}>
                {enhanced.verdict.summary}
              </p>
              {enhanced.verdict.issues.length > 0 && (
                <ul className="mb-0 ps-3" style={{ color: getVerdictStyle(enhanced.verdict.result).color, opacity: 0.7 }}>
                  {enhanced.verdict.issues.map((issue, idx) => (
                    <li key={idx} className="small">{issue}</li>
                  ))}
                </ul>
              )}
              <div className="d-flex gap-3 mt-2 flex-wrap">
                <span className="badge bg-dark bg-opacity-10 text-dark">OOM Kills: {enhanced.verdict.oom_kills}</span>
                <span className="badge bg-dark bg-opacity-10 text-dark">Restarts: {enhanced.verdict.container_restarts}</span>
                <span className="badge bg-dark bg-opacity-10 text-dark">High-Risk Spikes: {enhanced.verdict.high_risk_spikes}</span>
              </div>
            </div>
          </div>
        )}

        {/* Enhanced Report Tabs */}
        {enhanced && (
          <div className="card rounded-4 shadow-none border mb-3">
            <div className="card-header bg-transparent border-bottom p-0">
              <ul className="nav nav-tabs border-0" style={{ padding: '0 16px' }}>
                {[
                  { key: 'overview', label: 'Overview', icon: 'dashboard' },
                  { key: 'iterations', label: `Iterations (${enhanced.iteration_timeline?.total_iterations || 0})`, icon: 'format_list_numbered' },
                  { key: 'spikes', label: `Spikes (${enhanced.spike_analysis?.total_spikes || 0})`, icon: 'show_chart' },
                  { key: 'heatmap', label: 'Heatmap', icon: 'grid_on' },
                  { key: 'health', label: 'Cluster Health', icon: 'health_and_safety' },
                  { key: 'failures', label: `Failures (${enhanced.failure_analysis?.total_failures || 0})`, icon: 'bug_report' },
                  { key: 'capacity', label: 'Capacity', icon: 'speed' },
                ].map((tab) => (
                  <li key={tab.key} className="nav-item">
                    <button
                      className={`nav-link d-flex align-items-center gap-1 ${activeTab === tab.key ? 'active fw-semibold' : ''}`}
                      onClick={() => setActiveTab(tab.key as any)}
                      style={{ border: 'none', borderBottom: activeTab === tab.key ? '3px solid #667eea' : '3px solid transparent', borderRadius: 0, padding: '12px 16px' }}
                    >
                      <i className="material-icons-outlined" style={{ fontSize: 18 }}>{tab.icon}</i>
                      {tab.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card-body p-4">

              {/* OVERVIEW TAB */}
              {activeTab === 'overview' && (
                <div>
                  {/* Execution Summary Counts */}
                  <div className="mb-4">
                    <h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
                      <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>summarize</i>
                      Execution Summary
                    </h6>
                    <div className="row g-2">
                      {[
                        { label: 'Iterations', value: enhanced.iteration_timeline?.total_iterations || report.metrics_history?.length || 0, icon: 'repeat', color: '#667eea' },
                        { label: 'Total Operations', value: report.total_operations || 0, icon: 'play_arrow', color: '#0078d4' },
                        { label: 'Successful', value: report.successful_operations || 0, icon: 'check_circle', color: '#22c55e' },
                        { label: 'Failed', value: report.failed_operations || 0, icon: 'cancel', color: '#ef4444' },
                        { label: 'Spikes Detected', value: enhanced.spike_analysis?.total_spikes || 0, icon: 'show_chart', color: '#f59e0b' },
                        { label: 'Anomalies', value: (report as any).detected_anomalies?.length || enhanced.verdict?.oom_kills || 0, icon: 'warning', color: '#e11d48' },
                        { label: 'Stress Pods', value: (report as any).resource_summary?.stress_pods_deployed || 0, icon: 'rocket_launch', color: '#8b5cf6' },
                        { label: 'Duration', value: `${(report.duration_minutes || 0).toFixed(0)}m`, icon: 'schedule', color: '#64748b' },
                      ].map((item, idx) => (
                        <div key={idx} className="col-md-3 col-6">
                          <div className="d-flex align-items-center gap-2 p-2 bg-light rounded-3">
                            <i className="material-icons-outlined" style={{ fontSize: 18, color: item.color }}>{item.icon}</i>
                            <div>
                              <div className="fw-bold" style={{ fontSize: 16 }}>{item.value}</div>
                              <div className="text-muted" style={{ fontSize: 11 }}>{item.label}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Most Effective Operations */}
                  {(report as any).operation_effectiveness?.length > 0 && (
                    <div className="mb-4">
                      <h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-success" style={{ fontSize: 20 }}>trending_up</i>
                        Most Effective Operations
                      </h6>
                      <div className="table-responsive">
                        <table className="table table-sm table-hover align-middle mb-0">
                          <thead className="table-light">
                            <tr><th style={{ width: 30 }}></th><th>Operation</th><th>Count</th><th>Avg CPU Impact</th><th>Avg Mem Impact</th><th>Avg Duration</th><th>Success Rate</th></tr>
                          </thead>
                          <tbody>
                            {(report as any).operation_effectiveness.map((op: any, idx: number) => {
                              const key = `${op.entity_type || op.entity}.${op.operation}`;
                              const isExpanded = expandedEffectiveOps.has(key);
                              return (
                                <React.Fragment key={idx}>
                                  <tr
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => setExpandedEffectiveOps(prev => {
                                      const next = new Set(prev);
                                      next.has(key) ? next.delete(key) : next.add(key);
                                      return next;
                                    })}
                                  >
                                    <td><i className="material-icons-outlined" style={{ fontSize: 16 }}>{isExpanded ? 'expand_less' : 'expand_more'}</i></td>
                                    <td><strong>{key}</strong></td>
                                    <td><span className="badge bg-primary rounded-pill">{op.count ?? op.executions ?? op.execution_count ?? '-'}</span></td>
                                    <td style={{ color: ((op.avg_cpu_impact ?? op.avg_cpu_delta) || 0) > 0 ? '#ef4444' : '#22c55e' }}>{((op.avg_cpu_impact ?? op.avg_cpu_delta) || 0) > 0 ? '+' : ''}{((op.avg_cpu_impact ?? op.avg_cpu_delta) || 0).toFixed(2)}%</td>
                                    <td style={{ color: ((op.avg_memory_impact ?? op.avg_memory_delta) || 0) > 0 ? '#ef4444' : '#22c55e' }}>{((op.avg_memory_impact ?? op.avg_memory_delta) || 0) > 0 ? '+' : ''}{((op.avg_memory_impact ?? op.avg_memory_delta) || 0).toFixed(2)}%</td>
                                    <td>{(op.avg_duration || 0).toFixed(1)}s</td>
                                    <td><span className={`badge ${(op.success_rate || 0) >= 80 ? 'bg-success' : (op.success_rate || 0) >= 50 ? 'bg-warning text-dark' : 'bg-danger'} rounded-pill`}>{(op.success_rate || 0).toFixed(0)}%</span></td>
                                  </tr>
                                  {isExpanded && op.impacts && (
                                    <tr>
                                      <td colSpan={7} style={{ background: '#f8fafc', padding: '8px 16px 8px 48px' }}>
                                        <div className="small">
                                          <strong>Individual Executions:</strong>
                                          <table className="table table-sm table-bordered mt-1 mb-0" style={{ fontSize: 11 }}>
                                            <thead className="table-light"><tr><th>#</th><th>CPU Before</th><th>CPU After</th><th>CPU Δ</th><th>Mem Before</th><th>Mem After</th><th>Mem Δ</th><th>Duration</th></tr></thead>
                                            <tbody>
                                              {op.impacts.slice(0, 15).map((impact: any, ii: number) => (
                                                <tr key={ii}>
                                                  <td>{ii + 1}</td>
                                                  <td>{(impact.cpu_before || 0).toFixed(1)}%</td>
                                                  <td>{(impact.cpu_after || 0).toFixed(1)}%</td>
                                                  <td style={{ color: (impact.cpu_delta || 0) > 0 ? '#ef4444' : '#22c55e', fontWeight: 'bold' }}>{(impact.cpu_delta || 0) > 0 ? '+' : ''}{(impact.cpu_delta || 0).toFixed(2)}%</td>
                                                  <td>{(impact.memory_before || 0).toFixed(1)}%</td>
                                                  <td>{(impact.memory_after || 0).toFixed(1)}%</td>
                                                  <td style={{ color: (impact.memory_delta || 0) > 0 ? '#ef4444' : '#22c55e', fontWeight: 'bold' }}>{(impact.memory_delta || 0) > 0 ? '+' : ''}{(impact.memory_delta || 0).toFixed(2)}%</td>
                                                  <td>{(impact.duration || 0).toFixed(1)}s</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Capacity Planning */}
                  {enhanced.capacity_planning?.available && (
                    <div className="mb-4">
                      <h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>analytics</i>
                        Capacity Planning
                      </h6>
                      <div className="row g-3 mb-3">
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="small text-muted fw-semibold">CPU / Operation</div>
                            <div className="h4 mb-0 text-primary">{enhanced.capacity_planning.cpu_per_operation}%</div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="small text-muted fw-semibold">Memory / Operation</div>
                            <div className="h4 mb-0 text-warning">{enhanced.capacity_planning.memory_per_operation}%</div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="small text-muted fw-semibold">Bottleneck</div>
                            <div className="h5 mb-0"><span className="badge bg-danger">{enhanced.capacity_planning.bottleneck?.toUpperCase()}</span></div>
                          </div>
                        </div>
                        {enhanced.capacity_planning.estimated_total_capacity_ops && (
                          <div className="col-md-3">
                            <div className="p-3 bg-light rounded-3 text-center">
                              <div className="small text-muted fw-semibold">Est. Max Ops</div>
                              <div className="h4 mb-0 text-info">~{enhanced.capacity_planning.estimated_total_capacity_ops}</div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="alert alert-info rounded-3 mb-0">
                        <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 18 }}>tips_and_updates</i>
                        {enhanced.capacity_planning.recommendation}
                      </div>
                    </div>
                  )}

                  {/* Historical Comparison */}
                  {enhanced.historical_comparison?.available && enhanced.historical_comparison.previous_executions && (
                    <div>
                      <h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-warning" style={{ fontSize: 20 }}>history</i>
                        Previous Executions on This Testbed
                      </h6>
                      <div className="table-responsive">
                        <table className="table table-hover table-sm align-middle mb-0">
                          <thead className="table-light">
                            <tr><th>Execution</th><th>Status</th><th>Duration</th><th>Iterations</th><th>Ops</th><th>Success</th><th>CPU Start</th><th>CPU End</th></tr>
                          </thead>
                          <tbody>
                            {enhanced.historical_comparison.previous_executions.map((h: any, idx: number) => (
                              <tr key={idx}>
                                <td><code className="small">{h.execution_id?.substring(0, 12)}...</code></td>
                                <td><span className={`badge ${h.status === 'COMPLETED' ? 'bg-success' : h.status === 'LONGEVITY_SUSTAINING' ? 'bg-info' : 'bg-warning'} rounded-pill`}>{h.status}</span></td>
                                <td>{h.duration_minutes}m</td>
                                <td><strong>{h.iterations || '-'}</strong></td>
                                <td>{h.total_operations}</td>
                                <td>{h.success_rate}%</td>
                                <td>{h.baseline_cpu?.toFixed(1)}%</td>
                                <td>{h.final_cpu?.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SPIKE ANALYSIS TAB */}
              {activeTab === 'spikes' && (
                <div>
                  {enhanced.spike_analysis?.spikes?.length > 0 ? (
                    <>
                      <div className="row g-3 mb-4">
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="h3 mb-0 text-danger fw-bold">{enhanced.spike_analysis.high_risk_count}</div>
                            <div className="small text-muted fw-semibold">High Risk</div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="h3 mb-0 text-warning fw-bold">{enhanced.spike_analysis.medium_risk_count}</div>
                            <div className="small text-muted fw-semibold">Medium Risk</div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="h3 mb-0 text-info fw-bold">{enhanced.spike_analysis.total_spikes}</div>
                            <div className="small text-muted fw-semibold">Total Spikes</div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="p-3 bg-light rounded-3 text-center">
                            <div className="h3 mb-0 text-success fw-bold">{enhanced.spike_analysis.avg_recovery_minutes}m</div>
                            <div className="small text-muted fw-semibold">Avg Recovery</div>
                          </div>
                        </div>
                      </div>

                      {enhanced.spike_analysis.spikes.slice(0, 10).map((spike: any, idx: number) => (
                        <div key={idx} className="border rounded-3 p-3 mb-3" style={{
                          borderLeft: `4px solid ${spike.risk_level === 'high' ? '#ef4444' : spike.risk_level === 'medium' ? '#f59e0b' : '#22c55e'} !important`,
                          background: spike.risk_level === 'high' ? '#fef2f2' : spike.risk_level === 'medium' ? '#fffbeb' : '#f0fdf4'
                        }}>
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <h6 className="fw-bold mb-0">Spike #{spike.spike_number} — Iteration {spike.iteration}
                              {spike.operation_count > 0 && <span className="badge bg-secondary ms-2">{spike.operation_count} ops ({spike.operations_success}ok/{spike.operations_failed}fail)</span>}
                            </h6>
                            <span className={`badge ${getRiskBadge(spike.risk_level)} rounded-pill`}>{spike.risk_level?.toUpperCase()} RISK</span>
                          </div>
                          <div className="row g-3 mb-2">
                            <div className="col-md-3">
                              <div className="small text-muted fw-semibold">CPU Change</div>
                              <div className="fw-bold" style={{ color: spike.cpu_delta > 0 ? '#ef4444' : '#22c55e' }}>
                                {spike.cpu_before?.toFixed(1)}% → {spike.cpu_after?.toFixed(1)}% ({spike.cpu_delta > 0 ? '+' : ''}{spike.cpu_delta?.toFixed(1)}%)
                              </div>
                            </div>
                            <div className="col-md-3">
                              <div className="small text-muted fw-semibold">Memory Change</div>
                              <div className="fw-bold" style={{ color: spike.memory_delta > 0 ? '#ef4444' : '#22c55e' }}>
                                {spike.memory_before?.toFixed(1)}% → {spike.memory_after?.toFixed(1)}% ({spike.memory_delta > 0 ? '+' : ''}{spike.memory_delta?.toFixed(1)}%)
                              </div>
                            </div>
                            {spike.recovery_minutes && (
                              <div className="col-md-3">
                                <div className="small text-muted fw-semibold">Recovery Time</div>
                                <div className="fw-bold text-info">{spike.recovery_minutes} min</div>
                              </div>
                            )}
                            {spike.ml_prediction?.model_available && (
                              <div className="col-md-3">
                                <div className="small text-muted fw-semibold">ML Predicted</div>
                                <div className="fw-bold text-purple">CPU: {spike.ml_prediction.predicted_cpu_impact > 0 ? '+' : ''}{spike.ml_prediction.predicted_cpu_impact?.toFixed(1)}%</div>
                              </div>
                            )}
                          </div>

                          {spike.causal_operations?.length > 0 && (
                            <div className="mt-2">
                              <div className="small text-muted fw-semibold mb-1">Causal Operations ({spike.causal_operations.length})</div>
                              <div className="table-responsive">
                                <table className="table table-sm table-bordered mb-0">
                                  <thead className="table-light"><tr><th>Entity</th><th>Op</th><th>Name</th><th>Status</th><th>Timing</th></tr></thead>
                                  <tbody>
                                    {spike.causal_operations.slice(0, 5).map((op: any, oi: number) => (
                                      <tr key={oi}>
                                        <td>{op.entity_type}</td>
                                        <td>{op.operation}</td>
                                        <td><code className="small">{op.entity_name?.substring(0, 30)}</code></td>
                                        <td><span className={`badge ${op.status === 'SUCCESS' ? 'bg-success' : 'bg-danger'} rounded-pill`}>{op.status}</span></td>
                                        <td>{op.seconds_before_spike}s before</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {spike.affected_pods?.length > 0 && (
                            <div className="mt-2">
                              <div className="small text-muted fw-semibold mb-1">Affected Pods</div>
                              <div className="d-flex gap-2 flex-wrap">
                                {spike.affected_pods.slice(0, 5).map((pod: any, pi: number) => (
                                  <span key={pi} className="badge bg-light text-dark border">
                                    {pod.pod_name?.substring(0, 25)} (CPU: {pod.cpu_delta > 0 ? '+' : ''}{pod.cpu_delta?.toFixed(1)}%)
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>check_circle</i>
                      <div>No significant metric spikes detected</div>
                    </div>
                  )}
                </div>
              )}

              {/* CLUSTER HEALTH TAB */}
              {activeTab === 'health' && (
                <div>
                  {enhanced.cluster_health?.collection_status === 'success' ? (
                    <>
                      {/* Node Conditions */}
                      {enhanced.cluster_health.node_conditions?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3">Node Conditions</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Node</th><th>Ready</th><th>Disk Pressure</th><th>Memory Pressure</th><th>PID Pressure</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.node_conditions.map((n: any, i: number) => (
                                  <tr key={i}>
                                    <td><strong>{n.node}</strong></td>
                                    <td>{n.ready ? <span className="badge bg-success">Ready</span> : <span className="badge bg-danger">Not Ready</span>}</td>
                                    <td>{n.disk_pressure ? <span className="badge bg-danger">YES</span> : <span className="badge bg-success">No</span>}</td>
                                    <td>{n.memory_pressure ? <span className="badge bg-danger">YES</span> : <span className="badge bg-success">No</span>}</td>
                                    <td>{n.pid_pressure ? <span className="badge bg-danger">YES</span> : <span className="badge bg-success">No</span>}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* OOM Killed */}
                      {enhanced.cluster_health.oom_killed?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3 text-danger">OOMKilled Containers ({enhanced.cluster_health.oom_killed.length})</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Namespace</th><th>Container</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.oom_killed.map((o: any, i: number) => (
                                  <tr key={i}><td><code>{o.pod}</code></td><td>{o.namespace}</td><td>{o.container}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* CPU Throttling */}
                      {enhanced.cluster_health.cpu_throttling?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3 text-warning">CPU Throttled Pods ({enhanced.cluster_health.cpu_throttling.length})</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Namespace</th><th>Container</th><th>Throttle %</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.cpu_throttling.slice(0, 15).map((t: any, i: number) => (
                                  <tr key={i}>
                                    <td><code>{t.pod}</code></td><td>{t.namespace}</td><td>{t.container}</td>
                                    <td><span className={`badge ${t.throttle_ratio > 30 ? 'bg-danger' : t.throttle_ratio > 10 ? 'bg-warning text-dark' : 'bg-info'}`}>{t.throttle_ratio}%</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Container Restarts */}
                      {enhanced.cluster_health.container_restarts?.length > 0 && (
                        <div className="mb-4">
                          <h6 className="fw-bold mb-3">Container Restarts (Last Hour)</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Namespace</th><th>Container</th><th>Restarts</th></tr></thead>
                              <tbody>
                                {enhanced.cluster_health.container_restarts.slice(0, 10).map((r: any, i: number) => (
                                  <tr key={i}>
                                    <td><code>{r.pod}</code></td><td>{r.namespace}</td><td>{r.container}</td>
                                    <td><span className="badge bg-warning text-dark">{r.restart_count}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Pod Stability Scores */}
                      {enhanced.pod_stability?.length > 0 && (
                        <div>
                          <h6 className="fw-bold mb-3">Pod Stability Scores</h6>
                          <div className="table-responsive">
                            <table className="table table-sm table-bordered">
                              <thead className="table-light"><tr><th>Pod</th><th>Score</th><th>Restarts</th><th>Throttle</th><th>OOM</th><th>Max CPU</th></tr></thead>
                              <tbody>
                                {enhanced.pod_stability.slice(0, 15).map((p: any, i: number) => (
                                  <tr key={i}>
                                    <td><code className="small">{p.pod_name?.substring(0, 30)}</code></td>
                                    <td>
                                      <div className="d-flex align-items-center gap-2">
                                        <div className="progress" style={{ width: 60, height: 6 }}>
                                          <div className={`progress-bar ${p.stability_score >= 80 ? 'bg-success' : p.stability_score >= 50 ? 'bg-warning' : 'bg-danger'}`}
                                            style={{ width: `${p.stability_score}%` }} />
                                        </div>
                                        <strong>{p.stability_score}</strong>
                                      </div>
                                    </td>
                                    <td>{p.restarts > 0 ? <span className="badge bg-danger">{p.restarts}</span> : '0'}</td>
                                    <td>{p.cpu_throttle_pct > 10 ? <span className="badge bg-warning text-dark">{p.cpu_throttle_pct}%</span> : `${p.cpu_throttle_pct}%`}</td>
                                    <td>{p.oom_killed ? <span className="badge bg-danger">YES</span> : <span className="badge bg-success">No</span>}</td>
                                    <td>{p.max_cpu_pct}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>cloud_off</i>
                      <div>Cluster health data unavailable (Prometheus not reachable during report generation)</div>
                      <div className="small mt-1">Status: {enhanced.cluster_health?.collection_status || 'N/A'}</div>
                      <div className="small mt-1 text-info">Tip: Health data is collected during execution. Run a new execution to get fresh data.</div>
                    </div>
                  )}
                </div>
              )}

              {/* FAILURES TAB */}
              {activeTab === 'failures' && (
                <div>
                  {enhanced.failure_analysis?.groups?.length > 0 ? (
                    <>
                      <div className="alert alert-danger rounded-3 mb-3">
                        <strong>{enhanced.failure_analysis.total_failures}</strong> failures grouped into <strong>{enhanced.failure_analysis.unique_patterns}</strong> root cause patterns
                      </div>
                      {enhanced.failure_analysis.groups.map((group: any, idx: number) => (
                        <div key={idx} className="border rounded-3 p-3 mb-3" style={{ borderLeft: '4px solid #ef4444' }}>
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <strong>{group.count}x — {group.entity_types?.join(', ')} {group.operations?.join(', ')}</strong>
                            <span className="badge bg-danger rounded-pill">{group.count} occurrences</span>
                          </div>
                          <div className="mb-2">
                            <code className="small text-muted">{group.sample_error?.substring(0, 200)}</code>
                          </div>
                          <div className="alert alert-warning rounded-3 mb-0 py-2">
                            <strong>Root Cause:</strong> {group.root_cause_hint}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>check_circle</i>
                      <div>No failures detected</div>
                    </div>
                  )}
                </div>
              )}

              {/* CAPACITY TAB */}
              {activeTab === 'capacity' && (
                <div>
                  {enhanced.capacity_planning?.available ? (
                    <>
                      <div className="row g-3 mb-4">
                        <div className="col-md-3">
                          <div className="card rounded-3 border h-100">
                            <div className="card-body text-center p-3">
                              <div className="h2 fw-bold text-primary mb-1">{enhanced.capacity_planning.total_ops_executed}</div>
                              <div className="small text-muted fw-semibold">Ops Executed</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="card rounded-3 border h-100">
                            <div className="card-body text-center p-3">
                              <div className="h2 fw-bold text-info mb-1">{enhanced.capacity_planning.cpu_per_operation}%</div>
                              <div className="small text-muted fw-semibold">CPU per Op</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="card rounded-3 border h-100">
                            <div className="card-body text-center p-3">
                              <div className="h2 fw-bold text-warning mb-1">{enhanced.capacity_planning.memory_per_operation}%</div>
                              <div className="small text-muted fw-semibold">Memory per Op</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="card rounded-3 border h-100">
                            <div className="card-body text-center p-3">
                              <div className="h2 fw-bold text-danger mb-1">{enhanced.capacity_planning.bottleneck?.toUpperCase()}</div>
                              <div className="small text-muted fw-semibold">Bottleneck</div>
                            </div>
                          </div>
                        </div>
                      </div>
                      {enhanced.capacity_planning.estimated_total_capacity_ops && (
                        <div className="alert alert-info rounded-3 mb-3">
                          <strong>Estimated Maximum Capacity:</strong> ~{enhanced.capacity_planning.estimated_total_capacity_ops} operations before reaching target threshold
                        </div>
                      )}
                      <div className="alert alert-light rounded-3 border">
                        <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 18 }}>tips_and_updates</i>
                        {enhanced.capacity_planning.recommendation}
                      </div>
                      {enhanced.capacity_planning.entities_created && Object.keys(enhanced.capacity_planning.entities_created).length > 0 && (
                        <div className="mt-3">
                          <h6 className="fw-bold mb-2">Entities Created</h6>
                          <div className="d-flex gap-2 flex-wrap">
                            {Object.entries(enhanced.capacity_planning.entities_created).map(([etype, count]) => (
                              <span key={etype} className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 rounded-pill px-3 py-2">
                                {etype}: {count as number}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>info</i>
                      <div>Not enough data for capacity planning</div>
                    </div>
                  )}
                </div>
              )}

              {/* ITERATIONS TIMELINE TAB */}
              {activeTab === 'iterations' && (
                <div>
                  {enhanced.iteration_timeline?.iterations?.length > 0 ? (
                    <>
                      <p className="text-muted small mb-3">
                        Each row is one controller <strong>iteration</strong> (metrics sample). <strong>Ops</strong> = operations attributed to that iteration
                        (stored <code>iteration</code> on each op when available; otherwise time-window matching). Expand a row for the full list and
                        <strong> counts by entity × operation</strong>.
                      </p>
                      <div className="d-flex gap-3 mb-3 flex-wrap">
                        <span className="badge bg-primary bg-opacity-10 text-primary border px-3 py-2">Total Iterations: <strong>{enhanced.iteration_timeline.total_iterations}</strong></span>
                        <span className="badge bg-danger bg-opacity-10 text-danger border px-3 py-2">Spike Iterations: <strong>{enhanced.iteration_timeline.total_spikes}</strong></span>
                        <span className="badge bg-info bg-opacity-10 text-info border px-3 py-2">Total Ops: <strong>{enhanced.iteration_timeline.summary?.total_ops || 0}</strong></span>
                        <span className="badge bg-success bg-opacity-10 text-success border px-3 py-2">Creates: <strong>{enhanced.iteration_timeline.summary?.total_creates || 0}</strong></span>
                        <span className="badge bg-warning bg-opacity-10 text-dark border px-3 py-2">Deletes: <strong>{enhanced.iteration_timeline.summary?.total_deletes || 0}</strong></span>
                        <span className="badge bg-secondary bg-opacity-10 text-dark border px-3 py-2">Avg Ops/Iter: <strong>{enhanced.iteration_timeline.summary?.avg_ops_per_iteration || 0}</strong></span>
                      </div>
                      <div className="table-responsive" style={{ maxHeight: 600, overflowY: 'auto' }}>
                        <table className="table table-sm table-hover align-middle mb-0">
                          <thead className="table-light sticky-top">
                            <tr>
                              <th style={{ width: 40 }}></th>
                              <th>Iter</th>
                              <th>Time</th>
                              <th>CPU</th>
                              <th>Mem</th>
                              <th>CPU Δ</th>
                              <th>Mem Δ</th>
                              <th>Ops</th>
                              <th>Creates</th>
                              <th>Deletes</th>
                              <th>Success</th>
                              <th>Failed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {enhanced.iteration_timeline.iterations.map((iter: any, idx: number) => (
                              <React.Fragment key={idx}>
                                <tr
                                  style={{
                                    cursor: iter.operations_count > 0 ? 'pointer' : 'default',
                                    background: iter.is_spike
                                      ? iter.spike_risk === 'high' ? '#fef2f2' : iter.spike_risk === 'medium' ? '#fffbeb' : '#f0fdf4'
                                      : undefined,
                                    borderLeft: iter.is_spike ? `4px solid ${iter.spike_risk === 'high' ? '#ef4444' : iter.spike_risk === 'medium' ? '#f59e0b' : '#22c55e'}` : '4px solid transparent',
                                  }}
                                  onClick={() => {
                                    const hasDetail = (iter.operations_count > 0) || (iter.operation_breakdown && Object.keys(iter.operation_breakdown).length > 0);
                                    if (hasDetail) {
                                      setExpandedIterations(prev => {
                                        const next = new Set(prev);
                                        next.has(iter.iteration) ? next.delete(iter.iteration) : next.add(iter.iteration);
                                        return next;
                                      });
                                    }
                                  }}
                                >
                                  <td>
                                    {((iter.operations_count > 0) || (iter.operation_breakdown && Object.keys(iter.operation_breakdown).length > 0)) && (
                                      <i className="material-icons-outlined" style={{ fontSize: 16 }}>
                                        {expandedIterations.has(iter.iteration) ? 'expand_less' : 'expand_more'}
                                      </i>
                                    )}
                                  </td>
                                  <td>
                                    <strong>#{iter.iteration}</strong>
                                    {iter.is_spike && <span className={`badge ms-1 ${iter.spike_risk === 'high' ? 'bg-danger' : iter.spike_risk === 'medium' ? 'bg-warning text-dark' : 'bg-success'}`} style={{ fontSize: 9 }}>SPIKE</span>}
                                  </td>
                                  <td className="text-muted small">{iter.timestamp ? new Date(iter.timestamp).toLocaleTimeString() : '-'}</td>
                                  <td><strong>{iter.cpu}%</strong></td>
                                  <td><strong>{iter.memory}%</strong></td>
                                  <td style={{ color: iter.cpu_delta > 0 ? '#ef4444' : iter.cpu_delta < -2 ? '#22c55e' : '#666' }}>
                                    {iter.cpu_delta > 0 ? '+' : ''}{iter.cpu_delta}%
                                  </td>
                                  <td style={{ color: iter.memory_delta > 0 ? '#ef4444' : iter.memory_delta < -2 ? '#22c55e' : '#666' }}>
                                    {iter.memory_delta > 0 ? '+' : ''}{iter.memory_delta}%
                                  </td>
                                  <td><span className="badge bg-primary rounded-pill">{iter.operations_count}</span></td>
                                  <td>{iter.creates > 0 && <span className="badge bg-info bg-opacity-25 text-info">{iter.creates}</span>}</td>
                                  <td>{iter.deletes > 0 && <span className="badge bg-warning bg-opacity-25 text-dark">{iter.deletes}</span>}</td>
                                  <td>{iter.operations_success > 0 && <span className="text-success fw-bold">{iter.operations_success}</span>}</td>
                                  <td>{iter.operations_failed > 0 && <span className="text-danger fw-bold">{iter.operations_failed}</span>}</td>
                                </tr>
                                {expandedIterations.has(iter.iteration) && ((iter.operations?.length > 0) || (iter.operation_breakdown && Object.keys(iter.operation_breakdown).length > 0)) && (
                                  <tr>
                                    <td colSpan={12} style={{ background: '#f8fafc', padding: '8px 16px 8px 48px' }}>
                                      <div className="small">
                                        {Object.keys(iter.operation_breakdown || {}).length > 0 && (
                                          <div className="mb-3">
                                            <strong>Counts by entity × operation (this iteration):</strong>
                                            <table className="table table-sm table-bordered mt-1 mb-0" style={{ fontSize: 12 }}>
                                              <thead className="table-light"><tr><th>Entity.operation</th><th>Count</th><th>OK</th><th>Fail</th><th>Avg duration (s)</th></tr></thead>
                                              <tbody>
                                                {Object.entries(iter.operation_breakdown).map(([key, val]: [string, any]) => (
                                                  <tr key={key}>
                                                    <td><code>{key}</code></td>
                                                    <td><span className="badge bg-primary rounded-pill">{val.count}</span></td>
                                                    <td className="text-success">{val.success}</td>
                                                    <td className="text-danger">{val.failed}</td>
                                                    <td>{val.avg_duration ?? '—'}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                        {iter.operations?.length > 0 && (
                                          <>
                                            <strong>Operation instances (up to 20):</strong>
                                            <table className="table table-sm table-bordered mt-1 mb-0" style={{ fontSize: 12 }}>
                                              <thead className="table-light"><tr><th>Entity</th><th>Operation</th><th>Name</th><th>Status</th><th>Duration</th></tr></thead>
                                              <tbody>
                                                {iter.operations.map((op: any, oi: number) => (
                                                  <tr key={oi}>
                                                    <td>{op.entity_type}</td>
                                                    <td>{op.operation}</td>
                                                    <td><code>{op.entity_name?.substring(0, 30)}</code></td>
                                                    <td><span className={`badge ${op.status === 'SUCCESS' ? 'bg-success' : op.status === 'FAILED' ? 'bg-danger' : 'bg-secondary'} rounded-pill`}>{op.status}</span></td>
                                                    <td>{op.duration}s</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>format_list_numbered</i>
                      <div>No iteration data available</div>
                    </div>
                  )}
                </div>
              )}

              {/* OPERATION HEATMAP TAB */}
              {activeTab === 'heatmap' && (
                <div>
                  {enhanced.operation_heatmap?.entity_ops?.length > 0 ? (
                    <>
                      <p className="text-muted small mb-3">Operation frequency and duration across time buckets. Darker = more operations. Red border = failures detected.</p>
                      <div className="table-responsive">
                        <table className="table table-sm table-bordered mb-0" style={{ fontSize: 12 }}>
                          <thead className="table-light">
                            <tr>
                              <th style={{ minWidth: 160 }}>Operation</th>
                              <th style={{ minWidth: 50 }}>Total</th>
                              {enhanced.operation_heatmap.buckets.map((b: string, bi: number) => (
                                <th key={bi} className="text-center" style={{ minWidth: 60 }}>{b}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {enhanced.operation_heatmap.entity_ops.map((eo: string) => {
                              const rowData = enhanced.operation_heatmap.data[eo] || {};
                              const totalCount = Object.values(rowData).reduce((sum: number, cell: any) => sum + (cell?.count || 0), 0);
                              const maxCount = Math.max(...Object.values(rowData).map((cell: any) => cell?.count || 0), 1);
                              return (
                                <tr key={eo}>
                                  <td><strong>{eo}</strong></td>
                                  <td className="text-center"><span className="badge bg-primary rounded-pill">{totalCount}</span></td>
                                  {enhanced.operation_heatmap.buckets.map((_: string, bi: number) => {
                                    const cell = rowData[bi] || { count: 0, avg_duration: 0, failures: 0, failure_rate: 0 };
                                    const intensity = cell.count > 0 ? Math.max(0.1, cell.count / maxCount) : 0;
                                    const hasFails = cell.failures > 0;
                                    return (
                                      <td key={bi} className="text-center" style={{
                                        background: cell.count > 0 ? `rgba(102, 126, 234, ${intensity})` : undefined,
                                        color: intensity > 0.6 ? 'white' : undefined,
                                        border: hasFails ? '2px solid #ef4444' : undefined,
                                      }} title={`${cell.count} ops, avg ${cell.avg_duration}s${hasFails ? `, ${cell.failures} failed (${cell.failure_rate}%)` : ''}`}>
                                        {cell.count > 0 ? (
                                          <div>
                                            <div className="fw-bold">{cell.count}</div>
                                            <div style={{ fontSize: 10 }}>{cell.avg_duration}s</div>
                                          </div>
                                        ) : '-'}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="d-flex gap-3 mt-2 small text-muted">
                        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(102,126,234,0.3)', borderRadius: 2 }}></span> Low activity</span>
                        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(102,126,234,0.8)', borderRadius: 2 }}></span> High activity</span>
                        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#fff', border: '2px solid #ef4444', borderRadius: 2 }}></span> Has failures</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4 text-muted">
                      <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>grid_on</i>
                      <div>No heatmap data available</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Target Configuration Card */}
        <div className="card rounded-4 shadow-none border mb-3">
          <div className="card-header bg-transparent border-bottom p-4">
            <h5 className="mb-0 d-flex align-items-center gap-2">
              <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                width: 40,
                height: 40,
                background: 'linear-gradient(135deg, #0078d4 0%, #005a9e 100%)'
              }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>track_changes</i>
              </div>
              <span className="fw-semibold">Target Configuration</span>
            </h5>
          </div>
          <div className="card-body p-4">
            <div className="row g-4">
              <div className="col-md-4">
                <label className="form-label fw-semibold mb-3 d-flex align-items-center gap-2">
                  <i className="material-icons-outlined text-info" style={{ fontSize: 20 }}>memory</i>
                  CPU Threshold
                </label>
                <div className="progress rounded-4" style={{ height: 32 }}>
                  <div 
                    className="progress-bar bg-info progress-bar-striped progress-bar-animated" 
                    style={{ width: `${report.target_config?.cpu_threshold || 0}%` }}
                  >
                    {report.target_config?.cpu_threshold || 0}%
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold mb-3 d-flex align-items-center gap-2">
                  <i className="material-icons-outlined text-warning" style={{ fontSize: 20 }}>storage</i>
                  Memory Threshold
                </label>
                <div className="progress rounded-4" style={{ height: 32 }}>
                  <div 
                    className="progress-bar bg-warning progress-bar-striped progress-bar-animated" 
                    style={{ width: `${report.target_config?.memory_threshold || 0}%` }}
                  >
                    {report.target_config?.memory_threshold || 0}%
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold mb-3 d-flex align-items-center gap-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>settings</i>
                  Stop Condition
                </label>
                <div>
                  <span className="badge bg-secondary rounded-pill px-3 py-2" style={{ fontSize: '1em' }}>
                    {(report.target_config?.stop_condition || 'any').toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Metrics Summary Card — baseline / final; uses enhanced effective_metrics when stored finals were zero */}
        <div className="card rounded-4 shadow-none border mb-3">
          <div className="card-header bg-transparent border-bottom p-4">
            <h5 className="mb-0 d-flex align-items-center gap-2">
              <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                width: 40,
                height: 40,
                background: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)'
              }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>trending_up</i>
              </div>
              <span className="fw-semibold">Metrics Summary</span>
            </h5>
            {enhanced?.effective_metrics?.resolution_note && enhanced.effective_metrics.resolution_note !== 'stored' && (
              <p className="text-muted small mb-0 mt-2">
                Final/baseline shown using last/first <code>metrics_history</code> samples when stored values were missing ({enhanced.effective_metrics.resolution_note}).
              </p>
            )}
          </div>
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th className="ps-4">Metric</th>
                    <th className="text-center">Baseline</th>
                    <th className="text-center pe-4">Final</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="ps-4">
                      <div className="d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-info" style={{ fontSize: 20 }}>memory</i>
                        <strong>CPU Usage</strong>
                      </div>
                    </td>
                    <td className="text-center">
                      <span className="badge bg-secondary rounded-pill px-3 py-2">
                        {(enhanced?.effective_metrics?.baseline?.cpu_percent ?? report.baseline_metrics?.cpu_percent ?? 0).toFixed(1)}%
                      </span>
                    </td>
                    <td className="text-center pe-4">
                      <span className="badge bg-info rounded-pill px-3 py-2">
                        {(enhanced?.effective_metrics?.final?.cpu_percent ?? report.current_metrics?.cpu_percent ?? 0).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="ps-4">
                      <div className="d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-warning" style={{ fontSize: 20 }}>storage</i>
                        <strong>Memory Usage</strong>
                      </div>
                    </td>
                    <td className="text-center">
                      <span className="badge bg-secondary rounded-pill px-3 py-2">
                        {(enhanced?.effective_metrics?.baseline?.memory_percent ?? report.baseline_metrics?.memory_percent ?? 0).toFixed(1)}%
                      </span>
                    </td>
                    <td className="text-center pe-4">
                      <span className="badge bg-warning rounded-pill px-3 py-2">
                        {(enhanced?.effective_metrics?.final?.memory_percent ?? report.current_metrics?.memory_percent ?? 0).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* AI Insights Section */}
        {(report.ai_insights || report.ai_enabled || report.pid_stats || report.ml_stats) && (
          <div className="card rounded-4 shadow-none border mb-3" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)' }}>
            <div className="card-header border-bottom p-4" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)' }}>
              <h5 className="mb-0 d-flex align-items-center gap-2 text-white">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                  width: 40,
                  height: 40,
                  background: 'rgba(255, 255, 255, 0.2)',
                  backdropFilter: 'blur(10px)'
                }}>
                  <i className="material-icons-outlined" style={{ fontSize: 24 }}>psychology</i>
                </div>
                <span className="fw-semibold">🤖 AI Insights</span>
              </h5>
              {report.ai_enabled && (
                <p className="text-white-50 mb-0 mt-2" style={{ fontSize: '0.9rem' }}>
                  This execution used AI-powered control with PID controllers and Machine Learning
                </p>
              )}
            </div>
            <div className="card-body p-4">
              
              {/* PID Controller Performance */}
              {(report.pid_stats || report.ai_insights?.pid_performance) && (
                <div className="mb-4">
                  <h6 className="fw-bold text-primary mb-3">
                    <i className="material-icons-outlined align-middle me-2" style={{ fontSize: 20 }}>tune</i>
                    PID Controller Performance
                  </h6>
                  <div className="row g-3">
                    {report.pid_stats?.current_ops_per_min && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">Final Operations/Minute</div>
                          <div className="h4 mb-0 text-primary">{report.pid_stats.current_ops_per_min.toFixed(1)}</div>
                        </div>
                      </div>
                    )}
                    {report.pid_stats?.phase && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">Final Phase</div>
                          <div className="h5 mb-0">
                            <span className="badge bg-success">{report.pid_stats.phase.replace(/_/g, ' ').toUpperCase()}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {report.pid_stats?.iteration && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">Total Iterations</div>
                          <div className="h4 mb-0 text-info">{report.pid_stats.iteration}</div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {(report.pid_stats?.cpu_pid || report.pid_stats?.memory_pid) && (
                    <div className="mt-3 p-3 bg-white rounded-3 border">
                      <div className="row">
                        {report.pid_stats?.cpu_pid && (
                          <div className="col-md-6">
                            <h6 className="text-muted small mb-2">CPU PID Parameters</h6>
                            <div className="d-flex gap-3 flex-wrap">
                              <div>
                                <span className="text-muted small">Kp:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.cpu_pid.Kp}</span>
                              </div>
                              <div>
                                <span className="text-muted small">Ki:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.cpu_pid.Ki}</span>
                              </div>
                              <div>
                                <span className="text-muted small">Kd:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.cpu_pid.Kd}</span>
                              </div>
                            </div>
                          </div>
                        )}
                        {report.pid_stats?.memory_pid && (
                          <div className="col-md-6">
                            <h6 className="text-muted small mb-2">Memory PID Parameters</h6>
                            <div className="d-flex gap-3 flex-wrap">
                              <div>
                                <span className="text-muted small">Kp:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.memory_pid.Kp}</span>
                              </div>
                              <div>
                                <span className="text-muted small">Ki:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.memory_pid.Ki}</span>
                              </div>
                              <div>
                                <span className="text-muted small">Kd:</span>
                                <span className="fw-semibold ms-1">{report.pid_stats.memory_pid.Kd}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ML Model Performance */}
              {(report.ml_stats || report.ai_insights?.ml_performance) && (
                <div className="mb-4">
                  <h6 className="fw-bold text-success mb-3">
                    <i className="material-icons-outlined align-middle me-2" style={{ fontSize: 20 }}>model_training</i>
                    Machine Learning Performance
                  </h6>
                  <div className="row g-3">
                    {report.ml_stats?.model_trained !== undefined && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">Model Status</div>
                          <div className="h5 mb-0">
                            {report.ml_stats.model_trained ? (
                              <span className="badge bg-success">✓ Trained</span>
                            ) : (
                              <span className="badge bg-warning">⏳ Training</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {report.ml_stats?.training_samples && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">Training Samples</div>
                          <div className="h4 mb-0 text-success">{report.ml_stats.training_samples}</div>
                        </div>
                      </div>
                    )}
                    {report.ml_stats?.cpu_model_r2 !== undefined && (
                      <div className="col-md-4">
                        <div className="p-3 bg-white rounded-3 border">
                          <div className="text-muted small mb-1">CPU Model Accuracy (R²)</div>
                          <div className="h4 mb-0 text-info">{(report.ml_stats.cpu_model_r2 * 100).toFixed(1)}%</div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {report.ml_stats?.feature_importance && (
                    <div className="mt-3 p-3 bg-white rounded-3 border">
                      <h6 className="text-muted small mb-2">Feature Importance (CPU Model)</h6>
                      <div className="row">
                        {Object.entries(report.ml_stats.feature_importance.cpu_model || {}).map(([feature, importance]: [string, any]) => (
                          <div key={feature} className="col-md-6 mb-2">
                            <div className="d-flex justify-content-between align-items-center">
                              <span className="small text-muted">{feature.replace(/_/g, ' ')}</span>
                              <span className="badge bg-light text-dark">{(importance * 100).toFixed(1)}%</span>
                            </div>
                            <div className="progress" style={{ height: 4 }}>
                              <div 
                                className="progress-bar bg-success" 
                                style={{ width: `${importance * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* AI Decisions Timeline */}
              {report.ai_insights?.ai_decisions && report.ai_insights.ai_decisions.length > 0 && (
                <div className="mb-4">
                  <h6 className="fw-bold text-warning mb-3">
                    <i className="material-icons-outlined align-middle me-2" style={{ fontSize: 20 }}>timeline</i>
                    AI Decision Timeline
                  </h6>
                  <div className="bg-white rounded-3 border p-3">
                    <div className="timeline">
                      {report.ai_insights.ai_decisions.slice(-5).map((decision, idx) => (
                        <div key={idx} className="mb-3 pb-3 border-bottom">
                          <div className="d-flex align-items-start gap-3">
                            <div className="badge bg-primary rounded-circle" style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {decision.iteration}
                            </div>
                            <div className="flex-grow-1">
                              <div className="d-flex justify-content-between align-items-center mb-1">
                                <span className="badge bg-secondary">{decision.phase.replace(/_/g, ' ').toUpperCase()}</span>
                              </div>
                              <p className="text-muted small mb-0">{decision.reasoning}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {report.ai_insights?.recommendations && report.ai_insights.recommendations.length > 0 && (
                <div>
                  <h6 className="fw-bold text-info mb-3">
                    <i className="material-icons-outlined align-middle me-2" style={{ fontSize: 20 }}>lightbulb</i>
                    Recommendations for Next Execution
                  </h6>
                  <div className="bg-white rounded-3 border p-3">
                    <ul className="mb-0">
                      {report.ai_insights.recommendations.map((rec, idx) => (
                        <li key={idx} className="mb-2 text-muted">{rec}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* Entity Breakdown */}
        {report.entity_breakdown && typeof report.entity_breakdown === 'object' && Object.keys(report.entity_breakdown).length > 0 && (
          <div className="card rounded-4 shadow-none border mb-3">
            <div className="card-header bg-transparent border-bottom p-4">
              <h5 className="mb-0 d-flex align-items-center gap-2">
                <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                  width: 40,
                  height: 40,
                  background: 'linear-gradient(135deg, #17a2b8 0%, #138496 100%)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>category</i>
                </div>
                <span className="fw-semibold">Entity Breakdown</span>
              </h5>
            </div>
            <div className="card-body p-4">
              <div className="row g-3">
                {Object.entries(report.entity_breakdown).map(([entity, stats]: [string, any]) => (
                  <div key={entity} className="col-md-4">
                    <div className="card rounded-4 shadow-none border h-100">
                      <div className="card-body p-4">
                        <h6 className="fw-semibold mb-3 d-flex align-items-center gap-2">
                          <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>label</i>
                          {entity}
                        </h6>
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <span className="text-muted">Total:</span>
                          <span className="badge bg-primary rounded-pill px-3 py-2">{stats.total || 0}</span>
                        </div>
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <span className="text-success">Success:</span>
                          <span className="badge bg-success rounded-pill px-3 py-2">{stats.success || 0}</span>
                        </div>
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <span className="text-danger">Failed:</span>
                          <span className="badge bg-danger rounded-pill px-3 py-2">{stats.failed || 0}</span>
                        </div>
                        {stats.total > 0 && (
                          <div>
                            <div className="d-flex justify-content-between small mb-1">
                              <span className="text-muted">Success Rate</span>
                              <strong>{((stats.success || 0) / stats.total * 100).toFixed(0)}%</strong>
                            </div>
                            <div className="progress" style={{ height: 6 }}>
                              <div className={`progress-bar ${(stats.success / stats.total * 100) >= 80 ? 'bg-success' : (stats.success / stats.total * 100) >= 50 ? 'bg-warning' : 'bg-danger'}`} style={{ width: `${(stats.success / stats.total * 100)}%` }}></div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Operation Details Card */}
        <div className="card rounded-4 shadow-none border">
          <div className="card-header bg-transparent border-bottom p-4">
            <h5 className="mb-0 d-flex align-items-center gap-2">
              <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                width: 40,
                height: 40,
                background: 'linear-gradient(135deg, #6c757d 0%, #495057 100%)'
              }}>
                <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>list</i>
              </div>
              <span className="fw-semibold">Operation Details</span>
              <span className="badge bg-secondary rounded-pill ms-2">
                Last {(report.operations_history && Array.isArray(report.operations_history) ? report.operations_history.slice(-20).length : 0)}
              </span>
            </h5>
          </div>
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th className="ps-4">#</th>
                    <th>Entity</th>
                    <th>Operation</th>
                    <th>Name</th>
                    <th className="text-center">Duration</th>
                    <th className="text-center pe-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.operations_history && Array.isArray(report.operations_history) ? report.operations_history.slice(-20) : []).map((op, idx) => (
                    <tr key={idx}>
                      <td className="ps-4">
                        <span className="badge bg-light text-dark rounded-pill">{idx + 1}</span>
                      </td>
                      <td>
                        <span className="badge bg-secondary rounded-pill px-3 py-2">
                          {op.entity_type || 'Unknown'}
                        </span>
                      </td>
                      <td>
                        <code className="small">{op.operation || 'N/A'}</code>
                      </td>
                      <td>
                        <code className="font-monospace small text-muted">{op.entity_name || 'N/A'}</code>
                      </td>
                      <td className="text-center">
                        <span className="badge bg-light text-dark rounded-pill px-3 py-2">
                          {op.duration_seconds ? op.duration_seconds.toFixed(2) : '0.00'}s
                        </span>
                      </td>
                      <td className="text-center pe-4">
                        <span className={`badge rounded-pill px-3 py-2 ${
                          op.status === 'SUCCESS' ? 'bg-success' : 'bg-danger'
                        }`}>
                          {op.status || 'UNKNOWN'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(!report.operations_history || !Array.isArray(report.operations_history) || report.operations_history.length === 0) && (
                    <tr>
                      <td colSpan={6} className="text-center text-muted py-5">
                        <i className="material-icons-outlined mb-2" style={{ fontSize: 48, opacity: 0.3 }}>inbox</i>
                        <div>No operation details available</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      {/* Longevity Health Check Results */}
      {report.longevity?.enabled && (
        <div className="card shadow-sm border-0 mb-4 overflow-hidden">
          <div className="card-header bg-white border-bottom d-flex align-items-center py-3 px-4">
            <i className="material-icons-outlined text-info me-2">health_and_safety</i>
            <h5 className="mb-0">
              <span className="fw-semibold">Longevity Health Checks</span>
              <span className="badge bg-info rounded-pill ms-2">
                {report.longevity.total_health_checks || 0} checks
              </span>
            </h5>
          </div>
          <div className="card-body">
            {/* Latest verdict */}
            <div className="d-flex align-items-center mb-3">
              <span className="me-2">Latest Verdict:</span>
              <span className={`badge rounded-pill px-3 py-2 ${
                report.longevity.latest_health_verdict === 'PASS' ? 'bg-success' :
                report.longevity.latest_health_verdict === 'WARN' ? 'bg-warning text-dark' :
                report.longevity.latest_health_verdict === 'FAIL' ? 'bg-danger' : 'bg-secondary'
              }`}>
                {report.longevity.latest_health_verdict || 'N/A'}
              </span>
            </div>

            {/* Health check results table */}
            {report.longevity.health_check_results && report.longevity.health_check_results.length > 0 && (
              <div className="table-responsive mb-3">
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Timestamp</th>
                      <th>FATAL Scan</th>
                      <th>Process Restarts</th>
                      <th>Cgroup OOM</th>
                      <th>Thread Count</th>
                      <th>Disk Usage</th>
                      <th>Core Dumps</th>
                      <th>Memory Leaks</th>
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.longevity.health_check_results.slice(-10).map((hc: any, idx: number) => {
                      const statusBadge = (s: string) => {
                        const cls = s === 'PASS' ? 'bg-success' : s === 'WARN' ? 'bg-warning text-dark' : s === 'FAIL' ? 'bg-danger' : 'bg-secondary';
                        return <span className={`badge rounded-pill ${cls}`}>{s}</span>;
                      };
                      return (
                        <tr key={idx}>
                          <td className="text-muted small">{hc.timestamp ? new Date(hc.timestamp).toLocaleString() : '-'}</td>
                          <td>{statusBadge(hc.fatal_scan?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.process_restarts?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.cgroup_oom?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.thread_count?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.disk_usage?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.core_dumps?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.memory_leaks?.status || 'SKIP')}</td>
                          <td>{statusBadge(hc.verdict?.verdict || 'N/A')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Checkpoint reports */}
            {report.longevity.checkpoint_reports && report.longevity.checkpoint_reports.length > 0 && (
              <>
                <h6 className="mt-3 mb-2">
                  <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>flag</i>
                  Checkpoint Reports
                </h6>
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>#</th>
                        <th>Time</th>
                        <th>Elapsed</th>
                        <th>CPU</th>
                        <th>Memory</th>
                        <th>Total Ops</th>
                        <th>Success Rate</th>
                        <th>Health</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.longevity.checkpoint_reports.map((cp: any, idx: number) => (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td className="text-muted small">{cp.timestamp ? new Date(cp.timestamp).toLocaleString() : '-'}</td>
                          <td>{cp.elapsed_minutes ? `${cp.elapsed_minutes.toFixed(0)}m` : '-'}</td>
                          <td>{cp.cpu?.toFixed(1)}%</td>
                          <td>{cp.memory?.toFixed(1)}%</td>
                          <td>{cp.total_operations}</td>
                          <td>
                            <span className={`badge rounded-pill ${cp.success_rate >= 90 ? 'bg-success' : cp.success_rate >= 70 ? 'bg-warning text-dark' : 'bg-danger'}`}>
                              {cp.success_rate?.toFixed(1)}%
                            </span>
                          </td>
                          <td>
                            <span className={`badge rounded-pill ${
                              cp.latest_health_verdict === 'PASS' ? 'bg-success' :
                              cp.latest_health_verdict === 'WARN' ? 'bg-warning text-dark' : 'bg-secondary'
                            }`}>
                              {cp.latest_health_verdict || 'N/A'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      </div>
  );
};

export default SmartExecutionReport;
