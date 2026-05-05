import React from 'react';
import type { AISettings, MonitoringRule } from './types';
import { QUICK_RULE_TEMPLATES } from './types';

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

const SEVERITY_COLORS: Record<string, string> = {
  Critical: '#ef4444',
  Moderate: '#f59e0b',
  Low: '#22c55e',
};

const StepAdvanced: React.FC<StepAdvancedProps> = (props) => {
  const [showExecution, setShowExecution] = React.useState(false);
  const [showAlerts, setShowAlerts] = React.useState(false);
  const [showLongevity, setShowLongevity] = React.useState(false);
  const [tagInput, setTagInput] = React.useState('');
  const [showAddCustomRule, setShowAddCustomRule] = React.useState(false);
  const [customRuleName, setCustomRuleName] = React.useState('');
  const [customRuleQuery, setCustomRuleQuery] = React.useState('');
  const [customRuleOperator, setCustomRuleOperator] = React.useState<MonitoringRule['operator']>('>');
  const [customRuleThreshold, setCustomRuleThreshold] = React.useState(80);
  const [customRuleSeverity, setCustomRuleSeverity] = React.useState<MonitoringRule['severity']>('Moderate');
  const [customRuleDescription, setCustomRuleDescription] = React.useState('');
  const [customRuleNamespace, setCustomRuleNamespace] = React.useState('');
  const [customRulePod, setCustomRulePod] = React.useState('');

  const addQuickRule = (template: typeof QUICK_RULE_TEMPLATES[0]) => {
    const exists = props.monitoringRules.some(r => r.query === template.query);
    if (exists) return;
    const newRule: MonitoringRule = {
      ...template,
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      enabled: true,
    };
    props.onMonitoringRulesChange([...props.monitoringRules, newRule]);
  };

  const addCustomRule = () => {
    if (!customRuleName.trim() || !customRuleQuery.trim()) return;
    const newRule: MonitoringRule = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: customRuleName.trim(),
      query: customRuleQuery.trim(),
      operator: customRuleOperator,
      threshold: customRuleThreshold,
      severity: customRuleSeverity,
      enabled: true,
      description: customRuleDescription.trim() || undefined,
      namespace: customRuleNamespace || undefined,
      podName: customRulePod || undefined,
    };
    props.onMonitoringRulesChange([...props.monitoringRules, newRule]);
    setCustomRuleName(''); setCustomRuleQuery(''); setCustomRuleOperator('>');
    setCustomRuleThreshold(80); setCustomRuleSeverity('Moderate'); setCustomRuleDescription('');
    setCustomRuleNamespace(''); setCustomRulePod('');
    setShowAddCustomRule(false);
  };

  const removeRule = (ruleId: string) => {
    props.onMonitoringRulesChange(props.monitoringRules.filter(r => r.id !== ruleId));
  };

  const toggleRule = (ruleId: string) => {
    props.onMonitoringRulesChange(props.monitoringRules.map(r =>
      r.id === ruleId ? { ...r, enabled: !r.enabled } : r
    ));
  };

  const updateRuleField = (ruleId: string, field: keyof MonitoringRule, value: any) => {
    props.onMonitoringRulesChange(props.monitoringRules.map(r =>
      r.id === ruleId ? { ...r, [field]: value } : r
    ));
  };

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

            {/* PID Tuning (CPU & Memory) — disabled
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
            */}
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

              {/* Quick Rule Templates */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick Add Rules</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {QUICK_RULE_TEMPLATES.map(tpl => {
                    const alreadyAdded = props.monitoringRules.some(r => r.query === tpl.query);
                    return (
                      <button
                        key={tpl.query}
                        type="button"
                        onClick={() => addQuickRule(tpl)}
                        disabled={alreadyAdded}
                        title={tpl.description}
                        style={{
                          padding: '5px 12px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)',
                          fontWeight: 500, cursor: alreadyAdded ? 'default' : 'pointer', border: 'none',
                          background: alreadyAdded ? 'var(--color-surface-muted)' : `${SEVERITY_COLORS[tpl.severity]}15`,
                          color: alreadyAdded ? 'var(--color-text-muted)' : SEVERITY_COLORS[tpl.severity],
                          opacity: alreadyAdded ? 0.6 : 1, transition: 'all var(--transition-fast)',
                        }}
                      >
                        {alreadyAdded ? '✓ ' : '+ '}{tpl.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Rules Table */}
              {props.monitoringRules.length > 0 && (
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 16, overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)', minWidth: 800 }}>
                    <thead>
                      <tr style={{ background: 'var(--color-surface-muted)' }}>
                        <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 600, width: 40 }}>On</th>
                        <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 600 }}>Rule Name</th>
                        <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 600 }}>Namespace</th>
                        <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 600 }}>Pod Name</th>
                        <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 600 }}>Query</th>
                        <th style={{ padding: '8px 8px', textAlign: 'center', fontWeight: 600, width: 60 }}>Op</th>
                        <th style={{ padding: '8px 8px', textAlign: 'center', fontWeight: 600, width: 70 }}>Threshold</th>
                        <th style={{ padding: '8px 8px', textAlign: 'center', fontWeight: 600, width: 85 }}>Severity</th>
                        <th style={{ padding: '8px 8px', textAlign: 'center', fontWeight: 600, width: 40 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {props.monitoringRules.map(rule => (
                        <tr key={rule.id} style={{ borderTop: '1px solid var(--color-border)', opacity: rule.enabled ? 1 : 0.5 }}>
                          <td style={{ padding: '5px 8px' }}>
                            <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(rule.id)} />
                          </td>
                          <td style={{ padding: '5px 8px', fontWeight: 500 }}>{rule.name}</td>
                          <td style={{ padding: '5px 8px' }}>
                            <select value={rule.namespace || ''} onChange={e => updateRuleField(rule.id, 'namespace', e.target.value || undefined)}
                              style={{ padding: '2px 4px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.72rem', background: 'white', maxWidth: 120 }}>
                              <option value="">All</option>
                              {props.availableNamespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '5px 8px' }}>
                            <select value={rule.podName || ''} onChange={e => updateRuleField(rule.id, 'podName', e.target.value || undefined)}
                              style={{ padding: '2px 4px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.72rem', background: 'white', maxWidth: 140 }}>
                              <option value="">All Pods</option>
                              {props.availablePods.map(pod => <option key={pod} value={pod}>{pod}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--color-primary)' }}>{rule.query}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <select value={rule.operator} onChange={e => updateRuleField(rule.id, 'operator', e.target.value)}
                              style={{ padding: '2px 4px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.72rem', background: 'white' }}>
                              <option value=">">&gt;</option>
                              <option value="<">&lt;</option>
                              <option value=">=">&gt;=</option>
                              <option value="<=">&lt;=</option>
                              <option value="==">==</option>
                              <option value="!=">!=</option>
                            </select>
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <input type="number" value={rule.threshold} onChange={e => updateRuleField(rule.id, 'threshold', Number(e.target.value))}
                              style={{ width: 60, padding: '2px 4px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.72rem', textAlign: 'center' }} />
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <select value={rule.severity} onChange={e => updateRuleField(rule.id, 'severity', e.target.value)}
                              style={{ padding: '2px 6px', border: 'none', borderRadius: 'var(--radius-full)', fontSize: '0.68rem', fontWeight: 600,
                                background: `${SEVERITY_COLORS[rule.severity]}20`, color: SEVERITY_COLORS[rule.severity] }}>
                              <option value="Critical">Critical</option>
                              <option value="Moderate">Moderate</option>
                              <option value="Low">Low</option>
                            </select>
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <button type="button" onClick={() => removeRule(rule.id)} title="Remove rule"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: 16, lineHeight: 1, padding: '2px' }}>
                              <i className="material-icons-outlined" style={{ fontSize: 18 }}>delete_outline</i>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add Custom Rule */}
              {!showAddCustomRule ? (
                <button type="button" onClick={() => setShowAddCustomRule(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                    border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
                    background: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                  <i className="material-icons-outlined" style={{ fontSize: 18 }}>add</i>
                  Add Custom Prometheus Rule
                </button>
              ) : (
                <div style={{ border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', padding: 16, background: 'var(--color-primary-light)' }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 12 }}>Custom Prometheus Rule</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Rule Name *</label>
                      <input type="text" value={customRuleName} onChange={e => setCustomRuleName(e.target.value)}
                        placeholder="e.g., High Disk Usage"
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Prometheus Query *</label>
                      <input type="text" value={customRuleQuery} onChange={e => setCustomRuleQuery(e.target.value)}
                        placeholder="e.g., node_filesystem_avail_bytes"
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'monospace' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Namespace (optional)</label>
                      <select value={customRuleNamespace} onChange={e => setCustomRuleNamespace(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)' }}>
                        <option value="">All Namespaces</option>
                        {props.availableNamespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Pod Name (optional)</label>
                      <select value={customRulePod} onChange={e => setCustomRulePod(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)' }}>
                        <option value="">All Pods</option>
                        {props.availablePods.map(pod => <option key={pod} value={pod}>{pod}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Operator</label>
                        <select value={customRuleOperator} onChange={e => setCustomRuleOperator(e.target.value as MonitoringRule['operator'])}
                          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)' }}>
                          <option value=">">&gt;</option><option value="<">&lt;</option>
                          <option value=">=">&gt;=</option><option value="<=">&lt;=</option>
                          <option value="==">==</option><option value="!=">!=</option>
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Threshold</label>
                        <input type="number" value={customRuleThreshold} onChange={e => setCustomRuleThreshold(Number(e.target.value))}
                          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)' }} />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Severity</label>
                      <select value={customRuleSeverity} onChange={e => setCustomRuleSeverity(e.target.value as MonitoringRule['severity'])}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)' }}>
                        <option value="Critical">Critical</option>
                        <option value="Moderate">Moderate</option>
                        <option value="Low">Low</option>
                      </select>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Description (optional)</label>
                      <input type="text" value={customRuleDescription} onChange={e => setCustomRuleDescription(e.target.value)}
                        placeholder="Describe when this alert should fire"
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setShowAddCustomRule(false)}
                      style={{ padding: '6px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'white', cursor: 'pointer', fontSize: 'var(--text-xs)' }}>
                      Cancel
                    </button>
                    <button type="button" onClick={addCustomRule} disabled={!customRuleName.trim() || !customRuleQuery.trim()}
                      style={{ padding: '6px 16px', border: 'none', borderRadius: 'var(--radius-sm)', background: 'var(--color-primary)', color: 'white',
                        cursor: customRuleName.trim() && customRuleQuery.trim() ? 'pointer' : 'not-allowed', fontSize: 'var(--text-xs)', fontWeight: 600,
                        opacity: customRuleName.trim() && customRuleQuery.trim() ? 1 : 0.5 }}>
                      Add Rule
                    </button>
                  </div>
                </div>
              )}

              {/* Info box */}
              {props.monitoringRules.length > 0 && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#eff6ff', borderRadius: 'var(--radius-sm)', border: '1px solid #bfdbfe', fontSize: 'var(--text-xs)', color: '#1e40af' }}>
                  <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>info</i>
                  These rules will be evaluated every iteration during execution. Violations will be recorded as alerts on the <strong>Alerts</strong> page and included in the execution report.
                </div>
              )}
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
