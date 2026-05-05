import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ntnxLogo from '../assets/new_nutanix_logo.png';
import { getApiBase } from '../utils/backendUrl';

interface LayoutProps {
  children: React.ReactNode;
}

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/dashboard': 'Dashboard',
  '/deploy-new': 'Deploy New Testbed',
  '/onboarding': 'Onboard Testbed',
  '/my-testbeds': 'My Testbeds',
  '/testbeds': 'My Testbeds',
  '/rule-config-manager': 'Rule & Config Manager', // disabled from sidebar but route kept for backward compat
  '/alert-summary': 'Alert Summary',
  '/alert-configuration': 'Alert Configuration',
  '/smart-execution': 'Smart Execution',
  '/smart-execution/configure': 'Smart Execution',
  '/smart-execution/history': 'Execution History',
  '/scheduled-executions': 'Scheduled Executions',
  '/ml-insights': 'ML Insights',
  '/analytics/dashboard': 'Analytics Dashboard',
  '/analytics/comparison': 'Execution Comparison',
  '/analytics/executive-summary': 'Executive Summary',
  '/execution-workload-manager': 'Execution Workload',
  '/dynamic-workload': 'Dynamic Workload',
  '/status': 'Status & Monitoring',
};

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [alertCount, setAlertCount] = useState<number>(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    const fetchAlertCount = async () => {
      try {
        const backendUrl = getApiBase();
        const res = await fetch(`${backendUrl}/api/alerts`);
        if (res.ok) {
          const data = await res.json();
          setAlertCount(data.count || 0);
        }
      } catch { /* keep count at 0 */ }
    };
    fetchAlertCount();
    const interval = setInterval(fetchAlertCount, 60000);
    return () => clearInterval(interval);
  }, []);

  const isActive = (path: string) => location.pathname === path;
  const pageTitle = PAGE_TITLES[location.pathname]
    || (location.pathname.startsWith('/smart-execution/monitor') ? 'Live Monitor'
    : location.pathname.startsWith('/smart-execution/report') ? 'Execution Report'
    : location.pathname.startsWith('/multi-testbed') ? 'Multi-Testbed'
    : '');

  const navItem = (path: string, icon: string, label: string, activePaths?: string[]) => (
    <li key={path}>
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); navigate(path); }}
        className={activePaths ? (activePaths.some(p => isActive(p)) ? 'active' : '') : (isActive(path) ? 'active' : '')}
      >
        <i className="material-icons-outlined">{icon}</i>
        <span>{label}</span>
      </a>
    </li>
  );

  return (
    <>
      {/* Sidebar */}
      <aside className={`sidebar-wrapper ${!sidebarOpen ? 'closed' : ''}`}>
        <div className="sidebar-header">
          <img src={ntnxLogo} alt="Nutanix Logo" style={{ width: 38, height: 38 }} />
          <div>
            <h5 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-primary-hover)' }}>NCM Monitoring</h5>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Tool</p>
          </div>
        </div>

        <div className="sidebar-nav">
          <ul>
            {navItem('/dashboard', 'dashboard', 'Dashboard', ['/', '/dashboard'])}

            <li className="menu-label">TESTBEDS</li>
            {navItem('/deploy-new', 'rocket_launch', 'Deploy New')}
            {navItem('/onboarding', 'add_circle_outline', 'Onboard Existing')}
            {navItem('/my-testbeds', 'dns', 'My Testbeds', ['/my-testbeds', '/testbeds'])}

            <li className="menu-label">MONITORING</li>
            {navItem('/alert-summary', 'notifications_active', 'Alert Summary')}
            {navItem('/alert-configuration', 'tune', 'Alert Configuration')}
            {navItem('/status', 'show_chart', 'Status & Health')}

            <li className="menu-label">SMART EXECUTION</li>
            {navItem('/smart-execution', 'psychology', 'Configure & Run', ['/smart-execution', '/smart-execution/configure'])}
            {navItem('/smart-execution/history', 'history', 'Execution History')}
            {navItem('/scheduled-executions', 'event', 'Scheduled')}
            {navItem('/ml-insights', 'model_training', 'ML Insights')}

            <li className="menu-label">ANALYTICS</li>
            {navItem('/analytics/dashboard', 'insights', 'Analytics Dashboard')}
            {navItem('/analytics/comparison', 'compare', 'Comparison')}
            {navItem('/analytics/executive-summary', 'summarize', 'Executive Summary')}

            {/* Collapsible Advanced section */}
            <li className="menu-label" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setAdvancedOpen(!advancedOpen)}>
              <span className="d-flex align-items-center justify-content-between w-100">
                ADVANCED
                <i className="material-icons-outlined" style={{ fontSize: 16, transition: 'transform 200ms', transform: advancedOpen ? 'rotate(180deg)' : 'rotate(0)' }}>expand_more</i>
              </span>
            </li>
            {advancedOpen && (
              <>
                {navItem('/execution-workload-manager', 'play_circle', 'Execution Workload')}
                {navItem('/dynamic-workload', 'trending_up', 'Dynamic Workload')}
              </>
            )}
          </ul>
        </div>
      </aside>

      {/* Top Header */}
      <header className={`top-header ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        <div className="btn-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
          <i className="material-icons-outlined">menu</i>
        </div>

        <div style={{ flexGrow: 1, marginLeft: 'var(--space-5)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text)' }}>
            {pageTitle || 'NCM Monitoring Tool'}
          </span>
        </div>

        {/* Notification Bell */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div
            style={{ position: 'relative', cursor: 'pointer', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', transition: 'background var(--transition-fast)' }}
            onClick={() => navigate('/alert-summary')}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <i className="material-icons-outlined" style={{ fontSize: 22, color: 'var(--color-text-secondary)' }}>notifications</i>
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
