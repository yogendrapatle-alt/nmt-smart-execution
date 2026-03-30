import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../styles/ExecutiveSummary.css';
import { getApiBase } from '../utils/backendUrl';

interface Insight {
  type: 'positive' | 'warning' | 'info';
  message: string;
  icon: string;
}

interface ExecutiveSummary {
  period: {
    start: string;
    end: string;
    days: number;
  };
  key_metrics: {
    total_executions: number;
    success_rate: number;
    total_operations: number;
    total_cost: number;
    avg_cost_per_execution: number;
  };
  insights: Insight[];
  most_active_testbed: {
    testbed_id: string;
    execution_count: number;
  } | null;
}

const ExecutiveSummary: React.FC = () => {
  const navigate = useNavigate();
  
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30');

  useEffect(() => {
    loadExecutiveSummary();
  }, [dateRange]);

  const loadExecutiveSummary = async () => {
    try {
      setLoading(true);
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - parseInt(dateRange));
      
      const response = await axios.get(`${getApiBase()}/api/analytics/executive-summary`, {
        params: {
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0]
        }
      });
      
      if (response.data.success) {
        setSummary(response.data.summary);
      }
      
    } catch (error) {
      console.error('Failed to load executive summary:', error);
    } finally {
      setLoading(false);
    }
  };

  const getInsightClass = (type: string) => {
    switch (type) {
      case 'positive': return 'insight-positive';
      case 'warning': return 'insight-warning';
      case 'info': return 'insight-info';
      default: return '';
    }
  };

  const exportSummary = () => {
    if (!summary) return;
    
    const data = JSON.stringify(summary, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `executive_summary_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="executive-summary">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading executive summary...</p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="executive-summary">
        <div className="no-data">No summary data available</div>
      </div>
    );
  }

  return (
    <div className="executive-summary">
      <div className="page-header">
        <h1>📋 Executive Summary</h1>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => navigate('/analytics/dashboard')}>
            ← Back to Analytics
          </button>
          <button className="btn-primary" onClick={exportSummary}>
            📥 Export
          </button>
        </div>
      </div>

      {/* Date Range Selector */}
      <div className="controls">
        <label>Period:</label>
        <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="60">Last 60 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {/* Period Info */}
      <div className="period-info">
        <h2>Summary Period</h2>
        <p>
          {new Date(summary.period.start).toLocaleDateString()} to {new Date(summary.period.end).toLocaleDateString()} 
          <span className="days-badge">({summary.period.days} days)</span>
        </p>
      </div>

      {/* Key Metrics */}
      <div className="key-metrics-section">
        <h2>Key Metrics</h2>
        <div className="metrics-grid">
          <div className="metric-card primary">
            <div className="metric-icon">🚀</div>
            <div className="metric-content">
              <div className="metric-label">Total Executions</div>
              <div className="metric-value">{summary.key_metrics.total_executions}</div>
            </div>
          </div>
          
          <div className="metric-card success">
            <div className="metric-icon">✅</div>
            <div className="metric-content">
              <div className="metric-label">Success Rate</div>
              <div className="metric-value">{summary.key_metrics.success_rate.toFixed(2)}%</div>
            </div>
          </div>
          
          <div className="metric-card operations">
            <div className="metric-icon">⚙️</div>
            <div className="metric-content">
              <div className="metric-label">Total Operations</div>
              <div className="metric-value">{summary.key_metrics.total_operations.toLocaleString()}</div>
            </div>
          </div>
          
          <div className="metric-card cost">
            <div className="metric-icon">💰</div>
            <div className="metric-content">
              <div className="metric-label">Total Cost</div>
              <div className="metric-value">${summary.key_metrics.total_cost.toFixed(2)}</div>
              <div className="metric-subtitle">${summary.key_metrics.avg_cost_per_execution.toFixed(2)} avg</div>
            </div>
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className="insights-section">
        <h2>Key Insights & Recommendations</h2>
        {summary.insights.length > 0 ? (
          <div className="insights-list">
            {summary.insights.map((insight, index) => (
              <div key={index} className={`insight-item ${getInsightClass(insight.type)}`}>
                <div className="insight-icon">{insight.icon}</div>
                <div className="insight-message">{insight.message}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="no-insights">No specific insights for this period</div>
        )}
      </div>

      {/* Most Active Testbed */}
      {summary.most_active_testbed && (
        <div className="active-testbed-section">
          <h2>Most Active Testbed</h2>
          <div className="testbed-card">
            <div className="testbed-icon">🏆</div>
            <div className="testbed-info">
              <div className="testbed-id">{summary.most_active_testbed.testbed_id.slice(0, 8)}...</div>
              <div className="testbed-stats">
                {summary.most_active_testbed.execution_count} executions
                ({(summary.most_active_testbed.execution_count / summary.key_metrics.total_executions * 100).toFixed(1)}% of total)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <h3>Performance Highlights</h3>
          <ul>
            <li>
              <span className="highlight-icon">📈</span>
              Average of {(summary.key_metrics.total_operations / summary.key_metrics.total_executions).toFixed(1)} operations per execution
            </li>
            <li>
              <span className="highlight-icon">💵</span>
              Cost per operation: ${(summary.key_metrics.total_cost / summary.key_metrics.total_operations).toFixed(4)}
            </li>
          </ul>
        </div>
        
        <div className="summary-card">
          <h3>Recommendations</h3>
          <ul>
            <li>
              <span className="highlight-icon">💡</span>
              Review failed executions to improve success rate
            </li>
            <li>
              <span className="highlight-icon">⚡</span>
              Consider scheduling executions during off-peak hours
            </li>
            <li>
              <span className="highlight-icon">🎯</span>
              Optimize resource thresholds to reduce costs
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ExecutiveSummary;
