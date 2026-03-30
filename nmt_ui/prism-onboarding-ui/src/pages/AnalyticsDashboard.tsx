import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../styles/AnalyticsDashboard.css';
import { getApiBase } from '../utils/backendUrl';

interface Overview {
  period: {
    start: string;
    end: string;
    days: number;
  };
  executions: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    success_rate: number;
  };
  operations: {
    total: number;
    successful: number;
    success_rate: number;
    avg_per_execution: number;
  };
  performance: {
    avg_duration_minutes: number;
    avg_operations_per_minute: number;
    threshold_achievement_rate: number;
  };
  resource_utilization: {
    avg_cpu_percent: number;
    avg_memory_percent: number;
  };
}

interface TrendData {
  period: string;
  value: number;
  count: number;
}

interface Testbed {
  unique_testbed_id: string;
  testbed_label?: string;
  pc_ip?: string;
}

const AnalyticsDashboard: React.FC = () => {
  const navigate = useNavigate();
  
  const [overview, setOverview] = useState<Overview | null>(null);
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [dateRange, setDateRange] = useState('30'); // days
  const [selectedTestbed, setSelectedTestbed] = useState('');
  const [selectedMetric, setSelectedMetric] = useState('executions');

  useEffect(() => {
    loadTestbeds();
    loadAnalytics();
  }, [dateRange, selectedTestbed, selectedMetric]);

  const loadTestbeds = async () => {
    try {
      const response = await axios.get(`${getApiBase()}/api/testbeds`);
      if (response.data.success) {
        setTestbeds(response.data.testbeds);
      }
    } catch (error) {
      console.error('Failed to load testbeds:', error);
    }
  };

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      
      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - parseInt(dateRange));
      
      const params: any = {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      };
      
      if (selectedTestbed) {
        params.testbed_id = selectedTestbed;
      }
      
      // Load overview
      const overviewRes = await axios.get(`${getApiBase()}/api/analytics/overview`, { params });
      if (overviewRes.data.success) {
        setOverview(overviewRes.data.overview);
      }
      
      // Load trends
      const trendsParams = { ...params, metric: selectedMetric, granularity: 'daily' };
      const trendsRes = await axios.get(`${getApiBase()}/api/analytics/trends`, { params: trendsParams });
      if (trendsRes.data.success) {
        setTrends(trendsRes.data.trends.trend_data);
      }
      
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportData = async (format: 'csv' | 'json') => {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - parseInt(dateRange));
      
      const response = await axios.post(`${getApiBase()}/api/analytics/export`, {
        format,
        data_type: 'overview',
        params: {
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          testbed_id: selectedTestbed || undefined
        }
      }, {
        responseType: 'blob'
      });
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `analytics_${format}_${Date.now()}.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
    } catch (error) {
      console.error('Failed to export data:', error);
      alert('Failed to export data. Please try again.');
    }
  };

  const renderMetricCard = (title: string, value: number | string, subtitle?: string, icon?: string) => {
    return (
      <div className="metric-card">
        <div className="metric-icon">{icon || '📊'}</div>
        <div className="metric-content">
          <div className="metric-title">{title}</div>
          <div className="metric-value">{value}</div>
          {subtitle && <div className="metric-subtitle">{subtitle}</div>}
        </div>
      </div>
    );
  };

  const renderTrendChart = () => {
    if (!trends || trends.length === 0) {
      return <div className="no-data">No trend data available</div>;
    }
    
    const maxValue = Math.max(...trends.map(t => t.value));
    
    return (
      <div className="trend-chart">
        <div className="trend-bars">
          {trends.slice(-15).map((trend, index) => {
            const height = maxValue > 0 ? (trend.value / maxValue * 100) : 0;
            
            return (
              <div key={index} className="trend-bar-container">
                <div 
                  className="trend-bar" 
                  style={{ height: `${height}%` }}
                  title={`${trend.period}: ${trend.value.toFixed(2)}`}
                ></div>
                <div className="trend-label">
                  {new Date(trend.period).getDate()}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="analytics-dashboard">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-dashboard">
      <div className="dashboard-header">
        <h1>📊 Advanced Analytics</h1>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => navigate('/cost-dashboard')}>
            Cost Dashboard
          </button>
          <button className="btn-secondary" onClick={() => navigate('/analytics/comparison')}>
            Compare Testbeds
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-section">
        <div className="filter-group">
          <label>Date Range</label>
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
        
        <div className="filter-group">
          <label>Testbed</label>
          <select value={selectedTestbed} onChange={(e) => setSelectedTestbed(e.target.value)}>
            <option value="">All Testbeds</option>
            {testbeds.map(tb => (
              <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>
                {tb.testbed_label || tb.pc_ip}
              </option>
            ))}
          </select>
        </div>
        
        <div className="filter-group">
          <label>Metric</label>
          <select value={selectedMetric} onChange={(e) => setSelectedMetric(e.target.value)}>
            <option value="executions">Executions</option>
            <option value="operations">Operations</option>
            <option value="cpu">CPU Usage</option>
            <option value="memory">Memory Usage</option>
            <option value="success_rate">Success Rate</option>
          </select>
        </div>
        
        <div className="filter-group">
          <button className="btn-primary" onClick={loadAnalytics}>
            Refresh
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      {overview && (
        <div className="metrics-grid">
          {renderMetricCard(
            'Total Executions',
            overview.executions.total,
            `${overview.executions.completed} completed`,
            '🚀'
          )}
          {renderMetricCard(
            'Success Rate',
            `${overview.executions.success_rate}%`,
            `${overview.executions.failed} failed`,
            '✅'
          )}
          {renderMetricCard(
            'Total Operations',
            overview.operations.total.toLocaleString(),
            `${overview.operations.success_rate}% successful`,
            '⚙️'
          )}
          {renderMetricCard(
            'Avg Duration',
            `${overview.performance.avg_duration_minutes.toFixed(1)} min`,
            `${overview.performance.avg_operations_per_minute.toFixed(1)} ops/min`,
            '⏱️'
          )}
          {renderMetricCard(
            'Avg CPU Usage',
            `${overview.resource_utilization.avg_cpu_percent.toFixed(1)}%`,
            'Resource utilization',
            '💻'
          )}
          {renderMetricCard(
            'Avg Memory Usage',
            `${overview.resource_utilization.avg_memory_percent.toFixed(1)}%`,
            'Resource utilization',
            '🧠'
          )}
        </div>
      )}

      {/* Trend Chart */}
      <div className="chart-section">
        <div className="chart-header">
          <h2>Trends - {selectedMetric.charAt(0).toUpperCase() + selectedMetric.slice(1)}</h2>
          <div className="chart-actions">
            <button className="btn-icon" onClick={() => exportData('csv')} title="Export CSV">
              📥 CSV
            </button>
            <button className="btn-icon" onClick={() => exportData('json')} title="Export JSON">
              📥 JSON
            </button>
          </div>
        </div>
        {renderTrendChart()}
      </div>

      {/* Executive Summary Link */}
      <div className="quick-links">
        <button 
          className="link-card"
          onClick={() => navigate('/analytics/executive-summary')}
        >
          <div className="link-icon">📋</div>
          <div className="link-content">
            <h3>Executive Summary</h3>
            <p>View high-level insights and key findings</p>
          </div>
        </button>
        
        <button 
          className="link-card"
          onClick={() => navigate('/analytics/comparison')}
        >
          <div className="link-icon">📊</div>
          <div className="link-content">
            <h3>Compare Testbeds</h3>
            <p>Side-by-side testbed comparison</p>
          </div>
        </button>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
