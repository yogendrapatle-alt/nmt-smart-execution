import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

import Layout from './components/Layout';
import DashboardHome from './pages/DashboardHome';
import { ToastProvider } from './context/ToastContext';

const Onboarding = React.lazy(() => import('./components/Onboarding'));
const OnboardingExperimental = React.lazy(() => import('./components/OnboardingExperimental'));
const MyTestbeds = React.lazy(() => import('./pages/MyTestbeds'));
const DeployNew = React.lazy(() => import('./pages/DeployNew'));
const RuleBuilderExperimental = React.lazy(() => import('./components/RuleBuilderExperimental'));
const EnvironmentSelect = React.lazy(() => import('./pages/TestbedConfiguration'));
const RuleBuilder = React.lazy(() => import('./components/RuleBuilder'));
const AlertSummary = React.lazy(() => import('./components/AlertSummary'));
const DynamicWorkload = React.lazy(() => import('./pages/DynamicWorkload'));
const Status = React.lazy(() => import('./pages/Status'));
const RuleConfigManager = React.lazy(() => import('./pages/RuleConfigManager'));
const ExecutionWorkloadManager = React.lazy(() => import('./pages/ExecutionWorkloadManager'));
const TestbedTimeline = React.lazy(() => import('./pages/TestbedTimeline'));
const TestbedActivity = React.lazy(() => import('./pages/TestbedActivity'));
const ExecutionReport = React.lazy(() => import('./pages/ExecutionReport'));
const SmartExecutionHistory = React.lazy(() => import('./pages/SmartExecutionHistory'));
const SmartExecutionReport = React.lazy(() => import('./pages/SmartExecutionReport'));
const SmartExecutionConfigureAI = React.lazy(() => import('./pages/SmartExecutionConfigureAI'));
const SmartExecutionMonitorAI = React.lazy(() => import('./pages/SmartExecutionMonitorAI'));
const MLInsights = React.lazy(() => import('./pages/MLInsights'));
const ScheduledExecutions = React.lazy(() => import('./pages/ScheduledExecutions'));
const AlertConfiguration = React.lazy(() => import('./pages/AlertConfiguration'));
const MultiTestbedConfigure = React.lazy(() => import('./pages/MultiTestbedConfigure'));
const MultiTestbedMonitor = React.lazy(() => import('./pages/MultiTestbedMonitor'));
const MultiTestbedReport = React.lazy(() => import('./pages/MultiTestbedReport'));
const CostDashboard = React.lazy(() => import('./pages/CostDashboard'));
const BudgetConfiguration = React.lazy(() => import('./pages/BudgetConfiguration'));
const CostOptimization = React.lazy(() => import('./pages/CostOptimization'));
const AnalyticsDashboard = React.lazy(() => import('./pages/AnalyticsDashboard'));
const AnalyticsComparison = React.lazy(() => import('./pages/AnalyticsComparison'));
const ExecutiveSummary = React.lazy(() => import('./pages/ExecutiveSummary'));
const ErrorBoundaryTest = React.lazy(() => import('./pages/ErrorBoundaryTest'));

const LazyFallback: React.FC = () => (
  <div className="d-flex align-items-center justify-content-center" style={{ minHeight: 200 }}>
    <div className="spinner-border spinner-border-sm text-secondary" role="status" />
    <span className="ms-2 text-muted" style={{ fontSize: 'var(--text-base)' }}>Loading…</span>
  </div>
);

const App: React.FC = () => {
  const [, setIsAuthenticated] = React.useState(false);
  const [, setOnboarded] = React.useState(false);

  return (
    <ToastProvider>
    <Router>
      <Suspense fallback={<Layout><LazyFallback /></Layout>}>
      <Routes>
        {/* Dashboard – eagerly loaded for instant first paint */}
        <Route path="/" element={<Layout><DashboardHome /></Layout>} />
        <Route path="/dashboard" element={<Layout><DashboardHome /></Layout>} />

        {/* Testbed setup */}
        <Route path="/deploy-new" element={<Layout><DeployNew /></Layout>} />
        <Route path="/onboarding" element={<Layout><Onboarding onSubmit={() => { setOnboarded(true); setIsAuthenticated(true); }} /></Layout>} />
        <Route path="/onboarding-experimental" element={
          <Layout><OnboardingExperimental onSubmit={() => { setOnboarded(true); setIsAuthenticated(true); }} /></Layout>
        } />
        <Route path="/my-testbeds" element={<Layout><MyTestbeds /></Layout>} />
        <Route path="/testbeds" element={<Layout><MyTestbeds /></Layout>} />
        <Route path="/testbed-timeline/:testbedId" element={<Layout><TestbedTimeline /></Layout>} />
        <Route path="/testbed-activity/:testbedId" element={<Layout><TestbedActivity /></Layout>} />
        <Route path="/execution-report/:testbedId/:executionId" element={<Layout><ExecutionReport /></Layout>} />
        <Route path="/environment_select" element={<Layout><EnvironmentSelect /></Layout>} />

        {/* Rules & Alerts */}
        <Route path="/rulebuilder-experimental" element={<Layout><RuleBuilderExperimental onSave={() => {}} /></Layout>} />
        <Route path="/rulebuilder" element={<Layout><RuleBuilder onSave={() => {}} /></Layout>} />
        <Route path="/rule-config-manager" element={<Layout><RuleConfigManager /></Layout>} />
        <Route path="/alert-summary" element={<Layout><AlertSummary /></Layout>} />
        <Route path="/alert-configuration" element={<Layout><AlertConfiguration /></Layout>} />

        {/* Workloads */}
        <Route path="/dynamic-workload" element={<Layout><DynamicWorkload /></Layout>} />
        <Route path="/execution-workload-manager" element={<Layout><ExecutionWorkloadManager /></Layout>} />

        {/* Smart Execution */}
        <Route path="/smart-execution" element={<Layout><SmartExecutionConfigureAI /></Layout>} />
        <Route path="/smart-execution/configure" element={<Layout><SmartExecutionConfigureAI /></Layout>} />
        <Route path="/smart-execution/monitor/:executionId" element={<Layout><SmartExecutionMonitorAI /></Layout>} />
        <Route path="/smart-execution/history" element={<Layout><SmartExecutionHistory /></Layout>} />
        <Route path="/smart-execution/report/:executionId" element={<Layout><SmartExecutionReport /></Layout>} />
        <Route path="/ml-insights" element={<Layout><MLInsights /></Layout>} />
        <Route path="/scheduled-executions" element={<Layout><ScheduledExecutions /></Layout>} />

        {/* Multi-Testbed */}
        <Route path="/multi-testbed/configure" element={<Layout><MultiTestbedConfigure /></Layout>} />
        <Route path="/multi-testbed/monitor/:multiExecutionId" element={<Layout><MultiTestbedMonitor /></Layout>} />
        <Route path="/multi-testbed/report/:multiExecutionId" element={<Layout><MultiTestbedReport /></Layout>} />

        {/* Cost */}
        <Route path="/cost-dashboard" element={<Layout><CostDashboard /></Layout>} />
        <Route path="/budget-configuration" element={<Layout><BudgetConfiguration /></Layout>} />
        <Route path="/cost-optimization" element={<Layout><CostOptimization /></Layout>} />

        {/* Analytics */}
        <Route path="/analytics/dashboard" element={<Layout><AnalyticsDashboard /></Layout>} />
        <Route path="/analytics/comparison" element={<Layout><AnalyticsComparison /></Layout>} />
        <Route path="/analytics/executive-summary" element={<Layout><ExecutiveSummary /></Layout>} />

        {/* Misc */}
        <Route path="/status" element={<Layout><Status /></Layout>} />
        <Route path="/error-boundary-test" element={<Layout><ErrorBoundaryTest /></Layout>} />
      </Routes>
      </Suspense>
    </Router>
    </ToastProvider>
  );
};

export default App;
