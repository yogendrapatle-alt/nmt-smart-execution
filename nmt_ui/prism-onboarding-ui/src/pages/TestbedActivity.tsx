import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';

interface Execution {
  execution_id: string;
  testbed_id: string;
  status: string;
  progress: number;
  start_time: string;
  end_time: string | null;
  completed_operations: number;
  total_operations: number;
  successful_operations: number;
  failed_operations: number;
  duration_minutes: number;
}

interface Testbed {
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string;
  ncm_ip: string;
}

const TestbedActivity: React.FC = () => {
  const { testbedId } = useParams<{ testbedId: string }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [testbed, setTestbed] = useState<Testbed | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    fetchTestbedAndExecutions();
  }, [testbedId]);
  
  const fetchTestbedAndExecutions = async () => {
    try {
      setLoading(true);
      const backendUrl = 'http://localhost:5000';
      
      // Fetch testbed details
      const testbedResponse = await fetch(`${backendUrl}/api/get-testbeds`);
      const testbedData = await testbedResponse.json();
      
      if (testbedData.success) {
        const foundTestbed = testbedData.testbeds.find(
          (tb: any) => tb.unique_testbed_id === testbedId
        );
        if (foundTestbed) {
          setTestbed(foundTestbed);
        }
      }
      
      // Fetch all executions
      const executionsResponse = await fetch(`${backendUrl}/api/get-executions`);
      const executionsData = await executionsResponse.json();
      
      if (executionsData.success) {
        // Filter executions for this testbed and add duration
        const testbedExecutions = executionsData.executions
          .filter((exec: any) => exec.testbed_id === testbedId)
          .map((exec: any) => {
            const startTime = new Date(exec.start_time);
            const endTime = exec.end_time ? new Date(exec.end_time) : new Date();
            const durationMs = endTime.getTime() - startTime.getTime();
            const durationMinutes = durationMs / (1000 * 60);
            
            return {
              ...exec,
              duration_minutes: durationMinutes
            };
          })
          .sort((a: any, b: any) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
        
        setExecutions(testbedExecutions);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to fetch testbed activity');
    } finally {
      setLoading(false);
    }
  };
  
  const getStatusColor = (status: string) => {
    switch (status.toUpperCase()) {
      case 'COMPLETED':
        return 'success';
      case 'FAILED':
        return 'danger';
      case 'RUNNING':
        return 'primary';
      case 'PAUSED':
        return 'warning';
      case 'STOPPED':
        return 'secondary';
      default:
        return 'secondary';
    }
  };
  
  const getSuccessRate = (exec: Execution) => {
    if (exec.total_operations === 0) return 0;
    return ((exec.successful_operations / exec.total_operations) * 100).toFixed(1);
  };
  
  if (loading) {
    return (
      <Layout>
        <div className="container-fluid p-4">
          <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '400px' }}>
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <span className="ms-3">Loading testbed activity...</span>
          </div>
        </div>
      </Layout>
    );
  }
  
  if (error || !testbed) {
    return (
      <Layout>
        <div className="container-fluid p-4">
          <div className="alert alert-danger">
            <h4>Error</h4>
            <p>{error || 'Testbed not found'}</p>
            <button className="btn btn-primary mt-2" onClick={() => navigate('/my-testbeds')}>
              Back to Testbeds
            </button>
          </div>
        </div>
      </Layout>
    );
  }
  
  return (
    <Layout>
      <div className="container-fluid p-4">
        {/* Breadcrumb */}
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb">
            <li className="breadcrumb-item"><a href="/">Home</a></li>
            <li className="breadcrumb-item"><a href="/my-testbeds">My Testbeds</a></li>
            <li className="breadcrumb-item active" aria-current="page">Activity</li>
          </ol>
        </nav>
        
        {/* Header Card */}
        <div className="card shadow-sm mb-4">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <h2 className="mb-3">
                  <span className="material-icons text-primary me-2" style={{verticalAlign: 'middle', fontSize: '32px'}}>assessment</span>
                  Testbed Activity & Execution Reports
                </h2>
                <p className="mb-1"><strong>Testbed:</strong> {testbed.testbed_label}</p>
                <p className="mb-1"><strong>PC IP:</strong> {testbed.pc_ip}</p>
                <p className="mb-0"><strong>NCM IP:</strong> {testbed.ncm_ip}</p>
              </div>
              <div>
                <button 
                  className="btn btn-outline-primary me-2"
                  onClick={fetchTestbedAndExecutions}
                  title="Refresh"
                >
                  <span className="material-icons" style={{verticalAlign: 'middle'}}>refresh</span>
                </button>
                <button 
                  className="btn btn-primary"
                  onClick={() => navigate('/my-testbeds')}
                >
                  <span className="material-icons me-2" style={{verticalAlign: 'middle'}}>arrow_back</span>
                  Back to Testbeds
                </button>
              </div>
            </div>
          </div>
        </div>
        
        {/* Summary Cards */}
        <div className="row g-3 mb-4">
          <div className="col-md-3">
            <div className="card shadow-sm text-center">
              <div className="card-body">
                <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Total Executions</h6>
                <h2 className="text-primary mb-0">{executions.length}</h2>
              </div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card shadow-sm text-center">
              <div className="card-body">
                <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Completed</h6>
                <h2 className="text-success mb-0">
                  {executions.filter(e => e.status.toUpperCase() === 'COMPLETED').length}
                </h2>
              </div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card shadow-sm text-center">
              <div className="card-body">
                <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Failed</h6>
                <h2 className="text-danger mb-0">
                  {executions.filter(e => e.status.toUpperCase() === 'FAILED').length}
                </h2>
              </div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card shadow-sm text-center">
              <div className="card-body">
                <h6 className="text-muted text-uppercase mb-2" style={{fontSize: '0.85rem'}}>Running</h6>
                <h2 className="text-info mb-0">
                  {executions.filter(e => ['RUNNING', 'PENDING', 'STARTING'].includes(e.status.toUpperCase())).length}
                </h2>
              </div>
            </div>
          </div>
        </div>
        
        {/* Executions List */}
        <div className="card shadow-sm">
          <div className="card-header bg-primary text-white">
            <h5 className="mb-0">📋 Execution History</h5>
          </div>
          <div className="card-body">
            {executions.length === 0 ? (
              <div className="text-center py-5">
                <span className="material-icons text-muted mb-3" style={{fontSize: '64px'}}>inbox</span>
                <h4>No Executions Found</h4>
                <p className="text-muted">This testbed has no execution history yet.</p>
                <button 
                  className="btn btn-primary mt-3"
                  onClick={() => navigate('/execution-workload-manager')}
                >
                  <span className="material-icons me-2" style={{verticalAlign: 'middle'}}>play_arrow</span>
                  Start New Execution
                </button>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Execution ID</th>
                      <th>Status</th>
                      <th>Start Time</th>
                      <th>End Time</th>
                      <th>Duration</th>
                      <th>Operations</th>
                      <th>Success Rate</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executions.map(exec => {
                      const statusColor = getStatusColor(exec.status);
                      const successRate = parseFloat(getSuccessRate(exec));
                      const successColor = successRate > 90 ? 'success' : successRate < 70 ? 'danger' : 'warning';
                      
                      return (
                        <tr key={exec.execution_id}>
                          <td>
                            <code style={{fontSize: '0.85rem'}}>{exec.execution_id}</code>
                          </td>
                          <td>
                            <span className={`badge bg-${statusColor}`}>{exec.status}</span>
                          </td>
                          <td style={{fontSize: '0.85rem'}}>
                            {new Date(exec.start_time).toLocaleString()}
                          </td>
                          <td style={{fontSize: '0.85rem'}}>
                            {exec.end_time ? new Date(exec.end_time).toLocaleString() : 'In Progress'}
                          </td>
                          <td>
                            {exec.duration_minutes.toFixed(1)} min
                          </td>
                          <td>
                            <span className="text-success">{exec.successful_operations}</span>
                            {' / '}
                            <span className="text-danger">{exec.failed_operations}</span>
                            {' / '}
                            <span>{exec.total_operations}</span>
                          </td>
                          <td>
                            <span className={`badge bg-${successColor}`}>
                              {getSuccessRate(exec)}%
                            </span>
                          </td>
                          <td>
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => navigate(`/execution-report/${testbedId}/${exec.execution_id}`)}
                              title="View Detailed Report"
                            >
                              <span className="material-icons" style={{fontSize: '18px', verticalAlign: 'middle'}}>
                                visibility
                              </span>
                            </button>
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
      </div>
    </Layout>
  );
};

export default TestbedActivity;
