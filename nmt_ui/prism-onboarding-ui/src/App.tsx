import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import Onboarding from './components/Onboarding';
import OnboardingExperimental from './components/OnboardingExperimental';
import Loading from './components/Loading';
import Dashboard from './pages/Dashboard';
import DashboardHome from './pages/DashboardHome';
import MyTestbeds from './pages/MyTestbeds';
import DeployNew from './pages/DeployNew';
import RuleBuilderExperimental from './components/RuleBuilderExperimental';
import EnvironmentSelect from './pages/TestbedConfiguration';
import RuleBuilder from './components/RuleBuilder';
import AlertSummary from './components/AlertSummary';
import DynamicWorkload from './pages/DynamicWorkload';
import Status from './pages/Status';
import Layout from './components/Layout';
import RuleConfigManager from './pages/RuleConfigManager';
import ExecutionWorkloadManager from './pages/ExecutionWorkloadManager';
import TestbedTimeline from './pages/TestbedTimeline';
import TestbedActivity from './pages/TestbedActivity';
import ExecutionReport from './pages/ExecutionReport';
import SmartExecutionHistory from './pages/SmartExecutionHistory';
import SmartExecutionReport from './pages/SmartExecutionReport';
import SmartExecutionConfigureAI from './pages/SmartExecutionConfigureAI';
import SmartExecutionMonitorAI from './pages/SmartExecutionMonitorAI';
import MLInsights from './pages/MLInsights';
import ScheduledExecutions from './pages/ScheduledExecutions';
import AlertConfiguration from './pages/AlertConfiguration';
import MultiTestbedConfigure from './pages/MultiTestbedConfigure';
import MultiTestbedMonitor from './pages/MultiTestbedMonitor';
import MultiTestbedReport from './pages/MultiTestbedReport';
import CostDashboard from './pages/CostDashboard';
import BudgetConfiguration from './pages/BudgetConfiguration';
import CostOptimization from './pages/CostOptimization';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import AnalyticsComparison from './pages/AnalyticsComparison';
import ExecutiveSummary from './pages/ExecutiveSummary';
import ErrorBoundaryTest from './pages/ErrorBoundaryTest';

const App: React.FC = () => {
  // Placeholder for authentication state
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [onboarded, setOnboarded] = React.useState(false);

  return (
    <Router>
      <Routes>
        {/* All pages now use Layout for consistent sidebar + header */}
        <Route path="/" element={<Layout><DashboardHome /></Layout>} />
        <Route path="/dashboard" element={<Layout><DashboardHome /></Layout>} />
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
        <Route path="/rulebuilder-experimental" element={<Layout><RuleBuilderExperimental onSave={() => {}} /></Layout>} />
        <Route path="/rulebuilder" element={<Layout><RuleBuilder onSave={() => {}} /></Layout>} />
        <Route path="/rule-config-manager" element={<Layout><RuleConfigManager /></Layout>} />
        <Route path="/alert-summary" element={<Layout><AlertSummary /></Layout>} />
        <Route path="/dynamic-workload" element={<Layout><DynamicWorkload /></Layout>} />
        <Route path="/execution-workload-manager" element={<Layout><ExecutionWorkloadManager /></Layout>} />
        
        {/* Smart Execution - AI/ML Powered (New Primary) */}
        <Route path="/smart-execution" element={<Layout><SmartExecutionConfigureAI /></Layout>} />
        <Route path="/smart-execution/configure" element={<Layout><SmartExecutionConfigureAI /></Layout>} />
        <Route path="/smart-execution/monitor/:executionId" element={<Layout><SmartExecutionMonitorAI /></Layout>} />
        <Route path="/smart-execution/history" element={<Layout><SmartExecutionHistory /></Layout>} />
        <Route path="/smart-execution/report/:executionId" element={<Layout><SmartExecutionReport /></Layout>} />
        <Route path="/ml-insights" element={<Layout><MLInsights /></Layout>} />
        <Route path="/scheduled-executions" element={<Layout><ScheduledExecutions /></Layout>} />
        <Route path="/alert-configuration" element={<Layout><AlertConfiguration /></Layout>} />
        <Route path="/multi-testbed/configure" element={<Layout><MultiTestbedConfigure /></Layout>} />
        <Route path="/multi-testbed/monitor/:multiExecutionId" element={<Layout><MultiTestbedMonitor /></Layout>} />
        <Route path="/multi-testbed/report/:multiExecutionId" element={<Layout><MultiTestbedReport /></Layout>} />
        <Route path="/cost-dashboard" element={<Layout><CostDashboard /></Layout>} />
        <Route path="/budget-configuration" element={<Layout><BudgetConfiguration /></Layout>} />
        <Route path="/cost-optimization" element={<Layout><CostOptimization /></Layout>} />
        <Route path="/analytics/dashboard" element={<Layout><AnalyticsDashboard /></Layout>} />
        <Route path="/analytics/comparison" element={<Layout><AnalyticsComparison /></Layout>} />
        <Route path="/analytics/executive-summary" element={<Layout><ExecutiveSummary /></Layout>} />
        <Route path="/status" element={<Layout><Status /></Layout>} />
        <Route path="/error-boundary-test" element={<Layout><ErrorBoundaryTest /></Layout>} />
        <Route path="/loading" element={<Layout><Loading /></Layout>} />
      </Routes>
    </Router>
  );
};

export default App;
