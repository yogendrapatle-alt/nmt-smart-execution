/**
 * ML Insights Dashboard
 * 
 * Shows ML model status, training history, accuracy trends,
 * feature importance, and allows manual retraining.
 */

import React, { useState, useEffect, useCallback } from 'react';
import '../styles/MLInsights.css';
import { getApiBase } from '../utils/backendUrl';

interface ModelInfo {
  model_id: string;
  testbed_id: string | null;
  model_version: number;
  trained_at: string;
  samples_used: number;
  cpu_r2: number;
  cpu_mae: number;
  memory_r2: number;
  memory_mae: number;
  validation_score: number;
  model_path: string;
  training_duration_seconds: number;
  is_active: boolean;
}

interface TrainingJob {
  job_id: string;
  testbed_id: string | null;
  status: string;
  started_at: string;
  completed_at: string;
  samples_used: number;
  result_model_id: string;
  cpu_r2: number;
  memory_r2: number;
  error_message: string;
  trigger_type: string;
}

interface DataStats {
  total_samples: number;
  unique_entities: number;
  unique_operations: number;
  oldest_sample: string | null;
  newest_sample: string | null;
  source: string;
}

interface PredictionResult {
  cpu_impact: number;
  memory_impact: number;
  confidence: number;
}

interface Testbed {
  unique_testbed_id: string;
  testbed_label: string;
}

const API_BASE = getApiBase();

const MLInsights: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'models' | 'training' | 'predict'>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Data state
  const [insights, setInsights] = useState<any>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [trainingJobs, setTrainingJobs] = useState<TrainingJob[]>([]);
  const [dataStats, setDataStats] = useState<DataStats | null>(null);
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbed, setSelectedTestbed] = useState('');

  // Prediction state
  const [predEntity, setPredEntity] = useState('vm');
  const [predOperation, setPredOperation] = useState('CREATE');
  const [predCpu, setPredCpu] = useState(50);
  const [predMemory, setPredMemory] = useState(45);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);

  const fetchTestbeds = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/get-testbeds`);
      if (res.ok) {
        const data = await res.json();
        setTestbeds(data.testbeds || []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const params = selectedTestbed ? `?testbed_id=${selectedTestbed}` : '';
      const res = await fetch(`${API_BASE}/api/ml/insights${params}`);
      if (res.ok) {
        const data = await res.json();
        setInsights(data);
      }
    } catch (e) {
      console.error('Error fetching insights:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedTestbed]);

  const fetchModels = useCallback(async () => {
    try {
      const params = selectedTestbed ? `?testbed_id=${selectedTestbed}` : '';
      const res = await fetch(`${API_BASE}/api/ml/models${params}`);
      if (res.ok) {
        const data = await res.json();
        setModels(data.models || []);
      }
    } catch { /* ignore */ }
  }, [selectedTestbed]);

  const fetchTrainingJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ml/training-jobs`);
      if (res.ok) {
        const data = await res.json();
        setTrainingJobs(data.jobs || []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchDataStats = useCallback(async () => {
    try {
      const params = selectedTestbed ? `?testbed_id=${selectedTestbed}` : '';
      const res = await fetch(`${API_BASE}/api/ml/training-data/stats${params}`);
      if (res.ok) {
        const data = await res.json();
        setDataStats(data);
      }
    } catch { /* ignore */ }
  }, [selectedTestbed]);

  useEffect(() => {
    fetchTestbeds();
  }, [fetchTestbeds]);

  useEffect(() => {
    fetchInsights();
    fetchModels();
    fetchTrainingJobs();
    fetchDataStats();
  }, [selectedTestbed, fetchInsights, fetchModels, fetchTrainingJobs, fetchDataStats]);

  const handleTrainModel = async () => {
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/ml/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testbed_id: selectedTestbed || null }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(
          `Model trained successfully! Samples: ${data.samples_used}, ` +
          `CPU R²: ${data.metrics?.cpu_r2?.toFixed(3)}, ` +
          `Memory R²: ${data.metrics?.memory_r2?.toFixed(3)}`
        );
        fetchModels();
        fetchInsights();
        fetchTrainingJobs();
      } else {
        setError(data.error || 'Training failed');
      }
    } catch (e: any) {
      setError(e.message || 'Error triggering training');
    } finally {
      setLoading(false);
    }
  };

  const handlePredict = async () => {
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/ml/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testbed_id: selectedTestbed || null,
          entity_type: predEntity,
          operation: predOperation,
          current_cpu: predCpu,
          current_memory: predMemory,
        }),
      });
      const data = await res.json();
      if (data.success && data.prediction) {
        setPrediction(data.prediction);
      } else if (!data.model_trained) {
        setError('No trained model available. Train a model first.');
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const getR2Color = (r2: number): string => {
    if (r2 >= 0.7) return '#22c55e';
    if (r2 >= 0.4) return '#f59e0b';
    return '#ef4444';
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      COMPLETED: '#22c55e',
      RUNNING: '#3b82f6',
      FAILED: '#ef4444',
      PENDING: '#94a3b8',
    };
    return (
      <span className="status-badge" style={{ backgroundColor: colors[status] || '#64748b' }}>
        {status}
      </span>
    );
  };

  return (
    <div className="ml-insights-page">
      <div className="page-header">
        <h1>
          <span className="material-icons">psychology</span>
          ML Insights Dashboard
        </h1>
        <div className="header-controls">
          <select
            value={selectedTestbed}
            onChange={(e) => setSelectedTestbed(e.target.value)}
            className="testbed-select"
          >
            <option value="">All Testbeds (Global)</option>
            {testbeds.map(t => (
              <option key={t.unique_testbed_id} value={t.unique_testbed_id}>
                {t.testbed_label} ({t.unique_testbed_id.slice(0, 8)})
              </option>
            ))}
          </select>
          <button
            className="btn-train"
            onClick={handleTrainModel}
            disabled={loading}
          >
            <span className="material-icons">model_training</span>
            {loading ? 'Training...' : 'Train Model'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      <div className="tabs">
        {(['overview', 'models', 'training', 'predict'] as const).map(tab => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="tab-content">
          {/* Status Cards */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Model Status</div>
              <div className="stat-value" style={{
                color: insights?.model_status === 'trained' ? '#22c55e' : '#f59e0b'
              }}>
                {insights?.model_status === 'trained' ? 'Trained' : 'Not Trained'}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Training Samples</div>
              <div className="stat-value">{dataStats?.total_samples || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Entity Types</div>
              <div className="stat-value">{dataStats?.unique_entities || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Data Source</div>
              <div className="stat-value">{dataStats?.source || 'N/A'}</div>
            </div>
          </div>

          {/* Active Model */}
          {insights?.active_model && (
            <div className="section-card">
              <h3>Active Model</h3>
              <div className="model-details">
                <div className="detail-row">
                  <span>Model ID:</span>
                  <strong>{insights.active_model.model_id}</strong>
                </div>
                <div className="detail-row">
                  <span>Version:</span>
                  <strong>v{insights.active_model.model_version}</strong>
                </div>
                <div className="detail-row">
                  <span>Trained On:</span>
                  <strong>{insights.active_model.samples_used} samples</strong>
                </div>
                <div className="detail-row">
                  <span>Trained At:</span>
                  <strong>{formatDate(insights.active_model.trained_at)}</strong>
                </div>
                <div className="detail-row">
                  <span>CPU R²:</span>
                  <strong style={{ color: getR2Color(insights.active_model.cpu_r2 || 0) }}>
                    {(insights.active_model.cpu_r2 || 0).toFixed(3)}
                  </strong>
                </div>
                <div className="detail-row">
                  <span>Memory R²:</span>
                  <strong style={{ color: getR2Color(insights.active_model.memory_r2 || 0) }}>
                    {(insights.active_model.memory_r2 || 0).toFixed(3)}
                  </strong>
                </div>
                <div className="detail-row">
                  <span>Validation Score:</span>
                  <strong>{(insights.active_model.validation_score || 0).toFixed(3)}</strong>
                </div>
              </div>
            </div>
          )}

          {/* Feature Importance */}
          {insights?.feature_importance && Object.keys(insights.feature_importance).length > 0 && (
            <div className="section-card">
              <h3>Feature Importance</h3>
              {Object.entries(insights.feature_importance).map(([model, features]: [string, any]) => (
                <div key={model} className="feature-section">
                  <h4>{model === 'cpu_model' ? 'CPU Model' : 'Memory Model'}</h4>
                  <div className="feature-bars">
                    {Object.entries(features)
                      .sort(([, a]: any, [, b]: any) => b - a)
                      .map(([name, value]: [string, any]) => (
                        <div key={name} className="feature-bar-row">
                          <span className="feature-name">{name}</span>
                          <div className="feature-bar">
                            <div
                              className="feature-bar-fill"
                              style={{ width: `${Math.min(value * 100, 100)}%` }}
                            />
                          </div>
                          <span className="feature-value">{(value * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Accuracy Trend */}
          {insights?.accuracy_trend && insights.accuracy_trend.length > 0 && (
            <div className="section-card">
              <h3>Accuracy Trend</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>CPU R²</th>
                    <th>Memory R²</th>
                    <th>Samples</th>
                    <th>Trained At</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.accuracy_trend.map((entry: any, idx: number) => (
                    <tr key={idx}>
                      <td>v{entry.version}</td>
                      <td style={{ color: getR2Color(entry.cpu_r2 || 0) }}>
                        {(entry.cpu_r2 || 0).toFixed(3)}
                      </td>
                      <td style={{ color: getR2Color(entry.memory_r2 || 0) }}>
                        {(entry.memory_r2 || 0).toFixed(3)}
                      </td>
                      <td>{entry.samples}</td>
                      <td>{formatDate(entry.trained_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'models' && (
        <div className="tab-content">
          <div className="section-card">
            <h3>Model Registry ({models.length} models)</h3>
            {models.length === 0 ? (
              <p className="no-data">No models trained yet. Click "Train Model" to start.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Model ID</th>
                    <th>Version</th>
                    <th>Testbed</th>
                    <th>Samples</th>
                    <th>CPU R²</th>
                    <th>Memory R²</th>
                    <th>Score</th>
                    <th>Active</th>
                    <th>Trained At</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.model_id} className={m.is_active ? 'active-row' : ''}>
                      <td title={m.model_id}>{m.model_id.slice(0, 20)}...</td>
                      <td>v{m.model_version}</td>
                      <td>{m.testbed_id?.slice(0, 8) || 'Global'}</td>
                      <td>{m.samples_used}</td>
                      <td style={{ color: getR2Color(m.cpu_r2 || 0) }}>
                        {(m.cpu_r2 || 0).toFixed(3)}
                      </td>
                      <td style={{ color: getR2Color(m.memory_r2 || 0) }}>
                        {(m.memory_r2 || 0).toFixed(3)}
                      </td>
                      <td>{(m.validation_score || 0).toFixed(3)}</td>
                      <td>{m.is_active ? '✓' : ''}</td>
                      <td>{formatDate(m.trained_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'training' && (
        <div className="tab-content">
          <div className="section-card">
            <h3>Training Jobs ({trainingJobs.length})</h3>
            {trainingJobs.length === 0 ? (
              <p className="no-data">No training jobs yet.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Testbed</th>
                    <th>Status</th>
                    <th>Trigger</th>
                    <th>Samples</th>
                    <th>CPU R²</th>
                    <th>Memory R²</th>
                    <th>Started</th>
                    <th>Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {trainingJobs.map((j) => (
                    <tr key={j.job_id}>
                      <td title={j.job_id}>{j.job_id.slice(0, 20)}...</td>
                      <td>{j.testbed_id?.slice(0, 8) || 'Global'}</td>
                      <td>{getStatusBadge(j.status)}</td>
                      <td>{j.trigger_type}</td>
                      <td>{j.samples_used || 0}</td>
                      <td>{j.cpu_r2 ? j.cpu_r2.toFixed(3) : '-'}</td>
                      <td>{j.memory_r2 ? j.memory_r2.toFixed(3) : '-'}</td>
                      <td>{formatDate(j.started_at)}</td>
                      <td>{formatDate(j.completed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Training Data Stats */}
          {dataStats && (
            <div className="section-card">
              <h3>Training Data Statistics</h3>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">Total Samples</div>
                  <div className="stat-value">{dataStats.total_samples}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Entity Types</div>
                  <div className="stat-value">{dataStats.unique_entities}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Operations</div>
                  <div className="stat-value">{dataStats.unique_operations}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Data Source</div>
                  <div className="stat-value">{dataStats.source}</div>
                </div>
              </div>
              {dataStats.oldest_sample && (
                <p style={{ marginTop: '12px', color: '#94a3b8', fontSize: '0.9em' }}>
                  Data range: {formatDate(dataStats.oldest_sample)} — {formatDate(dataStats.newest_sample)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'predict' && (
        <div className="tab-content">
          <div className="section-card">
            <h3>Predict Operation Impact</h3>
            <p style={{ color: '#94a3b8', marginBottom: '16px' }}>
              Use the trained ML model to predict the impact of a specific operation on CPU and memory.
            </p>
            <div className="predict-form">
              <div className="form-row">
                <label>Entity Type</label>
                <select value={predEntity} onChange={(e) => setPredEntity(e.target.value)}>
                  <option value="vm">VM</option>
                  <option value="blueprint_multi_vm">Blueprint (Multi VM)</option>
                  <option value="blueprint_single_vm">Blueprint (Single VM)</option>
                  <option value="playbook">Playbook</option>
                  <option value="scenario">Scenario</option>
                  <option value="project">Project</option>
                  <option value="category">Category</option>
                  <option value="rate_card">Rate Card</option>
                  <option value="business_unit">Business Unit</option>
                  <option value="cost_center">Cost Center</option>
                </select>
              </div>
              <div className="form-row">
                <label>Operation</label>
                <select value={predOperation} onChange={(e) => setPredOperation(e.target.value)}>
                  <option value="CREATE">CREATE</option>
                  <option value="DELETE">DELETE</option>
                  <option value="UPDATE">UPDATE</option>
                  <option value="LIST">LIST</option>
                  <option value="EXECUTE">EXECUTE</option>
                  <option value="READ">READ</option>
                </select>
              </div>
              <div className="form-row">
                <label>Current CPU (%)</label>
                <input
                  type="number"
                  value={predCpu}
                  onChange={(e) => setPredCpu(Number(e.target.value))}
                  min={0} max={100}
                />
              </div>
              <div className="form-row">
                <label>Current Memory (%)</label>
                <input
                  type="number"
                  value={predMemory}
                  onChange={(e) => setPredMemory(Number(e.target.value))}
                  min={0} max={100}
                />
              </div>
              <button className="btn-predict" onClick={handlePredict}>
                <span className="material-icons">auto_awesome</span>
                Predict Impact
              </button>
            </div>

            {prediction && (
              <div className="prediction-result">
                <h4>Prediction Result</h4>
                <div className="prediction-grid">
                  <div className="prediction-card cpu">
                    <div className="prediction-label">CPU Impact</div>
                    <div className="prediction-value">+{prediction.cpu_impact.toFixed(2)}%</div>
                  </div>
                  <div className="prediction-card memory">
                    <div className="prediction-label">Memory Impact</div>
                    <div className="prediction-value">+{prediction.memory_impact.toFixed(2)}%</div>
                  </div>
                  <div className="prediction-card confidence">
                    <div className="prediction-label">Confidence</div>
                    <div className="prediction-value">{(prediction.confidence * 100).toFixed(0)}%</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MLInsights;
