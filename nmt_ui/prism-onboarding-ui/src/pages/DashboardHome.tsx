import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { IS_FAKE_MODE } from '../config/fakeMode';
import { getFakeTestbeds, getFakeAlerts, getFakeExecutions } from '../fake-data';
import { getApiBase } from '../utils/backendUrl';

interface DashboardStats {
  totalTestbeds: number;
  savedRules: number;
  alertsToday: number;
  alertsBySeverity: {
    Critical: number;
    Moderate: number;
    Low: number;
  };
}

interface RecentActivity {
  type: 'testbed' | 'alert';
  title: string;
  subtitle: string;
  timestamp: Date;
  icon: string;
  color: string;
}

const DashboardHome: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({
    totalTestbeds: 0,
    savedRules: 0,
    alertsToday: 0,
    alertsBySeverity: { Critical: 0, Moderate: 0, Low: 0 }
  });
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // FAKE DATA MODE
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 600));
        const testbedsData = getFakeTestbeds();
        const alertsData = getFakeAlerts();
        const executionsData = getFakeExecutions();
        
        const today = new Date().toISOString().split('T')[0];
        const allAlerts = alertsData.alerts || [];
        const alertsToday = allAlerts.filter((alert: any) => {
          if (!alert.triggered_at) return false;
          const alertDate = new Date(alert.triggered_at).toISOString().split('T')[0];
          return alertDate === today;
        });
        
        const severityCounts = { Critical: 0, Moderate: 0, Low: 0 };
        allAlerts.forEach((alert: any) => {
          const sev = alert.severity === 'critical' ? 'Critical' : alert.severity === 'warning' ? 'Moderate' : 'Low';
          severityCounts[sev as keyof typeof severityCounts]++;
        });
        
        setStats({
          totalTestbeds: testbedsData.testbeds.length,
          savedRules: 10, // From fake rules
          alertsToday: alertsToday.length,
          alertsBySeverity: severityCounts
        });
        
        const activities: RecentActivity[] = [];
        testbedsData.testbeds.slice(0, 3).forEach((tb: any) => {
          activities.push({
            type: 'testbed',
            title: `Testbed Configured: ${tb.testbed_label}`,
            subtitle: `PC IP: ${tb.pc_ip}`,
            timestamp: new Date(tb.timestamp),
            icon: 'dns',
            color: '#0078d4'
          });
        });
        allAlerts.slice(0, 3).forEach((alert: any) => {
          activities.push({
            type: 'alert',
            title: alert.alert_name,
            subtitle: alert.message,
            timestamp: new Date(alert.triggered_at),
            icon: 'warning',
            color: alert.severity === 'critical' ? '#d83b01' : '#ff8c00'
          });
        });
        setRecentActivity(activities);
        setLoading(false);
        return;
      }

      // Always use localhost:5000 for backend in development
      const backendUrl = getApiBase();
      
      console.log('Fetching dashboard data from:', backendUrl);

      // Fetch testbeds
      const testbedsRes = await fetch(`${backendUrl}/api/get-testbeds`);
      console.log('Testbeds response status:', testbedsRes.status);
      
      if (!testbedsRes.ok) {
        throw new Error(`Testbeds API returned ${testbedsRes.status}`);
      }
      
      const testbedsData = await testbedsRes.json();
      console.log('Testbeds data:', testbedsData);
      
      // Fetch alerts
      const alertsRes = await fetch(`${backendUrl}/api/alerts`);
      console.log('Alerts response status:', alertsRes.status);
      
      if (!alertsRes.ok) {
        throw new Error(`Alerts API returned ${alertsRes.status}`);
      }
      
      const alertsData = await alertsRes.json();
      console.log('Alerts data:', alertsData);

      // Calculate today's date in UTC
      const today = new Date().toISOString().split('T')[0];
      const allAlerts = alertsData.alerts || [];
      const alertsToday = allAlerts.filter((alert: any) => {
        if (!alert.timestamp) return false;
        const alertDate = new Date(alert.timestamp).toISOString().split('T')[0];
        return alertDate === today;
      });

      // Calculate severity distribution
      const severityCounts = {
        Critical: 0,
        Moderate: 0,
        Low: 0
      };
      allAlerts.forEach((alert: any) => {
        if (alert.severity in severityCounts) {
          severityCounts[alert.severity as keyof typeof severityCounts]++;
        }
      });

      // Count unique rules (from testbeds or separate endpoint if available)
      const allTestbeds = testbedsData.testbeds || [];
      const uniqueRuleCount = allTestbeds.length;

      console.log('Setting stats:', {
        totalTestbeds: allTestbeds.length,
        savedRules: uniqueRuleCount,
        alertsToday: alertsToday.length,
        alertsBySeverity: severityCounts
      });

      setStats({
        totalTestbeds: allTestbeds.length,
        savedRules: uniqueRuleCount,
        alertsToday: alertsToday.length,
        alertsBySeverity: severityCounts
      });

      // Build recent activity (last 5 testbeds + last 5 alerts)
      const activities: RecentActivity[] = [];

      // Add testbeds
      const sortedTestbeds = [...allTestbeds]
        .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 3);

      sortedTestbeds.forEach((testbed: any) => {
        activities.push({
          type: 'testbed',
          title: `Testbed Configured: ${testbed.testbed_label}`,
          subtitle: `PC IP: ${testbed.pc_ip || 'N/A'}`,
          timestamp: new Date(testbed.timestamp),
          icon: 'dns',
          color: '#0078d4'
        });
      });

      // Add alerts
      const sortedAlerts = [...allAlerts]
        .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 3);

      sortedAlerts.forEach((alert: any) => {
        activities.push({
          type: 'alert',
          title: `Alert: ${alert.ruleName}`,
          subtitle: `${alert.severity} - ${alert.testbed || 'Unknown testbed'}`,
          timestamp: new Date(alert.timestamp),
          icon: 'notifications_active',
          color: alert.severity === 'Critical' ? '#dc3545' : alert.severity === 'Moderate' ? '#fd7e14' : '#28a745'
        });
      });

      // Sort combined activities by timestamp
      activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      setRecentActivity(activities.slice(0, 5));

      console.log('Dashboard data loaded successfully');

    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load dashboard data: ${errorMessage}. Ensure the backend is reachable (same host as this page, or set VITE_API_BASE_URL).`);
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '80vh' }}>
        <div className="spinner-border text-primary" role="status" style={{ width: '3rem', height: '3rem' }}>
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger d-flex align-items-center" role="alert">
          <i className="material-icons-outlined me-3">error_outline</i>
          <div>
            <h5 className="alert-heading">Connection Error</h5>
            <p className="mb-0">{error}</p>
            <button className="btn btn-sm btn-danger mt-2" onClick={fetchDashboardData}>
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
      <div className="d-flex align-items-center mb-4">
        <div>
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-0">
              <li className="breadcrumb-item">
                <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>
                  <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle' }}>home</i>
                </a>
              </li>
              <li className="breadcrumb-item active">Dashboard</li>
            </ol>
          </nav>
        </div>
      </div>

      {/* Summary Statistics Cards */}
      <div className="row row-cols-1 row-cols-md-2 row-cols-xl-4 g-3 mb-4">
        {/* Total Testbeds Card */}
        <div className="col">
          <div className="card rounded-4 border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center gap-3">
                <div className="flex-shrink-0">
                  <div style={{
                    width: 50,
                    height: 50,
                    borderRadius: 12,
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>dns</i>
                  </div>
                </div>
                <div className="flex-grow-1">
                  <p className="mb-0 text-muted" style={{ fontSize: 13 }}>Total Testbeds</p>
                  <h3 className="mb-0 mt-1" style={{ fontWeight: 700 }}>{stats.totalTestbeds}</h3>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Saved Rules Card */}
        <div className="col">
          <div className="card rounded-4 border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center gap-3">
                <div className="flex-shrink-0">
                  <div style={{
                    width: 50,
                    height: 50,
                    borderRadius: 12,
                    background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>rule</i>
                  </div>
                </div>
                <div className="flex-grow-1">
                  <p className="mb-0 text-muted" style={{ fontSize: 13 }}>Saved Rules</p>
                  <h3 className="mb-0 mt-1" style={{ fontWeight: 700 }}>{stats.savedRules}</h3>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Alerts Today Card */}
        <div className="col">
          <div className="card rounded-4 border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center gap-3">
                <div className="flex-shrink-0">
                  <div style={{
                    width: 50,
                    height: 50,
                    borderRadius: 12,
                    background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>notifications_active</i>
                  </div>
                </div>
                <div className="flex-grow-1">
                  <p className="mb-0 text-muted" style={{ fontSize: 13 }}>Alerts Today</p>
                  <h3 className="mb-0 mt-1" style={{ fontWeight: 700 }}>{stats.alertsToday}</h3>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Total Alerts Card */}
        <div className="col">
          <div className="card rounded-4 border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center gap-3">
                <div className="flex-shrink-0">
                  <div style={{
                    width: 50,
                    height: 50,
                    borderRadius: 12,
                    background: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>notification_important</i>
                  </div>
                </div>
                <div className="flex-grow-1">
                  <p className="mb-0 text-muted" style={{ fontSize: 13 }}>Total Alerts</p>
                  <h3 className="mb-0 mt-1" style={{ fontWeight: 700 }}>
                    {stats.alertsBySeverity.Critical + stats.alertsBySeverity.Moderate + stats.alertsBySeverity.Low}
                  </h3>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Row */}
      <div className="row g-3">
        {/* Recent Activity */}
        <div className="col-12 col-xl-8">
          <div className="card rounded-4 border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h5 className="mb-0 fw-bold">Recent Activity</h5>
                <button className="btn btn-sm btn-outline-primary" onClick={fetchDashboardData}>
                  <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>refresh</i>
                </button>
              </div>

              {recentActivity.length === 0 ? (
                <div className="text-center py-5">
                  <i className="material-icons-outlined text-muted" style={{ fontSize: 64 }}>inbox</i>
                  <p className="text-muted mt-3 mb-0">No recent activity yet</p>
                  <p className="text-muted small">Start by onboarding a testbed or configuring rules</p>
                  <button className="btn btn-primary mt-3" onClick={() => navigate('/onboarding')}>
                    <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>add_circle</i>
                    Onboard Now
                  </button>
                </div>
              ) : (
                <ul className="list-group list-group-flush">
                  {recentActivity.map((activity, idx) => (
                    <li key={idx} className="list-group-item px-0 bg-transparent">
                      <div className="d-flex align-items-center gap-3">
                        <div style={{
                          width: 42,
                          height: 42,
                          borderRadius: 8,
                          background: `${activity.color}20`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <i className="material-icons-outlined" style={{ color: activity.color, fontSize: 24 }}>
                            {activity.icon}
                          </i>
                        </div>
                        <div className="flex-grow-1">
                          <h6 className="mb-0" style={{ fontSize: 14, fontWeight: 600 }}>{activity.title}</h6>
                          <p className="mb-0 text-muted" style={{ fontSize: 13 }}>{activity.subtitle}</p>
                        </div>
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          {formatTimestamp(activity.timestamp)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Alert Severity Distribution */}
        <div className="col-12 col-xl-4">
          <div className="card rounded-4 border-0 shadow-sm">
            <div className="card-body">
              <h5 className="mb-3 fw-bold">Alert Distribution</h5>
              
              {(stats.alertsBySeverity.Critical + stats.alertsBySeverity.Moderate + stats.alertsBySeverity.Low) === 0 ? (
                <div className="text-center py-4">
                  <i className="material-icons-outlined text-success" style={{ fontSize: 64 }}>check_circle</i>
                  <p className="text-muted mt-3 mb-0">No alerts recorded</p>
                  <p className="text-muted small">Your system is healthy!</p>
                </div>
              ) : (
                <div className="d-flex flex-column gap-3">
                  {/* Critical */}
                  <div>
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <span className="d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-danger" style={{ fontSize: 18 }}>fiber_manual_record</i>
                        <span style={{ fontWeight: 500 }}>Critical</span>
                      </span>
                      <span className="fw-bold">{stats.alertsBySeverity.Critical}</span>
                    </div>
                    <div className="progress" style={{ height: 8 }}>
                      <div 
                        className="progress-bar bg-danger" 
                        style={{ 
                          width: `${(stats.alertsBySeverity.Critical / (stats.alertsBySeverity.Critical + stats.alertsBySeverity.Moderate + stats.alertsBySeverity.Low)) * 100}%` 
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Moderate */}
                  <div>
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <span className="d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-warning" style={{ fontSize: 18 }}>fiber_manual_record</i>
                        <span style={{ fontWeight: 500 }}>Moderate</span>
                      </span>
                      <span className="fw-bold">{stats.alertsBySeverity.Moderate}</span>
                    </div>
                    <div className="progress" style={{ height: 8 }}>
                      <div 
                        className="progress-bar bg-warning" 
                        style={{ 
                          width: `${(stats.alertsBySeverity.Moderate / (stats.alertsBySeverity.Critical + stats.alertsBySeverity.Moderate + stats.alertsBySeverity.Low)) * 100}%` 
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Low */}
                  <div>
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <span className="d-flex align-items-center gap-2">
                        <i className="material-icons-outlined text-success" style={{ fontSize: 18 }}>fiber_manual_record</i>
                        <span style={{ fontWeight: 500 }}>Low</span>
                      </span>
                      <span className="fw-bold">{stats.alertsBySeverity.Low}</span>
                    </div>
                    <div className="progress" style={{ height: 8 }}>
                      <div 
                        className="progress-bar bg-success" 
                        style={{ 
                          width: `${(stats.alertsBySeverity.Low / (stats.alertsBySeverity.Critical + stats.alertsBySeverity.Moderate + stats.alertsBySeverity.Low)) * 100}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="row g-3 mt-2">
        <div className="col-12">
          <div className="card rounded-4 border-0 shadow-sm">
            <div className="card-body">
              <h5 className="mb-3 fw-bold">Quick Actions</h5>
              <div className="row row-cols-2 row-cols-md-5 g-3">
                <div className="col">
                  <button 
                    className="btn btn-outline-success w-100 d-flex flex-column align-items-center gap-2 py-3"
                    onClick={() => navigate('/deploy-new')}
                    style={{ borderRadius: 12 }}
                  >
                    <i className="material-icons-outlined" style={{ fontSize: 32 }}>rocket_launch</i>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Deploy New</span>
                  </button>
                </div>
                <div className="col">
                  <button 
                    className="btn btn-outline-primary w-100 d-flex flex-column align-items-center gap-2 py-3"
                    onClick={() => navigate('/onboarding')}
                    style={{ borderRadius: 12 }}
                  >
                    <i className="material-icons-outlined" style={{ fontSize: 32 }}>add_circle_outline</i>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Onboard Existing</span>
                  </button>
                </div>
                <div className="col">
                  <button 
                    className="btn btn-outline-info w-100 d-flex flex-column align-items-center gap-2 py-3"
                    onClick={() => navigate('/my-testbeds')}
                    style={{ borderRadius: 12 }}
                  >
                    <i className="material-icons-outlined" style={{ fontSize: 32 }}>dns</i>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>My Testbeds</span>
                  </button>
                </div>
                <div className="col">
                  <button 
                    className="btn btn-outline-danger w-100 d-flex flex-column align-items-center gap-2 py-3"
                    onClick={() => navigate('/alert-summary')}
                    style={{ borderRadius: 12 }}
                  >
                    <i className="material-icons-outlined" style={{ fontSize: 32 }}>notifications_active</i>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>View Alerts</span>
                  </button>
                </div>
                <div className="col">
                  <button 
                    className="btn btn-outline-warning w-100 d-flex flex-column align-items-center gap-2 py-3"
                    onClick={() => navigate('/status')}
                    style={{ borderRadius: 12 }}
                  >
                    <i className="material-icons-outlined" style={{ fontSize: 32 }}>show_chart</i>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>View Status</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Empty State Guidance */}
      {stats.totalTestbeds === 0 && (
        <div className="row mt-4">
          <div className="col-12">
            <div className="alert alert-info d-flex align-items-start" role="alert">
              <i className="material-icons-outlined me-3" style={{ fontSize: 32 }}>info</i>
              <div className="flex-grow-1">
                <h5 className="alert-heading mb-2">Welcome to NCM Monitoring Tool!</h5>
                <p className="mb-3">Get started by deploying a new testbed or onboarding your existing testbed.</p>
                <div className="d-flex gap-2">
                  <button className="btn btn-sm btn-success" onClick={() => navigate('/deploy-new')}>
                    <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>rocket_launch</i>
                    Deploy New Testbed
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => navigate('/onboarding')}>
                    <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>add_circle</i>
                    Onboard Existing
                  </button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate('/my-testbeds')}>
                    <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>dns</i>
                    View My Testbeds
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper function outside component
function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

export default DashboardHome;
