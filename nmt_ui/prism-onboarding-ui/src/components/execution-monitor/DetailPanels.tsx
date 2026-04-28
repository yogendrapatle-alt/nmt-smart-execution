import React from 'react';
import type { MonitorData } from './types';

interface Props {
  data: MonitorData;
}

const Panel: React.FC<{ icon: string; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="monitor-detail-panel">
    <div className="panel-header">
      <i className="material-icons-outlined" style={{ fontSize: 20, color: 'var(--color-primary)' }}>{icon}</i>
      <h6>{title}</h6>
    </div>
    <div className="panel-body">{children}</div>
  </div>
);

const KV: React.FC<{ label: string; value: React.ReactNode; warn?: boolean }> = ({ label, value, warn }) => (
  <tr>
    <td className={warn ? 'text-warning' : 'text-muted'}>{label}</td>
    <td className={`fw-semibold text-end ${warn ? 'text-warning' : ''}`}>{value}</td>
  </tr>
);

const DetailPanels: React.FC<Props> = ({ data }) => {
  const cfg = data.execution_config;
  const pid = data.pid_stats;
  const lat = data.latency_summary;
  const prt = data.pod_restart_tracking;

  return (
    <div className="monitor-detail-row">
      {/* AI Control */}
      <Panel icon="psychology" title="AI Control">
        <table className="table table-sm table-borderless mb-0 small">
          <tbody>
            <KV label="Ops/Minute" value={(data.operations_per_minute ?? 0).toFixed(1)} />
            <KV label="Phase" value={data.phase} />
            <KV label="Total Operations" value={data.total_operations} />
            <KV label="Iteration" value={data.iteration} />
            {data.circuit_breaker_trips > 0 && (
              <KV label={"⚠ Circuit Trips"} value={data.circuit_breaker_trips} warn />
            )}
          </tbody>
        </table>
      </Panel>

      {/* PID Controller */}
      {pid && (
        <Panel icon="tune" title="PID Controller">
          <table className="table table-sm table-borderless mb-0 small">
            <tbody>
              <KV label="CPU PID" value={<code style={{ fontSize: 11 }}>Kp={pid.cpu_pid?.Kp} Ki={pid.cpu_pid?.Ki} Kd={pid.cpu_pid?.Kd}</code>} />
              <KV label="Mem PID" value={<code style={{ fontSize: 11 }}>Kp={pid.memory_pid?.Kp} Ki={pid.memory_pid?.Ki} Kd={pid.memory_pid?.Kd}</code>} />
              <KV label="Current Ops/Min" value={pid.current_ops_per_min?.toFixed(1)} />
            </tbody>
          </table>
        </Panel>
      )}

      {/* Config */}
      {cfg && (
        <Panel icon="settings" title="Config">
          <table className="table table-sm table-borderless mb-0 small">
            <tbody>
              <tr>
                <td className="text-muted">Profile</td>
                <td className="text-end">
                  <span className={`badge rounded-pill ${
                    cfg.workload_profile === 'chaos' ? 'bg-danger bg-opacity-10 text-danger' :
                    cfg.workload_profile === 'burst' ? 'bg-warning bg-opacity-10 text-warning' :
                    'bg-success bg-opacity-10 text-success'
                  }`}>
                    {cfg.workload_profile.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </td>
              </tr>
              <KV label="Parallel" value={cfg.parallel_execution ? `Yes (max ${cfg.max_parallel_operations})` : 'Sequential'} />
              <KV label="Ops/Iteration" value={cfg.operations_per_iteration} />
              <KV label="Auto-cleanup" value={cfg.auto_cleanup ? <span className="text-success">Yes</span> : <span className="text-muted">No</span>} />
            </tbody>
          </table>
        </Panel>
      )}

      {/* API Latency */}
      {lat?.overall?.count && lat.overall.count > 0 && (
        <Panel icon="timer" title="API Latency">
          <table className="table table-sm table-borderless mb-0 small">
            <tbody>
              <KV label="Average" value={`${lat.overall.avg?.toFixed(1)}s`} />
              <KV label="P50" value={`${lat.overall.p50?.toFixed(1)}s`} />
              <KV label="P95" value={
                <span className={(lat.overall.p95 || 0) > 30 ? 'text-danger' : 'text-success'}>
                  {lat.overall.p95?.toFixed(1)}s
                </span>
              } />
              <KV label="Total Calls" value={lat.overall.count} />
            </tbody>
          </table>
          {Object.entries(lat.per_operation || {}).length > 0 && (
            <div className="border-top mt-2 pt-2" style={{ fontSize: 11 }}>
              {Object.entries(lat.per_operation).slice(0, 5).map(([key, stats]) => (
                <div key={key} className="d-flex justify-content-between text-muted">
                  <span>{key}</span>
                  <span>avg {stats.avg?.toFixed(1)}s ({stats.count})</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {/* Tags */}
      {data.tags && data.tags.length > 0 && (
        <Panel icon="label" title="Tags">
          <div className="d-flex gap-2 flex-wrap">
            {data.tags.map((tag, i) => (
              <span key={i} className="badge bg-info bg-opacity-10 text-info rounded-pill px-3 py-2">{tag}</span>
            ))}
          </div>
        </Panel>
      )}

      {/* Pod Restart Tracking */}
      {prt && prt.total_restarts_during_execution > 0 && (
        <Panel icon="restart_alt" title="Pod Restarts">
          <table className="table table-sm table-borderless mb-0 small">
            <tbody>
              <KV label="Total Restarts" value={
                <span className="text-danger fw-bold">{prt.total_restarts_during_execution}</span>
              } warn />
              <KV label="Pods Affected" value={prt.pods_restarted} warn />
              <KV label="Containers Tracked" value={prt.baseline_containers_tracked} />
            </tbody>
          </table>
          {prt.pod_summary && prt.pod_summary.length > 0 && (
            <div className="border-top mt-2 pt-2" style={{ fontSize: 11 }}>
              {prt.pod_summary.slice(0, 5).map((ps, i) => (
                <div key={i} className="d-flex justify-content-between text-muted" style={{ marginBottom: 2 }}>
                  <span title={`${ps.namespace}/${ps.pod}/${ps.container}`}>
                    {ps.pod.length > 25 ? ps.pod.slice(0, 25) + '…' : ps.pod}
                  </span>
                  <span className="text-warning fw-semibold">+{ps.delta}</span>
                </div>
              ))}
              {prt.pod_summary.length > 5 && (
                <div className="text-muted text-center mt-1">… +{prt.pod_summary.length - 5} more</div>
              )}
            </div>
          )}
        </Panel>
      )}

      {/* Pod Restart Events Timeline */}
      {prt && prt.restart_events && prt.restart_events.length > 0 && (
        <Panel icon="timeline" title="Restart Timeline">
          <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 11 }}>
            {prt.restart_events.slice(-10).reverse().map((ev, i) => {
              let tsLabel = '';
              if (ev.detected_at) {
                try { tsLabel = new Date(ev.detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { /* ignore */ }
              }
              return (
              <div key={i} style={{ borderBottom: '1px solid #f1f5f9', padding: '4px 0' }}>
                <div className="d-flex justify-content-between">
                  <span className="text-muted">{tsLabel ? `${tsLabel} (${ev.execution_elapsed_min} min)` : `${ev.execution_elapsed_min} min`}</span>
                  <span className="badge bg-warning bg-opacity-10 text-warning" style={{ fontSize: 10 }}>+{ev.new_restarts}</span>
                </div>
                <div style={{ color: '#334155' }} title={`${ev.namespace}/${ev.container}`}>
                  {ev.pod.length > 30 ? ev.pod.slice(0, 30) + '…' : ev.pod}
                </div>
                <div className="text-muted" style={{ fontSize: 10 }}>
                  total since start: {ev.total_since_start} | cumulative: {ev.cumulative_total}
                </div>
              </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Learning Summary */}
      {data.learning_summary && (
        <Panel icon="auto_stories" title="Learning Summary">
          <p className="small text-muted mb-0" style={{ lineHeight: 1.6 }}>{data.learning_summary}</p>
        </Panel>
      )}
    </div>
  );
};

export default DetailPanels;
