import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../styles/CostDashboard.css';
import { getApiBase } from '../utils/backendUrl';

interface CostSummary {
  total_cost: number;
  total_executions: number;
  avg_cost_per_execution: number;
  total_operations?: number;
  cost_breakdown?: {
    cpu: number;
    memory: number;
    storage: number;
    network: number;
    operations: number;
  };
}

interface TopSpending {
  testbed_id: string;
  total_cost: number;
  executions: number;
}

interface TrendData {
  date: string;
  cost: number;
  executions: number;
}

const CostDashboard: React.FC = () => {
  const navigate = useNavigate();
  
  const [todaySummary, setTodaySummary] = useState<CostSummary | null>(null);
  const [weekSummary, setWeekSummary] = useState<CostSummary | null>(null);
  const [monthSummary, setMonthSummary] = useState<CostSummary | null>(null);
  const [topSpending, setTopSpending] = useState<TopSpending[]>([]);
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Load dashboard summary
      const dashboardRes = await axios.get(`${getApiBase()}/api/costs/dashboard`);
      if (dashboardRes.data.success) {
        setTodaySummary(dashboardRes.data.today);
        setWeekSummary(dashboardRes.data.week);
        setMonthSummary(dashboardRes.data.month);
      }
      
      // Load top spending testbeds
      const topSpendingRes = await axios.get(`${getApiBase()}/api/costs/top-spending?days=30&limit=5`);
      if (topSpendingRes.data.success) {
        setTopSpending(topSpendingRes.data.top_spending);
      }
      
      // Load cost trends
      const trendsRes = await axios.get(`${getApiBase()}/api/costs/trends?days=30`);
      if (trendsRes.data.success) {
        setTrends(trendsRes.data.trends);
      }
      
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };

  const renderCostBreakdown = (breakdown: any) => {
    if (!breakdown) return null;
    
    return (
      <div className="cost-breakdown">
        <div className="breakdown-item">
          <span className="breakdown-label">CPU:</span>
          <span className="breakdown-value">{formatCurrency(breakdown.cpu)}</span>
        </div>
        <div className="breakdown-item">
          <span className="breakdown-label">Memory:</span>
          <span className="breakdown-value">{formatCurrency(breakdown.memory)}</span>
        </div>
        <div className="breakdown-item">
          <span className="breakdown-label">Storage:</span>
          <span className="breakdown-value">{formatCurrency(breakdown.storage)}</span>
        </div>
        <div className="breakdown-item">
          <span className="breakdown-label">Network:</span>
          <span className="breakdown-value">{formatCurrency(breakdown.network)}</span>
        </div>
        <div className="breakdown-item">
          <span className="breakdown-label">Operations:</span>
          <span className="breakdown-value">{formatCurrency(breakdown.operations)}</span>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="cost-dashboard">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading cost data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cost-dashboard">
      <div className="dashboard-header">
        <h1>💰 Cost Dashboard</h1>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => navigate('/budget-configuration')}>
            Configure Budgets
          </button>
          <button className="btn-secondary" onClick={() => navigate('/cost-reports')}>
            View Reports
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card today">
          <div className="card-header">
            <h3>Today</h3>
            <span className="icon">📅</span>
          </div>
          {todaySummary ? (
            <>
              <div className="card-value">{formatCurrency(todaySummary.total_cost)}</div>
              <div className="card-subtitle">
                {todaySummary.total_executions} executions
              </div>
              {renderCostBreakdown(todaySummary.cost_breakdown)}
            </>
          ) : (
            <div className="no-data">No data available</div>
          )}
        </div>

        <div className="summary-card week">
          <div className="card-header">
            <h3>Last 7 Days</h3>
            <span className="icon">📊</span>
          </div>
          {weekSummary ? (
            <>
              <div className="card-value">{formatCurrency(weekSummary.total_cost)}</div>
              <div className="card-subtitle">
                {weekSummary.total_executions} executions
              </div>
              {renderCostBreakdown(weekSummary.cost_breakdown)}
            </>
          ) : (
            <div className="no-data">No data available</div>
          )}
        </div>

        <div className="summary-card month">
          <div className="card-header">
            <h3>Last 30 Days</h3>
            <span className="icon">📈</span>
          </div>
          {monthSummary ? (
            <>
              <div className="card-value">{formatCurrency(monthSummary.total_cost)}</div>
              <div className="card-subtitle">
                {monthSummary.total_executions} executions
              </div>
              {renderCostBreakdown(monthSummary.cost_breakdown)}
            </>
          ) : (
            <div className="no-data">No data available</div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="dashboard-content">
        {/* Top Spending Testbeds */}
        <div className="dashboard-card">
          <h2>Top Spending Testbeds (30 Days)</h2>
          {topSpending.length > 0 ? (
            <div className="top-spending-list">
              {topSpending.map((item, index) => (
                <div key={index} className="spending-item">
                  <div className="rank">#{index + 1}</div>
                  <div className="testbed-info">
                    <div className="testbed-id">{item.testbed_id}</div>
                    <div className="testbed-meta">{item.executions} executions</div>
                  </div>
                  <div className="spending-amount">{formatCurrency(item.total_cost)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-data">No spending data available</div>
          )}
        </div>

        {/* Cost Trends */}
        <div className="dashboard-card">
          <h2>Cost Trends (30 Days)</h2>
          {trends.length > 0 ? (
            <div className="trend-chart">
              <div className="trend-bars">
                {trends.slice(-15).map((trend, index) => {
                  const maxCost = Math.max(...trends.map(t => t.cost));
                  const height = maxCost > 0 ? (trend.cost / maxCost * 100) : 0;
                  
                  return (
                    <div key={index} className="trend-bar-container">
                      <div 
                        className="trend-bar" 
                        style={{ height: `${height}%` }}
                        title={`${trend.date}: ${formatCurrency(trend.cost)}`}
                      ></div>
                      <div className="trend-label">
                        {new Date(trend.date).getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="trend-legend">
                <span>Cost per day (last 15 days)</span>
              </div>
            </div>
          ) : (
            <div className="no-data">No trend data available</div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <h2>Quick Actions</h2>
        <div className="action-buttons">
          <button 
            className="action-btn"
            onClick={() => navigate('/budget-configuration')}
          >
            <span className="icon">⚙️</span>
            <span>Set Budget Limits</span>
          </button>
          <button 
            className="action-btn"
            onClick={() => navigate('/cost-optimization')}
          >
            <span className="icon">💡</span>
            <span>View Optimization Tips</span>
          </button>
          <button 
            className="action-btn"
            onClick={() => navigate('/cost-reports')}
          >
            <span className="icon">📄</span>
            <span>Generate Report</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CostDashboard;
