import React, { useEffect, useState, useCallback } from 'react';
import type { Alert, AlertDiagnostics } from '../types/onboarding';
import { getApiBase } from '../utils/backendUrl';

interface AlertDetailModalProps {
  alert: Alert | null;
  isOpen: boolean;
  onClose: () => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  Critical: '#dc3545', Moderate: '#fd7e14', Low: '#28a745',
  critical: '#dc3545', warning: '#fd7e14', info: '#28a745',
};
const TIMELINE_COLORS: Record<string, string> = {
  fired: '#dc3545', acknowledged: '#fd7e14', resolved: '#28a745',
  active: '#dc3545', context: '#6c757d',
};

function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return 'Still active';
  const m = Math.abs(minutes);
  if (m < 1) return `${Math.round(m * 60)}s`;
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const rm = Math.round(m % 60);
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}d ${rh}h`;
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true,
  });
}

const Badge: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span style={{
    display: 'inline-block', padding: '3px 10px', borderRadius: 4, fontSize: 12,
    fontWeight: 600, color: '#fff', backgroundColor: color, lineHeight: '18px',
  }}>{children}</span>
);

const SectionTitle: React.FC<{ icon: string; title: string }> = ({ icon, title }) => (
  <h4 style={{
    margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: '#333',
    display: 'flex', alignItems: 'center', gap: 8,
  }}>{icon} {title}</h4>
);

const Card: React.FC<{
  bg?: string; border?: string; children: React.ReactNode; style?: React.CSSProperties;
}> = ({ bg = '#f8f9fa', border = '#dee2e6', children, style }) => (
  <div style={{
    backgroundColor: bg, border: `1px solid ${border}`, borderRadius: 8,
    padding: 16, marginBottom: 16, ...style,
  }}>{children}</div>
);

export const AlertDetailModal: React.FC<AlertDetailModalProps> = ({ alert, isOpen, onClose }) => {
  const [diagnostics, setDiagnostics] = useState<AlertDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchDiagnostics = useCallback(async (alertId: string) => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${getApiBase()}/api/alerts/detail/${alertId}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setDiagnostics(data.diagnostics);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && alert?.id) {
      fetchDiagnostics(String(alert.id));
    } else {
      setDiagnostics(null);
      setError('');
    }
  }, [isOpen, alert?.id, fetchDiagnostics]);

  if (!isOpen || !alert) return null;

  const sevColor = SEVERITY_COLORS[alert.severity] || '#6c757d';
  const isActive = alert.status === 'Active' || alert.status === 'active';

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
      justifyContent: 'center', alignItems: 'center', zIndex: 1000,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        backgroundColor: '#fff', borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)', maxWidth: 780, width: '95%',
        maxHeight: '90vh', overflow: 'auto', padding: 0,
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 14px', borderBottom: '1px solid #e9ecef',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          background: isActive ? 'linear-gradient(135deg, #fff5f5 0%, #fff 100%)' : undefined,
        }}>
          <div>
            <h3 style={{ margin: 0, color: '#333', fontSize: 20, fontWeight: 600 }}>
              {alert.ruleName}
            </h3>
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge color={sevColor}>{alert.severity}</Badge>
              <Badge color={isActive ? '#dc3545' : '#28a745'}>{alert.status}</Badge>
              {alert.duration_minutes != null ? (
                <Badge color="#6c757d">{formatDuration(alert.duration_minutes)}</Badge>
              ) : isActive ? (
                <Badge color="#dc3545">Active</Badge>
              ) : null}
              {alert.testbed && (
                <span style={{ fontSize: 13, color: '#6c757d' }}>on {alert.testbed}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer',
            padding: '4px 8px', borderRadius: 4, color: '#666',
          }}>&times;</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 24, color: '#6c757d' }}>
              Loading diagnostics...
            </div>
          )}
          {error && (
            <Card bg="#fff3cd" border="#ffc107">
              <span style={{ color: '#856404' }}>Could not load live diagnostics: {error}</span>
            </Card>
          )}

          {/* Metric Context */}
          {diagnostics?.metric_context?.value != null && (
            <Card bg="#fff" border="#dee2e6">
              <SectionTitle icon="📊" title="Metric at Time of Alert" />
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: sevColor }}>
                    {diagnostics.metric_context.value}{diagnostics.metric_context.unit}
                  </div>
                  <div style={{ fontSize: 13, color: '#6c757d' }}>
                    Threshold: {diagnostics.metric_context.threshold}{diagnostics.metric_context.unit}
                  </div>
                </div>
                <div style={{ flex: '2 1 300px' }}>
                  <div style={{
                    height: 12, backgroundColor: '#e9ecef', borderRadius: 6,
                    position: 'relative', overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 6,
                      width: `${Math.min(((diagnostics.metric_context.value ?? 0) / Math.max(diagnostics.metric_context.threshold ?? 100, 1)) * 100, 100)}%`,
                      backgroundColor: (diagnostics.metric_context.over_threshold) ? sevColor : '#28a745',
                      transition: 'width 0.5s ease',
                    }} />
                    <div style={{
                      position: 'absolute', top: 0, left: `${Math.min(100, ((diagnostics.metric_context.threshold ?? 100) / Math.max(diagnostics.metric_context.value ?? 100, diagnostics.metric_context.threshold ?? 100, 1)) * 100)}%`,
                      width: 2, height: '100%', backgroundColor: '#333',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6c757d', marginTop: 4 }}>
                    <span>0</span>
                    <span>Threshold: {diagnostics.metric_context.threshold}</span>
                    <span>Value: {diagnostics.metric_context.value}</span>
                  </div>
                </div>
                {diagnostics.metric_context.over_threshold && (
                  <div style={{ fontSize: 13, color: '#dc3545', fontWeight: 500 }}>
                    Exceeded by {diagnostics.metric_context.exceeded_by}{diagnostics.metric_context.unit} ({diagnostics.metric_context.exceeded_pct}% over)
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Timeline */}
          {diagnostics?.timeline && diagnostics.timeline.length > 0 && (
            <Card>
              <SectionTitle icon="🕐" title="Event Timeline" />
              <div style={{ position: 'relative', paddingLeft: 24 }}>
                <div style={{
                  position: 'absolute', left: 8, top: 4, bottom: 4, width: 2,
                  backgroundColor: '#dee2e6',
                }} />
                {diagnostics.timeline.map((evt, i) => (
                  <div key={i} style={{
                    position: 'relative', marginBottom: i < diagnostics.timeline.length - 1 ? 14 : 0,
                  }}>
                    <div style={{
                      position: 'absolute', left: -20, top: 3, width: 12, height: 12,
                      borderRadius: '50%', backgroundColor: TIMELINE_COLORS[evt.type] || '#6c757d',
                      border: '2px solid #fff', boxShadow: '0 0 0 2px ' + (TIMELINE_COLORS[evt.type] || '#6c757d'),
                    }} />
                    <div style={{ fontSize: 12, color: '#6c757d', fontFamily: 'monospace' }}>
                      {fmtTs(evt.timestamp)}
                    </div>
                    <div style={{ fontSize: 14, color: '#333', marginTop: 2 }}>
                      {evt.event}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Root Cause */}
          {diagnostics?.root_cause && (
            <Card bg="#fff5f5" border="#f5c6cb">
              <SectionTitle icon="🔍" title="Root Cause Analysis" />
              <p style={{ margin: 0, fontSize: 14, color: '#333', lineHeight: 1.6 }}>
                {diagnostics.root_cause}
              </p>
            </Card>
          )}

          {/* Impact Assessment */}
          {diagnostics?.impact_assessment && (
            <Card bg="#fff3cd" border="#ffc107" style={{ borderLeft: `4px solid ${sevColor}` }}>
              <SectionTitle icon="⚡" title="Impact Assessment" />
              <p style={{ margin: 0, fontSize: 14, color: '#333', lineHeight: 1.6 }}>
                {diagnostics.impact_assessment}
              </p>
            </Card>
          )}

          {/* Recommendation */}
          {diagnostics?.recommendation && (
            <Card bg="#d4edda" border="#c3e6cb">
              <SectionTitle icon="💡" title="Recommendation" />
              <p style={{ margin: 0, fontSize: 14, color: '#155724', lineHeight: 1.6, fontWeight: 500 }}>
                {diagnostics.recommendation}
              </p>
            </Card>
          )}

          {/* Live Data */}
          {diagnostics?.prometheus_available && diagnostics.live_data && (
            <Card bg="#e8f4fd" border="#bee5eb">
              <SectionTitle icon="📡" title="Live Cluster Data (from Prometheus)" />
              {diagnostics.live_data.recent_restarts && (diagnostics.live_data.recent_restarts as Array<Record<string, unknown>>).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <strong style={{ fontSize: 13, color: '#0c5460' }}>Recent Pod Restarts (last 1h):</strong>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 13 }}>
                    <thead>
                      <tr style={{ backgroundColor: '#d1ecf1' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Pod</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Namespace</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Container</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Restarts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(diagnostics.live_data.recent_restarts as Array<Record<string, unknown>>).map((r, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #bee5eb' }}>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}>{String(r.pod)}</td>
                          <td style={{ padding: '6px 8px' }}>{String(r.namespace)}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}>{String(r.container)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#dc3545' }}>{String(r.restart_count_1h)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {diagnostics.live_data.termination_reasons && (diagnostics.live_data.termination_reasons as Array<Record<string, unknown>>).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <strong style={{ fontSize: 13, color: '#0c5460' }}>Termination Reasons:</strong>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {(diagnostics.live_data.termination_reasons as Array<Record<string, unknown>>).map((t, i: number) => (
                      <span key={i} style={{
                        padding: '4px 8px', borderRadius: 4, fontSize: 12,
                        backgroundColor: String(t.reason) === 'OOMKilled' ? '#f8d7da' : '#e2e3e5',
                        color: String(t.reason) === 'OOMKilled' ? '#721c24' : '#383d41',
                      }}>
                        {String(t.pod)}: {String(t.reason)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {diagnostics.live_data.top_cpu_pods && (diagnostics.live_data.top_cpu_pods as Array<Record<string, unknown>>).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <strong style={{ fontSize: 13, color: '#0c5460' }}>Top CPU Consumers:</strong>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 13 }}>
                    <thead>
                      <tr style={{ backgroundColor: '#d1ecf1' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Pod</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Namespace</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>CPU %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(diagnostics.live_data.top_cpu_pods as Array<Record<string, unknown>>).slice(0, 5).map((p, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #bee5eb' }}>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}>{String(p.pod)}</td>
                          <td style={{ padding: '6px 8px' }}>{String(p.namespace)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{String(p.cpu_pct)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {diagnostics.live_data.top_memory_pods && (diagnostics.live_data.top_memory_pods as Array<Record<string, unknown>>).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <strong style={{ fontSize: 13, color: '#0c5460' }}>Top Memory Consumers:</strong>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 13 }}>
                    <thead>
                      <tr style={{ backgroundColor: '#d1ecf1' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Pod</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Namespace</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Memory (MB)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(diagnostics.live_data.top_memory_pods as Array<Record<string, unknown>>).slice(0, 5).map((p, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #bee5eb' }}>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}>{String(p.pod)}</td>
                          <td style={{ padding: '6px 8px' }}>{String(p.namespace)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{String(p.memory_mb)} MB</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {diagnostics.live_data.pvc_usage && (diagnostics.live_data.pvc_usage as Array<Record<string, unknown>>).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <strong style={{ fontSize: 13, color: '#0c5460' }}>PVC Usage:</strong>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 13 }}>
                    <thead>
                      <tr style={{ backgroundColor: '#d1ecf1' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>PVC</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Namespace</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Used / Capacity</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(diagnostics.live_data.pvc_usage as Array<Record<string, unknown>>).map((pvc, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #bee5eb' }}>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}>{String(pvc.pvc_name)}</td>
                          <td style={{ padding: '6px 8px' }}>{String(pvc.namespace)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{String(pvc.used_gb)} / {String(pvc.capacity_gb)} GB</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: Number(pvc.usage_pct) > 80 ? '#dc3545' : '#333' }}>{String(pvc.usage_pct)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {diagnostics.live_data.api_latency && (diagnostics.live_data.api_latency as Array<Record<string, unknown>>).length > 0 && (
                <div>
                  <strong style={{ fontSize: 13, color: '#0c5460' }}>API Server Latency (P99):</strong>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 13 }}>
                    <thead>
                      <tr style={{ backgroundColor: '#d1ecf1' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Verb</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Resource</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>P99 Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(diagnostics.live_data.api_latency as Array<Record<string, unknown>>).map((l, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #bee5eb' }}>
                          <td style={{ padding: '6px 8px' }}>{String(l.verb)}</td>
                          <td style={{ padding: '6px 8px' }}>{String(l.resource)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{String(l.p99_seconds)}s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* Related Alerts */}
          {diagnostics?.related_alerts && diagnostics.related_alerts.length > 0 && (
            <Card>
              <SectionTitle icon="🔗" title={`Related Alerts (${diagnostics.related_alerts.length} within ±30min)`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {diagnostics.related_alerts.map((ra, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px',
                    borderRadius: 6, backgroundColor: '#fff', border: '1px solid #e9ecef',
                    fontSize: 13,
                  }}>
                    <Badge color={SEVERITY_COLORS[ra.severity] || '#6c757d'}>{ra.severity}</Badge>
                    <span style={{ fontWeight: 500, color: '#333' }}>{ra.alert_type}</span>
                    <span style={{ color: '#6c757d', fontSize: 12, marginLeft: 'auto', fontFamily: 'monospace' }}>
                      {fmtTs(ra.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Running Executions */}
          {diagnostics?.running_executions && diagnostics.running_executions.length > 0 && (
            <Card bg="#e8f0fe" border="#c6d9f1">
              <SectionTitle icon="🚀" title="Smart Execution Context" />
              {diagnostics.running_executions.map((exec, i) => (
                <div key={i} style={{
                  padding: '8px 12px', borderRadius: 6, backgroundColor: '#fff',
                  border: '1px solid #c6d9f1', marginBottom: 8, fontSize: 13,
                }}>
                  <div style={{ fontWeight: 600, color: '#333' }}>Execution: {exec.execution_id}</div>
                  <div style={{ color: '#6c757d', marginTop: 4 }}>
                    Status: {exec.status} | Started: {fmtTs(exec.start_time)}
                    {exec.end_time ? ` | Ended: ${fmtTs(exec.end_time)}` : ' | Still running'}
                  </div>
                </div>
              ))}
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6c757d', fontStyle: 'italic' }}>
                Alerts during an active smart execution may be expected load-test behavior.
              </p>
            </Card>
          )}

          {/* Original Alert Message */}
          {alert.summary && (
            <Card>
              <SectionTitle icon="📋" title="Original Alert Message" />
              <pre style={{
                margin: 0, fontSize: 12, color: '#495057', whiteSpace: 'pre-wrap',
                fontFamily: 'monospace', lineHeight: 1.5, backgroundColor: '#fff',
                padding: 12, borderRadius: 4, border: '1px solid #dee2e6',
              }}>{alert.summary}</pre>
            </Card>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid #e9ecef',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: '#6c757d' }}>
            {diagnostics?.prometheus_available
              ? 'Live data from Prometheus'
              : 'Prometheus not reachable — showing stored data'}
          </span>
          <button onClick={onClose} style={{
            background: '#6c757d', color: '#fff', border: 'none', borderRadius: 4,
            padding: '8px 16px', fontWeight: 500, cursor: 'pointer', fontSize: 14,
          }}>Close</button>
        </div>
      </div>
    </div>
  );
};
