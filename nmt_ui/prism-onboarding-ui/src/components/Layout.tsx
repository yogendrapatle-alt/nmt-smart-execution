import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ntnxLogo from '../assets/new_nutanix_logo.png';
import { getApiBase } from '../utils/backendUrl';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [alertCount, setAlertCount] = useState<number>(0);

  // Fetch alert count for notification badge
  useEffect(() => {
    const fetchAlertCount = async () => {
      try {
        // Always use localhost:5000 for backend in development
        const backendUrl = getApiBase();
        const res = await fetch(`${backendUrl}/api/alerts`);
        if (res.ok) {
          const data = await res.json();
          setAlertCount(data.count || 0);
        }
      } catch {
        // Don't show error to user - just keep count at 0
      }
    };
    fetchAlertCount();
    // Refresh every 60 seconds
    const interval = setInterval(fetchAlertCount, 60000);
    return () => clearInterval(interval);
  }, []);

  const isActivePath = (path: string) => {
    return location.pathname === path;
  };

  return (
    <>
      {/* Sidebar */}
      <aside className={`sidebar-wrapper ${!sidebarOpen ? 'closed' : ''}`}>
        <div className="sidebar-header">
          <img src={ntnxLogo} alt="Nutanix Logo" style={{ width: 40, height: 40 }} />
          <div>
            <h5 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#00008B' }}>NCM Monitoring</h5>
            <p style={{ margin: 0, fontSize: 11, color: '#6c757d' }}>Tool</p>
          </div>
        </div>

        <div className="sidebar-nav">
          <ul>
            {/* Dashboard */}
            <li>
              <a 
                href="#" 
                onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}
                className={isActivePath('/dashboard') || isActivePath('/') ? 'active' : ''}
              >
                <i className="material-icons-outlined">dashboard</i>
                <span>Dashboard</span>
              </a>
            </li>

            <li className="menu-label">TESTBED SETUP</li>

            {/* Deploy New Testbed */}
            <li>
              <a 
                href="#" 
                onClick={(e) => { e.preventDefault(); navigate('/deploy-new'); }}
                className={isActivePath('/deploy-new') ? 'active' : ''}
              >
                <i className="material-icons-outlined">rocket_launch</i>
                <span>Deploy New Testbed</span>
              </a>
            </li>

            {/* Onboard Existing Testbed */}
            <li>
              <a 
                href="#" 
                onClick={(e) => { e.preventDefault(); navigate('/onboarding'); }}
                className={isActivePath('/onboarding') ? 'active' : ''}
              >
                <i className="material-icons-outlined">add_circle_outline</i>
                <span>Onboard Existing</span>
              </a>
            </li>

            {/* My Testbeds */}
            <li>
              <a 
                href="#" 
                onClick={(e) => { e.preventDefault(); navigate('/my-testbeds'); }}
                className={isActivePath('/my-testbeds') || isActivePath('/testbeds') ? 'active' : ''}
              >
                <i className="material-icons-outlined">dns</i>
                <span>My Testbeds</span>
              </a>
            </li>

            <li className="menu-label">MONITORING & ALERTS</li>

            {/* Rules & Configuration */}
            <li>
              <a 
                href="#" 
                onClick={(e) => { e.preventDefault(); navigate('/rule-config-manager'); }}
                className={isActivePath('/rule-config-manager') || isActivePath('/rulebuilder-experimental') || isActivePath('/rulebuilder') ? 'active' : ''}
              >
                <i className="material-icons-outlined">rule</i>
                <span>Rule & Config Manager</span>
              </a>
            </li>

            {/* Alert Summary */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/alert-summary'); }} className={isActivePath('/alert-summary') ? 'active' : ''}>
                <i className="material-icons-outlined">notifications_active</i>
                <span>Alert Summary</span>
              </a>
            </li>

            {/* Alert Configuration */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/alert-configuration'); }} className={isActivePath('/alert-configuration') ? 'active' : ''}>
                <i className="material-icons-outlined">tune</i>
                <span>Alert Configuration</span>
              </a>
            </li>

            <li className="menu-label">EXECUTION</li>

            {/* Smart Execution - Threshold-Based */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/smart-execution'); }} className={isActivePath('/smart-execution') || isActivePath('/smart-execution/configure') ? 'active' : ''}>
                <i className="material-icons-outlined">psychology</i>
                <span>Smart Execution</span>
              </a>
            </li>

            {/* Smart Execution History */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/smart-execution/history'); }} className={isActivePath('/smart-execution/history') ? 'active' : ''}>
                <i className="material-icons-outlined">history</i>
                <span>Execution History</span>
              </a>
            </li>

            {/* Scheduled Executions */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/scheduled-executions'); }} className={isActivePath('/scheduled-executions') ? 'active' : ''}>
                <i className="material-icons-outlined">event</i>
                <span>Scheduled Executions</span>
              </a>
            </li>

            {/* ML Insights */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/ml-insights'); }} className={isActivePath('/ml-insights') ? 'active' : ''}>
                <i className="material-icons-outlined">model_training</i>
                <span>ML Insights</span>
              </a>
            </li>

            <li className="menu-label">ANALYTICS</li>

            {/* Analytics Dashboard */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/analytics/dashboard'); }} className={isActivePath('/analytics/dashboard') ? 'active' : ''}>
                <i className="material-icons-outlined">insights</i>
                <span>Analytics Dashboard</span>
              </a>
            </li>

            {/* Execution Comparison */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/analytics/comparison'); }} className={isActivePath('/analytics/comparison') ? 'active' : ''}>
                <i className="material-icons-outlined">compare</i>
                <span>Execution Comparison</span>
              </a>
            </li>

            {/* Executive Summary */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/analytics/executive-summary'); }} className={isActivePath('/analytics/executive-summary') ? 'active' : ''}>
                <i className="material-icons-outlined">summarize</i>
                <span>Executive Summary</span>
              </a>
            </li>

            <li className="menu-label">ADVANCED</li>

            {/* Execution Workload Manager */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/execution-workload-manager'); }} className={isActivePath('/execution-workload-manager') ? 'active' : ''}>
                <i className="material-icons-outlined">play_circle</i>
                <span>Execution Workload</span>
              </a>
            </li>

            {/* Dynamic Workload (Legacy) */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dynamic-workload'); }} className={isActivePath('/dynamic-workload') ? 'active' : ''}>
                <i className="material-icons-outlined">trending_up</i>
                <span>Dynamic Workload</span>
              </a>
            </li>

            {/* Status & Monitoring */}
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/status'); }} className={isActivePath('/status') ? 'active' : ''}>
                <i className="material-icons-outlined">show_chart</i>
                <span>Status & Monitoring</span>
              </a>
            </li>
          </ul>
        </div>
      </aside>

      {/* Top Header */}
      <header className={`top-header ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        <div className="btn-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
          <i className="material-icons-outlined">menu</i>
        </div>

        <div style={{ flexGrow: 1, marginLeft: 20 }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: '#00008B' }}>NCM Monitoring Tool</span>
        </div>

        {/* Notification Bell */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div 
            style={{ position: 'relative', cursor: 'pointer', padding: 8 }}
            onClick={() => navigate('/alert-summary')}
          >
            <i className="material-icons-outlined" style={{ fontSize: 24, color: '#6c757d' }}>notifications</i>
            {alertCount > 0 && (
              <span className="badge-notify">
                {alertCount > 99 ? '99+' : alertCount}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={`main-wrapper ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        {children}
      </main>
    </>
  );
};

export default Layout;
