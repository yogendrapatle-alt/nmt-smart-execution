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

  useEffect(() => {
    fetchTestbeds();
  }, []);

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
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (autoRefreshInterval > 0 && selectedTestbed) {
      refreshTimerRef.current = setInterval(refreshAll, autoRefreshInterval);
    }
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
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
          if (data.testbeds.length > 0 && !selectedTestbed) {
            setSelectedTestbed(data.testbeds[0].unique_testbed_id);
          }
        }
        setLoading(false);
        return;
      }

      const base = getApiBase();
      const response = await fetch(`${base}/api/get-testbeds`);
      const data = await response.json();
      
      if (data.success && data.testbeds) {
        setTestbeds(data.testbeds);
        if (data.testbeds.length > 0 && !selectedTestbed) {
          setSelectedTestbed(data.testbeds[0].unique_testbed_id);
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

      const base = getApiBase();
      const response = await fetch(`${base}/api/alerts/${testbedId}`);
      const data = await response.json();
      
      if (data.success) {
        setAlerts(data.alerts || []);
      }
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
      
      if (data.success) {
        setExecutions(data.executions || []);
      }
    } catch (err) {
      console.warn('Error fetching executions:', err);
    }
  };

  const checkPrometheusStatus = async (url?: string) => {
    if (!url) {
      setPrometheusStatus('offline');
      return;
    }

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

  const getExecStartTime = (exec: ExecutionRecord): string | undefined => {
    return exec.start_time || exec.started_at;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'critical': return '#dc3545';
      case 'warning': return '#ffc107';
      case 'info': return '#17a2b8';
      default: return '#6c757d';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active': return '#dc3545';
      case 'pending': return '#ffc107';
      case 'resolved': return '#28a745';
      default: return '#6c757d';
    }
  };

  const getExecutionStatusColor = (status: string) => {
    switch (status.toUpperCase()) {
      case 'COMPLETED': return '#28a745';
      case 'FAILED': return '#dc3545';
      case 'RUNNING': return '#007bff';
      case 'TIMEOUT': return '#fd7e14';
      case 'STOPPED': return '#6c757d';
      default: return '#6c757d';
    }
  };

  const totalExecs = executions.length;
  const completedExecs = executions.filter(e => e.status?.toUpperCase() === 'COMPLETED').length;
  const failedExecs = executions.filter(e => ['FAILED', 'TIMEOUT'].includes(e.status?.toUpperCase())).length;
  const runningExecs = executions.filter(e => e.status?.toUpperCase() === 'RUNNING').length;
  const avgSuccessRate = executions.length > 0
    ? executions.reduce((sum, e) => sum + (e.success_rate || 0), 0) / executions.length
    : 0;

  return (
    <div className="main-content">
      {/* Breadcrumb */}
      <div className="d-flex align-items-center mb-4">
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb mb-0">
            <li className="breadcrumb-item">
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>
                <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle' }}>home</i>
              </a>
            </li>
            <li className="breadcrumb-item active">Status & Monitoring</li>
          </ol>
        </nav>
      </div>

      {/* Page Title + Auto-Refresh */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0 text-gray-800">
          <i className="material-icons-outlined" style={{ fontSize: 32, verticalAlign: 'middle', marginRight: 12 }}>
            monitoring
          </i>
          Status & Monitoring
        </h1>
        <div className="d-flex align-items-center gap-3">
          <span className="text-muted" style={{ fontSize: '0.8rem' }}>
            Last refreshed: {lastRefreshed.toLocaleTimeString()}
          </span>
          <select
            className="form-select form-select-sm"
            value={autoRefreshInterval}
            onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
            style={{ width: 100 }}
          >
            {AUTO_REFRESH_INTERVALS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            className="btn btn-sm btn-outline-primary"
            onClick={refreshAll}
            title="Refresh now"
          >
            <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle' }}>refresh</i>
          </button>
        </div>
      </div>

      {/* Testbed Selector */}
      <div className="card rounded-4 border-0 shadow-sm mb-4">
        <div className="card-body">
          <h5 className="card-title mb-3">
            <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 8 }}>
              dns
            </i>
            Select Testbed
          </h5>
          {loading ? (
            <p>Loading testbeds...</p>
          ) : error ? (
            <div className="alert alert-danger">{error}</div>
          ) : (
            <select
              className="form-select"
              value={selectedTestbed}
              onChange={(e) => setSelectedTestbed(e.target.value)}
              style={{ maxWidth: 500 }}
            >
              <option value="">-- Select a testbed --</option>
              {testbeds.map(tb => (
                <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>
                  {tb.testbed_label} ({tb.pc_ip})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {selectedTestbedDetails && (
        <>
          {/* Summary Stats Cards */}
          <div className="row mb-4">
            <div className="col-md-3 col-sm-6 mb-3">
              <div className="card rounded-4 border-0 shadow-sm h-100">
                <div className="card-body text-center">
                  <i className="material-icons-outlined" style={{ fontSize: 28, color: '#6f42c1' }}>history</i>
                  <h3 className="mt-2 mb-0">{totalExecs}</h3>
                  <small className="text-muted">Total Executions</small>
                </div>
              </div>
            </div>
            <div className="col-md-3 col-sm-6 mb-3">
              <div className="card rounded-4 border-0 shadow-sm h-100">
                <div className="card-body text-center">
                  <i className="material-icons-outlined" style={{ fontSize: 28, color: '#28a745' }}>check_circle</i>
                  <h3 className="mt-2 mb-0">{completedExecs}</h3>
                  <small className="text-muted">Completed</small>
                </div>
              </div>
            </div>
            <div className="col-md-3 col-sm-6 mb-3">
              <div className="card rounded-4 border-0 shadow-sm h-100">
                <div className="card-body text-center">
                  <i className="material-icons-outlined" style={{ fontSize: 28, color: '#dc3545' }}>error</i>
                  <h3 className="mt-2 mb-0">{failedExecs}</h3>
                  <small className="text-muted">Failed / Timeout</small>
                </div>
              </div>
            </div>
            <div className="col-md-3 col-sm-6 mb-3">
              <div className="card rounded-4 border-0 shadow-sm h-100">
                <div className="card-body text-center">
                  <i className="material-icons-outlined" style={{ fontSize: 28, color: '#007bff' }}>
                    {runningExecs > 0 ? 'play_circle' : 'trending_up'}
                  </i>
                  <h3 className="mt-2 mb-0">
                    {runningExecs > 0 ? runningExecs : `${avgSuccessRate.toFixed(1)}%`}
                  </h3>
                  <small className="text-muted">{runningExecs > 0 ? 'Running Now' : 'Avg Success Rate'}</small>
                </div>
              </div>
            </div>
          </div>

          {/* Testbed Info & Prometheus Status */}
          <div className="row mb-4">
            {/* Testbed Info */}
            <div className="col-md-6">
              <div className="card rounded-4 border-0 shadow-sm h-100">
                <div className="card-body">
                  <h5 className="card-title mb-3">
                    <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 8 }}>
                      info
                    </i>
                    Testbed Information
                  </h5>
                  <table className="table table-sm">
                    <tbody>
                      <tr>
                        <td><strong>Name:</strong></td>
                        <td>{selectedTestbedDetails.testbed_label}</td>
                      </tr>
                      <tr>
                        <td><strong>PC IP:</strong></td>
                        <td><code>{selectedTestbedDetails.pc_ip}</code></td>
                      </tr>
                      {selectedTestbedDetails.ncm_ip && (
                        <tr>
                          <td><strong>NCM IP:</strong></td>
                          <td><code>{selectedTestbedDetails.ncm_ip}</code></td>
                        </tr>
                      )}
                      <tr>
                        <td><strong>Testbed ID:</strong></td>
                        <td><code style={{ fontSize: '0.75rem' }}>{selectedTestbedDetails.unique_testbed_id}</code></td>
                      </tr>
                      <tr>
                        <td><strong>Onboarded:</strong></td>
                        <td>{new Date(selectedTestbedDetails.timestamp).toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Prometheus Status */}
            <div className="col-md-6">
              <div className="card rounded-4 border-0 shadow-sm h-100">
                <div className="card-body">
                  <h5 className="card-title mb-3">
                    <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 8 }}>
                      assessment
                    </i>
                    Prometheus Status
                  </h5>
                  <div className="d-flex align-items-center mb-3">
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: prometheusStatus === 'online' ? '#28a745' : prometheusStatus === 'offline' ? '#dc3545' : '#ffc107',
                        marginRight: 8
                      }}
                    ></div>
                    <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                      {prometheusStatus === 'online' ? 'Online' : prometheusStatus === 'offline' ? 'Offline' : 'Checking...'}
                    </span>
                  </div>
                  {getPrometheusUrl(selectedTestbedDetails) ? (
                    <p className="mb-2">
                      <strong>URL:</strong> <code>{getPrometheusUrl(selectedTestbedDetails)}</code>
                    </p>
                  ) : (
                    <p className="mb-2 text-muted">
                      No Prometheus endpoint configured for this testbed.
                    </p>
                  )}
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => checkPrometheusStatus(getPrometheusUrl(selectedTestbedDetails))}
                  >
                    <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>
                      refresh
                    </i>
                    Refresh Status
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Alerts */}
          <div className="card rounded-4 border-0 shadow-sm mb-4">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h5 className="card-title mb-0">
                  <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 8 }}>
                    warning
                  </i>
                  Active Alerts ({alerts.length})
                </h5>
                <button
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => navigate('/alert-summary')}
                >
                  View All Alerts
                </button>
              </div>
              {alerts.length === 0 ? (
                <div className="alert alert-success mb-0">
                  <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 8 }}>
                    check_circle
                  </i>
                  No active alerts for this testbed
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th>Alert Name</th>
                        <th>Severity</th>
                        <th>Status</th>
                        <th>Description</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.map(alert => (
                        <tr key={alert.id}>
                          <td><strong>{alert.alert_name}</strong></td>
                          <td>
                            <span
                              className="badge"
                              style={{ backgroundColor: getSeverityColor(alert.severity), color: '#fff' }}
                            >
                              {alert.severity}
                            </span>
                          </td>
                          <td>
                            <span
                              className="badge"
                              style={{ backgroundColor: getStatusColor(alert.status), color: '#fff' }}
                            >
                              {alert.status}
                            </span>
                          </td>
                          <td>{alert.description}</td>
                          <td>{new Date(alert.timestamp).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Recent Executions */}
          <div className="card rounded-4 border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h5 className="card-title mb-0">
                  <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 8 }}>
                    history
                  </i>
                  Recent Executions ({Math.min(executions.length, 10)} of {executions.length})
                </h5>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => navigate('/smart-execution/history')}
                >
                  View All
                </button>
              </div>
              {executions.length === 0 ? (
                <div className="alert alert-info mb-0">
                  <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 8 }}>
                    info
                  </i>
                  No executions found for this testbed
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th>Execution ID</th>
                        <th>Status</th>
                        <th>Started</th>
                        <th>Duration</th>
                        <th>Operations</th>
                        <th>Success Rate</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {executions.slice(0, 10).map(exec => {
                        const startTime = getExecStartTime(exec);
                        const isRunning = exec.status?.toUpperCase() === 'RUNNING';
                        return (
                          <tr
                            key={exec.execution_id}
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              if (isRunning) {
                                navigate(`/smart-execution/monitor/${exec.execution_id}`);
                              } else {
                                navigate(`/smart-execution/report/${exec.execution_id}`);
                              }
                            }}
                          >
                            <td>
                              <code style={{ fontSize: '0.75rem' }}>
                                {exec.execution_id.length > 24
                                  ? exec.execution_id.substring(0, 24) + '...'
                                  : exec.execution_id}
                              </code>
                            </td>
                            <td>
                              <span
                                className="badge"
                                style={{ backgroundColor: getExecutionStatusColor(exec.status), color: '#fff' }}
                              >
                                {exec.status}
                              </span>
                            </td>
                            <td>{startTime ? new Date(startTime).toLocaleString() : 'N/A'}</td>
                            <td>
                              {exec.duration_minutes != null
                                ? `${exec.duration_minutes.toFixed(1)} min`
                                : 'N/A'}
                            </td>
                            <td>
                              {exec.successful_operations != null && exec.total_operations != null
                                ? `${exec.successful_operations}/${exec.total_operations}`
                                : 'N/A'}
                            </td>
                            <td>
                              {exec.success_rate != null
                                ? <span style={{
                                    color: exec.success_rate >= 90 ? '#28a745' : exec.success_rate >= 70 ? '#ffc107' : '#dc3545',
                                    fontWeight: 600
                                  }}>
                                    {exec.success_rate.toFixed(1)}%
                                  </span>
                                : 'N/A'}
                            </td>
                            <td>
                              <i className="material-icons-outlined" style={{ fontSize: 18, color: '#6c757d' }}>
                                {isRunning ? 'visibility' : 'description'}
                              </i>
                            </td>
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
