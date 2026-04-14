import React, { useState, useEffect, useCallback } from 'react';
import ReactApexChart from 'react-apexcharts';
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

const r2Quality = (r2: number): { label: string; color: string; bg: string; icon: string } => {
  if (r2 >= 0.7) return { label: 'Strong', color: '#166534', bg: '#dcfce7', icon: 'check_circle' };
  if (r2 >= 0.4) return { label: 'Moderate', color: '#92400e', bg: '#fef3c7', icon: 'trending_up' };
  if (r2 >= 0.1) return { label: 'Weak', color: '#9a3412', bg: '#ffedd5', icon: 'trending_flat' };
  if (r2 >= 0) return { label: 'Very Weak', color: '#991b1b', bg: '#fee2e2', icon: 'trending_down' };
  return { label: 'Not Predictive', color: '#7f1d1d', bg: '#fecaca', icon: 'error_outline' };
};

const r2Percent = (r2: number) => Math.max(0, Math.round(r2 * 100));

const MLInsights: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<any>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [trainingJobs, setTrainingJobs] = useState<TrainingJob[]>([]);
  const [dataStats, setDataStats] = useState<DataStats | null>(null);
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbed, setSelectedTestbed] = useState('');
  const [training, setTraining] = useState(false);
  const [trainMsg, setTrainMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [predEntity, setPredEntity] = useState('vm');
  const [predOp, setPredOp] = useState('create');
  const [predCpu, setPredCpu] = useState(50);
  const [predMem, setPredMem] = useState(45);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [predicting, setPredicting] = useState(false);

  const [showModels, setShowModels] = useState(false);
  const [showJobs, setShowJobs] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = selectedTestbed ? `?testbed_id=${selectedTestbed}` : '';
      const [insRes, modRes, jobRes, statRes, tbRes] = await Promise.all([
        fetch(`${API_BASE}/api/ml/insights${qs}`),
        fetch(`${API_BASE}/api/ml/models${qs}`),
        fetch(`${API_BASE}/api/ml/training-jobs${qs}`),
        fetch(`${API_BASE}/api/ml/training-data/stats${qs}`),
        fetch(`${API_BASE}/api/get-testbeds`),
      ]);
      const [insD, modD, jobD, statD, tbD] = await Promise.all([insRes.json(), modRes.json(), jobRes.json(), statRes.json(), tbRes.json()]);
      setInsights(insD);
      setModels(modD.models || []);
      setTrainingJobs(jobD.jobs || []);
      setDataStats(statD);
      setTestbeds(tbD.testbeds || []);
    } catch (err) {
      console.error('ML Insights load error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedTestbed]);

  useEffect(() => { load(); }, [load]);

  const handleTrain = async () => {
    setTraining(true);
    setTrainMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/ml/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testbed_id: selectedTestbed || null }),
      });
      const d = await res.json();
      if (d.success) {
        setTrainMsg({ type: 'success', text: `Model trained on ${d.samples_used} samples — CPU accuracy ${r2Percent(d.metrics?.cpu_r2 || 0)}%, Memory accuracy ${r2Percent(d.metrics?.memory_r2 || 0)}%` });
        load();
      } else {
        setTrainMsg({ type: 'error', text: d.error || 'Training failed' });
      }
    } catch (e: any) {
      setTrainMsg({ type: 'error', text: e.message });
    } finally {
      setTraining(false);
    }
  };

  const handlePredict = async () => {
    setPredicting(true);
    setPrediction(null);
    try {
      const res = await fetch(`${API_BASE}/api/ml/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testbed_id: selectedTestbed || null, entity_type: predEntity, operation: predOp, current_cpu: predCpu, current_memory: predMem }),
      });
      const d = await res.json();
      if (d.success && d.prediction) setPrediction(d.prediction);
      else setTrainMsg({ type: 'error', text: d.error || 'No trained model available. Train a model first.' });
    } catch (e: any) {
      setTrainMsg({ type: 'error', text: e.message });
    } finally {
      setPredicting(false);
    }
  };

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString() : '—';

  const activeModel = insights?.active_model;
  const featureImportance = insights?.feature_importance || {};
  const accuracyTrend = (insights?.accuracy_trend || []).slice(0, 8);

  if (loading) {
    return (
      <div className="main-content">
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status" style={{ width: '3rem', height: '3rem' }}><span className="visually-hidden">Loading...</span></div>
          <p className="mt-3 text-muted">Loading ML insights...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-3">
        <div>
          <h2 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>psychology</i>
            </div>
            ML Insights
          </h2>
          <p className="text-muted mb-0" style={{ maxWidth: 600 }}>
            The ML system learns from every Smart Execution you run. It tracks how each operation (VM create, project delete, etc.) affects CPU and memory, then uses that data to make smarter decisions in future executions.
          </p>
        </div>
        <div className="d-flex gap-2 align-items-center flex-wrap">
          <select className="form-select form-select-sm rounded-3" style={{ width: 'auto' }} value={selectedTestbed} onChange={e => setSelectedTestbed(e.target.value)}>
            <option value="">All Testbeds (Global)</option>
            {testbeds.map(t => <option key={t.unique_testbed_id} value={t.unique_testbed_id}>{t.testbed_label}</option>)}
          </select>
          <button className="btn btn-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={handleTrain} disabled={training}>
            {training ? <><span className="spinner-border spinner-border-sm"></span>Training...</> : <><i className="material-icons-outlined" style={{ fontSize: 18 }}>model_training</i>Retrain Model</>}
          </button>
          <button className="btn btn-outline-secondary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={load}>
            <i className="material-icons-outlined" style={{ fontSize: 18 }}>refresh</i>
          </button>
        </div>
      </div>

      {/* Alert messages */}
      {trainMsg && (
        <div className={`alert ${trainMsg.type === 'success' ? 'alert-success' : 'alert-danger'} rounded-3 d-flex align-items-center gap-2 mb-4`} role="alert">
          <i className="material-icons-outlined" style={{ fontSize: 20 }}>{trainMsg.type === 'success' ? 'check_circle' : 'error'}</i>
          {trainMsg.text}
          <button type="button" className="btn-close ms-auto" onClick={() => setTrainMsg(null)}></button>
        </div>
      )}

      {/* ───── HOW IT WORKS BANNER ───── */}
      <div className="card rounded-4 border shadow-none mb-4" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #ede9fe 100%)' }}>
        <div className="card-body p-4">
          <h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
            <i className="material-icons-outlined text-primary" style={{ fontSize: 22 }}>auto_awesome</i>
            How the ML System Works
          </h6>
          <div className="row g-3">
            {[
              { icon: 'storage', title: 'Collects Data', desc: 'Every operation in Smart Execution records its CPU and memory impact' },
              { icon: 'model_training', title: 'Trains Models', desc: 'A machine learning model learns which operations have the biggest resource impact' },
              { icon: 'psychology', title: 'Predicts Impact', desc: 'Before running operations, the AI predicts their resource cost and prioritizes accordingly' },
              { icon: 'tune', title: 'Improves Over Time', desc: 'More executions = more data = better predictions, making each run smarter' },
            ].map((step, i) => (
              <div className="col-md-3" key={i}>
                <div className="d-flex align-items-start gap-2">
                  <div className="d-flex align-items-center justify-content-center rounded-circle flex-shrink-0" style={{ width: 36, height: 36, background: '#667eea', color: 'white', fontWeight: 700, fontSize: 14 }}>{i + 1}</div>
                  <div>
                    <div className="fw-semibold" style={{ fontSize: '0.85rem' }}>{step.title}</div>
                    <div className="text-muted" style={{ fontSize: '0.78rem' }}>{step.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ───── STATUS CARDS ───── */}
      <div className="row g-3 mb-4">
        {[
          { icon: 'check_circle', label: 'Model Status', value: insights?.model_status === 'trained' ? 'Trained' : 'Not Trained', color: insights?.model_status === 'trained' ? '#22c55e' : '#f59e0b' },
          { icon: 'database', label: 'Training Samples', value: (dataStats?.total_samples || 0).toLocaleString(), color: '#3b82f6', sub: `from ${dataStats?.unique_entities || 0} entity types, ${dataStats?.unique_operations || 0} operations` },
          { icon: 'timeline', label: 'Model Versions', value: models.length, color: '#8b5cf6', sub: activeModel ? `Active: v${activeModel.model_version}` : undefined },
          { icon: 'school', label: 'Training Runs', value: trainingJobs.length, color: '#06b6d4', sub: trainingJobs.filter(j => j.status === 'COMPLETED').length + ' successful' },
        ].map((c, i) => (
          <div className="col-md-3" key={i}>
            <div className="card rounded-4 border shadow-none h-100">
              <div className="card-body d-flex align-items-center gap-3 p-3">
                <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 48, height: 48, background: `${c.color}15` }}>
                  <i className="material-icons-outlined" style={{ fontSize: 26, color: c.color }}>{c.icon}</i>
                </div>
                <div>
                  <div className="text-muted small">{c.label}</div>
                  <div className="fw-bold fs-5" style={{ color: c.color }}>{c.value}</div>
                  {c.sub && <div className="text-muted" style={{ fontSize: '0.72rem' }}>{c.sub}</div>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ───── ACTIVE MODEL ACCURACY ───── */}
      {activeModel && (
        <div className="card rounded-4 border shadow-none mb-4">
          <div className="card-header bg-transparent border-bottom p-4">
            <h5 className="mb-0 fw-semibold d-flex align-items-center gap-2">
              <i className="material-icons-outlined text-success" style={{ fontSize: 22 }}>verified</i>
              Current Model Accuracy
              <span className="badge bg-primary rounded-pill ms-2">v{activeModel.model_version}</span>
            </h5>
            <p className="text-muted mb-0 mt-1" style={{ fontSize: '0.82rem' }}>
              Trained on {activeModel.samples_used} samples — higher accuracy means the AI makes better resource predictions
            </p>
            {(activeModel.cpu_r2 || 0) <= 0 && (activeModel.memory_r2 || 0) <= 0 && (
              <div className="d-flex align-items-start gap-2 mt-2 p-2 rounded-3" style={{ background: '#fef3c7', border: '1px solid #fcd34d' }}>
                <i className="material-icons-outlined flex-shrink-0" style={{ fontSize: 18, color: '#92400e' }}>info</i>
                <span className="small" style={{ color: '#92400e' }}>
                  Accuracy is low because the current training data doesn't have strong resource patterns. This improves as more real Smart Executions with varying workloads are completed.
                </span>
              </div>
            )}
          </div>
          <div className="card-body p-4">
            <div className="row g-4">
              {/* CPU Accuracy */}
              {(() => { const q = r2Quality(activeModel.cpu_r2 || 0); const pct = r2Percent(activeModel.cpu_r2 || 0); return (
                <div className="col-md-6">
                  <div className="p-3 rounded-3" style={{ background: q.bg, border: `1px solid ${q.color}22` }}>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="fw-semibold">CPU Prediction Accuracy</span>
                      <span className="badge rounded-pill" style={{ background: q.color, color: 'white' }}>
                        <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>{q.icon}</i> {q.label}
                      </span>
                    </div>
                    <div className="d-flex align-items-end gap-2 mb-2">
                      <span className="fw-bold" style={{ fontSize: '2rem', color: q.color }}>{pct}%</span>
                      <span className="text-muted small mb-1">R² = {(activeModel.cpu_r2 || 0).toFixed(3)}</span>
                    </div>
                    <div className="progress rounded-pill" style={{ height: 8 }}>
                      <div className="progress-bar rounded-pill" style={{ width: `${Math.max(pct, 3)}%`, background: q.color }}></div>
                    </div>
                    <div className="text-muted mt-2" style={{ fontSize: '0.75rem' }}>
                      {pct >= 70 ? 'The model reliably predicts how operations affect CPU usage.' : pct >= 40 ? 'The model captures general CPU patterns but may miss some edge cases.' : pct > 0 ? 'Predictions are unreliable — run more diverse workloads to improve.' : 'Not enough distinct resource patterns in training data yet.'}
                    </div>
                  </div>
                </div>
              ); })()}

              {/* Memory Accuracy */}
              {(() => { const q = r2Quality(activeModel.memory_r2 || 0); const pct = r2Percent(activeModel.memory_r2 || 0); return (
                <div className="col-md-6">
                  <div className="p-3 rounded-3" style={{ background: q.bg, border: `1px solid ${q.color}22` }}>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="fw-semibold">Memory Prediction Accuracy</span>
                      <span className="badge rounded-pill" style={{ background: q.color, color: 'white' }}>
                        <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>{q.icon}</i> {q.label}
                      </span>
                    </div>
                    <div className="d-flex align-items-end gap-2 mb-2">
                      <span className="fw-bold" style={{ fontSize: '2rem', color: q.color }}>{pct}%</span>
                      <span className="text-muted small mb-1">R² = {(activeModel.memory_r2 || 0).toFixed(3)}</span>
                    </div>
                    <div className="progress rounded-pill" style={{ height: 8 }}>
                      <div className="progress-bar rounded-pill" style={{ width: `${Math.max(pct, 3)}%`, background: q.color }}></div>
                    </div>
                    <div className="text-muted mt-2" style={{ fontSize: '0.75rem' }}>
                      {pct >= 70 ? 'The model reliably predicts how operations affect memory usage.' : pct >= 40 ? 'The model captures general memory patterns but may miss some edge cases.' : pct > 0 ? 'Predictions are unreliable — run more diverse workloads to improve.' : 'Not enough distinct resource patterns in training data yet.'}
                    </div>
                  </div>
                </div>
              ); })()}
            </div>
          </div>
        </div>
      )}

      {/* ───── ACCURACY TREND CHART ───── */}
      {accuracyTrend.length > 1 && (
        <div className="card rounded-4 border shadow-none mb-4">
          <div className="card-header bg-transparent border-bottom p-4">
            <h5 className="mb-0 fw-semibold d-flex align-items-center gap-2">
              <i className="material-icons-outlined text-info" style={{ fontSize: 22 }}>show_chart</i>
              Accuracy Over Time
            </h5>
            <p className="text-muted mb-0 mt-1" style={{ fontSize: '0.82rem' }}>
              Each point is a model version — accuracy should trend upward as more data is collected
            </p>
          </div>
          <div className="card-body p-4">
            <ReactApexChart
              type="line"
              height={260}
              series={[
                { name: 'CPU Accuracy %', data: [...accuracyTrend].reverse().map((e: any) => Math.max(0, r2Percent(e.cpu_r2 || 0))) },
                { name: 'Memory Accuracy %', data: [...accuracyTrend].reverse().map((e: any) => Math.max(0, r2Percent(e.memory_r2 || 0))) },
              ]}
              options={{
                chart: { toolbar: { show: false }, fontFamily: 'inherit', zoom: { enabled: false } },
                colors: ['#3b82f6', '#8b5cf6'],
                stroke: { curve: 'smooth', width: 2.5 },
                markers: { size: 5 },
                xaxis: { categories: [...accuracyTrend].reverse().map((e: any) => `v${e.version}`), labels: { style: { fontSize: '11px' } } },
                yaxis: { min: 0, max: 100, labels: { formatter: (v: number) => `${v}%` } },
                grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
                tooltip: { y: { formatter: (v: number) => `${v}%` } },
                legend: { position: 'top' },
              }}
            />
          </div>
        </div>
      )}

      {/* ───── FEATURE IMPORTANCE ───── */}
      {Object.keys(featureImportance).length > 0 && (
        <div className="card rounded-4 border shadow-none mb-4">
          <div className="card-header bg-transparent border-bottom p-4">
            <h5 className="mb-0 fw-semibold d-flex align-items-center gap-2">
              <i className="material-icons-outlined text-warning" style={{ fontSize: 22 }}>bar_chart</i>
              What Affects Resources Most?
            </h5>
            <p className="text-muted mb-0 mt-1" style={{ fontSize: '0.82rem' }}>
              Shows which factors the ML model considers most important when predicting resource impact — higher bars mean stronger influence
            </p>
          </div>
          <div className="card-body p-4">
            <div className="row g-4">
              {Object.entries(featureImportance).map(([modelName, feats]: [string, any]) => {
                const isCpu = modelName.includes('cpu');
                const sorted = Object.entries(feats).sort(([, a]: any, [, b]: any) => (b as number) - (a as number)).slice(0, 8);
                const friendlyNames: Record<string, string> = {
                  current_cpu: 'Current CPU %', current_memory: 'Current Memory %', entity_encoded: 'Entity Type',
                  operation_encoded: 'Operation Type', concurrent_ops: 'Parallel Operations', duration_seconds: 'Operation Duration',
                  current_load: 'System Load', cpu_trend: 'CPU Trend', memory_trend: 'Memory Trend',
                  cluster_size: 'Cluster Size', success_rate: 'Success Rate', hour_of_day: 'Time of Day',
                };
                return (
                  <div className="col-md-6" key={modelName}>
                    <h6 className="fw-semibold mb-3 d-flex align-items-center gap-2">
                      <i className="material-icons-outlined" style={{ fontSize: 18, color: isCpu ? '#3b82f6' : '#8b5cf6' }}>{isCpu ? 'memory' : 'storage'}</i>
                      {isCpu ? 'CPU Model' : 'Memory Model'}
                    </h6>
                    {sorted.map(([name, val]: [string, any]) => {
                      const pct = Math.min((val as number) * 100, 100);
                      return (
                        <div className="d-flex align-items-center gap-2 mb-2" key={name}>
                          <div className="text-muted text-end flex-shrink-0" style={{ width: 140, fontSize: '0.8rem' }}>{friendlyNames[name] || name.replace(/_/g, ' ')}</div>
                          <div className="flex-grow-1">
                            <div className="progress rounded-pill" style={{ height: 14 }}>
                              <div className="progress-bar rounded-pill" style={{ width: `${Math.max(pct, 2)}%`, background: isCpu ? '#3b82f6' : '#8b5cf6' }}></div>
                            </div>
                          </div>
                          <div className="fw-medium flex-shrink-0" style={{ width: 45, fontSize: '0.8rem', textAlign: 'right' }}>{pct.toFixed(1)}%</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ───── PREDICT IMPACT ───── */}
      <div className="card rounded-4 border shadow-none mb-4">
        <div className="card-header bg-transparent border-bottom p-4">
          <h5 className="mb-0 fw-semibold d-flex align-items-center gap-2">
            <i className="material-icons-outlined text-primary" style={{ fontSize: 22 }}>auto_awesome</i>
            Predict Operation Impact
          </h5>
          <p className="text-muted mb-0 mt-1" style={{ fontSize: '0.82rem' }}>
            Use the trained model to estimate how a specific operation would affect your cluster right now. Enter the current resource levels and the operation you plan to run.
          </p>
        </div>
        <div className="card-body p-4">
          <div className="row g-3 mb-3">
            <div className="col-md-3">
              <label className="form-label fw-medium small">Entity Type</label>
              <select className="form-select form-select-sm rounded-3" value={predEntity} onChange={e => setPredEntity(e.target.value)}>
                {['vm', 'project', 'category', 'image', 'subnet', 'cluster'].map(e => <option key={e} value={e}>{e.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label fw-medium small">Operation</label>
              <select className="form-select form-select-sm rounded-3" value={predOp} onChange={e => setPredOp(e.target.value)}>
                {['create', 'delete', 'update', 'list'].map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label fw-medium small">Current CPU %</label>
              <input type="number" className="form-control form-control-sm rounded-3" value={predCpu} onChange={e => setPredCpu(Number(e.target.value))} min={0} max={100} />
            </div>
            <div className="col-md-2">
              <label className="form-label fw-medium small">Current Memory %</label>
              <input type="number" className="form-control form-control-sm rounded-3" value={predMem} onChange={e => setPredMem(Number(e.target.value))} min={0} max={100} />
            </div>
            <div className="col-md-2 d-flex align-items-end">
              <button className="btn btn-primary btn-sm rounded-3 w-100 d-flex align-items-center justify-content-center gap-1" onClick={handlePredict} disabled={predicting || insights?.model_status !== 'trained'}>
                {predicting ? <span className="spinner-border spinner-border-sm"></span> : <i className="material-icons-outlined" style={{ fontSize: 18 }}>auto_awesome</i>}
                Predict
              </button>
            </div>
          </div>

          {prediction && (
            <div className="row g-3 mt-1">
              <div className="col-md-4">
                <div className="p-3 rounded-3 text-center" style={{ background: '#dbeafe', border: '1px solid #93c5fd' }}>
                  <div className="text-muted small fw-medium">Predicted CPU Change</div>
                  <div className="fw-bold fs-4" style={{ color: prediction.cpu_impact >= 0 ? '#dc2626' : '#16a34a' }}>
                    {prediction.cpu_impact >= 0 ? '+' : ''}{prediction.cpu_impact.toFixed(2)}%
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                    {predCpu}% → ~{Math.min(100, Math.max(0, predCpu + prediction.cpu_impact)).toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <div className="p-3 rounded-3 text-center" style={{ background: '#ede9fe', border: '1px solid #c4b5fd' }}>
                  <div className="text-muted small fw-medium">Predicted Memory Change</div>
                  <div className="fw-bold fs-4" style={{ color: prediction.memory_impact >= 0 ? '#dc2626' : '#16a34a' }}>
                    {prediction.memory_impact >= 0 ? '+' : ''}{prediction.memory_impact.toFixed(2)}%
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                    {predMem}% → ~{Math.min(100, Math.max(0, predMem + prediction.memory_impact)).toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <div className="p-3 rounded-3 text-center" style={{ background: prediction.confidence >= 0.7 ? '#dcfce7' : '#fef3c7', border: `1px solid ${prediction.confidence >= 0.7 ? '#86efac' : '#fcd34d'}` }}>
                  <div className="text-muted small fw-medium">Prediction Confidence</div>
                  <div className="fw-bold fs-4" style={{ color: prediction.confidence >= 0.7 ? '#166534' : '#92400e' }}>
                    {(prediction.confidence * 100).toFixed(0)}%
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                    {prediction.confidence >= 0.7 ? 'High confidence' : prediction.confidence >= 0.4 ? 'Moderate confidence' : 'Low confidence — more data needed'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ───── COLLAPSIBLE: MODEL HISTORY ───── */}
      <div className="card rounded-4 border shadow-none mb-4">
        <div className="card-header bg-transparent p-4" role="button" onClick={() => setShowModels(!showModels)} style={{ cursor: 'pointer' }}>
          <h5 className="mb-0 fw-semibold d-flex align-items-center gap-2">
            <i className="material-icons-outlined text-muted" style={{ fontSize: 22 }}>inventory_2</i>
            Model History
            <span className="badge bg-light text-muted rounded-pill">{models.length}</span>
            <i className="material-icons-outlined ms-auto text-muted" style={{ fontSize: 22 }}>{showModels ? 'expand_less' : 'expand_more'}</i>
          </h5>
        </div>
        {showModels && (
          <div className="card-body p-0">
            {models.length === 0 ? (
              <div className="text-center py-4 text-muted">No models trained yet</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.82rem' }}>
                  <thead className="table-light">
                    <tr><th className="ps-4">Version</th><th>Samples</th><th>CPU Accuracy</th><th>Memory Accuracy</th><th>Score</th><th>Active</th><th>Trained</th></tr>
                  </thead>
                  <tbody>
                    {models.map(m => {
                      const cq = r2Quality(m.cpu_r2 || 0);
                      const mq = r2Quality(m.memory_r2 || 0);
                      return (
                        <tr key={m.model_id} style={{ background: m.is_active ? '#eff6ff' : undefined }}>
                          <td className="ps-4 fw-medium">v{m.model_version}</td>
                          <td>{m.samples_used}</td>
                          <td><span className="badge rounded-pill" style={{ background: cq.bg, color: cq.color, fontSize: '0.75rem' }}>{r2Percent(m.cpu_r2 || 0)}% {cq.label}</span></td>
                          <td><span className="badge rounded-pill" style={{ background: mq.bg, color: mq.color, fontSize: '0.75rem' }}>{r2Percent(m.memory_r2 || 0)}% {mq.label}</span></td>
                          <td>{(m.validation_score || 0).toFixed(2)}</td>
                          <td>{m.is_active && <i className="material-icons-outlined text-success" style={{ fontSize: 18 }}>check_circle</i>}</td>
                          <td className="text-muted">{fmtDate(m.trained_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ───── COLLAPSIBLE: TRAINING JOBS ───── */}
      <div className="card rounded-4 border shadow-none mb-4">
        <div className="card-header bg-transparent p-4" role="button" onClick={() => setShowJobs(!showJobs)} style={{ cursor: 'pointer' }}>
          <h5 className="mb-0 fw-semibold d-flex align-items-center gap-2">
            <i className="material-icons-outlined text-muted" style={{ fontSize: 22 }}>history</i>
            Training Jobs
            <span className="badge bg-light text-muted rounded-pill">{trainingJobs.length}</span>
            <i className="material-icons-outlined ms-auto text-muted" style={{ fontSize: 22 }}>{showJobs ? 'expand_less' : 'expand_more'}</i>
          </h5>
        </div>
        {showJobs && (
          <div className="card-body p-0">
            {trainingJobs.length === 0 ? (
              <div className="text-center py-4 text-muted">No training jobs yet</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.82rem' }}>
                  <thead className="table-light">
                    <tr><th className="ps-4">Status</th><th>Trigger</th><th>Samples</th><th>CPU Acc.</th><th>Memory Acc.</th><th>Started</th></tr>
                  </thead>
                  <tbody>
                    {trainingJobs.map(j => (
                      <tr key={j.job_id}>
                        <td className="ps-4"><span className={`badge rounded-pill ${j.status === 'COMPLETED' ? 'bg-success' : j.status === 'FAILED' ? 'bg-danger' : j.status === 'RUNNING' ? 'bg-info' : 'bg-secondary'}`}>{j.status}</span></td>
                        <td className="text-muted">{(j.trigger_type || '').replace(/_/g, ' ')}</td>
                        <td>{j.samples_used || '—'}</td>
                        <td>{j.cpu_r2 != null ? `${r2Percent(j.cpu_r2)}%` : '—'}</td>
                        <td>{j.memory_r2 != null ? `${r2Percent(j.memory_r2)}%` : '—'}</td>
                        <td className="text-muted">{fmtDate(j.started_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ───── DATA STATS FOOTER ───── */}
      {dataStats && (
        <div className="text-muted small text-center pb-3">
          Training data: {dataStats.total_samples.toLocaleString()} samples across {dataStats.unique_entities} entity types and {dataStats.unique_operations} operations
          {dataStats.oldest_sample && <> — from {fmtDate(dataStats.oldest_sample)} to {fmtDate(dataStats.newest_sample)}</>}
        </div>
      )}
    </div>
  );
};

export default MLInsights;
