import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBase } from '../utils/backendUrl';

interface ChildExecution {
  execution_id: string;
  status: string;
  total_operations: number;
  successful_operations: number;
  failed_operations: number;
  success_rate: number;
  duration_minutes: number;
  threshold_reached: boolean;
  target_config: any;
  entity_types_count: number;
}

interface SmartExecution {
  execution_id: string;
  testbed_id: string;
  testbed_label: string;
  status: string;
  start_time: string;
  end_time?: string;
  total_operations: number;
  duration_minutes?: number | null;
  target_cpu?: number;
  target_memory?: number;
  final_cpu?: number;
  final_memory?: number;
  threshold_reached?: boolean;
  anomaly_count?: number;
  anomaly_high_count?: number;
  tags?: string[];
  learning_summary?: string;
  latency_avg?: number;
  entities_config?: {
    child_executions?: ChildExecution[];
  };
}

const SmartExecutionHistory: React.FC = () => {
  const navigate = useNavigate();
  const [executions, setExecutions] = useState<SmartExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTestbed, setFilterTestbed] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedForCompare, setSelectedForCompare] = useState<Set<string>>(new Set());
  const [compareData, setCompareData] = useState<any>(null);
  const [comparingFlag, setComparingFlag] = useState(false);

  useEffect(() => {
    fetchExecutions();
  }, []);

  const fetchExecutions = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${getApiBase()}/api/smart-execution/history`);
      const data = await response.json();
      
      if (data.success) {
        setExecutions(data.executions || []);
      } else {
        setError(data.error || 'Failed to fetch execution history');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = async (executionId: string) => {
    try {
      const response = await fetch(`${getApiBase()}/api/smart-execution/report/${executionId}/enhanced`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smart-execution-enhanced-${executionId}.html`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(`Failed to download report: ${err.message}`);
    }
  };

  const viewReport = (executionId: string) => {
    navigate(`/smart-execution/report/${executionId}`);
  };

  const rerunExecution = async (executionId: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/smart-execution/rerun-config/${executionId}`);
      const data = await res.json();
      if (data.success && data.config) {
        sessionStorage.setItem('rerun_config', JSON.stringify(data.config));
        navigate('/smart-execution?rerun=true');
      } else {
        alert(data.error || 'Could not load config for re-run');
      }
    } catch (err: any) {
      alert(`Re-run error: ${err.message}`);
    }
  };

  const downloadCSV = async (executionId: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/smart-execution/csv/${executionId}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `operations-${executionId.substring(0, 20)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(`CSV download failed: ${err.message}`);
    }
  };

  const toggleCompare = (executionId: string) => {
    setSelectedForCompare(prev => {
      const next = new Set(prev);
      if (next.has(executionId)) next.delete(executionId);
      else if (next.size < 5) next.add(executionId);
      return next;
    });
  };

  const runComparison = async () => {
    if (selectedForCompare.size < 2) { alert('Select at least 2 executions to compare'); return; }
    setComparingFlag(true);
    try {
      const res = await fetch(`${getApiBase()}/api/smart-execution/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execution_ids: Array.from(selectedForCompare) })
      });
      const data = await res.json();
      if (data.success) setCompareData(data);
      else alert(data.error || 'Comparison failed');
    } catch (err: any) {
      alert(`Compare error: ${err.message}`);
    } finally {
      setComparingFlag(false);
    }
  };

  const cleanupEntities = async (executionId: string) => {
    if (!confirm('🧹 Delete all entities created by this execution?\n(VMs, projects, blueprints, etc.)')) return;
    try {
      const response = await fetch(`${getApiBase()}/api/smart-execution/cleanup/${executionId}`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        alert(`Cleanup done: ${data.cleanup_summary?.success || 0}/${data.cleanup_summary?.total || 0} entities deleted`);
      } else {
        alert(data.error || 'Cleanup failed');
      }
    } catch (err: any) {
      alert(`Cleanup error: ${err.message}`);
    }
  };

  const deleteExecution = async (executionId: string) => {
    if (!confirm('⚠️ Are you sure you want to delete this execution record?\n\nThis action cannot be undone.')) {
      return;
    }

    try {
      setDeletingId(executionId);
      const response = await fetch(`${getApiBase()}/api/smart-execution/${executionId}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      
      if (data.success) {
        fetchExecutions();
      } else {
        alert(data.error || 'Failed to delete execution');
      }
    } catch (err: any) {
      alert(`Failed to delete execution: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const stopExecution = async (executionId: string) => {
    if (!confirm('Stop this running execution?')) return;
    try {
      setStoppingId(executionId);
      const response = await fetch(`${getApiBase()}/api/smart-execution/stop/${executionId}`, {
        method: 'POST'
      });
      const data = await response.json();
      if (data.success) {
        fetchExecutions();
      } else {
        alert(data.error || 'Failed to stop execution');
      }
    } catch (err: any) {
      alert(`Failed to stop execution: ${err.message}`);
    } finally {
      setStoppingId(null);
    }
  };

  const stopAllRunning = async () => {
    const runningCount = executions.filter(e => e.status === 'RUNNING').length;
    if (runningCount === 0) { alert('No running executions found.'); return; }
    if (!confirm(`Stop all ${runningCount} running execution(s)?`)) return;
    try {
      const response = await fetch(`${getApiBase()}/api/smart-execution/stop-all`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        alert(data.message || 'All executions stopped');
        fetchExecutions();
      } else {
        alert(data.error || 'Failed to stop executions');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const formatDuration = (minutes: number) => {
    if (!minutes || isNaN(minutes) || minutes < 0) return '0m';
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
      'THRESHOLD_REACHED': { bg: 'bg-primary', icon: 'flag' },
      'LONGEVITY_SUSTAINING': { bg: 'bg-purple', icon: 'repeat' },
      'TIMEOUT': { bg: 'bg-secondary', icon: 'timer_off' },
    };
    return badges[status] || { bg: 'bg-secondary', icon: 'help_outline' };
  };

  const filteredExecutions = executions.filter(exec => {
    const matchesStatus = filterStatus === 'all' || exec.status === filterStatus;
    const matchesTestbed = filterTestbed === 'all' || exec.testbed_label === filterTestbed;
    const matchesSearch = searchQuery === '' || 
      exec.execution_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exec.testbed_label.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesStatus && matchesTestbed && matchesSearch;
  });

  const uniqueTestbeds = Array.from(new Set(executions.map(e => e.testbed_label)));
  const statuses = ['RUNNING', 'LONGEVITY_SUSTAINING', 'COMPLETED', 'STOPPED', 'FAILED', 'THRESHOLD_REACHED', 'TIMEOUT'];

  const toggleExpand = (executionId: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(executionId)) {
        newSet.delete(executionId);
      } else {
        newSet.add(executionId);
      }
      return newSet;
    });
  };

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
                <a href="#" onClick={(e) => { e.preventDefault(); navigate('/smart-execution'); }}>
                  Smart Execution
                </a>
              </li>
              <li className="breadcrumb-item active">Execution History</li>
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
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>history</i>
                </div>
                Smart Execution History
              </h2>
              <p className="text-muted mb-0">View, analyze, and download reports from past executions</p>
            </div>
            <div className="d-flex gap-2">
              {executions.some(e => e.status === 'RUNNING' || e.status === 'LONGEVITY_SUSTAINING') && (
                <button 
                  className="btn btn-danger btn-lg rounded-4 d-flex align-items-center gap-2"
                  onClick={stopAllRunning}
                  title="Stop all currently running executions"
                >
                  <i className="material-icons-outlined" style={{ fontSize: 20 }}>stop_circle</i>
                  Stop All Running
                </button>
              )}
              <button 
                className="btn btn-primary btn-lg rounded-4 d-flex align-items-center gap-2"
                onClick={() => navigate('/smart-execution')}
                title="Start a new smart execution"
              >
                <i className="material-icons-outlined" style={{ fontSize: 20 }}>add</i>
                New Execution
              </button>
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="alert alert-danger alert-dismissible fade show rounded-4 d-flex align-items-center mb-3" role="alert">
            <i className="material-icons-outlined me-2">error_outline</i>
            <div className="flex-grow-1"><strong>Error:</strong> {error}</div>
            <button type="button" className="btn-close" onClick={() => setError(null)} aria-label="Close"></button>
          </div>
        )}

        {/* Filters Card */}
        <div className="card rounded-4 shadow-none border mb-3">
          <div className="card-body p-4">
            <h5 className="card-title d-flex align-items-center gap-2 mb-4">
              <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                width: 40,
                height: 40,
                background: 'linear-gradient(135deg, #0078d4 0%, #005a9e 100%)'
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
                    placeholder="Search by execution ID or testbed..."
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
                  {statuses.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
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
                  {uniqueTestbeds.map(testbed => (
                    <option key={testbed} value={testbed}>{testbed}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Executions Table Card */}
        <div className="card rounded-4 shadow-none border">
          <div className="card-header bg-transparent border-bottom p-4">
            <div className="d-flex justify-content-between align-items-center">
              <h5 className="mb-0 d-flex align-items-center gap-2">
                <i className="material-icons-outlined text-primary" style={{ fontSize: 24 }}>list</i>
                <span className="fw-semibold">Executions</span>
                <span className="badge bg-primary rounded-pill">{filteredExecutions.length}</span>
              </h5>
              <button 
                className="btn btn-outline-secondary btn-sm rounded-3"
                onClick={fetchExecutions}
                disabled={loading}
              >
                <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>refresh</i>
                Refresh
              </button>
            </div>
          </div>
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-5">
                <div className="spinner-border text-primary" role="status" style={{ width: '3rem', height: '3rem' }}>
                  <span className="visually-hidden">Loading...</span>
                </div>
                <p className="mt-3 text-muted">Loading execution history...</p>
              </div>
            ) : filteredExecutions.length === 0 ? (
              <div className="text-center py-5">
                <i className="material-icons-outlined text-muted" style={{ fontSize: 64, opacity: 0.3 }}>inbox</i>
                <p className="mt-3 text-muted">
                  {executions.length === 0 ? 'No executions yet' : 'No executions match the current filters'}
                </p>
                {executions.length === 0 && (
                  <button 
                    className="btn btn-primary rounded-4 mt-2"
                    onClick={() => navigate('/smart-execution')}
                  >
                    <i className="material-icons-outlined me-2" style={{ fontSize: 18, verticalAlign: 'middle' }}>rocket_launch</i>
                    Start Your First Execution
                  </button>
                )}
              </div>
            ) : (
              <>
              {/* Compare toolbar */}
              {selectedForCompare.size > 0 && (
                <div className="alert alert-info d-flex align-items-center justify-content-between mb-3">
                  <span>{selectedForCompare.size} execution(s) selected for comparison</span>
                  <div className="d-flex gap-2">
                    <button className="btn btn-primary btn-sm" onClick={runComparison} disabled={selectedForCompare.size < 2 || comparingFlag}>
                      {comparingFlag ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="material-icons-outlined me-1" style={{ fontSize: 16, verticalAlign: 'middle' }}>compare_arrows</i>}
                      Compare
                    </button>
                    <button className="btn btn-outline-secondary btn-sm" onClick={() => { setSelectedForCompare(new Set()); setCompareData(null); }}>Clear</button>
                  </div>
                </div>
              )}

              {/* Comparison Results */}
              {compareData && compareData.comparisons && (
                <div className="card border-0 shadow-sm mb-4">
                  <div className="card-header bg-white d-flex justify-content-between align-items-center">
                    <h6 className="mb-0"><i className="material-icons-outlined me-2" style={{ verticalAlign: 'middle' }}>compare_arrows</i>Comparison Results</h6>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setCompareData(null)}>Close</button>
                  </div>
                  <div className="card-body p-0">
                    <div className="table-responsive">
                      <table className="table table-sm table-bordered mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>Metric</th>
                            {compareData.comparisons.map((c: any) => <th key={c.execution_id} className="text-center">{c.execution_id.substring(0, 15)}...</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {['status', 'duration_minutes', 'total_operations', 'success_rate', 'cpu_change', 'memory_change', 'anomaly_count', 'latency_avg'].map(metric => (
                            <tr key={metric}>
                              <td className="fw-bold">{metric.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())}</td>
                              {compareData.comparisons.map((c: any) => {
                                let val = c[metric];
                                if (typeof val === 'number') val = val.toFixed(1);
                                if (val === null || val === undefined) val = 'N/A';
                                const isBest = metric === 'success_rate' ? c.execution_id === compareData.summary?.highest_success
                                  : metric === 'duration_minutes' ? c.execution_id === compareData.summary?.fastest
                                  : false;
                                return <td key={c.execution_id} className={`text-center ${isBest ? 'bg-success bg-opacity-10 fw-bold' : ''}`}>{String(val)}</td>;
                              })}
                            </tr>
                          ))}
                          <tr>
                            <td className="fw-bold">Learning Summary</td>
                            {compareData.comparisons.map((c: any) => <td key={c.execution_id} className="small">{c.learning_summary || 'N/A'}</td>)}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    {compareData.summary && (
                      <div className="p-3 small text-muted">
                        Fastest: <strong>{compareData.summary.fastest?.substring(0, 15)}...</strong> | 
                        Most Efficient: <strong>{compareData.summary.most_efficient?.substring(0, 15)}...</strong> | 
                        Highest Success: <strong>{compareData.summary.highest_success?.substring(0, 15)}...</strong>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: 30 }}></th>
                      <th className="ps-2">Execution ID</th>
                      <th>Testbed</th>
                      <th className="text-center">Status</th>
                      <th>Started</th>
                      <th className="text-center">Duration</th>
                      <th className="text-center">Operations</th>
                      <th className="text-center">Alerts</th>
                      <th className="text-center pe-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExecutions.map(exec => {
                      const statusInfo = getStatusBadge(exec.status);
                      const hasChildren = exec.entities_config?.child_executions && exec.entities_config.child_executions.length > 0;
                      const isExpanded = expandedRows.has(exec.execution_id);
                      
                      return (
                        <React.Fragment key={exec.execution_id}>
                          <tr>
                            {/* Compare checkbox */}
                            <td className="text-center">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={selectedForCompare.has(exec.execution_id)}
                                onChange={() => toggleCompare(exec.execution_id)}
                                title="Select for comparison"
                              />
                            </td>
                            <td className="ps-2">
                              <div className="d-flex align-items-center gap-2">
                                {hasChildren && (
                                  <button
                                    className="btn btn-sm btn-link p-0 text-decoration-none"
                                    onClick={() => toggleExpand(exec.execution_id)}
                                    title={isExpanded ? "Collapse" : "Expand"}
                                  >
                                    <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>
                                      {isExpanded ? 'expand_more' : 'chevron_right'}
                                    </i>
                                  </button>
                                )}
                                <div>
                                  <code className="font-monospace small text-muted">
                                    {exec.execution_id.substring(0, 20)}...
                                  </code>
                                  {exec.tags && exec.tags.length > 0 && (
                                    <div className="d-flex gap-1 flex-wrap mt-1">
                                      {exec.tags.map((tag, i) => (
                                        <span key={i} className="badge bg-info bg-opacity-25 text-info small">{tag}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="badge bg-secondary rounded-pill px-3 py-2">
                                {exec.testbed_label}
                              </span>
                            </td>
                            <td className="text-center">
                              <span className={`badge ${statusInfo.bg} rounded-pill px-3 py-2 d-inline-flex align-items-center gap-1`}>
                                <i className="material-icons-outlined" style={{ fontSize: 16 }}>{statusInfo.icon}</i>
                                {exec.status}
                              </span>
                              {exec.learning_summary && (
                                <div className="mt-1">
                                  <span className="badge bg-light text-dark small" title={exec.learning_summary} style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', cursor: 'pointer' }}>
                                    <i className="material-icons-outlined" style={{ fontSize: 12, verticalAlign: 'middle' }}>lightbulb</i> Summary
                                  </span>
                                </div>
                              )}
                            </td>
                            <td>
                              <div className="small">
                                <i className="material-icons-outlined me-1" style={{ fontSize: 16, verticalAlign: 'middle' }}>schedule</i>
                                {formatDate(exec.start_time)}
                              </div>
                            </td>
                            <td className="text-center">
                              <span className="badge bg-light text-dark rounded-pill px-3 py-2">
                                {formatDuration(exec.duration_minutes || 0)}
                              </span>
                            </td>
                            <td className="text-center">
                              <span className="fw-bold text-primary">{exec.total_operations}</span>
                              {exec.latency_avg != null && (
                                <div className="text-muted small">{exec.latency_avg.toFixed(1)}s avg</div>
                              )}
                            </td>
                            <td className="text-center">
                              {(exec.anomaly_count || 0) > 0 ? (
                                <span className={`badge ${(exec.anomaly_high_count || 0) > 0 ? 'bg-danger' : 'bg-warning text-dark'} rounded-pill px-2 py-1`} title={`${exec.anomaly_count} anomalies (${exec.anomaly_high_count || 0} high)`}>
                                  <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>warning</i>
                                  {' '}{exec.anomaly_count}
                                </span>
                              ) : (
                                <span className="badge bg-success bg-opacity-25 text-success rounded-pill px-2 py-1">
                                  <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>check_circle</i>
                                </span>
                              )}
                            </td>
                            <td className="text-center pe-4">
                              <div className="d-flex align-items-center justify-content-center gap-1 flex-wrap">
                                {(exec.status === 'RUNNING' || exec.status === 'LONGEVITY_SUSTAINING') && (
                                  <button
                                    className="btn btn-danger btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                                    onClick={() => stopExecution(exec.execution_id)}
                                    disabled={stoppingId === exec.execution_id}
                                    data-bs-toggle="tooltip"
                                    data-bs-placement="top"
                                    title="Stop this running execution"
                                  >
                                    {stoppingId === exec.execution_id ? (
                                      <span className="spinner-border spinner-border-sm" role="status"></span>
                                    ) : (
                                      <i className="material-icons-outlined" style={{ fontSize: 16 }}>stop_circle</i>
                                    )}
                                    <span className="d-none d-xl-inline small">Stop</span>
                                  </button>
                                )}
                                <button
                                  className="btn btn-outline-primary btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                                  onClick={() => viewReport(exec.execution_id)}
                                  data-bs-toggle="tooltip"
                                  data-bs-placement="top"
                                  title="View detailed execution report"
                                >
                                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>visibility</i>
                                  <span className="d-none d-xl-inline small">Report</span>
                                </button>
                                <button
                                  className="btn btn-outline-success btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                                  onClick={() => downloadReport(exec.execution_id)}
                                  data-bs-toggle="tooltip"
                                  data-bs-placement="top"
                                  title="Download HTML report file"
                                >
                                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>download</i>
                                  <span className="d-none d-xl-inline small">HTML</span>
                                </button>
                                <button
                                  className="btn btn-outline-info btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                                  onClick={() => downloadCSV(exec.execution_id)}
                                  data-bs-toggle="tooltip"
                                  data-bs-placement="top"
                                  title="Download operations data as CSV"
                                >
                                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>table_view</i>
                                  <span className="d-none d-xl-inline small">CSV</span>
                                </button>
                                <button
                                  className="btn btn-outline-secondary btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                                  onClick={() => rerunExecution(exec.execution_id)}
                                  data-bs-toggle="tooltip"
                                  data-bs-placement="top"
                                  title="Re-run execution with the same configuration"
                                >
                                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>replay</i>
                                  <span className="d-none d-xl-inline small">Re-run</span>
                                </button>
                                <button
                                  className="btn btn-outline-warning btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                                  onClick={() => cleanupEntities(exec.execution_id)}
                                  disabled={exec.status === 'RUNNING' || exec.status === 'LONGEVITY_SUSTAINING'}
                                  data-bs-toggle="tooltip"
                                  data-bs-placement="top"
                                  title="Delete all entities (VMs, blueprints, etc.) created by this execution"
                                >
                                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>cleaning_services</i>
                                  <span className="d-none d-xl-inline small">Cleanup</span>
                                </button>
                                <button
                                  className="btn btn-outline-danger btn-sm rounded-3 d-inline-flex align-items-center gap-1"
                                  onClick={() => deleteExecution(exec.execution_id)}
                                  disabled={deletingId === exec.execution_id}
                                  data-bs-toggle="tooltip"
                                  data-bs-placement="top"
                                  title="Permanently delete this execution record"
                                >
                                  {deletingId === exec.execution_id ? (
                                    <span className="spinner-border spinner-border-sm" role="status"></span>
                                  ) : (
                                    <i className="material-icons-outlined" style={{ fontSize: 16 }}>delete</i>
                                  )}
                                  <span className="d-none d-xl-inline small">Delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Child Execution Row */}
                          {isExpanded && hasChildren && exec.entities_config!.child_executions!.map(child => (
                            <tr key={child.execution_id} className="table-info">
                              <td colSpan={9} className="ps-5 pe-4">
                                <div className="card border-0 shadow-sm my-2" style={{ background: 'linear-gradient(135deg, #f8f9fa 0%, #e3f2fd 100%)' }}>
                                  <div className="card-body p-3">
                                    <div className="row align-items-center">
                                      <div className="col-md-8">
                                        <div className="d-flex align-items-center gap-3 mb-2">
                                          <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                                            width: 36,
                                            height: 36,
                                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                                          }}>
                                            <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>smart_toy</i>
                                          </div>
                                          <div>
                                            <h6 className="mb-0 fw-bold d-flex align-items-center gap-2">
                                              🤖 AI Model-Adjusted Execution
                                              {child.threshold_reached && (
                                                <span className="badge bg-success rounded-pill">Threshold Reached!</span>
                                              )}
                                            </h6>
                                            <code className="small text-muted">{child.execution_id}</code>
                                          </div>
                                        </div>
                                        <div className="row g-2 small">
                                          <div className="col-6 col-md-3">
                                            <div className="text-muted mb-1">Operations</div>
                                            <div className="fw-bold text-primary">{child.total_operations.toLocaleString()}</div>
                                          </div>
                                          <div className="col-6 col-md-3">
                                            <div className="text-muted mb-1">Success Rate</div>
                                            <div className="fw-bold text-success">{child.success_rate.toFixed(1)}%</div>
                                          </div>
                                          <div className="col-6 col-md-3">
                                            <div className="text-muted mb-1">Duration</div>
                                            <div className="fw-bold">{formatDuration(child.duration_minutes)}</div>
                                          </div>
                                          <div className="col-6 col-md-3">
                                            <div className="text-muted mb-1">Entity Types</div>
                                            <div className="fw-bold">{child.entity_types_count}</div>
                                          </div>
                                        </div>
                                        {child.target_config && (
                                          <div className="mt-2 p-2 rounded-3" style={{ background: 'rgba(255,255,255,0.5)' }}>
                                            <div className="small">
                                              <strong>🎯 AI Adjustments:</strong> Load increased by {((child.target_config.load_adjustment_factor || 1) * 100 - 100).toFixed(0)}% • 
                                              Model confidence: {((child.target_config.model_confidence || 0) * 100).toFixed(0)}%
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                      <div className="col-md-4 text-end">
                                        <button 
                                          className="btn btn-primary rounded-3 d-flex align-items-center gap-2 ms-auto"
                                          onClick={() => viewReport(child.execution_id)}
                                        >
                                          <i className="material-icons-outlined" style={{ fontSize: 18 }}>visibility</i>
                                          View Full Report
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </div>
        </div>
      </div>
  );
};

export default SmartExecutionHistory;
