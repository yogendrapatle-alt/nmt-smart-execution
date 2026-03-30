import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../styles/AnalyticsComparison.css';
import { getApiBase } from '../utils/backendUrl';

interface Testbed {
  unique_testbed_id: string;
  testbed_label?: string;
  pc_ip?: string;
}

interface ComparisonData {
  testbed_id: string;
  total_executions: number;
  success_rate: number;
  total_operations: number;
  avg_duration_minutes: number;
}

const AnalyticsComparison: React.FC = () => {
  const navigate = useNavigate();
  
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbeds, setSelectedTestbeds] = useState<string[]>([]);
  const [comparisonData, setComparisonData] = useState<ComparisonData[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState('30');

  useEffect(() => {
    loadTestbeds();
  }, []);

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

  const toggleTestbed = (testbedId: string) => {
    setSelectedTestbeds(prev => {
      if (prev.includes(testbedId)) {
        return prev.filter(id => id !== testbedId);
      } else {
        return [...prev, testbedId];
      }
    });
  };

  const runComparison = async () => {
    if (selectedTestbeds.length < 2) {
      alert('Please select at least 2 testbeds to compare');
      return;
    }
    
    try {
      setLoading(true);
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - parseInt(dateRange));
      
      const response = await axios.post(`${getApiBase()}/api/analytics/compare-testbeds`, {
        testbed_ids: selectedTestbeds,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      });
      
      if (response.data.success) {
        setComparisonData(response.data.comparison.comparisons);
      }
      
    } catch (error) {
      console.error('Failed to run comparison:', error);
      alert('Failed to run comparison. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getTestbedName = (testbedId: string) => {
    const testbed = testbeds.find(tb => tb.unique_testbed_id === testbedId);
    return testbed?.testbed_label || testbed?.pc_ip || testbedId.slice(0, 8);
  };

  const getBestPerformer = (metric: string) => {
    if (comparisonData.length === 0) return null;
    
    switch (metric) {
      case 'success_rate':
        return comparisonData.reduce((best, current) => 
          current.success_rate > best.success_rate ? current : best
        );
      case 'operations':
        return comparisonData.reduce((best, current) => 
          current.total_operations > best.total_operations ? current : best
        );
      case 'efficiency':
        return comparisonData.reduce((best, current) => 
          current.avg_duration_minutes < best.avg_duration_minutes ? current : best
        );
      default:
        return null;
    }
  };

  const renderComparisonTable = () => {
    if (comparisonData.length === 0) {
      return <div className="no-data">No comparison data available. Select testbeds and click "Run Comparison".</div>;
    }
    
    const bestSuccessRate = getBestPerformer('success_rate');
    const bestOperations = getBestPerformer('operations');
    const bestEfficiency = getBestPerformer('efficiency');
    
    return (
      <div className="comparison-table-container">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Testbed</th>
              <th>Total Executions</th>
              <th>
                Success Rate
                <span className="winner-icon">🏆</span>
              </th>
              <th>
                Total Operations
                <span className="winner-icon">🏆</span>
              </th>
              <th>
                Avg Duration
                <span className="winner-icon">🏆</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {comparisonData.map((data) => (
              <tr key={data.testbed_id}>
                <td className="testbed-cell">
                  <strong>{getTestbedName(data.testbed_id)}</strong>
                </td>
                <td>{data.total_executions}</td>
                <td className={data.testbed_id === bestSuccessRate?.testbed_id ? 'best-value' : ''}>
                  {data.success_rate.toFixed(2)}%
                  {data.testbed_id === bestSuccessRate?.testbed_id && <span className="winner-badge">🏆</span>}
                </td>
                <td className={data.testbed_id === bestOperations?.testbed_id ? 'best-value' : ''}>
                  {data.total_operations.toLocaleString()}
                  {data.testbed_id === bestOperations?.testbed_id && <span className="winner-badge">🏆</span>}
                </td>
                <td className={data.testbed_id === bestEfficiency?.testbed_id ? 'best-value' : ''}>
                  {data.avg_duration_minutes.toFixed(2)} min
                  {data.testbed_id === bestEfficiency?.testbed_id && <span className="winner-badge">🏆</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="analytics-comparison">
      <div className="page-header">
        <h1>📊 Testbed Comparison</h1>
        <button className="btn-secondary" onClick={() => navigate('/analytics/dashboard')}>
          ← Back to Analytics
        </button>
      </div>

      {/* Configuration */}
      <div className="comparison-config">
        <div className="config-section">
          <h2>Select Testbeds to Compare</h2>
          <div className="testbed-grid">
            {testbeds.map(testbed => (
              <div 
                key={testbed.unique_testbed_id}
                className={`testbed-card ${selectedTestbeds.includes(testbed.unique_testbed_id) ? 'selected' : ''}`}
                onClick={() => toggleTestbed(testbed.unique_testbed_id)}
              >
                <div className="testbed-checkbox">
                  {selectedTestbeds.includes(testbed.unique_testbed_id) ? '✓' : ''}
                </div>
                <div className="testbed-info">
                  <div className="testbed-name">{testbed.testbed_label || testbed.pc_ip}</div>
                  <div className="testbed-id">{testbed.unique_testbed_id.slice(0, 8)}...</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="config-section">
          <h2>Time Period</h2>
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>

        <div className="config-actions">
          <button 
            className="btn-primary btn-large" 
            onClick={runComparison}
            disabled={selectedTestbeds.length < 2 || loading}
          >
            {loading ? 'Running Comparison...' : `Compare ${selectedTestbeds.length} Testbeds`}
          </button>
        </div>
      </div>

      {/* Comparison Results */}
      {comparisonData.length > 0 && (
        <div className="comparison-results">
          <h2>Comparison Results</h2>
          {renderComparisonTable()}
          
          {/* Key Insights */}
          <div className="insights-section">
            <h3>Key Insights</h3>
            <div className="insights-grid">
              <div className="insight-card">
                <div className="insight-icon">🏆</div>
                <div className="insight-content">
                  <h4>Best Success Rate</h4>
                  <p>{getTestbedName(getBestPerformer('success_rate')?.testbed_id || '')}</p>
                  <p className="insight-value">{getBestPerformer('success_rate')?.success_rate.toFixed(2)}%</p>
                </div>
              </div>
              
              <div className="insight-card">
                <div className="insight-icon">⚡</div>
                <div className="insight-content">
                  <h4>Most Operations</h4>
                  <p>{getTestbedName(getBestPerformer('operations')?.testbed_id || '')}</p>
                  <p className="insight-value">{getBestPerformer('operations')?.total_operations.toLocaleString()} ops</p>
                </div>
              </div>
              
              <div className="insight-card">
                <div className="insight-icon">🚀</div>
                <div className="insight-content">
                  <h4>Most Efficient</h4>
                  <p>{getTestbedName(getBestPerformer('efficiency')?.testbed_id || '')}</p>
                  <p className="insight-value">{getBestPerformer('efficiency')?.avg_duration_minutes.toFixed(2)} min avg</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsComparison;
