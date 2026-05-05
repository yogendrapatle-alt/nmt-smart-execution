/**
 * Smart Execution Configuration Page (AI-Powered)
 *
 * Wizard-style configuration with 5 steps:
 *   0. Identity — Testbed selection, name, preset templates
 *   1. Entities — Entity/operation selection grid
 *   2. Thresholds — CPU/memory targets, AI/ML settings
 *   3. Advanced — Monitoring rules, execution settings, longevity
 *   4. Review — Summary, pre-check, launch
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/SmartExecutionConfigureAI.css';
import { IS_FAKE_MODE } from '../config/fakeMode';
import { getApiBase } from '../utils/backendUrl';
import { PageHeader } from '../components/ui';
import {
  WizardStepper,
  StepIdentity,
  StepEntities,
  StepThresholds,
  StepAdvanced,
  StepReview,
  AVAILABLE_ENTITIES,
  getAvailableOperations,
} from '../components/smart-execution';
import type { Testbed, AISettings, PresetConfig, MonitoringRule } from '../components/smart-execution';

const STEPS = [
  { label: 'Identity', icon: 'badge' },
  { label: 'Entities', icon: 'apps' },
  { label: 'Thresholds', icon: 'tune' },
  { label: 'Advanced', icon: 'settings' },
  { label: 'Review', icon: 'checklist' },
];

const SmartExecutionConfigureAI: React.FC = () => {
  const navigate = useNavigate();

  // Wizard
  const [currentStep, setCurrentStep] = useState(0);

  // Testbeds
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbed, setSelectedTestbed] = useState('');

  // Identity
  const [executionName, setExecutionName] = useState('');
  const [executionDescription, setExecutionDescription] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // Entities
  const [selectedEntities, setSelectedEntities] = useState<Record<string, string[]>>({});

  // Thresholds
  const [cpuThreshold, setCpuThreshold] = useState(80);
  const [memoryThreshold, setMemoryThreshold] = useState(75);
  const [stopCondition, setStopCondition] = useState('any');

  // AI
  const [aiSettings, setAISettings] = useState<AISettings>({
    enable_ai: true, enable_ml: true, data_collection: true,
    pid_tuning: { cpu_kp: 2.5, cpu_ki: 0.12, cpu_kd: 0.6, memory_kp: 2.0, memory_ki: 0.1, memory_kd: 0.5 },
  });
  const [mlRecommendations, setMlRecommendations] = useState<any[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

  // Monitoring
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [availablePods, setAvailablePods] = useState<string[]>([]);
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>([]);
  const [selectedPods, setSelectedPods] = useState<string[]>([]);
  const [loadingPods, setLoadingPods] = useState(false);

  // Execution settings
  const [workloadProfile, setWorkloadProfile] = useState('sustained');
  const [maxParallelOps, setMaxParallelOps] = useState(5);
  const [opsPerIteration, setOpsPerIteration] = useState(3);
  const [parallelExecution, setParallelExecution] = useState(true);
  const [autoCleanup, setAutoCleanup] = useState(false);
  const [timeoutMinutes, setTimeoutMinutes] = useState(0);
  const [sustainMinutes, setSustainMinutes] = useState(5);
  const [mlGuidedOps, setMlGuidedOps] = useState(false);
  const [entityCooldown, setEntityCooldown] = useState(0);

  // Alert thresholds
  const [cpuSpikeThreshold, setCpuSpikeThreshold] = useState(10);
  const [memorySpikeThreshold, setMemorySpikeThreshold] = useState(10);
  const [failureRateThreshold, setFailureRateThreshold] = useState(0.3);

  // Tags
  const [tags, setTags] = useState<string[]>([]);

  // Monitoring Rules
  const [monitoringRules, setMonitoringRules] = useState<MonitoringRule[]>([]);

  // Longevity
  const [longevityEnabled, setLongevityEnabled] = useState(false);
  const [longevityDuration, setLongevityDuration] = useState(24);
  const [churnIntervalMin, setChurnIntervalMin] = useState(30);
  const [healthCheckIntervalMin, setHealthCheckIntervalMin] = useState(60);
  const [checkpointIntervalMin, setCheckpointIntervalMin] = useState(120);
  const [maintainLoadPct, setMaintainLoadPct] = useState(75);
  const [healthChecks, setHealthChecks] = useState<Record<string, boolean>>({
    fatal_scan: true, process_restarts: true, cgroup_oom: true, thread_count: true,
    disk_usage: true, core_dumps: true, memory_leaks: true,
  });

  // Pre-check
  const [preCheckResult, setPreCheckResult] = useState<any>(null);
  const [runningPreCheck, setRunningPreCheck] = useState(false);

  // UI
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /* ─── Effects ──────────────────────────────────────────── */

  useEffect(() => {
    fetchTestbeds();

    // Pre-select testbed if navigated from MyTestbeds or Onboarding
    const preSelectedId = localStorage.getItem('unique_testbed_id');
    if (preSelectedId) {
      setSelectedTestbed(preSelectedId);
      localStorage.removeItem('unique_testbed_id');
    }

    const rerunJson = sessionStorage.getItem('rerun_config');
    if (rerunJson) {
      try {
        const cfg = JSON.parse(rerunJson);
        sessionStorage.removeItem('rerun_config');
        if (cfg.testbed_id) setSelectedTestbed(cfg.testbed_id);
        if (cfg.target_config) {
          setCpuThreshold(cfg.target_config.cpu_threshold || 80);
          setMemoryThreshold(cfg.target_config.memory_threshold || 75);
          setStopCondition(cfg.target_config.stop_condition || 'any');
          const adv = cfg.target_config.advanced || {};
          if (adv.workload_profile) setWorkloadProfile(adv.workload_profile);
          if (adv.max_parallel_operations) setMaxParallelOps(adv.max_parallel_operations);
          if (adv.operations_per_iteration) setOpsPerIteration(adv.operations_per_iteration);
          if (adv.parallel_execution !== undefined) setParallelExecution(adv.parallel_execution);
          if (adv.auto_cleanup !== undefined) setAutoCleanup(adv.auto_cleanup);
        }
        if (cfg.entities_config) {
          const cleaned: Record<string, string[]> = {};
          for (const [k, v] of Object.entries(cfg.entities_config)) {
            if (Array.isArray(v)) cleaned[k] = v;
          }
          setSelectedEntities(cleaned);
        }
        if (cfg.tags) setTags(cfg.tags);
      } catch (err) { console.warn('Failed to parse rerun config:', err); }
    }
  }, []);

  useEffect(() => {
    if (selectedTestbed) {
      fetchAvailablePods();
      loadSavedMonitoringRules(selectedTestbed);
    }
  }, [selectedTestbed]);

  // Auto-save monitoring rules when they change (debounced)
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!selectedTestbed || monitoringRules.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`${getApiBase()}/api/testbed/${selectedTestbed}/monitoring-rules`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitoring_rules: monitoringRules }),
      }).catch(() => {});
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [monitoringRules, selectedTestbed]);

  /* ─── API calls ────────────────────────────────────────── */

  const fetchTestbeds = async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/get-testbeds`);
      if (!response.ok) { setError(`Failed to load testbeds (HTTP ${response.status})`); return; }
      const data = await response.json();
      if (data.success && data.testbeds) setTestbeds(data.testbeds);
      else setError(data.error || 'Failed to load testbeds');
    } catch { setError('Could not connect to backend to load testbeds'); }
  };

  const loadSavedMonitoringRules = async (testbedId: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/testbed/${testbedId}/monitoring-rules`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.monitoring_rules) && data.monitoring_rules.length > 0) {
          setMonitoringRules(data.monitoring_rules);
        }
      }
    } catch { /* ignore — rules just start empty */ }
  };

  const fetchAvailablePods = async () => {
    if (!selectedTestbed) return;
    setLoadingPods(true);
    try {
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const defaultNamespaces = ['ntnx-system', 'default', 'kube-system', 'kube-public', 'kube-node-lease', 'monitoring', 'logging'];
        const defaultPods = ['ncm-api-server', 'ncm-pod-1', 'ncm-pod-2', 'ncm-pod-3', 'prism-central-pod-1', 'prism-central-pod-2', 'kubernetes-dashboard', 'metrics-server', 'coredns-pod-1', 'coredns-pod-2', 'etcd-pod', 'kube-apiserver', 'kube-controller-manager', 'kube-scheduler', 'alertmanager', 'prometheus', 'grafana'];
        setAvailableNamespaces(defaultNamespaces);
        setAvailablePods(defaultPods);
        setSelectedNamespaces(['ntnx-system', 'default', 'kube-system']);
        setLoadingPods(false);
        return;
      }
      const response = await fetch(`${getApiBase()}/api/smart-execution/available-pods`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testbed_id: selectedTestbed }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setAvailableNamespaces(data.namespaces || []);
          setAvailablePods(data.pods || []);
          const common = ['ntnx-system', 'default', 'kube-system'];
          setSelectedNamespaces(data.namespaces?.filter((ns: string) => common.includes(ns)) || common);
        } else throw new Error('API returned error');
      } else throw new Error('API request failed');
    } catch {
      setAvailableNamespaces(['ntnx-system', 'default', 'kube-system']);
      setAvailablePods(['prism-central', 'ncm-api-server', 'ncm-controller', 'ncm-scheduler', 'calm-server', 'epsilon-server', 'nucalm', 'insights-server', 'coredns', 'etcd', 'kube-apiserver', 'metrics-server']);
      setSelectedNamespaces(['ntnx-system', 'default', 'kube-system']);
    } finally { setLoadingPods(false); }
  };

  const fetchMLRecommendations = async () => {
    if (!selectedTestbed) { setError('Please select a testbed first'); return; }
    setLoadingRecommendations(true); setError('');
    try {
      const response = await fetch(`${getApiBase()}/api/smart-execution/ml-recommendations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testbed_id: selectedTestbed, target_cpu: cpuThreshold, target_memory: memoryThreshold }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) setMlRecommendations(data.recommendations || []);
        else setError(data.error || 'Failed to get ML recommendations');
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.error || 'Failed to get ML recommendations');
      }
    } catch { setError('Error fetching recommendations. Make sure backend is running.'); }
    finally { setLoadingRecommendations(false); }
  };

  const applyMLRecommendations = () => {
    const newSelection: Record<string, string[]> = {};
    mlRecommendations.slice(0, 5).forEach(rec => {
      if (!newSelection[rec.entity]) newSelection[rec.entity] = [];
      if (!newSelection[rec.entity].includes(rec.operation)) newSelection[rec.entity].push(rec.operation);
    });
    setSelectedEntities(newSelection);
  };

  const runPreCheck = async () => {
    if (!selectedTestbed) { setError('Select a testbed first'); return; }
    setRunningPreCheck(true); setPreCheckResult(null);
    try {
      const res = await fetch(`${getApiBase()}/api/smart-execution/pre-check`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testbed_id: selectedTestbed, target_config: { cpu_threshold: cpuThreshold, memory_threshold: memoryThreshold, stop_condition: stopCondition }, entities_config: selectedEntities }),
      });
      const data = await res.json();
      setPreCheckResult(data.success ? data.checks : { passed: false, warnings: [data.error || 'Pre-check failed'] });
    } catch { setPreCheckResult({ passed: false, warnings: ['Could not reach backend'] }); }
    finally { setRunningPreCheck(false); }
  };

  const startExecution = async () => {
    if (!selectedTestbed) { setError('Please select a testbed'); return; }
    if (Object.keys(selectedEntities).length === 0) { setError('Please select at least one entity-operation pair'); return; }
    setLoading(true); setError('');
    try {
      const config: Record<string, unknown> = {
        testbed_id: selectedTestbed,
        execution_name: executionName || undefined,
        execution_description: executionDescription || undefined,
        target_config: {
          cpu_threshold: cpuThreshold, memory_threshold: memoryThreshold, stop_condition: stopCondition,
          timeout_minutes: timeoutMinutes > 0 ? timeoutMinutes : undefined, sustain_minutes: sustainMinutes,
          longevity: longevityEnabled
            ? { enabled: true, duration_hours: longevityDuration, churn_interval_minutes: churnIntervalMin, health_check_interval_minutes: healthCheckIntervalMin, checkpoint_interval_minutes: checkpointIntervalMin, maintain_load_percent: maintainLoadPct, health_checks: healthChecks }
            : { enabled: false },
        },
        entities_config: selectedEntities,
        rule_config: {
          namespaces: selectedNamespaces,
          pod_names: selectedPods,
          custom_queries: [],
          monitoring_rules: monitoringRules.filter(r => r.enabled).map(r => ({
            id: r.id, name: r.name, query: r.query, operator: r.operator,
            threshold: r.threshold, severity: r.severity, description: r.description,
            namespace: r.namespace || null, pod_name: r.podName || null,
          })),
        },
        ai_settings: aiSettings,
        advanced: { workload_profile: workloadProfile, max_parallel_operations: maxParallelOps, operations_per_iteration: opsPerIteration, parallel_execution: parallelExecution, auto_cleanup: autoCleanup, tags, ml_guided_ops: mlGuidedOps, entity_cooldown_seconds: entityCooldown, alert_thresholds: { cpu_spike_percent: cpuSpikeThreshold, memory_spike_percent: memorySpikeThreshold, failure_rate_threshold: failureRateThreshold } },
      };
      const endpoint = aiSettings.enable_ai ? `${getApiBase()}/api/smart-execution/start-ai` : `${getApiBase()}/api/smart-execution/start`;
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.execution_id) navigate(`/smart-execution/monitor/${data.execution_id}`);
        else setError(data.error || 'Failed to start execution');
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.error || `Failed to start execution (${response.status})`);
      }
    } catch { setError('Error starting execution. Make sure backend is running.'); }
    finally { setLoading(false); }
  };

  /* ─── Callbacks ────────────────────────────────────────── */

  const toggleEntityOperation = (entity: string, operation: string) => {
    setSelectedEntities(prev => {
      const current = prev[entity] || [];
      const updated = current.includes(operation) ? current.filter(op => op !== operation) : [...current, operation];
      if (updated.length === 0) { const { [entity]: _, ...rest } = prev; return rest; }
      return { ...prev, [entity]: updated };
    });
  };

  const setEntityOps = (entity: string, ops: string[]) => {
    setSelectedEntities(prev => {
      if (ops.length === 0) { const { [entity]: _, ...rest } = prev; return rest; }
      return { ...prev, [entity]: ops };
    });
  };

  const selectAllEntities = () => {
    const all: Record<string, string[]> = {};
    AVAILABLE_ENTITIES.forEach(entity => { all[entity] = getAvailableOperations(entity); });
    setSelectedEntities(all);
  };

  const applyPreset = (preset: PresetConfig) => {
    setActivePreset(preset.id);
    setSelectedEntities(preset.entities);
    setCpuThreshold(preset.cpuThreshold);
    setMemoryThreshold(preset.memoryThreshold);
    setStopCondition(preset.stopCondition);
    setWorkloadProfile(preset.workloadProfile);
    setMaxParallelOps(preset.maxParallelOps);
    setOpsPerIteration(preset.opsPerIteration);
    setParallelExecution(preset.parallelExecution);
    setAutoCleanup(preset.autoCleanup);
    setTimeoutMinutes(preset.timeoutMinutes);
    setSustainMinutes(preset.sustainMinutes);
    setLongevityEnabled(preset.longevityEnabled);
    setLongevityDuration(preset.longevityDuration);
    setAISettings(prev => ({ ...prev, enable_ai: preset.aiEnabled, enable_ml: preset.mlEnabled }));
    setTags(preset.tags);
  };

  const canProceed = (step: number): boolean => {
    if (step === 0) return !!selectedTestbed;
    if (step === 1) return Object.keys(selectedEntities).length > 0;
    return true;
  };

  /* ─── Render ───────────────────────────────────────────── */

  return (
    <div className="smart-execution-configure-ai">
      <PageHeader
        icon="psychology"
        iconGradient="linear-gradient(135deg, #3b82f6, #8b5cf6)"
        title="AI-Powered Smart Execution"
        subtitle="Configure intelligent threshold-based execution with PID control and ML optimization"
      />

      {error && (
        <div className="error-banner">
          <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>error_outline</i>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', float: 'right', fontSize: 16, color: 'inherit', lineHeight: 1 }}>×</button>
        </div>
      )}

      <WizardStepper steps={STEPS} currentStep={currentStep} onStepClick={setCurrentStep} />

      {currentStep === 0 && (
        <StepIdentity
          testbeds={testbeds} selectedTestbed={selectedTestbed} onSelectTestbed={setSelectedTestbed}
          executionName={executionName} onNameChange={setExecutionName}
          executionDescription={executionDescription} onDescriptionChange={setExecutionDescription}
          activePreset={activePreset} onApplyPreset={applyPreset}
        />
      )}

      {currentStep === 1 && (
        <StepEntities
          selectedEntities={selectedEntities}
          onToggleOperation={toggleEntityOperation}
          onSelectAll={selectAllEntities}
          onClearAll={() => setSelectedEntities({})}
          onSetEntityOps={setEntityOps}
        />
      )}

      {currentStep === 2 && (
        <StepThresholds
          cpuThreshold={cpuThreshold} onCpuChange={setCpuThreshold}
          memoryThreshold={memoryThreshold} onMemoryChange={setMemoryThreshold}
          stopCondition={stopCondition} onStopConditionChange={setStopCondition}
          aiSettings={aiSettings} onAISettingsChange={setAISettings}
          selectedTestbed={selectedTestbed}
          mlRecommendations={mlRecommendations} loadingRecommendations={loadingRecommendations}
          onFetchRecommendations={fetchMLRecommendations} onApplyRecommendations={applyMLRecommendations}
        />
      )}

      {currentStep === 3 && (
        <StepAdvanced
          aiSettings={aiSettings} onAISettingsChange={setAISettings}
          availableNamespaces={availableNamespaces} selectedNamespaces={selectedNamespaces} onNamespacesChange={setSelectedNamespaces}
          availablePods={availablePods} selectedPods={selectedPods} onPodsChange={setSelectedPods}
          loadingPods={loadingPods}
          workloadProfile={workloadProfile} onWorkloadChange={setWorkloadProfile}
          maxParallelOps={maxParallelOps} onMaxParallelChange={setMaxParallelOps}
          opsPerIteration={opsPerIteration} onOpsPerIterChange={setOpsPerIteration}
          parallelExecution={parallelExecution} onParallelChange={setParallelExecution}
          autoCleanup={autoCleanup} onAutoCleanupChange={setAutoCleanup}
          timeoutMinutes={timeoutMinutes} onTimeoutChange={setTimeoutMinutes}
          sustainMinutes={sustainMinutes} onSustainChange={setSustainMinutes}
          mlGuidedOps={mlGuidedOps} onMlGuidedChange={setMlGuidedOps}
          entityCooldown={entityCooldown} onCooldownChange={setEntityCooldown}
          cpuSpikeThreshold={cpuSpikeThreshold} onCpuSpikeChange={setCpuSpikeThreshold}
          memorySpikeThreshold={memorySpikeThreshold} onMemSpikeChange={setMemorySpikeThreshold}
          failureRateThreshold={failureRateThreshold} onFailRateChange={setFailureRateThreshold}
          tags={tags} onTagsChange={setTags}
          longevityEnabled={longevityEnabled} onLongevityToggle={setLongevityEnabled}
          longevityDuration={longevityDuration} onLongevityDuration={setLongevityDuration}
          churnIntervalMin={churnIntervalMin} onChurnChange={setChurnIntervalMin}
          healthCheckIntervalMin={healthCheckIntervalMin} onHealthCheckChange={setHealthCheckIntervalMin}
          checkpointIntervalMin={checkpointIntervalMin} onCheckpointChange={setCheckpointIntervalMin}
          maintainLoadPct={maintainLoadPct} onMaintainLoadChange={setMaintainLoadPct}
          healthChecks={healthChecks} onHealthChecksChange={setHealthChecks}
          monitoringRules={monitoringRules} onMonitoringRulesChange={setMonitoringRules}
        />
      )}

      {currentStep === 4 && (
        <StepReview
          testbeds={testbeds} selectedTestbed={selectedTestbed}
          executionName={executionName} cpuThreshold={cpuThreshold} memoryThreshold={memoryThreshold}
          stopCondition={stopCondition} aiSettings={aiSettings} workloadProfile={workloadProfile}
          maxParallelOps={maxParallelOps} selectedEntities={selectedEntities}
          longevityEnabled={longevityEnabled} longevityDuration={longevityDuration}
          tags={tags} loading={loading}
          onStartExecution={startExecution} onRunPreCheck={runPreCheck} runningPreCheck={runningPreCheck}
          preCheckResult={preCheckResult} onViewHistory={() => navigate('/smart-execution/history')}
        />
      )}

      {/* Step Navigation */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 'var(--space-6)', padding: 'var(--space-4) 0', borderTop: '1px solid var(--color-border)',
      }}>
        <button
          onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
          className="btn-secondary"
          style={{ opacity: currentStep === 0 ? 0.4 : 1 }}
        >
          <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>arrow_back</i> Previous
        </button>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Step {currentStep + 1} of {STEPS.length}
        </span>
        {currentStep < STEPS.length - 1 ? (
          <button
            onClick={() => setCurrentStep(Math.min(STEPS.length - 1, currentStep + 1))}
            disabled={!canProceed(currentStep)}
            className="btn-primary"
            style={{ opacity: !canProceed(currentStep) ? 0.4 : 1 }}
          >
            Next <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>arrow_forward</i>
          </button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
};

export default SmartExecutionConfigureAI;
