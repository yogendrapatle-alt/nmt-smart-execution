/**
 * Multi-Testbed Aggregate Report Page
 * 
 * Shows aggregate metrics and per-testbed breakdown
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import '../styles/MultiTestbedReport.css';

interface TestbedResult {
  execution_id: string;
  status: string;
  total_operations: number;
  successful_operations: number;
  success_rate: number;
}

interface ReportData {
  multi_execution_id: string;
  status: string;
  aggregate_metrics: {
    total_testbeds: number;
    total_operations: number;
    successful_operations: number;
    failed_operations: number;
    avg_cpu_achieved: number;
    avg_memory_achieved: number;
    avg_duration_minutes: number;
    success_rate: number;
  };
  testbed_results: Record<string, TestbedResult>;
  total_testbeds: number;
  completed_testbeds: number;
  failed_testbeds: number;
}

const MultiTestbedReport: React.FC = () => {
  const { multiExecutionId } = useParams<{ multiExecutionId: string }>();
  const navigate = useNavigate();
  
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReport();
  }, [multiExecutionId]);

  const fetchReport = async () => {
    try {
      const response = await fetch(`/api/multi-testbed/report/${multiExecutionId}`);
      const data = await response.json();
      
      if (data.success) {
        setReport(data);
      }
      setLoading(false);
    } catch (err) {
      console.error('Error fetching report:', err);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="multi-testbed-report">
        <div className="loading">Loading report...</div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="multi-testbed-report">
        <div className="error">Report not found</div>
      </div>
    );
  }

  const metrics = report.aggregate_metrics;

  return (
    <div className="multi-testbed-report">
      <div className="page-header">
        <h1>📊 Multi-Testbed Aggregate Report</h1>
        <p>Execution ID: <code>{multiExecutionId}</code></p>
      </div>

      {/* Summary Card */}
      <div className="report-card summary-card">
        <h2>Execution Summary</h2>
        <div className="summary-grid">
          <div className="summary-item">
            <div className="summary-icon">🖥️</div>
            <div className="summary-content">
              <div className="summary-label">Total Testbeds</div>
              <div className="summary-value">{report.total_testbeds}</div>
            </div>
          </div>
          <div className="summary-item success">
            <div className="summary-icon">✅</div>
            <div className="summary-content">
              <div className="summary-label">Completed</div>
              <div className="summary-value">{report.completed_testbeds}</div>
            </div>
          </div>
          <div className="summary-item error">
            <div className="summary-icon">❌</div>
            <div className="summary-content">
              <div className="summary-label">Failed</div>
              <div className="summary-value">{report.failed_testbeds}</div>
            </div>
          </div>
          <div className="summary-item">
            <div className="summary-icon">⚙️</div>
            <div className="summary-content">
              <div className="summary-label">Total Operations</div>
              <div className="summary-value">{metrics.total_operations.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Aggregate Metrics */}
      <div className="report-card metrics-card">
        <h2>Aggregate Metrics</h2>
        <div className="metrics-grid">
          <div className="metric-box">
            <div className="metric-label">Success Rate</div>
            <div className="metric-value large">{metrics.success_rate.toFixed(1)}%</div>
            <div className="metric-detail">
              {metrics.successful_operations.toLocaleString()} / {metrics.total_operations.toLocaleString()} operations
            </div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Average CPU Achieved</div>
            <div className="metric-value large">{metrics.avg_cpu_achieved.toFixed(1)}%</div>
            <div className="metric-bar">
              <div className="metric-fill" style={{ width: `${metrics.avg_cpu_achieved}%` }} />
            </div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Average Memory Achieved</div>
            <div className="metric-value large">{metrics.avg_memory_achieved.toFixed(1)}%</div>
            <div className="metric-bar">
              <div className="metric-fill" style={{ width: `${metrics.avg_memory_achieved}%` }} />
            </div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Average Duration</div>
            <div className="metric-value large">{metrics.avg_duration_minutes.toFixed(1)}</div>
            <div className="metric-detail">minutes per testbed</div>
          </div>
        </div>
      </div>

      {/* Per-Testbed Results */}
      <div className="report-card testbed-results-card">
        <h2>Per-Testbed Results</h2>
        <div className="testbed-results-table">
          <table>
            <thead>
              <tr>
                <th>Testbed ID</th>
                <th>Status</th>
                <th>Operations</th>
                <th>Success Rate</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(report.testbed_results).map(([testbedId, result]) => (
                <tr key={testbedId}>
                  <td><code>{testbedId}</code></td>
                  <td>
                    <span className={`status-badge status-${result.status}`}>
                      {result.status}
                    </span>
                  </td>
                  <td>
                    {result.total_operations.toLocaleString()}
                    <small> ({result.successful_operations} successful)</small>
                  </td>
                  <td>
                    <div className="success-rate">
                      <div className="rate-value">{result.success_rate.toFixed(1)}%</div>
                      <div className="rate-bar">
                        <div 
                          className="rate-fill"
                          style={{ width: `${result.success_rate}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td>
                    <button
                      className="btn-link"
                      onClick={() => navigate(`/smart-execution/report/${result.execution_id}`)}
                    >
                      View Details →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="report-actions">
        <button 
          className="btn-secondary"
          onClick={() => navigate('/multi-testbed/history')}
        >
          ← Back to History
        </button>
        <button 
          className="btn-primary"
          onClick={() => navigate('/multi-testbed/configure')}
        >
          Start New Multi-Testbed Execution
        </button>
      </div>
    </div>
  );
};

export default MultiTestbedReport;
