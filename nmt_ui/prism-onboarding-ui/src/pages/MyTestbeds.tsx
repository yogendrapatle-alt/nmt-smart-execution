import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ntnxLogo from '../assets/new_nutanix_logo.png';
import { IS_FAKE_MODE } from '../config/fakeMode';
import { getFakeTestbeds } from '../fake-data';

interface Testbed {
  id: number;
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string | null;
  uuid: string | null;
  timestamp: string;
  testbed_json: any;
  ncm_ip: string | null;
  deployment_status?: string;
}

const MyTestbeds: React.FC = () => {
  const navigate = useNavigate();
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchTestbeds();
  }, []);

  const fetchTestbeds = async () => {
    setLoading(true);
    setError(null);

    try {
      // FAKE DATA MODE: Return demo data without backend call
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
        const data = getFakeTestbeds();
        setTestbeds(data.testbeds || []);
        setLoading(false);
        return;
      }

      const backendUrl = 'http://localhost:5000';
      console.log('Fetching testbeds from:', backendUrl);

      const response = await fetch(`${backendUrl}/api/get-testbeds`);
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      console.log('Testbeds data:', data);

      if (data.success) {
        setTestbeds(data.testbeds || []);
      } else {
        setError('Failed to fetch testbeds');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Error fetching testbeds: ${errorMsg}`);
      console.error('Error fetching testbeds:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleView = (testbed: Testbed) => {
    // Navigate to status page with this testbed selected
    localStorage.setItem('selected_testbed_label', testbed.testbed_label);
    navigate('/status');
  };

  const handleConfigure = (testbed: Testbed) => {
    // Store testbed ID and navigate to rule config manager
    localStorage.setItem('unique_testbed_id', testbed.unique_testbed_id);
    localStorage.setItem('selected_testbed_label', testbed.testbed_label);
    navigate('/rule-config-manager');
  };

  const handleDelete = async (testbed: Testbed) => {
    if (!confirm(`Are you sure you want to delete testbed "${testbed.testbed_label}"?\n\nThis will also delete all associated rules and configurations.`)) {
      return;
    }

    setDeleteLoading(testbed.unique_testbed_id);

    try {
      // FAKE DATA MODE: Just remove from local state
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
        setTestbeds(testbeds.filter(t => t.unique_testbed_id !== testbed.unique_testbed_id));
        alert(`✓ Testbed deleted successfully (DEMO mode)`);
        setDeleteLoading(null);
        return;
      }

      const backendUrl = 'http://localhost:5000';
      console.log(`Deleting testbed: ${testbed.unique_testbed_id}`);
      
      const response = await fetch(`${backendUrl}/api/delete-testbed/${testbed.unique_testbed_id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('Delete response status:', response.status);
      
      const data = await response.json();
      console.log('Delete response data:', data);

      if (response.ok && data.success) {
        // Remove from local state
        setTestbeds(testbeds.filter(t => t.unique_testbed_id !== testbed.unique_testbed_id));
        alert(`✓ ${data.message}`);
      } else {
        const errorMsg = data.error || data.message || 'Unknown error';
        console.error('Delete failed:', errorMsg);
        alert(`✗ Failed to delete testbed: ${errorMsg}`);
      }
    } catch (err) {
      console.error('Error deleting testbed:', err);
      const errorMsg = err instanceof Error ? err.message : 'Network error or server not responding';
      alert(`✗ Failed to delete testbed: ${errorMsg}\n\nPlease check:\n- Backend server is running\n- Network connection is stable`);
    } finally {
      setDeleteLoading(null);
    }
  };

  const getStatusBadge = (testbed: Testbed) => {
    // Determine status based on available data
    if (testbed.ncm_ip) {
      return <span className="badge bg-success">Active</span>;
    } else if (testbed.pc_ip) {
      return <span className="badge bg-warning">Configured</span>;
    } else {
      return <span className="badge bg-secondary">Pending</span>;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="main-content">
        <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '60vh' }}>
          <div className="spinner-border text-primary" role="status" style={{ width: '3rem', height: '3rem' }}>
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="main-content">
        <div className="alert alert-danger d-flex align-items-center" role="alert">
          <i className="material-icons-outlined me-3">error_outline</i>
          <div>
            <h5 className="alert-heading">Error Loading Testbeds</h5>
            <p className="mb-0">{error}</p>
            <button className="btn btn-sm btn-danger mt-2" onClick={fetchTestbeds}>
              <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>refresh</i> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content">
      {/* Breadcrumb */}
      <div className="d-flex align-items-center justify-content-between mb-4">
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb mb-0">
            <li className="breadcrumb-item">
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>
                <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle' }}>home</i>
              </a>
            </li>
            <li className="breadcrumb-item active">My Testbeds</li>
          </ol>
        </nav>
        <button className="btn btn-primary" onClick={() => navigate('/deploy-new')}>
          <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4 }}>add</i>
          Deploy New Testbed
        </button>
      </div>

      <div className="card rounded-4 border-0 shadow-sm" style={{ overflow: 'hidden' }}>
        <div className="card-body p-5">
          {/* Header */}
          <div className="d-flex align-items-center justify-content-between mb-4">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #0078d4 0%, #005a9e 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0, 120, 212, 0.3)'
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 24 }}>dns</i>
                </div>
                <div>
                  <h2 className="mb-1" style={{ color: '#00008B', fontWeight: 700, fontSize: 32, letterSpacing: '-0.5px' }}>My Testbeds</h2>
                  <p className="text-muted mb-0" style={{ fontSize: 15 }}>Manage your onboarded testbeds</p>
                </div>
              </div>
            </div>
            <button className="btn btn-outline-primary" onClick={fetchTestbeds} style={{ borderRadius: 8, padding: '10px 20px', fontWeight: 600 }}>
              <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>refresh</i>
              Refresh
            </button>
          </div>

          {/* Empty State */}
          {testbeds.length === 0 ? (
            <div className="text-center py-5" style={{ padding: '60px 20px' }}>
              <div style={{
                width: 100,
                height: 100,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #e9ecef 0%, #dee2e6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <i className="material-icons-outlined text-muted" style={{ fontSize: 48 }}>dns</i>
              </div>
              <h4 className="mt-3 mb-2" style={{ fontWeight: 700, fontSize: 24, color: '#333' }}>No Testbeds Found</h4>
              <p className="text-muted mb-4" style={{ fontSize: 15 }}>Get started by onboarding an existing testbed or deploying a new one</p>
              <div className="d-flex gap-3 justify-content-center">
                <button className="btn btn-primary btn-lg" onClick={() => navigate('/onboarding')} style={{ borderRadius: 8, padding: '12px 24px', fontWeight: 600 }}>
                  <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>add_circle</i>
                  Onboard Existing
                </button>
                <button className="btn btn-outline-primary btn-lg" onClick={() => navigate('/deploy-new')} style={{ borderRadius: 8, padding: '12px 24px', fontWeight: 600 }}>
                  <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>rocket_launch</i>
                  Deploy New
                </button>
              </div>
            </div>
          ) : (
            /* Testbeds Table */
            <div className="table-responsive" style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #dee2e6' }}>
              <table className="table table-hover mb-0">
                <thead style={{ background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)' }}>
                  <tr>
                    <th style={{ fontWeight: 700, fontSize: 14, color: '#333', padding: '16px', borderBottom: '2px solid #dee2e6' }}>
                      <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6, color: '#0078d4' }}>label</i>
                      Testbed Name
                    </th>
                    <th style={{ fontWeight: 700, fontSize: 14, color: '#333', padding: '16px', borderBottom: '2px solid #dee2e6' }}>
                      <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6, color: '#0078d4' }}>computer</i>
                      PC IP
                    </th>
                    <th style={{ fontWeight: 700, fontSize: 14, color: '#333', padding: '16px', borderBottom: '2px solid #dee2e6' }}>
                      <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6, color: '#0078d4' }}>dns</i>
                      NCM IP
                    </th>
                    <th style={{ fontWeight: 700, fontSize: 14, color: '#333', padding: '16px', borderBottom: '2px solid #dee2e6' }}>
                      <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6, color: '#0078d4' }}>schedule</i>
                      Last Updated
                    </th>
                    <th style={{ fontWeight: 700, fontSize: 14, color: '#333', padding: '16px', borderBottom: '2px solid #dee2e6' }}>
                      <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6, color: '#0078d4' }}>check_circle</i>
                      Status
                    </th>
                    <th style={{ fontWeight: 700, fontSize: 14, color: '#333', padding: '16px', borderBottom: '2px solid #dee2e6', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {testbeds.map((testbed, idx) => (
                    <tr key={testbed.id} style={{ 
                      backgroundColor: idx % 2 === 0 ? '#fff' : '#f8f9fa',
                      transition: 'background-color 0.2s'
                    }}>
                      <td style={{ padding: '16px', verticalAlign: 'middle' }}>
                        <div className="d-flex align-items-center">
                          <div style={{
                            width: 44,
                            height: 44,
                            borderRadius: 10,
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginRight: 12,
                            boxShadow: '0 2px 6px rgba(102, 126, 234, 0.3)'
                          }}>
                            <i className="material-icons-outlined text-white" style={{ fontSize: 22 }}>dns</i>
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: '#212529', fontSize: 15 }}>{testbed.testbed_label}</div>
                            <div style={{ fontSize: 12, color: '#6c757d', marginTop: 2 }}>ID: {testbed.unique_testbed_id.slice(0, 8)}...</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '16px', verticalAlign: 'middle' }}>
                        <span className="font-monospace" style={{ fontSize: 14, color: '#333' }}>
                          {testbed.pc_ip || <span className="text-muted">N/A</span>}
                        </span>
                      </td>
                      <td style={{ padding: '16px', verticalAlign: 'middle' }}>
                        <span className="font-monospace" style={{ fontSize: 14, color: '#333' }}>
                          {testbed.ncm_ip || <span className="text-muted">Not deployed</span>}
                        </span>
                      </td>
                      <td style={{ padding: '16px', verticalAlign: 'middle', fontSize: 14, color: '#6c757d' }}>
                        {formatDate(testbed.timestamp)}
                      </td>
                      <td style={{ padding: '16px', verticalAlign: 'middle' }}>{getStatusBadge(testbed)}</td>
                      <td style={{ padding: '16px', verticalAlign: 'middle', textAlign: 'center' }}>
                        <div className="d-flex gap-2 justify-content-center">
                          <button
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => handleView(testbed)}
                            title="View Details"
                            style={{ borderRadius: 6, padding: '6px 12px' }}
                          >
                            <i className="material-icons-outlined" style={{ fontSize: 18 }}>visibility</i>
                          </button>
                          <button
                            className="btn btn-sm btn-outline-info"
                            onClick={() => navigate(`/testbed-timeline/${testbed.unique_testbed_id}`)}
                            title="View Activity Timeline"
                            style={{ borderRadius: 6, padding: '6px 12px' }}
                          >
                            <i className="material-icons-outlined" style={{ fontSize: 18 }}>timeline</i>
                          </button>
                          <button
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => navigate(`/testbed-activity/${testbed.unique_testbed_id}`)}
                            title="View Execution Reports"
                            style={{ borderRadius: 6, padding: '6px 12px' }}
                          >
                            <i className="material-icons-outlined" style={{ fontSize: 18 }}>assessment</i>
                          </button>
                          <button
                            className="btn btn-sm btn-outline-success"
                            onClick={() => handleConfigure(testbed)}
                            title="Configure Rules"
                            style={{ borderRadius: 6, padding: '6px 12px' }}
                          >
                            <i className="material-icons-outlined" style={{ fontSize: 18 }}>settings</i>
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => handleDelete(testbed)}
                            title="Delete Testbed"
                            disabled={deleteLoading === testbed.unique_testbed_id}
                            style={{ borderRadius: 6, padding: '6px 12px' }}
                          >
                            {deleteLoading === testbed.unique_testbed_id ? (
                              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                            ) : (
                              <i className="material-icons-outlined" style={{ fontSize: 18 }}>delete</i>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary Info */}
          {testbeds.length > 0 && (
            <div className="mt-4" style={{ 
              background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
              borderRadius: 12,
              padding: 24,
              border: '1px solid #dee2e6'
            }}>
              <div className="row row-cols-1 row-cols-md-3 g-4">
                <div className="col">
                  <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 10, background: '#fff' }}>
                    <div className="card-body p-4">
                      <div className="d-flex align-items-center gap-3">
                        <div style={{
                          width: 56,
                          height: 56,
                          borderRadius: 12,
                          background: 'linear-gradient(135deg, #0078d4 0%, #005a9e 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 2px 8px rgba(0, 120, 212, 0.3)'
                        }}>
                          <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>dns</i>
                        </div>
                        <div>
                          <div style={{ fontSize: 32, fontWeight: 700, color: '#0078d4', lineHeight: 1 }}>{testbeds.length}</div>
                          <div style={{ fontSize: 14, color: '#6c757d', fontWeight: 500, marginTop: 4 }}>Total Testbeds</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col">
                  <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 10, background: '#fff' }}>
                    <div className="card-body p-4">
                      <div className="d-flex align-items-center gap-3">
                        <div style={{
                          width: 56,
                          height: 56,
                          borderRadius: 12,
                          background: 'linear-gradient(135deg, #28a745 0%, #1e7e34 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 2px 8px rgba(40, 167, 69, 0.3)'
                        }}>
                          <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>check_circle</i>
                        </div>
                        <div>
                          <div style={{ fontSize: 32, fontWeight: 700, color: '#28a745', lineHeight: 1 }}>
                            {testbeds.filter(t => t.ncm_ip).length}
                          </div>
                          <div style={{ fontSize: 14, color: '#6c757d', fontWeight: 500, marginTop: 4 }}>Active</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col">
                  <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 10, background: '#fff' }}>
                    <div className="card-body p-4">
                      <div className="d-flex align-items-center gap-3">
                        <div style={{
                          width: 56,
                          height: 56,
                          borderRadius: 12,
                          background: 'linear-gradient(135deg, #fd7e14 0%, #e85d00 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 2px 8px rgba(253, 126, 20, 0.3)'
                        }}>
                          <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>pending</i>
                        </div>
                        <div>
                          <div style={{ fontSize: 32, fontWeight: 700, color: '#fd7e14', lineHeight: 1 }}>
                            {testbeds.filter(t => !t.ncm_ip).length}
                          </div>
                          <div style={{ fontSize: 14, color: '#6c757d', fontWeight: 500, marginTop: 4 }}>Pending</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MyTestbeds;
