import React from 'react';
import type { AISettings, MonitoringRule } from './types';
import MonitoringRulesEditor from '../MonitoringRulesEditor';

interface StepAdvancedProps {
  aiSettings: AISettings;
  onAISettingsChange: (s: AISettings) => void;
  availableNamespaces: string[];
  selectedNamespaces: string[];
  onNamespacesChange: (ns: string[]) => void;
  availablePods: string[];
  selectedPods: string[];
  onPodsChange: (pods: string[]) => void;
  loadingPods: boolean;
  workloadProfile: string; onWorkloadChange: (v: string) => void;
  maxParallelOps: number; onMaxParallelChange: (v: number) => void;
  opsPerIteration: number; onOpsPerIterChange: (v: number) => void;
  parallelExecution: boolean; onParallelChange: (v: boolean) => void;
  autoCleanup: boolean; onAutoCleanupChange: (v: boolean) => void;
  timeoutMinutes: number; onTimeoutChange: (v: number) => void;
  sustainMinutes: number; onSustainChange: (v: number) => void;
  mlGuidedOps: boolean; onMlGuidedChange: (v: boolean) => void;
  entityCooldown: number; onCooldownChange: (v: number) => void;
  cpuSpikeThreshold: number; onCpuSpikeChange: (v: number) => void;
  memorySpikeThreshold: number; onMemSpikeChange: (v: number) => void;
  failureRateThreshold: number; onFailRateChange: (v: number) => void;
  tags: string[];
  onTagsChange: (t: string[]) => void;
  longevityEnabled: boolean; onLongevityToggle: (v: boolean) => void;
  longevityDuration: number; onLongevityDuration: (v: number) => void;
  churnIntervalMin: number; onChurnChange: (v: number) => void;
  healthCheckIntervalMin: number; onHealthCheckChange: (v: number) => void;
  checkpointIntervalMin: number; onCheckpointChange: (v: number) => void;
  maintainLoadPct: number; onMaintainLoadChange: (v: number) => void;
  healthChecks: Record<string, boolean>; onHealthChecksChange: (h: Record<string, boolean>) => void;
  monitoringRules: MonitoringRule[]; onMonitoringRulesChange: (rules: MonitoringRule[]) => void;
  podsByNamespace?: Record<string, string[]>;
  testbedId?: string;
}

const PROFILE_DESCRIPTIONS: Record<string, string> = {
  sustained: 'Constant load level throughout execution (default)',
  ramp_up: 'Gradually increases from 20% to 100% load over 20 iterations',
  burst: 'Alternates between 150% and 50% load every 5 iterations',
  chaos: 'Random load multiplier (0.3x-2.0x) per iteration for stress testing',
};

const HEALTH_CHECK_LABELS: Record<string, string> = {
  fatal_scan: 'FATAL Log Scanning',
  process_restarts: 'Process Restart Detection',
  cgroup_oom: 'Cgroup OOM Monitoring',
  thread_count: 'Thread Count Check',
  disk_usage: 'Disk Usage Monitoring',
  core_dumps: 'Core Dump Detection',
  memory_leaks: 'Memory Leak Detection',
};

const StepAdvanced: React.FC<StepAdvancedProps> = (props) => {
  const [showExecution, setShowExecution] = React.useState(false);
  const [showAlerts, setShowAlerts] = React.useState(false);
  const [showLongevity, setShowLongevity] = React.useState(false);
  const [tagInput, setTagInput] = React.useState('');
  const [podSearch, setPodSearch] = React.useState('');

  return (
    <>
      {/* Monitoring Rules */}
      <section className="config-section">
        <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>settings</i> Monitoring Rules</h2>
        {props.loadingPods ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Loading available namespaces and pods…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Namespaces */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="material-icons-outlined" style={{ fontSize: 18, color: 'var(--color-primary)' }}>dns</i>
                  Namespaces
                </span>
                {props.availableNamespaces.length > 0 && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => props.onNamespacesChange([...props.availableNamespaces])}
                      style={{ padding: '3px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', background: 'white', cursor: 'pointer', fontSize: 11, fontWeight: 500, color: 'var(--color-primary)' }}>
                      Select All
                    </button>
                    <button type="button" onClick={() => props.onNamespacesChange([])}
                      style={{ padding: '3px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', background: 'white', cursor: 'pointer', fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)' }}>
                      Clear
                    </button>
                  </div>
                )}
              </div>
              {props.availableNamespaces.length === 0 ? (
                <div style={{ padding: '12px 16px', background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontStyle: 'italic' }}>
                  No namespaces available. Select a testbed first.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {props.availableNamespaces.map(ns => {
                    const isSelected = props.selectedNamespaces.includes(ns);
                    return (
                      <button key={ns} type="button"
                        onClick={() => props.onNamespacesChange(isSelected ? props.selectedNamespaces.filter(n => n !== ns) : [...props.selectedNamespaces, ns])}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                          border: `1.5px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                          borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'all 150ms',
                          background: isSelected ? 'rgba(79, 70, 229, 0.06)' : 'white',
                          fontSize: 'var(--text-xs)', fontWeight: isSelected ? 600 : 400,
                          color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
                        }}
                      >
                        <span style={{
                          width: 18, height: 18, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          background: isSelected ? 'var(--color-primary)' : 'transparent',
                          border: isSelected ? 'none' : '2px solid var(--color-border)',
                        }}>
                          {isSelected && <i className="material-icons-outlined" style={{ fontSize: 14, color: 'white' }}>check</i>}
                        </span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ns}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {props.selectedNamespaces.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
                  <strong>{props.selectedNamespaces.length}</strong> of {props.availableNamespaces.length} selected
                </div>
              )}
            </div>

            {/* Pod Names */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="material-icons-outlined" style={{ fontSize: 18, color: 'var(--color-primary)' }}>view_in_ar</i>
                  Pod Names
                  <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--color-text-muted)' }}>(optional — leave empty to monitor all)</span>
                </span>
                {props.availablePods.length > 0 && props.selectedPods.length > 0 && (
                  <button type="button" onClick={() => { props.onPodsChange([]); setPodSearch(''); }}
                    style={{ padding: '3px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', background: 'white', cursor: 'pointer', fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)' }}>
                    Clear All ({props.selectedPods.length})
                  </button>
                )}
              </div>
              {props.availablePods.length === 0 ? (
                <div style={{ padding: '12px 16px', background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontStyle: 'italic' }}>
                  No pods available.
                </div>
              ) : (
                <>
                  <div style={{ position: 'relative', marginBottom: 10 }}>
                    <i className="material-icons-outlined" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: 'var(--color-text-muted)', pointerEvents: 'none' }}>search</i>
                    <input type="text" value={podSearch} onChange={e => setPodSearch(e.target.value)}
                      placeholder={`Search ${props.availablePods.length} pods…`}
                      style={{ width: '100%', padding: '8px 10px 8px 34px', border: '1.5px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', outline: 'none' }} />
                    {podSearch && (
                      <button type="button" onClick={() => setPodSearch('')}
                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 16, lineHeight: 1, padding: 2 }}>
                        ×
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, maxHeight: 240, overflowY: 'auto', padding: 2 }}>
                    {props.availablePods
                      .filter(pod => !podSearch || pod.toLowerCase().includes(podSearch.toLowerCase()))
                      .map(pod => {
                        const isSelected = props.selectedPods.includes(pod);
                        return (
                          <button key={pod} type="button"
                            onClick={() => props.onPodsChange(isSelected ? props.selectedPods.filter(p => p !== pod) : [...props.selectedPods, pod])}
                            title={pod}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                              border: `1.5px solid ${isSelected ? '#22c55e' : 'var(--color-border)'}`,
                              borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'all 150ms',
                              background: isSelected ? 'rgba(34, 197, 94, 0.06)' : 'white',
                              fontSize: 11, fontWeight: isSelected ? 600 : 400,
                              color: isSelected ? '#15803d' : 'var(--color-text)',
                            }}
                          >
                            <span style={{
                              width: 16, height: 16, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                              background: isSelected ? '#22c55e' : 'transparent',
                              border: isSelected ? 'none' : '2px solid var(--color-border)',
                            }}>
                              {isSelected && <i className="material-icons-outlined" style={{ fontSize: 12, color: 'white' }}>check</i>}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>{pod}</span>
                          </button>
                        );
                      })}
                  </div>
                  {podSearch && props.availablePods.filter(p => p.toLowerCase().includes(podSearch.toLowerCase())).length === 0 && (
                    <div style={{ padding: '12px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                      No pods matching "{podSearch}"
                    </div>
                  )}
                </>
              )}
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
                {props.selectedPods.length > 0
                  ? <><strong>{props.selectedPods.length}</strong> pod{props.selectedPods.length > 1 ? 's' : ''} selected</>
                  : 'All pods (no filter)'}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Execution Settings */}
      <section className="config-section">
        <h2 style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setShowExecution(!showExecution)}>
          <i className="material-icons-outlined" style={{ fontSize: 18, transition: 'transform 200ms', transform: showExecution ? 'rotate(90deg)' : 'rotate(0)' }}>chevron_right</i>
          Execution Settings
        </h2>
        {showExecution && (
          <div className="advanced-settings">
            <div className="threshold-grid">
              <div className="threshold-input">
                <label>
                  Workload Profile
                  <select value={props.workloadProfile} onChange={e => props.onWorkloadChange(e.target.value)}>
                    <option value="sustained">Sustained (steady load)</option>
                    <option value="ramp_up">Ramp Up (gradual increase)</option>
                    <option value="burst">Burst (alternating high/low)</option>
                    <option value="chaos">Chaos (random intensity)</option>
                  </select>
                </label>
                <small style={{ color: 'var(--color-text-muted)', display: 'block', marginTop: 4, fontSize: 'var(--text-xs)' }}>
                  {PROFILE_DESCRIPTIONS[props.workloadProfile]}
                </small>
              </div>
              <div className="threshold-input">
                <label>Max Parallel Operations<input type="number" min={1} max={20} value={props.maxParallelOps} onChange={e => props.onMaxParallelChange(Number(e.target.value))} /></label>
              </div>
              <div className="threshold-input">
                <label>Operations per Iteration<input type="number" min={1} max={20} value={props.opsPerIteration} onChange={e => props.onOpsPerIterChange(Number(e.target.value))} /></label>
              </div>
              <div className="threshold-input">
                <label>Timeout (minutes, 0 = no limit)<input type="number" min={0} max={480} value={props.timeoutMinutes} onChange={e => props.onTimeoutChange(Number(e.target.value))} /></label>
              </div>
              <div className="threshold-input">
                <label>
                  Sustain at threshold (minutes)
                  <input type="number" min={0} max={60} value={props.sustainMinutes} onChange={e => props.onSustainChange(Number(e.target.value))} />
                  <small style={{ display: 'block', color: 'var(--color-text-muted)', marginTop: 4, fontSize: 'var(--text-xs)' }}>Hold load at target for this duration before stopping. 0 = stop immediately.</small>
                </label>
              </div>
            </div>
            <div className="ai-toggles" style={{ marginTop: 16 }}>
              <label className="toggle-switch">
                <input type="checkbox" checked={props.parallelExecution} onChange={e => props.onParallelChange(e.target.checked)} />
                <span className="toggle-slider" /><span className="toggle-label">Enable Parallel Execution</span>
              </label>
              <label className="toggle-switch">
                <input type="checkbox" checked={props.autoCleanup} onChange={e => props.onAutoCleanupChange(e.target.checked)} />
                <span className="toggle-slider" /><span className="toggle-label">Auto-cleanup entities when execution completes</span>
              </label>
              <label className="toggle-switch">
                <input type="checkbox" checked={props.mlGuidedOps} onChange={e => props.onMlGuidedChange(e.target.checked)} />
                <span className="toggle-slider" /><span className="toggle-label">ML-guided operation selection (auto-pick high-impact ops when metrics stagnate)</span>
              </label>
            </div>
            <div className="threshold-grid" style={{ marginTop: 16 }}>
              <div className="threshold-input">
                <label>
                  Entity Cooldown (seconds)
                  <input type="number" min={0} max={60} value={props.entityCooldown} onChange={e => props.onCooldownChange(Number(e.target.value))} />
                </label>
                <small style={{ color: 'var(--color-text-muted)', display: 'block', marginTop: 4, fontSize: 'var(--text-xs)' }}>Min delay between ops of same type (0 = no cooldown)</small>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Tags */}
      <section className="config-section">
        <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>label</i> Tags / Labels</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {props.tags.map((tag, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 'var(--radius-full)', background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
              {tag}
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--color-danger)', padding: 0, lineHeight: 1 }} onClick={() => props.onTagsChange(props.tags.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          <input
            type="text" value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && tagInput.trim()) { props.onTagsChange([...props.tags, tagInput.trim()]); setTagInput(''); e.preventDefault(); } }}
            placeholder="Type tag and press Enter"
            style={{ padding: '6px 10px', border: '2px solid var(--color-border)', borderRadius: 'var(--radius-sm)', minWidth: 160, fontSize: 'var(--text-sm)' }}
          />
        </div>
        <small style={{ color: 'var(--color-text-muted)', display: 'block', marginTop: 6, fontSize: 'var(--text-xs)' }}>Tags help filter and compare executions (e.g., "pre-upgrade", "nightly-soak")</small>
      </section>

      {/* Alert Thresholds & Monitoring Rules */}
      <section className="config-section">
        <h2 style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setShowAlerts(!showAlerts)}>
          <i className="material-icons-outlined" style={{ fontSize: 18, transition: 'transform 200ms', transform: showAlerts ? 'rotate(90deg)' : 'rotate(0)' }}>chevron_right</i>
          Alert Thresholds & Monitoring Rules
        </h2>
        {showAlerts && (
          <div className="advanced-settings">
            {/* Spike / Failure Rate Thresholds */}
            <div className="threshold-grid">
              <div className="threshold-input">
                <label>CPU Spike Threshold (%)<input type="number" min={1} max={50} step={0.5} value={props.cpuSpikeThreshold} onChange={e => props.onCpuSpikeChange(Number(e.target.value))} /></label>
                <small style={{ color: 'var(--color-text-muted)', display: 'block', marginTop: 4, fontSize: 'var(--text-xs)' }}>Alert when CPU jumps more than this % in one poll</small>
              </div>
              <div className="threshold-input">
                <label>Memory Spike Threshold (%)<input type="number" min={1} max={50} step={0.5} value={props.memorySpikeThreshold} onChange={e => props.onMemSpikeChange(Number(e.target.value))} /></label>
              </div>
              <div className="threshold-input">
                <label>Failure Rate Threshold (0–1)<input type="number" min={0.05} max={1} step={0.05} value={props.failureRateThreshold} onChange={e => props.onFailRateChange(Number(e.target.value))} /></label>
                <small style={{ color: 'var(--color-text-muted)', display: 'block', marginTop: 4, fontSize: 'var(--text-xs)' }}>Trigger anomaly when failure rate exceeds this</small>
              </div>
            </div>

            {/* Monitoring Rules */}
            <div style={{ marginTop: 24, borderTop: '1px solid var(--color-border)', paddingTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="material-icons-outlined" style={{ fontSize: 20, color: 'var(--color-primary)' }}>monitoring</i>
                  Monitoring Rules
                </h3>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {props.monitoringRules.filter(r => r.enabled).length} active rule{props.monitoringRules.filter(r => r.enabled).length !== 1 ? 's' : ''}
                </span>
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: '0 0 16px' }}>
                Add rules to monitor Prometheus metrics during execution. Violations are captured as alerts on the Alerts page.
              </p>

              <MonitoringRulesEditor
                rules={props.monitoringRules}
                onChange={props.onMonitoringRulesChange}
                availableNamespaces={props.availableNamespaces}
                availablePods={props.availablePods}
                podsByNamespace={props.podsByNamespace}
                testbedId={props.testbedId}
                embedded
              />
            </div>
          </div>
        )}
      </section>

      {/* Longevity Mode */}
      <section className="config-section">
        <h2 style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setShowLongevity(!showLongevity)}>
          <i className="material-icons-outlined" style={{ fontSize: 18, transition: 'transform 200ms', transform: showLongevity ? 'rotate(90deg)' : 'rotate(0)' }}>chevron_right</i>
          Longevity Mode
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={props.longevityEnabled} onChange={e => props.onLongevityToggle(e.target.checked)} />
            <strong>Enable Longevity Mode</strong>
          </label>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Maintains load at target and runs periodic health checks</span>
        </div>

        {showLongevity && props.longevityEnabled && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
            <div><label>Duration (hours)</label><input type="number" min={1} max={720} value={props.longevityDuration} onChange={e => props.onLongevityDuration(Number(e.target.value))} style={{ width: '100%', padding: '10px 12px', border: '2px solid var(--color-border)', borderRadius: 'var(--radius-sm)', marginTop: 6 }} /><small style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>1–720 hours (30 days max)</small></div>
            <div><label>Churn Interval (min)</label><input type="number" min={5} max={240} value={props.churnIntervalMin} onChange={e => props.onChurnChange(Number(e.target.value))} style={{ width: '100%', padding: '10px 12px', border: '2px solid var(--color-border)', borderRadius: 'var(--radius-sm)', marginTop: 6 }} /></div>
            <div><label>Health Check Interval (min)</label><input type="number" min={10} max={360} value={props.healthCheckIntervalMin} onChange={e => props.onHealthCheckChange(Number(e.target.value))} style={{ width: '100%', padding: '10px 12px', border: '2px solid var(--color-border)', borderRadius: 'var(--radius-sm)', marginTop: 6 }} /></div>
            <div><label>Checkpoint Interval (min)</label><input type="number" min={30} max={480} value={props.checkpointIntervalMin} onChange={e => props.onCheckpointChange(Number(e.target.value))} style={{ width: '100%', padding: '10px 12px', border: '2px solid var(--color-border)', borderRadius: 'var(--radius-sm)', marginTop: 6 }} /></div>
            <div><label>Maintain Load at (%)</label><input type="number" min={20} max={95} value={props.maintainLoadPct} onChange={e => props.onMaintainLoadChange(Number(e.target.value))} style={{ width: '100%', padding: '10px 12px', border: '2px solid var(--color-border)', borderRadius: 'var(--radius-sm)', marginTop: 6 }} /></div>

            <div style={{ gridColumn: '1 / -1' }}>
              <h3 style={{ margin: '12px 0 8px', fontSize: 'var(--text-base)', fontWeight: 600 }}>Health Checks</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {Object.entries(HEALTH_CHECK_LABELS).map(([key, label]) => (
                  <label key={key} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 'var(--text-xs)',
                    background: props.healthChecks[key] ? 'var(--color-success-light)' : 'var(--color-surface-muted)',
                    border: `1px solid ${props.healthChecks[key] ? 'var(--color-success)' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'all var(--transition-fast)',
                  }}>
                    <input type="checkbox" checked={props.healthChecks[key]} onChange={e => props.onHealthChecksChange({ ...props.healthChecks, [key]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
};

export default StepAdvanced;
