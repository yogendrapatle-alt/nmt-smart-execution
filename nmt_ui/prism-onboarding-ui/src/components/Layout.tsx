import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ntnxLogo from '../assets/new_nutanix_logo.png';
import { getApiBase } from '../utils/backendUrl';

interface LayoutProps {
  children: React.ReactNode;
}

const PAGE_BREADCRUMBS: Record<string, { section?: string; page: string }> = {
  '/': { page: 'Dashboard' },
  '/dashboard': { page: 'Dashboard' },
  '/onboarding': { section: 'Testbeds', page: 'Onboard' },
  '/my-testbeds': { section: 'Testbeds', page: 'My Testbeds' },
  '/testbeds': { section: 'Testbeds', page: 'My Testbeds' },
  '/rule-config-manager': { section: 'Monitoring', page: 'Rule & Config Manager' },
  '/alert-summary': { section: 'Monitoring', page: 'Alert Summary' },
  '/alert-configuration': { section: 'Monitoring', page: 'Alert Configuration' },
  '/monitor-only': { section: 'Monitoring', page: 'Monitor-Only Testbed' },
  '/monitor-only/configure': { section: 'Monitoring', page: 'Monitor-Only Testbed' },
  '/monitor-only/sessions': { section: 'Monitoring', page: 'Monitor Sessions' },
  '/smart-execution': { section: 'Smart Execution', page: 'Configure & Run' },
  '/smart-execution/configure': { section: 'Smart Execution', page: 'Configure & Run' },
  '/smart-execution/history': { section: 'Smart Execution', page: 'Execution History' },
  '/scheduled-executions': { section: 'Smart Execution', page: 'Scheduled' },
  '/ml-insights': { section: 'Smart Execution', page: 'ML Insights' },
  '/analytics/dashboard': { section: 'Analytics', page: 'Dashboard' },
  '/analytics/comparison': { section: 'Analytics', page: 'Comparison' },
  '/analytics/executive-summary': { section: 'Analytics', page: 'Executive Summary' },
  '/status': { section: 'Monitoring', page: 'Status & Health' },
};

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [alertCount, setAlertCount] = useState<number>(0);

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
  const crumb = PAGE_BREADCRUMBS[location.pathname]
    || (location.pathname.startsWith('/smart-execution/monitor') ? { section: 'Smart Execution', page: 'Live Monitor' }
    : location.pathname.startsWith('/smart-execution/report') ? { section: 'Smart Execution', page: 'Execution Report' }
    : location.pathname.startsWith('/monitor-only/run') ? { section: 'Monitoring', page: 'Live Monitor' }
    : location.pathname.startsWith('/monitor-only/report') ? { section: 'Monitoring', page: 'Monitor Report' }
    : location.pathname.startsWith('/multi-testbed') ? { section: 'Testbeds', page: 'Multi-Testbed' }
    : null);

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
            {navItem('/onboarding', 'add_circle_outline', 'Onboard')}
            {navItem('/my-testbeds', 'dns', 'My Testbeds', ['/my-testbeds', '/testbeds'])}

            <li className="menu-label">MONITORING</li>
            {navItem('/alert-summary', 'notifications_active', 'Alert Summary')}
            {navItem('/alert-configuration', 'tune', 'Alert Configuration')}
            {navItem('/monitor-only', 'visibility', 'Monitor-Only Testbed', ['/monitor-only', '/monitor-only/configure'])}
            {navItem('/monitor-only/sessions', 'list_alt', 'Monitor Sessions')}
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
          </ul>
        </div>
      </aside>

      {/* Top Header */}
      <header className={`top-header ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        <div className="btn-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
          <i className="material-icons-outlined">menu</i>
        </div>

        <nav style={{ flexGrow: 1, marginLeft: 'var(--space-5)', display: 'flex', alignItems: 'center' }} aria-label="breadcrumb">
          <ol style={{ display: 'flex', alignItems: 'center', gap: 0, listStyle: 'none', margin: 0, padding: 0, fontSize: 'var(--text-sm)' }}>
            <li>
              <a href="#" onClick={e => { e.preventDefault(); navigate('/dashboard'); }}
                style={{ color: 'var(--color-text-muted)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                <i className="material-icons-outlined" style={{ fontSize: 16 }}>home</i>
                Home
              </a>
            </li>
            {crumb?.section && (
              <li style={{ display: 'flex', alignItems: 'center' }}>
                <i className="material-icons-outlined" style={{ fontSize: 16, color: 'var(--color-text-muted)', margin: '0 6px' }}>chevron_right</i>
                <span style={{ color: 'var(--color-text-muted)' }}>{crumb.section}</span>
              </li>
            )}
            {crumb?.page && (
              <li style={{ display: 'flex', alignItems: 'center' }}>
                <i className="material-icons-outlined" style={{ fontSize: 16, color: 'var(--color-text-muted)', margin: '0 6px' }}>chevron_right</i>
                <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{crumb.page}</span>
              </li>
            )}
          </ol>
        </nav>

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
