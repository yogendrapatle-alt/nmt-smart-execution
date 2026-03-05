import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAutoBackendUrl } from '../utils/backendUrl';
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
  started_at: string;
  completed_at?: string;
  duration_minutes?: number;
  total_operations?: number;
  successful_operations?: number;
  failed_operations?: number;
}

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

  useEffect(() => {
    fetchTestbeds();
  }, []);

  useEffect(() => {
    if (selectedTestbed) {
      const testbed = testbeds.find(t => t.unique_testbed_id === selectedTestbed);
      setSelectedTestbedDetails(testbed || null);
      fetchAlerts(selectedTestbed);
      fetchExecutions(selectedTestbed);
      checkPrometheusStatus(testbed?.prometheus_url);
    }
  }, [selectedTestbed, testbeds]);

  const fetchTestbeds = async () => {
    try {
      // FAKE DATA MODE
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

      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/get-testbeds`);
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
      // FAKE DATA MODE
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const data = getFakeAlertsByTestbed(testbedId);
        setAlerts(data.alerts as any || []);
        return;
      }

      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/alerts/${testbedId}`);
      const data = await response.json();
      
      if (data.success) {
        setAlerts(data.alerts || []);
      }
    } catch (err) {
      console.error('Error fetching alerts:', err);
    }
  };

  const fetchExecutions = async (testbedId: string) => {
    try {
      // FAKE DATA MODE
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const data = getFakeExecutionsByTestbed(testbedId);
        setExecutions(data.executions as any || []);
        return;
      }

      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/execution-history?testbed_id=${testbedId}`);
      const data = await response.json();
      
      if (data.success) {
        setExecutions(data.history || []);
      }
    } catch (err) {
      console.error('Error fetching executions:', err);
    }
  };

  const checkPrometheusStatus = async (url?: string) => {
    if (!url) {
      setPrometheusStatus('offline');
      return;
    }

    try {
      setPrometheusStatus('checking');
      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/check-prometheus?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      
      setPrometheusStatus(data.status === 'online' ? 'online' : 'offline');
    } catch (err) {
      console.error('Error checking Prometheus status:', err);
      setPrometheusStatus('offline');
    }
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
    switch (status.toLowerCase()) {
      case 'completed': return '#28a745';
      case 'failed': return '#dc3545';
      case 'running': return '#ffc107';
      default: return '#6c757d';
    }
  };

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

      {/* Page Title */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0 text-gray-800">
          <i className="material-icons-outlined" style={{ fontSize: 32, verticalAlign: 'middle', marginRight: 12 }}>
            monitoring
          </i>
          Status & Monitoring
        </h1>
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
                        <td><code style={{ fontSize: '0.75rem' }}>{selectedTestbedDetails.unique_testbed_id.substring(0, 20)}...</code></td>
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
                  {selectedTestbedDetails.prometheus_url && (
                    <p className="mb-2">
                      <strong>URL:</strong> <code>{selectedTestbedDetails.prometheus_url}</code>
                    </p>
                  )}
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => checkPrometheusStatus(selectedTestbedDetails.prometheus_url)}
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
              <h5 className="card-title mb-3">
                <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 8 }}>
                  warning
                </i>
                Active Alerts ({alerts.length})
              </h5>
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
                  Recent Executions (Last 10)
                </h5>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => navigate('/execution-workload-manager')}
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
                      </tr>
                    </thead>
                    <tbody>
                      {executions.slice(0, 10).map(exec => (
                        <tr key={exec.execution_id}>
                          <td>
                            <code style={{ fontSize: '0.75rem' }}>
                              {exec.execution_id.substring(0, 20)}...
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
                          <td>{new Date(exec.started_at).toLocaleString()}</td>
                          <td>
                            {exec.duration_minutes !== undefined && exec.duration_minutes !== null
                              ? `${exec.duration_minutes.toFixed(2)} min`
                              : 'N/A'}
                          </td>
                          <td>
                            {exec.successful_operations !== undefined && exec.total_operations !== undefined
                              ? `${exec.successful_operations}/${exec.total_operations}`
                              : 'N/A'}
                          </td>
                        </tr>
                      ))}
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
