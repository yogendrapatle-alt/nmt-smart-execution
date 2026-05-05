import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactApexChart from 'react-apexcharts';
import { getApiBase } from '../utils/backendUrl';
import { SkeletonTable } from '../components/ui/LoadingSkeleton';

interface Execution {
  execution_id: string;
  execution_name?: string;
  testbed_label?: string;
  status: string;
  total_operations: number;
  successful_operations: number;
  failed_operations: number;
  success_rate: number;
  duration_minutes: number;
  start_time: string;
}

interface CompResult {
  execution_id: string;
  execution_name?: string;
  testbed_label?: string;
  status: string;
  total_operations: number;
  success_rate: number;
  duration_minutes: number;
  baseline_cpu?: number;
  baseline_memory?: number;
  final_cpu?: number;
  final_memory?: number;
  cpu_change?: number;
  memory_change?: number;
  operations_per_minute?: number;
  latency_avg?: number;
  anomaly_count?: number;
  metric_iterations?: number;
  threshold_reached?: boolean;
  learning_summary?: string;
  tags?: string[];
  start_time?: string;
  end_time?: string;
}

interface Summary {
  fastest?: string;
  highest_success?: string;
  most_efficient?: string;
}

const COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e'];

const API_BASE = getApiBase();

const AnalyticsComparison: React.FC = () => {
  const navigate = useNavigate();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<CompResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExecs, setLoadingExecs] = useState(true);
  const [expandedSummary, setExpandedSummary] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/smart-execution/history?limit=50`);
        const d = await res.json();
        setExecutions((d.executions || []).filter((e: Execution) => e.status !== 'RUNNING'));
      } catch (err) {
        console.error('Failed to load executions:', err);
      } finally {
        setLoadingExecs(false);
      }
    })();
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 5 ? [...prev, id] : prev);
  }, []);

  const runComparison = async () => {
    if (selected.length < 2) return;
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/smart-execution/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execution_ids: selected }),
      });
      const d = await res.json();
      if (d.success) {
        setResults(d.comparisons || []);
        setSummary(d.summary || null);
      }
    } catch (err) {
      console.error('Comparison failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const label = (e: CompResult | Execution) => {
    const name = ('execution_name' in e ? e.execution_name : '') || '';
    if (name) return name.length > 28 ? name.slice(0, 28) + '...' : name;
    const tb = ('testbed_label' in e ? e.testbed_label : '') || '';
    if (tb) return `${tb} (${e.execution_id.slice(-8)})`;
    return e.execution_id.slice(0, 20) + '...';
  };

  const shortLabel = (e: CompResult) => {
    const name = e.execution_name || '';
    if (name) return name.length > 16 ? name.slice(0, 16) + '..' : name;
    const tb = e.testbed_label || '';
    if (tb) return tb.length > 12 ? `${tb.slice(0, 12)}..` : `${tb}-${e.execution_id.slice(-4)}`;
    return e.execution_id.slice(6, 20);
  };

  const statusBadge = (s: string) => {
    const upper = (s || '').toUpperCase();
    const map: Record<string, string> = { COMPLETED: 'bg-success', STOPPED: 'bg-warning text-dark', FAILED: 'bg-danger', TIMEOUT: 'bg-secondary', THRESHOLD_REACHED: 'bg-primary' };
    return <span className={`badge ${map[upper] || 'bg-secondary'} rounded-pill`}>{upper}</span>;
  };

  const bestId = (metric: keyof CompResult, mode: 'max' | 'min' = 'max') => {
    if (!results.length) return null;
    let best = results[0];
    for (const r of results) {
      const bv = (best[metric] as number) ?? 0;
      const rv = (r[metric] as number) ?? 0;
      if (mode === 'max' ? rv > bv : rv < bv) best = r;
    }
    return best.execution_id;
  };

  const pct = (v: number | undefined) => v != null ? `${v.toFixed(1)}%` : '—';
  const num = (v: number | undefined, d = 1) => v != null ? v.toFixed(d) : '—';

  const chartLabels = results.map(r => shortLabel(r));

  return (
    <div className="main-content">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>compare</i>
            </div>
            Execution Comparison
          </h2>
          <p className="text-muted mb-0">
            Compare 2–5 executions side-by-side — see differences in operations, success rate, resource impact, latency, and anomalies to identify the most efficient runs.
          </p>
        </div>
        <button className="btn btn-outline-secondary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={() => navigate('/analytics/dashboard')}>
          <i className="material-icons-outlined" style={{ fontSize: 18 }}>arrow_back</i>Analytics
        </button>
      </div>

      {/* Selection */}
      <div className="card rounded-4 border shadow-none mb-4">
        <div className="card-header bg-transparent border-bottom p-4 d-flex justify-content-between align-items-center">
          <div>
            <h5 className="mb-1 fw-semibold d-flex align-items-center gap-2">
              <i className="material-icons-outlined text-primary" style={{ fontSize: 22 }}>checklist</i>
              Select Executions
              <span className="badge bg-primary rounded-pill">{selected.length}/5</span>
            </h5>
            <p className="text-muted mb-0 small">Click rows to select, then press Compare. Only non-running executions are shown.</p>
          </div>
          <button className="btn btn-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={runComparison} disabled={selected.length < 2 || loading}>
            {loading ? <><span className="spinner-border spinner-border-sm me-1" role="status"></span>Comparing...</> : <><i className="material-icons-outlined" style={{ fontSize: 18 }}>compare_arrows</i>Compare ({selected.length})</>}
          </button>
        </div>
        <div className="card-body p-4">
          {loadingExecs ? (
            <div className="p-3"><SkeletonTable rows={4} cols={5} /></div>
          ) : executions.length === 0 ? (
            <div className="text-center py-4 text-muted">No completed executions found</div>
          ) : (
            <div className="table-responsive" style={{ maxHeight: 350, overflowY: 'auto' }}>
              <table className="table table-sm table-hover align-middle mb-0">
                <thead className="table-light sticky-top">
                  <tr><th style={{ width: 40 }}></th><th>Execution</th><th>Testbed</th><th>Status</th><th className="text-end">Ops</th><th className="text-end">Success</th><th className="text-end">Duration</th></tr>
                </thead>
                <tbody>
                  {executions.map(e => {
                    const checked = selected.includes(e.execution_id);
                    return (
                      <tr key={e.execution_id} onClick={() => toggle(e.execution_id)} style={{ cursor: 'pointer', background: checked ? '#eff6ff' : undefined }}>
                        <td><input type="checkbox" checked={checked} readOnly className="form-check-input" /></td>
                        <td>
                          <div className="fw-medium" style={{ fontSize: '0.85rem' }}>{e.execution_name || <code className="small">{e.execution_id.slice(0, 22)}...</code>}</div>
                          <div className="text-muted" style={{ fontSize: '0.7rem' }}>{e.start_time ? new Date(e.start_time).toLocaleString() : ''}</div>
                        </td>
                        <td className="small text-muted">{e.testbed_label || '—'}</td>
                        <td>{statusBadge(e.status)}</td>
                        <td className="text-end fw-medium">{e.total_operations}</td>
                        <td className="text-end">{e.success_rate?.toFixed(1)}%</td>
                        <td className="text-end">{e.duration_minutes?.toFixed(1)}m</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ========== RESULTS ========== */}
      {results.length > 0 && (
        <>
          {/* Winner Banner */}
          {summary && (
            <div className="row g-3 mb-4">
              {[
                { key: 'fastest', icon: 'speed', color: '#22c55e', bg: 'linear-gradient(135deg,#dcfce7,#f0fdf4)', title: 'Fastest Execution', sub: 'Shortest run duration' },
                { key: 'highest_success', icon: 'verified', color: '#3b82f6', bg: 'linear-gradient(135deg,#dbeafe,#eff6ff)', title: 'Highest Success Rate', sub: 'Best operation success' },
                { key: 'most_efficient', icon: 'emoji_events', color: '#f59e0b', bg: 'linear-gradient(135deg,#fef3c7,#fffbeb)', title: 'Most Efficient', sub: 'Best ops/minute throughput' },
              ].filter(b => (summary as any)[b.key]).map(b => {
                const winnerId = (summary as any)[b.key];
                const winner = results.find(r => r.execution_id === winnerId);
                return (
                  <div className="col-md-4" key={b.key}>
                    <div className="card rounded-4 border shadow-none h-100" style={{ background: b.bg }}>
                      <div className="card-body d-flex align-items-center gap-3 p-3">
                        <i className="material-icons-outlined" style={{ fontSize: 36, color: b.color }}>{b.icon}</i>
                        <div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>{b.title}</div>
                          <div className="fw-bold">{winner ? label(winner) : winnerId.slice(0, 20)}</div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>{b.sub}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ===== DETAILED COMPARISON TABLE ===== */}
          <div className="card rounded-4 border shadow-none mb-4">
            <div className="card-header bg-transparent border-bottom p-4">
              <h5 className="mb-1 fw-semibold d-flex align-items-center gap-2">
                <i className="material-icons-outlined text-primary" style={{ fontSize: 22 }}>table_chart</i>
                Detailed Comparison
              </h5>
              <p className="text-muted mb-0 small">
                Green highlight marks the best value per metric. Click any row to view that execution's full report.
              </p>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.88rem' }}>
                  <thead className="table-light">
                    <tr>
                      <th className="ps-4 text-muted fw-semibold" style={{ minWidth: 180 }}>Metric</th>
                      {results.map((r, i) => (
                        <th key={r.execution_id} className="text-center" style={{ minWidth: 140, cursor: 'pointer' }} onClick={() => navigate(`/smart-execution/report/${r.execution_id}`)}>
                          <div className="d-flex align-items-center justify-content-center gap-1">
                            <span className="rounded-circle d-inline-block" style={{ width: 10, height: 10, background: COLORS[i] }}></span>
                            <span className="fw-semibold">{shortLabel(r)}</span>
                          </div>
                          <div className="text-muted" style={{ fontSize: '0.68rem' }}>{r.testbed_label || '—'}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Status */}
                    <tr>
                      <td className="ps-4 text-muted fw-medium">Status</td>
                      {results.map(r => <td key={r.execution_id} className="text-center">{statusBadge(r.status)}</td>)}
                    </tr>
                    {/* Operations */}
                    <tr>
                      <td className="ps-4 text-muted fw-medium">
                        <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 16 }}>functions</i>Total Operations
                      </td>
                      {results.map(r => {
                        const isBest = r.execution_id === bestId('total_operations');
                        return <td key={r.execution_id} className="text-center fw-bold" style={isBest ? { background: '#f0fdf4' } : undefined}>{r.total_operations}{isBest && <i className="material-icons-outlined text-success ms-1" style={{ fontSize: 14 }}>star</i>}</td>;
                      })}
                    </tr>
                    {/* Success Rate */}
                    <tr>
                      <td className="ps-4 text-muted fw-medium">
                        <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 16 }}>check_circle</i>Success Rate
                      </td>
                      {results.map(r => {
                        const isBest = r.execution_id === bestId('success_rate');
                        return (
                          <td key={r.execution_id} className="text-center fw-bold" style={isBest ? { background: '#f0fdf4' } : undefined}>
                            <span className={r.success_rate >= 90 ? 'text-success' : r.success_rate >= 70 ? 'text-warning' : 'text-danger'}>{pct(r.success_rate)}</span>
                            {isBest && <i className="material-icons-outlined text-success ms-1" style={{ fontSize: 14 }}>star</i>}
                          </td>
                        );
                      })}
                    </tr>
                    {/* Duration */}
                    <tr>
                      <td className="ps-4 text-muted fw-medium">
                        <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 16 }}>timer</i>Duration
                      </td>
                      {results.map(r => {
                        const isBest = r.execution_id === bestId('duration_minutes', 'min');
                        return <td key={r.execution_id} className="text-center" style={isBest ? { background: '#f0fdf4' } : undefined}>{num(r.duration_minutes)} min{isBest && <i className="material-icons-outlined text-success ms-1" style={{ fontSize: 14 }}>star</i>}</td>;
                      })}
                    </tr>
                    {/* Ops/min */}
                    <tr>
                      <td className="ps-4 text-muted fw-medium">
                        <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 16 }}>speed</i>Throughput (ops/min)
                      </td>
                      {results.map(r => {
                        const isBest = r.execution_id === bestId('operations_per_minute');
                        return <td key={r.execution_id} className="text-center" style={isBest ? { background: '#f0fdf4' } : undefined}>{num(r.operations_per_minute, 2)}{isBest && <i className="material-icons-outlined text-success ms-1" style={{ fontSize: 14 }}>star</i>}</td>;
                      })}
                    </tr>
                    {/* Baseline CPU */}
                    <tr className="table-light"><td colSpan={results.length + 1} className="ps-4 fw-semibold small text-uppercase text-muted py-2">Resource Impact — CPU</td></tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">Baseline CPU</td>
                      {results.map(r => <td key={r.execution_id} className="text-center">{pct(r.baseline_cpu)}</td>)}
                    </tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">Final CPU</td>
                      {results.map(r => <td key={r.execution_id} className="text-center fw-semibold">{pct(r.final_cpu)}</td>)}
                    </tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">CPU Change</td>
                      {results.map(r => {
                        const v = r.cpu_change ?? 0;
                        return <td key={r.execution_id} className="text-center fw-bold" style={{ color: v > 0 ? '#ef4444' : v < 0 ? '#22c55e' : '#6b7280' }}>{v > 0 ? '+' : ''}{num(v)}%</td>;
                      })}
                    </tr>
                    {/* Baseline Memory */}
                    <tr className="table-light"><td colSpan={results.length + 1} className="ps-4 fw-semibold small text-uppercase text-muted py-2">Resource Impact — Memory</td></tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">Baseline Memory</td>
                      {results.map(r => <td key={r.execution_id} className="text-center">{pct(r.baseline_memory)}</td>)}
                    </tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">Final Memory</td>
                      {results.map(r => <td key={r.execution_id} className="text-center fw-semibold">{pct(r.final_memory)}</td>)}
                    </tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">Memory Change</td>
                      {results.map(r => {
                        const v = r.memory_change ?? 0;
                        return <td key={r.execution_id} className="text-center fw-bold" style={{ color: v > 0 ? '#ef4444' : v < 0 ? '#22c55e' : '#6b7280' }}>{v > 0 ? '+' : ''}{num(v)}%</td>;
                      })}
                    </tr>
                    {/* Performance */}
                    <tr className="table-light"><td colSpan={results.length + 1} className="ps-4 fw-semibold small text-uppercase text-muted py-2">Performance &amp; Reliability</td></tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">
                        <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 16 }}>network_check</i>Avg Latency
                      </td>
                      {results.map(r => {
                        const isBest = r.execution_id === bestId('latency_avg', 'min');
                        return <td key={r.execution_id} className="text-center" style={isBest ? { background: '#f0fdf4' } : undefined}>{r.latency_avg != null ? `${num(r.latency_avg)}s` : '—'}{isBest && <i className="material-icons-outlined text-success ms-1" style={{ fontSize: 14 }}>star</i>}</td>;
                      })}
                    </tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">
                        <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 16 }}>warning</i>Anomalies Detected
                      </td>
                      {results.map(r => {
                        const isBest = r.execution_id === bestId('anomaly_count', 'min');
                        const ct = r.anomaly_count ?? 0;
                        return <td key={r.execution_id} className="text-center" style={isBest ? { background: '#f0fdf4' } : undefined}><span className={ct > 3 ? 'text-danger fw-bold' : ct > 0 ? 'text-warning fw-bold' : 'text-success'}>{ct}</span>{isBest && <i className="material-icons-outlined text-success ms-1" style={{ fontSize: 14 }}>star</i>}</td>;
                      })}
                    </tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">
                        <i className="material-icons-outlined align-middle me-1" style={{ fontSize: 16 }}>loop</i>Metric Iterations
                      </td>
                      {results.map(r => <td key={r.execution_id} className="text-center">{r.metric_iterations ?? '—'}</td>)}
                    </tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">Threshold Reached</td>
                      {results.map(r => <td key={r.execution_id} className="text-center">{r.threshold_reached ? <i className="material-icons-outlined text-success" style={{ fontSize: 20 }}>check_circle</i> : <i className="material-icons-outlined text-muted" style={{ fontSize: 20 }}>cancel</i>}</td>)}
                    </tr>
                    {/* Tags */}
                    <tr>
                      <td className="ps-4 text-muted fw-medium">Tags</td>
                      {results.map(r => <td key={r.execution_id} className="text-center">{(r.tags || []).length > 0 ? r.tags!.map(t => <span key={t} className="badge bg-light text-dark border me-1">{t}</span>) : <span className="text-muted">—</span>}</td>)}
                    </tr>
                    {/* Time */}
                    <tr className="table-light"><td colSpan={results.length + 1} className="ps-4 fw-semibold small text-uppercase text-muted py-2">Timing</td></tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">Started</td>
                      {results.map(r => <td key={r.execution_id} className="text-center small">{r.start_time ? new Date(r.start_time).toLocaleString() : '—'}</td>)}
                    </tr>
                    <tr>
                      <td className="ps-4 text-muted fw-medium">Ended</td>
                      {results.map(r => <td key={r.execution_id} className="text-center small">{r.end_time ? new Date(r.end_time).toLocaleString() : '—'}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ===== VISUAL CHARTS ===== */}
          <div className="row g-3 mb-4">
            {/* Operations & Success Rate */}
            <div className="col-md-6">
              <div className="card rounded-4 border shadow-none h-100">
                <div className="card-body p-4">
                  <h6 className="fw-semibold mb-1 d-flex align-items-center gap-2">
                    <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>bar_chart</i>
                    Operations Count
                  </h6>
                  <p className="text-muted small mb-3">Total API operations executed per run</p>
                  <ReactApexChart
                    type="bar"
                    height={220}
                    series={[{ name: 'Operations', data: results.map(r => r.total_operations) }]}
                    options={{
                      chart: { toolbar: { show: false }, fontFamily: 'inherit' },
                      colors: COLORS.slice(0, results.length),
                      plotOptions: { bar: { borderRadius: 6, columnWidth: '55%', distributed: true } },
                      xaxis: { categories: chartLabels, labels: { style: { fontSize: '10px' } } },
                      legend: { show: false },
                      dataLabels: { enabled: true, style: { fontSize: '11px' } },
                      grid: { borderColor: '#f1f5f9' },
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="card rounded-4 border shadow-none h-100">
                <div className="card-body p-4">
                  <h6 className="fw-semibold mb-1 d-flex align-items-center gap-2">
                    <i className="material-icons-outlined text-success" style={{ fontSize: 20 }}>check_circle</i>
                    Success Rate
                  </h6>
                  <p className="text-muted small mb-3">Percentage of operations that completed successfully</p>
                  <ReactApexChart
                    type="bar"
                    height={220}
                    series={[{ name: 'Success %', data: results.map(r => Math.round((r.success_rate || 0) * 10) / 10) }]}
                    options={{
                      chart: { toolbar: { show: false }, fontFamily: 'inherit' },
                      colors: COLORS.slice(0, results.length),
                      plotOptions: { bar: { borderRadius: 6, columnWidth: '55%', distributed: true } },
                      xaxis: { categories: chartLabels, labels: { style: { fontSize: '10px' } } },
                      yaxis: { max: 100, labels: { formatter: (v: number) => `${v}%` } },
                      legend: { show: false },
                      dataLabels: { enabled: true, formatter: (v: number) => `${v}%`, style: { fontSize: '11px' } },
                      grid: { borderColor: '#f1f5f9' },
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* CPU & Memory Grouped Bar */}
          <div className="row g-3 mb-4">
            <div className="col-md-6">
              <div className="card rounded-4 border shadow-none h-100">
                <div className="card-body p-4">
                  <h6 className="fw-semibold mb-1 d-flex align-items-center gap-2">
                    <i className="material-icons-outlined text-danger" style={{ fontSize: 20 }}>memory</i>
                    CPU: Baseline vs Final
                  </h6>
                  <p className="text-muted small mb-3">How much CPU utilization changed during each execution</p>
                  <ReactApexChart
                    type="bar"
                    height={220}
                    series={[
                      { name: 'Baseline CPU', data: results.map(r => Math.round((r.baseline_cpu || 0) * 10) / 10) },
                      { name: 'Final CPU', data: results.map(r => Math.round((r.final_cpu || 0) * 10) / 10) },
                    ]}
                    options={{
                      chart: { toolbar: { show: false }, fontFamily: 'inherit' },
                      colors: ['#93c5fd', '#2563eb'],
                      plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
                      xaxis: { categories: chartLabels, labels: { style: { fontSize: '10px' } } },
                      yaxis: { labels: { formatter: (v: number) => `${v}%` } },
                      dataLabels: { enabled: true, formatter: (v: number) => `${v}%`, style: { fontSize: '10px' } },
                      grid: { borderColor: '#f1f5f9' },
                      legend: { position: 'top', fontSize: '11px' },
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="card rounded-4 border shadow-none h-100">
                <div className="card-body p-4">
                  <h6 className="fw-semibold mb-1 d-flex align-items-center gap-2">
                    <i className="material-icons-outlined text-purple" style={{ fontSize: 20, color: '#8b5cf6' }}>storage</i>
                    Memory: Baseline vs Final
                  </h6>
                  <p className="text-muted small mb-3">How much memory utilization changed during each execution</p>
                  <ReactApexChart
                    type="bar"
                    height={220}
                    series={[
                      { name: 'Baseline Mem', data: results.map(r => Math.round((r.baseline_memory || 0) * 10) / 10) },
                      { name: 'Final Mem', data: results.map(r => Math.round((r.final_memory || 0) * 10) / 10) },
                    ]}
                    options={{
                      chart: { toolbar: { show: false }, fontFamily: 'inherit' },
                      colors: ['#c4b5fd', '#7c3aed'],
                      plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
                      xaxis: { categories: chartLabels, labels: { style: { fontSize: '10px' } } },
                      yaxis: { labels: { formatter: (v: number) => `${v}%` } },
                      dataLabels: { enabled: true, formatter: (v: number) => `${v}%`, style: { fontSize: '10px' } },
                      grid: { borderColor: '#f1f5f9' },
                      legend: { position: 'top', fontSize: '11px' },
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Throughput & Latency */}
          <div className="row g-3 mb-4">
            <div className="col-md-6">
              <div className="card rounded-4 border shadow-none h-100">
                <div className="card-body p-4">
                  <h6 className="fw-semibold mb-1 d-flex align-items-center gap-2">
                    <i className="material-icons-outlined text-warning" style={{ fontSize: 20 }}>speed</i>
                    Throughput (ops/min)
                  </h6>
                  <p className="text-muted small mb-3">How many operations per minute — higher is more efficient</p>
                  <ReactApexChart
                    type="bar"
                    height={220}
                    series={[{ name: 'Ops/min', data: results.map(r => Math.round((r.operations_per_minute || 0) * 100) / 100) }]}
                    options={{
                      chart: { toolbar: { show: false }, fontFamily: 'inherit' },
                      colors: COLORS.slice(0, results.length),
                      plotOptions: { bar: { borderRadius: 6, columnWidth: '55%', distributed: true } },
                      xaxis: { categories: chartLabels, labels: { style: { fontSize: '10px' } } },
                      legend: { show: false },
                      dataLabels: { enabled: true, style: { fontSize: '11px' } },
                      grid: { borderColor: '#f1f5f9' },
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="card rounded-4 border shadow-none h-100">
                <div className="card-body p-4">
                  <h6 className="fw-semibold mb-1 d-flex align-items-center gap-2">
                    <i className="material-icons-outlined" style={{ fontSize: 20, color: '#ef4444' }}>network_check</i>
                    Avg API Latency (seconds)
                  </h6>
                  <p className="text-muted small mb-3">Average response time per API call — lower is better</p>
                  <ReactApexChart
                    type="bar"
                    height={220}
                    series={[{ name: 'Latency (s)', data: results.map(r => Math.round((r.latency_avg || 0) * 100) / 100) }]}
                    options={{
                      chart: { toolbar: { show: false }, fontFamily: 'inherit' },
                      colors: COLORS.slice(0, results.length),
                      plotOptions: { bar: { borderRadius: 6, columnWidth: '55%', distributed: true } },
                      xaxis: { categories: chartLabels, labels: { style: { fontSize: '10px' } } },
                      legend: { show: false },
                      dataLabels: { enabled: true, formatter: (v: number) => `${v}s`, style: { fontSize: '11px' } },
                      grid: { borderColor: '#f1f5f9' },
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Radar Chart — Multi-metric Overview */}
          <div className="card rounded-4 border shadow-none mb-4">
            <div className="card-body p-4">
              <h6 className="fw-semibold mb-1 d-flex align-items-center gap-2">
                <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>radar</i>
                Multi-Metric Radar
              </h6>
              <p className="text-muted small mb-3">Normalized comparison across key metrics — larger area means better overall performance</p>
              <div className="d-flex justify-content-center">
                <ReactApexChart
                  type="radar"
                  height={340}
                  width={500}
                  series={results.map((r, _i) => ({
                    name: shortLabel(r),
                    data: [
                      Math.min(100, r.success_rate || 0),
                      (() => { const vals = results.map(x => x.operations_per_minute || 0); const mx = Math.max(...vals, 1); return Math.round(((r.operations_per_minute || 0) / mx) * 100); })(),
                      (() => { const vals = results.map(x => x.total_operations); const mx = Math.max(...vals, 1); return Math.round((r.total_operations / mx) * 100); })(),
                      (() => { const vals = results.map(x => x.latency_avg || 99); const mn = Math.min(...vals); return mn > 0 ? Math.round((mn / (r.latency_avg || mn)) * 100) : 100; })(),
                      100 - Math.min(100, Math.round((r.anomaly_count || 0) * 15)),
                    ],
                  }))}
                  options={{
                    chart: { toolbar: { show: false }, fontFamily: 'inherit' },
                    colors: COLORS.slice(0, results.length),
                    xaxis: { categories: ['Success Rate', 'Throughput', 'Scale', 'Low Latency', 'Reliability'] },
                    yaxis: { show: false, max: 100 },
                    stroke: { width: 2 },
                    fill: { opacity: 0.15 },
                    markers: { size: 3 },
                    legend: { position: 'bottom', fontSize: '12px' },
                  }}
                />
              </div>
            </div>
          </div>

          {/* ===== LEARNING SUMMARIES ===== */}
          {results.some(r => r.learning_summary) && (
            <div className="card rounded-4 border shadow-none mb-4">
              <div className="card-header bg-transparent border-bottom p-4">
                <h5 className="mb-1 fw-semibold d-flex align-items-center gap-2">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 22 }}>psychology</i>
                  AI Learning Summaries
                </h5>
                <p className="text-muted mb-0 small">Automated insights from each execution — what the system learned about workload behavior</p>
              </div>
              <div className="card-body p-4">
                {results.map((r, i) => (
                  r.learning_summary ? (
                    <div key={r.execution_id} className={`${i > 0 ? 'mt-3 pt-3 border-top' : ''}`}>
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <span className="rounded-circle d-inline-block flex-shrink-0" style={{ width: 10, height: 10, background: COLORS[i] }}></span>
                        <span className="fw-semibold">{label(r)}</span>
                        {statusBadge(r.status)}
                      </div>
                      <div className="ps-4">
                        <p className="mb-0 text-muted" style={{ fontSize: '0.88rem', lineHeight: 1.6 }}>
                          {expandedSummary === r.execution_id || r.learning_summary.length <= 200
                            ? r.learning_summary
                            : r.learning_summary.slice(0, 200) + '...'}
                        </p>
                        {r.learning_summary.length > 200 && (
                          <button className="btn btn-link btn-sm p-0 text-primary" onClick={() => setExpandedSummary(expandedSummary === r.execution_id ? null : r.execution_id)}>
                            {expandedSummary === r.execution_id ? 'Show less' : 'Read more'}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null
                ))}
              </div>
            </div>
          )}

          {/* Comparison Insights */}
          <div className="card rounded-4 border shadow-none mb-4" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #faf5ff 100%)' }}>
            <div className="card-body p-4">
              <h6 className="fw-semibold mb-3 d-flex align-items-center gap-2">
                <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>lightbulb</i>
                Comparison Insights
              </h6>
              <div className="row g-3">
                {(() => {
                  const insights: { icon: string; color: string; text: string }[] = [];
                  const durations = results.map(r => r.duration_minutes);
                  const rates = results.map(r => r.success_rate);
                  const ops = results.map(r => r.total_operations);
                  const latencies = results.map(r => r.latency_avg || 0).filter(v => v > 0);
                  const cpuChanges = results.map(r => r.cpu_change || 0);

                  const maxDur = Math.max(...durations);
                  const minDur = Math.min(...durations);
                  if (maxDur > 0 && minDur > 0) insights.push({ icon: 'timer', color: '#3b82f6', text: `Duration range: ${num(minDur)} – ${num(maxDur)} min (${((maxDur / minDur)).toFixed(1)}x difference).` });

                  const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
                  insights.push({ icon: 'check_circle', color: '#22c55e', text: `Average success rate across compared runs: ${avgRate.toFixed(1)}%.` });

                  const totalOps = ops.reduce((a, b) => a + b, 0);
                  insights.push({ icon: 'functions', color: '#8b5cf6', text: `Combined operations across ${results.length} runs: ${totalOps.toLocaleString()}.` });

                  if (latencies.length > 0) {
                    const avgLat = latencies.reduce((a, b) => a + b, 0) / latencies.length;
                    insights.push({ icon: 'network_check', color: '#f59e0b', text: `Average API latency: ${avgLat.toFixed(1)}s across all compared runs.` });
                  }

                  const maxCpu = Math.max(...cpuChanges);
                  const minCpu = Math.min(...cpuChanges);
                  if (maxCpu !== minCpu) insights.push({ icon: 'memory', color: '#ef4444', text: `CPU change ranged from ${minCpu > 0 ? '+' : ''}${num(minCpu)}% to +${num(maxCpu)}% — showing different workload intensity levels.` });

                  const thresholdCount = results.filter(r => r.threshold_reached).length;
                  insights.push({ icon: 'flag', color: '#6366f1', text: `${thresholdCount} of ${results.length} executions reached the resource threshold target.` });

                  return insights.map((ins, idx) => (
                    <div key={idx} className="col-md-6">
                      <div className="d-flex align-items-start gap-2">
                        <i className="material-icons-outlined flex-shrink-0" style={{ fontSize: 18, color: ins.color, marginTop: 2 }}>{ins.icon}</i>
                        <span className="small">{ins.text}</span>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Empty state when no results yet */}
      {results.length === 0 && !loading && (
        <div className="card rounded-4 border shadow-none" style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #f5f3ff 100%)' }}>
          <div className="card-body p-5 text-center">
            <i className="material-icons-outlined mb-3" style={{ fontSize: 48, color: '#94a3b8' }}>compare_arrows</i>
            <h5 className="fw-semibold mb-2">No Comparison Yet</h5>
            <p className="text-muted mb-0" style={{ maxWidth: 420, margin: '0 auto' }}>
              Select 2–5 executions from the table above and click <strong>Compare</strong> to see a detailed side-by-side analysis including resource impact, latency, throughput, and AI learning summaries.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsComparison;
