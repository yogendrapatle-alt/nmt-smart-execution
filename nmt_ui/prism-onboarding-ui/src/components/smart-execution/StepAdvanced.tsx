import React from 'react';
import type { AISettings } from './types';

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

  return (
    <>
      {/* Monitoring Rules */}
      <section className="config-section">
        <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>settings</i> Monitoring Rules</h2>
        {props.loadingPods ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Loading available namespaces and pods…</div>
        ) : (
          <div className="advanced-settings" style={{ borderTop: 'none', paddingTop: 0 }}>
            <div className="advanced-group">
              <label>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Namespaces</span>
                {props.availableNamespaces.length === 0 ? (
                  <div className="info-message">No namespaces available. Select a testbed first.</div>
                ) : (
                  <div className="multi-select-box">
                    {props.availableNamespaces.map(ns => (
                      <label key={ns} className="checkbox-label">
                        <input type="checkbox" checked={props.selectedNamespaces.includes(ns)}
                          onChange={e => props.onNamespacesChange(e.target.checked ? [...props.selectedNamespaces, ns] : props.selectedNamespaces.filter(n => n !== ns))} />
                        <span>{ns}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="selected-items">Selected: {props.selectedNamespaces.length > 0 ? props.selectedNamespaces.join(', ') : 'None'}</div>
              </label>

              <label style={{ marginTop: 16, display: 'block' }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Pod Names (optional — leave empty to monitor all)</span>
                {props.availablePods.length === 0 ? (
                  <div className="info-message">No pods available.</div>
                ) : (
                  <div className="multi-select-box scrollable">
                    <div className="select-all-button">
                      <button type="button" onClick={() => props.onPodsChange([])} className="btn-small">Clear All</button>
                    </div>
                    {props.availablePods.map(pod => (
                      <label key={pod} className="checkbox-label">
                        <input type="checkbox" checked={props.selectedPods.includes(pod)}
                          onChange={e => props.onPodsChange(e.target.checked ? [...props.selectedPods, pod] : props.selectedPods.filter(p => p !== pod))} />
                        <span>{pod}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="selected-items">Selected: {props.selectedPods.length > 0 ? `${props.selectedPods.length} pods` : 'All pods (no filter)'}</div>
              </label>
            </div>

            {props.aiSettings.enable_ai && (
              <div className="advanced-group">
                <h3>PID Tuning (CPU)</h3>
                <div className="pid-inputs">
                  {(['cpu_kp', 'cpu_ki', 'cpu_kd'] as const).map(key => (
                    <label key={key}>
                      {key === 'cpu_kp' ? 'Kp (Proportional)' : key === 'cpu_ki' ? 'Ki (Integral)' : 'Kd (Derivative)'}
                      <input type="number" step={key === 'cpu_ki' ? 0.01 : 0.1} value={props.aiSettings.pid_tuning[key]}
                        onChange={e => props.onAISettingsChange({ ...props.aiSettings, pid_tuning: { ...props.aiSettings.pid_tuning, [key]: Number(e.target.value) } })} />
                    </label>
                  ))}
                </div>
                <h3>PID Tuning (Memory)</h3>
                <div className="pid-inputs">
                  {(['memory_kp', 'memory_ki', 'memory_kd'] as const).map(key => (
                    <label key={key}>
                      {key === 'memory_kp' ? 'Kp' : key === 'memory_ki' ? 'Ki' : 'Kd'}
                      <input type="number" step={key === 'memory_ki' ? 0.01 : 0.1} value={props.aiSettings.pid_tuning[key]}
                        onChange={e => props.onAISettingsChange({ ...props.aiSettings, pid_tuning: { ...props.aiSettings.pid_tuning, [key]: Number(e.target.value) } })} />
                    </label>
                  ))}
                </div>
              </div>
            )}
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

      {/* Alert Thresholds */}
      <section className="config-section">
        <h2 style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setShowAlerts(!showAlerts)}>
          <i className="material-icons-outlined" style={{ fontSize: 18, transition: 'transform 200ms', transform: showAlerts ? 'rotate(90deg)' : 'rotate(0)' }}>chevron_right</i>
          Alert Thresholds
        </h2>
        {showAlerts && (
          <div className="advanced-settings">
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
