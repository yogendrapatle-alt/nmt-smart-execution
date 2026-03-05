import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

interface TimelineEvent {
  timestamp: string;
  execution_id: string;
  entity_type: string;
  operation_type: string;
  entity_name: string;
  entity_uuid?: string;
  status: string;
  duration_seconds?: number;
  pod_cpu_percent?: number;
  pod_memory_mb?: number;
  pod_network_rx_mbps?: number;
  pod_network_tx_mbps?: number;
  testbed_label?: string;
  pc_ip?: string;
  ncm_ip?: string;
}

const TestbedTimeline: React.FC = () => {
  const { testbedId } = useParams<{ testbedId: string }>();
  const navigate = useNavigate();
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testbedInfo, setTestbedInfo] = useState<any>(null);

  useEffect(() => {
    if (testbedId) {
      fetchTimeline();
    }
  }, [testbedId]);

  const fetchTimeline = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch timeline
      const response = await fetch(`http://localhost:5000/api/testbed-timeline/${testbedId}`);
      const data = await response.json();

      if (data.success) {
        setTimeline(data.timeline);
        if (data.timeline.length > 0) {
          setTestbedInfo({
            label: data.timeline[0].testbed_label,
            pc_ip: data.timeline[0].pc_ip,
            ncm_ip: data.timeline[0].ncm_ip
          });
        }
      } else {
        setError(data.error || 'Failed to fetch timeline');
      }
    } catch (err) {
      setError('Failed to connect to backend');
      console.error('Error fetching timeline:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status.toUpperCase()) {
      case 'COMPLETED':
        return 'badge bg-success';
      case 'FAILED':
        return 'badge bg-danger';
      case 'RUNNING':
        return 'badge bg-primary';
      default:
        return 'badge bg-secondary';
    }
  };

  const getEntityIcon = (entityType: string) => {
    const icons: Record<string, string> = {
      'vm': '🖥️',
      'project': '📁',
      'endpoint': '🔌',
      'blueprint': '📋',
      'playbook': '▶️',
      'report_config': '📊',
      'application': '📱',
      'runbook': '📖',
      'library_variable': '📝',
      'marketplace_item': '🛒',
      'alert': '🚨',
      'uda_policy': '🛡️',
      'scenario': '🎬',
      'image': '💿',
      'subnet': '🌐',
      'cluster': '🏢',
      'user': '👤',
      'business_unit': '🏪',
      'cost_center': '💰',
      'budget': '💵',
      'rate_card': '💳',
      'analysis_session': '🔬'
    };
    return icons[entityType] || '📦';
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'N/A';
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="container-fluid" style={{ padding: '20px' }}>
      {/* Breadcrumb */}
      <nav aria-label="breadcrumb" style={{ marginBottom: '20px' }}>
        <ol className="breadcrumb">
          <li className="breadcrumb-item">
            <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Home</a>
          </li>
          <li className="breadcrumb-item">
            <a href="/my-testbeds" onClick={(e) => { e.preventDefault(); navigate('/my-testbeds'); }}>My Testbeds</a>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Testbed Timeline
          </li>
        </ol>
      </nav>

      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-2">
            <span className="material-icons" style={{ verticalAlign: 'middle', marginRight: '10px' }}>
              timeline
            </span>
            Testbed Activity Timeline
          </h2>
          {testbedInfo && (
            <div style={{ color: '#666', fontSize: '0.9rem' }}>
              <strong>{testbedInfo.label}</strong> | PC: {testbedInfo.pc_ip} | NCM: {testbedInfo.ncm_ip}
            </div>
          )}
        </div>
        <button
          className="btn btn-outline-secondary"
          onClick={() => navigate('/my-testbeds')}
        >
          <span className="material-icons" style={{ verticalAlign: 'middle', marginRight: '5px' }}>
            arrow_back
          </span>
          Back to Testbeds
        </button>
      </div>

      {/* Timeline Content */}
      <div className="card">
        <div className="card-body">
          {loading && (
            <div className="text-center py-5">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
              <p className="mt-3">Loading timeline...</p>
            </div>
          )}

          {error && (
            <div className="alert alert-danger" role="alert">
              <span className="material-icons" style={{ verticalAlign: 'middle', marginRight: '8px' }}>
                error
              </span>
              {error}
              <button
                className="btn btn-sm btn-outline-danger ms-3"
                onClick={fetchTimeline}
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && timeline.length === 0 && (
            <div className="alert alert-info" role="alert">
              <span className="material-icons" style={{ verticalAlign: 'middle', marginRight: '8px' }}>
                info
              </span>
              No activities found for this testbed yet.
            </div>
          )}

          {!loading && !error && timeline.length > 0 && (
            <>
              {/* Summary Stats */}
              <div className="row mb-4">
                <div className="col-md-3">
                  <div className="card bg-light">
                    <div className="card-body text-center">
                      <h3 className="mb-0">{timeline.length}</h3>
                      <small className="text-muted">Total Operations</small>
                    </div>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="card bg-success text-white">
                    <div className="card-body text-center">
                      <h3 className="mb-0">
                        {timeline.filter(e => e.status === 'COMPLETED').length}
                      </h3>
                      <small>Completed</small>
                    </div>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="card bg-danger text-white">
                    <div className="card-body text-center">
                      <h3 className="mb-0">
                        {timeline.filter(e => e.status === 'FAILED').length}
                      </h3>
                      <small>Failed</small>
                    </div>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="card bg-info text-white">
                    <div className="card-body text-center">
                      <h3 className="mb-0">
                        {new Set(timeline.map(e => e.execution_id)).size}
                      </h3>
                      <small>Executions</small>
                    </div>
                  </div>
                </div>
              </div>

              {/* Timeline Table */}
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead className="table-light">
                    <tr>
                      <th>Time</th>
                      <th>Entity</th>
                      <th>Operation</th>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Duration</th>
                      <th>CPU %</th>
                      <th>Memory (MB)</th>
                      <th>Network RX/TX</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map((event, index) => (
                      <tr key={index}>
                        <td>
                          <small>{formatTimestamp(event.timestamp)}</small>
                        </td>
                        <td>
                          <span style={{ fontSize: '1.2rem', marginRight: '5px' }}>
                            {getEntityIcon(event.entity_type)}
                          </span>
                          {event.entity_type}
                        </td>
                        <td>
                          <span className="badge bg-primary">
                            {event.operation_type}
                          </span>
                        </td>
                        <td>
                          <strong>{event.entity_name}</strong>
                          {event.entity_uuid && (
                            <div>
                              <small className="text-muted">
                                {event.entity_uuid.substring(0, 8)}...
                              </small>
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={getStatusBadgeClass(event.status)}>
                            {event.status}
                          </span>
                        </td>
                        <td>{formatDuration(event.duration_seconds)}</td>
                        <td>
                          {event.pod_cpu_percent !== null && event.pod_cpu_percent !== undefined
                            ? event.pod_cpu_percent.toFixed(1)
                            : 'N/A'}
                        </td>
                        <td>
                          {event.pod_memory_mb !== null && event.pod_memory_mb !== undefined
                            ? event.pod_memory_mb.toFixed(0)
                            : 'N/A'}
                        </td>
                        <td>
                          {event.pod_network_rx_mbps !== null && event.pod_network_rx_mbps !== undefined
                            ? `${event.pod_network_rx_mbps.toFixed(1)} / ${event.pod_network_tx_mbps?.toFixed(1) || 0}`
                            : 'N/A'}
                        </td>
                        <td>
                          <button
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => navigate(`/execution/${event.execution_id}`)}
                            title="View Execution Details"
                          >
                            <span className="material-icons" style={{ fontSize: '16px' }}>
                              visibility
                            </span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Refresh Button */}
              <div className="text-center mt-3">
                <button
                  className="btn btn-primary"
                  onClick={fetchTimeline}
                >
                  <span className="material-icons" style={{ verticalAlign: 'middle', marginRight: '5px' }}>
                    refresh
                  </span>
                  Refresh Timeline
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TestbedTimeline;
