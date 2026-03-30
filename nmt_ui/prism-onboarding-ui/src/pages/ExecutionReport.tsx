import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getApiBase } from '../utils/backendUrl';

interface ExecutionData {
  execution_id: string;
  testbed_id: string;
  status: string;
  progress: number;
  total_operations: number;
  completed_operations: number;
  successful_operations: number;
  failed_operations: number;
  start_time: string;
  end_time: string | null;
  duration_minutes: number;
  last_error: string | null;
  config: any;
  metrics: any;
}

interface TestbedData {
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string;
  ncm_ip: string;
}

interface OperationMetric {
  id: number;
  entity_type: string;
  operation_type: string;
  entity_name: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number;
  status: string;
  error_message: string | null;
  pod_cpu_percent: number;
  pod_memory_mb: number;
}

interface Alert {
  id: number;
  alert_name: string;
  severity: string;
  status: string;
  description: string;
  triggered_at: string;
  resolved_at: string | null;
}

const ExecutionReport: React.FC = () => {
  const { testbedId, executionId } = useParams<{ testbedId: string; executionId: string }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [execution, setExecution] = useState<ExecutionData | null>(null);
  const [testbed, setTestbed] = useState<TestbedData | null>(null);
  const [operationMetrics, setOperationMetrics] = useState<OperationMetric[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    fetchExecutionReport();
  }, [executionId]);
  
  const fetchExecutionReport = async () => {
    try {
      setLoading(true);
      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/execution-report-detailed/${executionId}`);
      const data = await response.json();
      
      if (data.success) {
        setExecution(data.execution);
        setTestbed(data.testbed);
        setOperationMetrics(data.operation_metrics || []);
        setAlerts(data.alerts || []);
      } else {
        setError(data.error || 'Failed to load execution report');
      }
    } catch (err) {
      console.error('Error fetching execution report:', err);
      setError('Failed to fetch execution report');
    } finally {
      setLoading(false);
    }
  };
  
  const downloadHTMLReport = async () => {
    try {
      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/execution-html-report/${executionId}`);
      
      if (!response.ok) {
        throw new Error('Failed to download report');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `NMT_Execution_Report_${executionId}.html`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading report:', error);
      alert('Failed to download HTML report');
    }
  };
  
  const calculateSummary = () => {
    if (!execution || operationMetrics.length === 0) return null;
    
    const totalOps = operationMetrics.length;
    const successfulOps = operationMetrics.filter(op => op.status === 'SUCCESS').length;
    const failedOps = operationMetrics.filter(op => op.status === 'FAILED').length;
    const successRate = (successfulOps / totalOps * 100).toFixed(1);
    
    const avgDuration = (operationMetrics.reduce((sum, op) => sum + op.duration_seconds, 0) / totalOps).toFixed(2);
    const avgCpu = (operationMetrics.reduce((sum, op) => sum + op.pod_cpu_percent, 0) / totalOps).toFixed(1);
    const avgMemory = (operationMetrics.reduce((sum, op) => sum + op.pod_memory_mb, 0) / totalOps).toFixed(1);
    const maxCpu = Math.max(...operationMetrics.map(op => op.pod_cpu_percent)).toFixed(1);
    const maxMemory = Math.max(...operationMetrics.map(op => op.pod_memory_mb)).toFixed(1);
    
    const entityTypes = [...new Set(operationMetrics.map(op => op.entity_type))];
    
    return {
      totalOps,
      successfulOps,
      failedOps,
      successRate,
      avgDuration,
      avgCpu,
      avgMemory,
      maxCpu,
      maxMemory,
      entityTypesCount: entityTypes.length,
      criticalAlerts: alerts.filter(a => a.severity === 'critical').length
    };
  };
  
  const getEntityBreakdown = () => {
    const breakdown: Record<string, any> = {};
    
    operationMetrics.forEach(op => {
      if (!breakdown[op.entity_type]) {
        breakdown[op.entity_type] = {
          total: 0,
          create: 0,
          update: 0,
          delete: 0,
          other: 0,
          successful: 0,
          failed: 0
        };
      }
      
      breakdown[op.entity_type].total++;
      
      if (op.operation_type === 'create') breakdown[op.entity_type].create++;
      else if (op.operation_type === 'update') breakdown[op.entity_type].update++;
      else if (op.operation_type === 'delete') breakdown[op.entity_type].delete++;
      else breakdown[op.entity_type].other++;
      
      if (op.status === 'SUCCESS') breakdown[op.entity_type].successful++;
      else breakdown[op.entity_type].failed++;
    });
    
    return breakdown;
  };
  
  const getTopCPUConsumers = () => {
    return [...operationMetrics]
      .sort((a, b) => b.pod_cpu_percent - a.pod_cpu_percent)
      .slice(0, 10);
  };
  
  const getSlowestOperations = () => {
    return [...operationMetrics]
      .sort((a, b) => b.duration_seconds - a.duration_seconds)
      .slice(0, 10);
  };
  
  if (loading) {
    return (
      <Layout>
        <div className="container-fluid p-4">
          <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '400px' }}>
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <span className="ms-3">Loading execution report...</span>
          </div>
        </div>
      </Layout>
    );
  }
  
  if (error || !execution || !testbed) {
    return (
      <Layout>
        <div className="container-fluid p-4">
          <div className="alert alert-danger">
            <h4>Error</h4>
            <p>{error || 'Failed to load execution report'}</p>
            <button className="btn btn-primary mt-2" onClick={() => navigate('/my-testbeds')}>
              Back to Testbeds
            </button>
          </div>
        </div>
      </Layout>
    );
  }
  
  const summary = calculateSummary();
  const entityBreakdown = getEntityBreakdown();
  const topCPU = getTopCPUConsumers();
  const slowest = getSlowestOperations();
  
  const statusColor = execution.status === 'COMPLETED' ? 'success' : 
                      execution.status === 'FAILED' ? 'danger' : 'warning';
  
  return (
    <Layout>
      <div className="container-fluid p-4">
        {/* Breadcrumb */}
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb">
            <li className="breadcrumb-item"><a href="/">Home</a></li>
            <li className="breadcrumb-item"><a href="/my-testbeds">My Testbeds</a></li>
            <li className="breadcrumb-item active" aria-current="page">Execution Report</li>
          </ol>
        </nav>
        
        {/* Header Card */}
        <div className="card shadow-sm mb-4">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <h2 className="mb-3">
                  <span className="material-icons text-primary me-2" style={{verticalAlign: 'middle', fontSize: '32px'}}>assessment</span>
                  Execution Report
                </h2>
                <p className="mb-1"><strong>Execution ID:</strong> {execution.execution_id}</p>
                <p className="mb-1"><strong>Testbed:</strong> {testbed.testbed_label} ({testbed.pc_ip})</p>
                <p className="mb-1"><strong>NCM Cluster:</strong> {testbed.ncm_ip}</p>
                <p className="mb-1">
                  <strong>Status:</strong> 
                  <span className={`badge bg-${statusColor} ms-2`}>{execution.status}</span>
                </p>
                <p className="mb-1"><strong>Duration:</strong> {execution.duration_minutes.toFixed(2)} minutes</p>
                <p className="mb-0">
                  <strong>Period:</strong> {new Date(execution.start_time).toLocaleString()} → {execution.end_time ? new Date(execution.end_time).toLocaleString() : 'In Progress'}
                </p>
              </div>
              <button 
                className="btn btn-primary"
                onClick={downloadHTMLReport}
                title="Download HTML Report"
              >
                <span className="material-icons me-2" style={{verticalAlign: 'middle'}}>download</span>
                Download HTML Report
              </button>
            </div>
          </div>
        </div>
        
        {/* Executive Summary */}
        {summary && (
          <>
            <h3 className="mb-3">📊 Executive Summary</h3>
            <div className="row g-3 mb-4">
              <div className="col-md-3">
                <div className="card shadow-sm text-center">
                  <div className="card-body">
                    <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Total Operations</h6>
                    <h2 className="text-primary mb-0">{summary.totalOps}</h2>
                  </div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="card shadow-sm text-center">
                  <div className="card-body">
                    <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Success Rate</h6>
                    <h2 className={`mb-0 ${parseFloat(summary.successRate) > 90 ? 'text-success' : parseFloat(summary.successRate) < 70 ? 'text-danger' : 'text-warning'}`}>
                      {summary.successRate}%
                    </h2>
                  </div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="card shadow-sm text-center">
                  <div className="card-body">
                    <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Successful</h6>
                    <h2 className="text-success mb-0">{summary.successfulOps}</h2>
                  </div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="card shadow-sm text-center">
                  <div className="card-body">
                    <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Failed</h6>
                    <h2 className="text-danger mb-0">{summary.failedOps}</h2>
                  </div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="card shadow-sm text-center">
                  <div className="card-body">
                    <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Entity Types</h6>
                    <h2 className="text-info mb-0">{summary.entityTypesCount}</h2>
                  </div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="card shadow-sm text-center">
                  <div className="card-body">
                    <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Avg CPU</h6>
                    <h2 className={`mb-0 ${parseFloat(summary.avgCpu) > 80 ? 'text-danger' : parseFloat(summary.avgCpu) > 60 ? 'text-warning' : 'text-success'}`}>
                      {summary.avgCpu}%
                    </h2>
                    <small className="text-muted">Max: {summary.maxCpu}%</small>
                  </div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="card shadow-sm text-center">
                  <div className="card-body">
                    <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Avg Memory</h6>
                    <h2 className={`mb-0 ${parseFloat(summary.avgMemory) > 1024 ? 'text-danger' : parseFloat(summary.avgMemory) > 512 ? 'text-warning' : 'text-success'}`}>
                      {summary.avgMemory} MB
                    </h2>
                    <small className="text-muted">Max: {summary.maxMemory} MB</small>
                  </div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="card shadow-sm text-center">
                  <div className="card-body">
                    <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Alerts</h6>
                    <h2 className={`mb-0 ${summary.criticalAlerts > 0 ? 'text-danger' : alerts.length === 0 ? 'text-success' : 'text-warning'}`}>
                      {alerts.length}
                    </h2>
                    <small className="text-muted">Critical: {summary.criticalAlerts}</small>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
        
        {/* Entity Operations Breakdown */}
        <div className="card shadow-sm mb-4">
          <div className="card-header bg-primary text-white">
            <h5 className="mb-0">📋 Entity Operations Breakdown</h5>
          </div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Entity Type</th>
                    <th>Total</th>
                    <th>Create</th>
                    <th>Update</th>
                    <th>Delete</th>
                    <th>Other</th>
                    <th>Success Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(entityBreakdown).map(([entityType, data]: [string, any]) => {
                    const successRate = ((data.successful / data.total) * 100).toFixed(1);
                    const rateColor = parseFloat(successRate) > 90 ? 'success' : parseFloat(successRate) < 70 ? 'danger' : 'warning';
                    
                    return (
                      <tr key={entityType}>
                        <td><strong>{entityType}</strong></td>
                        <td>{data.total}</td>
                        <td>{data.create}</td>
                        <td>{data.update}</td>
                        <td>{data.delete}</td>
                        <td>{data.other}</td>
                        <td>
                          <span className={`badge bg-${rateColor}`}>{successRate}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        {/* Pod-Level Performance */}
        <div className="card shadow-sm mb-4">
          <div className="card-header bg-primary text-white">
            <h5 className="mb-0">🎯 Pod-Level Performance (Top 10 by CPU)</h5>
          </div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Entity</th>
                    <th>Operation</th>
                    <th>Duration (s)</th>
                    <th>Pod CPU %</th>
                    <th>Pod Memory (MB)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {topCPU.map((op, idx) => {
                    const cpuClass = op.pod_cpu_percent > 90 ? 'table-danger' : op.pod_cpu_percent > 70 ? 'table-warning' : '';
                    const statusColor = op.status === 'SUCCESS' ? 'success' : 'danger';
                    
                    return (
                      <tr key={op.id} className={cpuClass}>
                        <td>{idx + 1}</td>
                        <td>{op.entity_type}</td>
                        <td>{op.operation_type}</td>
                        <td>{op.duration_seconds.toFixed(2)}</td>
                        <td><strong>{op.pod_cpu_percent.toFixed(2)}</strong></td>
                        <td>{op.pod_memory_mb.toFixed(2)}</td>
                        <td><span className={`badge bg-${statusColor}`}>{op.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="card shadow-sm mb-4">
            <div className="card-header bg-danger text-white">
              <h5 className="mb-0">🚨 Alerts Triggered During Execution</h5>
            </div>
            <div className="card-body">
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Alert Name</th>
                      <th>Severity</th>
                      <th>Status</th>
                      <th>Triggered At</th>
                      <th>Resolved At</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map(alert => {
                      const sevColor = alert.severity === 'critical' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'info';
                      const rowClass = alert.severity === 'critical' ? 'table-danger' : alert.severity === 'warning' ? 'table-warning' : '';
                      
                      return (
                        <tr key={alert.id} className={rowClass}>
                          <td><strong>{alert.alert_name}</strong></td>
                          <td><span className={`badge bg-${sevColor}`}>{alert.severity}</span></td>
                          <td>{alert.status}</td>
                          <td style={{fontSize: '0.85rem'}}>{new Date(alert.triggered_at).toLocaleString()}</td>
                          <td style={{fontSize: '0.85rem'}}>{alert.resolved_at ? new Date(alert.resolved_at).toLocaleString() : 'N/A'}</td>
                          <td>{alert.description}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        
        {/* Slowest Operations */}
        <div className="card shadow-sm mb-4">
          <div className="card-header bg-warning">
            <h5 className="mb-0">⏱️ Slowest Operations (Top 10)</h5>
          </div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Entity Type</th>
                    <th>Operation</th>
                    <th>Entity Name</th>
                    <th>Duration (s)</th>
                    <th>Status</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {slowest.map((op, idx) => {
                    const durationClass = op.duration_seconds > 300 ? 'table-danger' : op.duration_seconds > 120 ? 'table-warning' : '';
                    const statusColor = op.status === 'SUCCESS' ? 'success' : 'danger';
                    
                    return (
                      <tr key={op.id} className={durationClass}>
                        <td>{idx + 1}</td>
                        <td>{op.entity_type}</td>
                        <td>{op.operation_type}</td>
                        <td>{op.entity_name}</td>
                        <td><strong>{op.duration_seconds.toFixed(2)}</strong></td>
                        <td><span className={`badge bg-${statusColor}`}>{op.status}</span></td>
                        <td style={{fontSize: '0.85rem'}}>{op.error_message || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        {/* Complete Timeline */}
        <div className="card shadow-sm mb-4">
          <div className="card-header bg-info text-white">
            <h5 className="mb-0">📅 Complete Operation Timeline ({operationMetrics.length} operations)</h5>
          </div>
          <div className="card-body">
            <div className="table-responsive" style={{maxHeight: '500px', overflow: 'auto'}}>
              <table className="table table-hover table-sm">
                <thead style={{position: 'sticky', top: 0, backgroundColor: 'white', zIndex: 1}}>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Entity</th>
                    <th>Operation</th>
                    <th>Name</th>
                    <th>Duration</th>
                    <th>CPU %</th>
                    <th>Memory</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {operationMetrics.map((op, idx) => {
                    const statusColor = op.status === 'SUCCESS' ? 'success' : 'danger';
                    const rowClass = op.status === 'SUCCESS' ? 'table-success' : 'table-danger';
                    
                    return (
                      <tr key={op.id} className={rowClass} style={{opacity: 0.9}}>
                        <td>{idx + 1}</td>
                        <td style={{fontSize: '0.8rem'}}>{new Date(op.started_at).toLocaleTimeString()}</td>
                        <td>{op.entity_type}</td>
                        <td>{op.operation_type}</td>
                        <td>{op.entity_name}</td>
                        <td>{op.duration_seconds.toFixed(2)}s</td>
                        <td>{op.pod_cpu_percent.toFixed(1)}%</td>
                        <td>{op.pod_memory_mb.toFixed(1)} MB</td>
                        <td>
                          <span style={{
                            display: 'inline-block',
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            backgroundColor: op.status === 'SUCCESS' ? '#28a745' : '#dc3545',
                            marginRight: '5px'
                          }}></span>
                          {op.status}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default ExecutionReport;
