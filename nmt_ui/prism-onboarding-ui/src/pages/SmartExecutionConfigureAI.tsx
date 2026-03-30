/**
 * Smart Execution Configuration Page (AI-Powered)
 * 
 * User interface for configuring AI-powered Smart Execution with:
 * - Testbed selection
 * - Entity/Operation selection
 * - Rule configuration (thresholds, monitoring)
 * - AI/ML settings (enable/disable, PID tuning)
 * - ML recommendations
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/SmartExecutionConfigureAI.css';
import { IS_FAKE_MODE } from '../config/fakeMode';
import { getApiBase } from '../utils/backendUrl';

interface Testbed {
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string;
  ncm_ip: string;
  prometheus_endpoint: string;
  status?: string;
}

interface EntityOperation {
  entity: string;
  operations: string[];
}

interface AISettings {
  enable_ai: boolean;
  enable_ml: boolean;
  data_collection: boolean;
  pid_tuning: {
    cpu_kp: number;
    cpu_ki: number;
    cpu_kd: number;
    memory_kp: number;
    memory_ki: number;
    memory_kd: number;
  };
}

const SmartExecutionConfigureAI: React.FC = () => {
  const navigate = useNavigate();
  
  // State
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbed, setSelectedTestbed] = useState<string>('');
  const [availableEntities, setAvailableEntities] = useState<string[]>([
    'vm', 'project', 'category', 'image', 'subnet', 'cluster', 'alert',
    'endpoint', 'library_variable', 'runbook',
    'blueprint_single_vm', 'blueprint_multi_vm', 'playbook',
    'application', 'marketplace_item',
    'uda_policy', 'scenario', 'analysis_session',
    'report_config', 'report_instance',
    'business_unit', 'cost_center', 'budget', 'rate_card',
    'action_rule', 'dashboard', 'network_security_policy',
    'address_group', 'service_group', 'vpc', 'environment'
  ]);
  const [selectedEntities, setSelectedEntities] = useState<Record<string, string[]>>({});
  
  // Target configuration
  const [cpuThreshold, setCpuThreshold] = useState<number>(80);
  const [memoryThreshold, setMemoryThreshold] = useState<number>(75);
  const [stopCondition, setStopCondition] = useState<string>('any');
  
  // Rule configuration
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [availablePods, setAvailablePods] = useState<string[]>([]);
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>([]);
  const [selectedPods, setSelectedPods] = useState<string[]>([]);
  const [customQueries, setCustomQueries] = useState<string>('');
  const [loadingPods, setLoadingPods] = useState<boolean>(false);
  
  // AI Settings
  const [aiSettings, setAISettings] = useState<AISettings>({
    enable_ai: true,
    enable_ml: true,
    data_collection: true,
    pid_tuning: {
      cpu_kp: 2.5,
      cpu_ki: 0.12,
      cpu_kd: 0.6,
      memory_kp: 2.0,
      memory_ki: 0.1,
      memory_kd: 0.5
    }
  });
  
  // ML Recommendations
  const [mlRecommendations, setMlRecommendations] = useState<any[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState<boolean>(false);
  
  // Advanced execution settings
  const [workloadProfile, setWorkloadProfile] = useState<string>('sustained');
  const [maxParallelOps, setMaxParallelOps] = useState<number>(5);
  const [opsPerIteration, setOpsPerIteration] = useState<number>(3);
  const [parallelExecution, setParallelExecution] = useState<boolean>(true);
  const [autoCleanup, setAutoCleanup] = useState<boolean>(false);
  const [timeoutMinutes, setTimeoutMinutes] = useState<number>(0);
  
  // Pre-check
  const [preCheckResult, setPreCheckResult] = useState<any>(null);
  const [runningPreCheck, setRunningPreCheck] = useState<boolean>(false);
  
  // Tags
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState<string>('');
  
  // Alert thresholds
  const [cpuSpikeThreshold, setCpuSpikeThreshold] = useState<number>(10);
  const [memorySpikeThreshold, setMemorySpikeThreshold] = useState<number>(10);
  const [failureRateThreshold, setFailureRateThreshold] = useState<number>(0.3);
  
  // ML-guided operation selection
  const [mlGuidedOps, setMlGuidedOps] = useState<boolean>(false);
  
  // Entity cooldown
  const [entityCooldown, setEntityCooldown] = useState<number>(0);
  
  // Longevity Mode
  const [longevityEnabled, setLongevityEnabled] = useState<boolean>(false);
  const [longevityDuration, setLongevityDuration] = useState<number>(24);
  const [churnIntervalMin, setChurnIntervalMin] = useState<number>(30);
  const [healthCheckIntervalMin, setHealthCheckIntervalMin] = useState<number>(60);
  const [checkpointIntervalMin, setCheckpointIntervalMin] = useState<number>(120);
  const [maintainLoadPct, setMaintainLoadPct] = useState<number>(75);
  const [healthChecks, setHealthChecks] = useState<Record<string, boolean>>({
    fatal_scan: true,
    process_restarts: true,
    cgroup_oom: true,
    thread_count: true,
    disk_usage: true,
    core_dumps: true,
    memory_leaks: true,
  });
  const [showLongevitySettings, setShowLongevitySettings] = useState<boolean>(false);

  // UI State
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [showExecutionSettings, setShowExecutionSettings] = useState<boolean>(false);
  const [showAlertSettings, setShowAlertSettings] = useState<boolean>(false);

  // Fetch testbeds on mount and load rerun config if present
  useEffect(() => {
    fetchTestbeds();
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
        if (cfg.entities_config) setSelectedEntities(cfg.entities_config);
        if (cfg.tags) setTags(cfg.tags);
      } catch {}
    }
  }, []);

  // Fetch available pods when testbed is selected
  useEffect(() => {
    if (selectedTestbed) {
      fetchAvailablePods();
    }
  }, [selectedTestbed]);

  const fetchTestbeds = async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/get-testbeds`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.testbeds) {
          setTestbeds(data.testbeds);
        }
      }
    } catch (err) {
      console.error('Error fetching testbeds:', err);
    }
  };

  const fetchAvailablePods = async () => {
    if (!selectedTestbed) return;
    
    setLoadingPods(true);
    try {
      // FAKE DATA MODE or provide sensible defaults
      if (IS_FAKE_MODE || true) {  // Always use defaults for now
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Default namespaces commonly used in Kubernetes/Nutanix
        const defaultNamespaces = [
          'ntnx-system',
          'default',
          'kube-system',
          'kube-public',
          'kube-node-lease',
          'monitoring',
          'logging'
        ];
        
        // Default pod names (examples)
        const defaultPods = [
          'ncm-api-server',
          'ncm-pod-1',
          'ncm-pod-2',
          'ncm-pod-3',
          'prism-central-pod-1',
          'prism-central-pod-2',
          'kubernetes-dashboard',
          'metrics-server',
          'coredns-pod-1',
          'coredns-pod-2',
          'etcd-pod',
          'kube-apiserver',
          'kube-controller-manager',
          'kube-scheduler',
          'alertmanager',
          'prometheus',
          'grafana'
        ];
        
        setAvailableNamespaces(defaultNamespaces);
        setAvailablePods(defaultPods);
        
        // Auto-select common namespaces
        const commonNamespaces = ['ntnx-system', 'default', 'kube-system'];
        setSelectedNamespaces(commonNamespaces);
        
        setLoadingPods(false);
        return;
      }
      
      // Try to fetch from backend (if not in fake mode)
      const response = await fetch(`${getApiBase()}/api/smart-execution/available-pods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testbed_id: selectedTestbed })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setAvailableNamespaces(data.namespaces || []);
          setAvailablePods(data.pods || []);
          
          // Auto-select common namespaces
          const commonNamespaces = ['ntnx-system', 'default', 'kube-system'];
          const defaultSelection = data.namespaces?.filter((ns: string) => 
            commonNamespaces.includes(ns)
          ) || commonNamespaces;
          setSelectedNamespaces(defaultSelection);
        } else {
          // Fallback to defaults if API fails
          throw new Error('API returned error');
        }
      } else {
        throw new Error('API request failed');
      }
    } catch (err) {
      console.error('Error fetching available pods, using defaults:', err);
      
      // Fallback to default values if API fails
      const defaultNamespaces = ['ntnx-system', 'default', 'kube-system'];
      const defaultPods = [
        'ncm-api-server',
        'ncm-pod-1',
        'ncm-pod-2',
        'prism-central-pod-1'
      ];
      
      setAvailableNamespaces(defaultNamespaces);
      setAvailablePods(defaultPods);
      setSelectedNamespaces(defaultNamespaces);
    } finally {
      setLoadingPods(false);
    }
  };

  const toggleEntityOperation = (entity: string, operation: string) => {
    setSelectedEntities(prev => {
      const current = prev[entity] || [];
      const updated = current.includes(operation)
        ? current.filter(op => op !== operation)
        : [...current, operation];
      
      if (updated.length === 0) {
        const { [entity]: _, ...rest } = prev;
        return rest;
      }
      
      return { ...prev, [entity]: updated };
    });
  };

  const getAvailableOperations = (entity: string): string[] => {
    // Define available operations per entity
    const operationsMap: Record<string, string[]> = {
      vm: ['CREATE', 'DELETE', 'LIST', 'UPDATE', 'POWER_ON', 'POWER_OFF', 'CLONE', 'MIGRATE', 'SNAPSHOT_CREATE', 'SNAPSHOT_DELETE', 'ADD_DISK', 'CPU_UPDATE', 'MEMORY_UPDATE'],
      project: ['CREATE', 'UPDATE', 'DELETE', 'LIST'],
      category: ['CREATE', 'DELETE'],
      image: ['CREATE', 'DELETE', 'LIST', 'UPDATE'],
      subnet: ['LIST'],
      cluster: ['LIST'],
      alert: ['LIST'],
      endpoint: ['CREATE', 'DELETE', 'LIST'],
      library_variable: ['CREATE', 'DELETE', 'LIST'],
      runbook: ['CREATE', 'DELETE', 'LIST', 'EXECUTE'],
      blueprint_single_vm: ['CREATE', 'DELETE', 'EXECUTE', 'LIST'],
      blueprint_multi_vm: ['CREATE', 'DELETE', 'EXECUTE', 'LIST'],
      playbook: ['CREATE', 'DELETE', 'EXECUTE', 'LIST'],
      application: ['CREATE', 'DELETE', 'LIST'],
      marketplace_item: ['LIST', 'PUBLISH', 'UNPUBLISH'],
      uda_policy: ['CREATE', 'LIST'],
      scenario: ['CREATE', 'DELETE', 'LIST'],
      analysis_session: ['CREATE', 'DELETE'],
      report_config: ['CREATE', 'DELETE', 'LIST'],
      report_instance: ['CREATE', 'DELETE', 'LIST'],
      business_unit: ['CREATE', 'DELETE'],
      cost_center: ['CREATE', 'DELETE'],
      budget: ['CREATE', 'DELETE'],
      rate_card: ['CREATE', 'DELETE'],
      action_rule: ['CREATE', 'DELETE', 'LIST'],
      dashboard: ['CREATE', 'DELETE'],
      network_security_policy: ['CREATE', 'DELETE'],
      address_group: ['CREATE', 'DELETE'],
      service_group: ['CREATE', 'DELETE'],
      vpc: ['CREATE', 'DELETE'],
      environment: ['CREATE', 'LIST'],
    };
    
    return operationsMap[entity] || ['CREATE', 'DELETE', 'LIST'];
  };

  const fetchMLRecommendations = async () => {
    if (!selectedTestbed) {
      setError('Please select a testbed first');
      return;
    }
    
    setLoadingRecommendations(true);
    setError('');
    
    try {
      const response = await fetch(`${getApiBase()}/api/smart-execution/ml-recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testbed_id: selectedTestbed,
          target_cpu: cpuThreshold,
          target_memory: memoryThreshold
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setMlRecommendations(data.recommendations || []);
        } else {
          setError(data.error || 'Failed to get ML recommendations');
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.error || 'Failed to get ML recommendations');
      }
    } catch (err) {
      console.error('Error fetching recommendations:', err);
      setError('Error fetching recommendations. Make sure backend is running.');
    } finally {
      setLoadingRecommendations(false);
    }
  };

  const applyMLRecommendations = () => {
    const newSelection: Record<string, string[]> = {};
    
    mlRecommendations.slice(0, 5).forEach(rec => {
      const entity = rec.entity;
      const operation = rec.operation;
      
      if (!newSelection[entity]) {
        newSelection[entity] = [];
      }
      
      if (!newSelection[entity].includes(operation)) {
        newSelection[entity].push(operation);
      }
    });
    
    setSelectedEntities(newSelection);
  };

  const runPreCheck = async () => {
    if (!selectedTestbed) { setError('Select a testbed first'); return; }
    setRunningPreCheck(true);
    setPreCheckResult(null);
    try {
      const res = await fetch(`${getApiBase()}/api/smart-execution/pre-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testbed_id: selectedTestbed,
          target_config: { cpu_threshold: cpuThreshold, memory_threshold: memoryThreshold, stop_condition: stopCondition },
          entities_config: selectedEntities
        })
      });
      const data = await res.json();
      setPreCheckResult(data.success ? data.checks : { passed: false, warnings: [data.error || 'Pre-check failed'] });
    } catch (err) {
      setPreCheckResult({ passed: false, warnings: ['Could not reach backend'] });
    } finally {
      setRunningPreCheck(false);
    }
  };

  const startExecution = async () => {
    if (!selectedTestbed) {
      setError('Please select a testbed');
      return;
    }
    
    if (Object.keys(selectedEntities).length === 0) {
      setError('Please select at least one entity-operation pair');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const config: any = {
        testbed_id: selectedTestbed,
        target_config: {
          cpu_threshold: cpuThreshold,
          memory_threshold: memoryThreshold,
          stop_condition: stopCondition,
          timeout_minutes: timeoutMinutes > 0 ? timeoutMinutes : undefined,
          longevity: longevityEnabled ? {
            enabled: true,
            duration_hours: longevityDuration,
            churn_interval_minutes: churnIntervalMin,
            health_check_interval_minutes: healthCheckIntervalMin,
            checkpoint_interval_minutes: checkpointIntervalMin,
            maintain_load_percent: maintainLoadPct,
            health_checks: healthChecks,
          } : { enabled: false }
        },
        entities_config: selectedEntities,
        rule_config: {
          namespaces: selectedNamespaces,
          pod_names: selectedPods,
          custom_queries: customQueries ? JSON.parse(customQueries) : []
        },
        ai_settings: aiSettings,
        advanced: {
          workload_profile: workloadProfile,
          max_parallel_operations: maxParallelOps,
          operations_per_iteration: opsPerIteration,
          parallel_execution: parallelExecution,
          auto_cleanup: autoCleanup,
          tags: tags,
          ml_guided_ops: mlGuidedOps,
          entity_cooldown_seconds: entityCooldown,
          alert_thresholds: {
            cpu_spike_percent: cpuSpikeThreshold,
            memory_spike_percent: memorySpikeThreshold,
            failure_rate_threshold: failureRateThreshold,
          }
        }
      };
      
      const response = await fetch(`${getApiBase()}/api/smart-execution/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.execution_id) {
          // Navigate to monitoring page or history
          // The standard endpoint returns execution_id
          navigate(`/smart-execution/history`);
        } else {
          setError(data.error || 'Failed to start execution');
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.error || `Failed to start execution (${response.status})`);
      }
    } catch (err) {
      console.error('Error starting execution:', err);
      setError('Error starting execution');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="smart-execution-configure-ai">
      <div className="page-header">
        <h1>🤖 AI-Powered Smart Execution</h1>
        <p>Configure intelligent threshold-based execution with PID control and ML optimization</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Testbed Selection */}
      <section className="config-section">
        <h2>1️⃣ Select Testbed</h2>
        <select
          value={selectedTestbed}
          onChange={(e) => setSelectedTestbed(e.target.value)}
          className="testbed-select"
        >
          <option value="">-- Select Testbed --</option>
          {testbeds.map(tb => (
            <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>
              {tb.testbed_label} ({tb.pc_ip})
            </option>
          ))}
        </select>
      </section>

      {/* Target Configuration */}
      <section className="config-section">
        <h2>2️⃣ Target Thresholds</h2>
        <div className="threshold-grid">
          <div className="threshold-input">
            <label>
              CPU Threshold (%)
              <input
                type="number"
                min="10"
                max="100"
                value={cpuThreshold}
                onChange={(e) => setCpuThreshold(Number(e.target.value))}
              />
            </label>
            <div className="threshold-bar">
              <div className="threshold-fill" style={{ width: `${cpuThreshold}%` }} />
            </div>
          </div>
          
          <div className="threshold-input">
            <label>
              Memory Threshold (%)
              <input
                type="number"
                min="10"
                max="100"
                value={memoryThreshold}
                onChange={(e) => setMemoryThreshold(Number(e.target.value))}
              />
            </label>
            <div className="threshold-bar">
              <div className="threshold-fill memory" style={{ width: `${memoryThreshold}%` }} />
            </div>
          </div>
          
          <div className="threshold-input">
            <label>
              Stop Condition
              <select
                value={stopCondition}
                onChange={(e) => setStopCondition(e.target.value)}
              >
                <option value="any">Any threshold reached</option>
                <option value="all">All thresholds reached</option>
                <option value="cpu">CPU threshold only</option>
                <option value="memory">Memory threshold only</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* AI/ML Settings */}
      <section className="config-section ai-settings">
        <h2>🤖 AI/ML Settings</h2>
        <div className="ai-toggles">
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={aiSettings.enable_ai}
              onChange={(e) => setAISettings(prev => ({ ...prev, enable_ai: e.target.checked }))}
            />
            <span className="toggle-slider"></span>
            <span className="toggle-label">
              Enable AI Control (PID-based adaptive load)
            </span>
          </label>
          
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={aiSettings.enable_ml}
              onChange={(e) => setAISettings(prev => ({ ...prev, enable_ml: e.target.checked }))}
              disabled={!aiSettings.enable_ai}
            />
            <span className="toggle-slider"></span>
            <span className="toggle-label">
              Enable ML Predictions (operation recommendations)
            </span>
          </label>
          
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={aiSettings.data_collection}
              onChange={(e) => setAISettings(prev => ({ ...prev, data_collection: e.target.checked }))}
            />
            <span className="toggle-slider"></span>
            <span className="toggle-label">
              Collect training data for ML model improvement
            </span>
          </label>
        </div>

        {aiSettings.enable_ai && (
          <div className="ml-recommendations-section">
            <button
              onClick={fetchMLRecommendations}
              disabled={loadingRecommendations || !selectedTestbed}
              className="btn-secondary"
            >
              {loadingRecommendations ? '⏳ Loading...' : '💡 Get ML Recommendations'}
            </button>
            
            {mlRecommendations.length > 0 && (
              <div className="recommendations-box">
                <h3>Top ML Recommendations:</h3>
                <div className="recommendations-list">
                  {mlRecommendations.slice(0, 5).map((rec, idx) => (
                    <div key={idx} className="recommendation-item">
                      <span className="rec-rank">#{idx + 1}</span>
                      <span className="rec-entity">{rec.entity}</span>
                      <span className="rec-operation">{rec.operation}</span>
                      <span className="rec-impact">
                        CPU: +{rec.cpu_impact.toFixed(1)}%, Mem: +{rec.memory_impact.toFixed(1)}%
                      </span>
                      <span className="rec-score">Score: {rec.score.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <button onClick={applyMLRecommendations} className="btn-secondary">
                  Apply Recommendations
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Entity/Operation Selection */}
      <section className="config-section">
        <h2>3️⃣ Select Entities & Operations</h2>
        <div style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '6px 16px', fontSize: '13px' }}
            onClick={() => {
              const all: Record<string, string[]> = {};
              availableEntities.forEach(entity => {
                all[entity] = getAvailableOperations(entity);
              });
              setSelectedEntities(all);
            }}
          >
            Select All
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '6px 16px', fontSize: '13px' }}
            onClick={() => setSelectedEntities({})}
          >
            Clear All
          </button>
        </div>
        <div className="entities-grid">
          {availableEntities.map(entity => {
            const ops = getAvailableOperations(entity);
            const allSelected = ops.every(op => selectedEntities[entity]?.includes(op));
            return (
            <div key={entity} className="entity-card">
              <h3>{entity.replace(/_/g, ' ').toUpperCase()}</h3>
              <div className="operations-list">
                <label className="operation-checkbox" style={{ fontWeight: 'bold', borderBottom: '1px solid #eee', paddingBottom: '4px', marginBottom: '4px' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => {
                      if (allSelected) {
                        const { [entity]: _, ...rest } = selectedEntities;
                        setSelectedEntities(rest);
                      } else {
                        setSelectedEntities(prev => ({ ...prev, [entity]: ops }));
                      }
                    }}
                  />
                  <span>Select All</span>
                </label>
                {ops.map(operation => (
                  <label key={operation} className="operation-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedEntities[entity]?.includes(operation) || false}
                      onChange={() => toggleEntityOperation(entity, operation)}
                    />
                    <span>{operation}</span>
                  </label>
                ))}
              </div>
            </div>
            );
          })}
        </div>
        
        <div className="selection-summary">
          <strong>Selected:</strong>{' '}
          {Object.entries(selectedEntities).length > 0
            ? Object.entries(selectedEntities).map(([entity, ops]) => 
                `${entity} (${ops.join(', ')})`
              ).join(' | ')
            : 'None'}
        </div>
      </section>

      {/* Advanced Settings */}
      <section className="config-section">
        <h2 onClick={() => setShowAdvanced(!showAdvanced)} style={{ cursor: 'pointer' }}>
          ⚙️ Advanced Settings {showAdvanced ? '▼' : '▶'}
        </h2>
        
        {showAdvanced && (
          <div className="advanced-settings">
            <div className="advanced-group">
              <h3>Monitoring Rules</h3>
              
              {loadingPods ? (
                <div className="loading-pods">⏳ Loading available namespaces and pods...</div>
              ) : (
                <>
                  <label>
                    Namespaces
                    {availableNamespaces.length === 0 ? (
                      <div className="info-message">No namespaces available. Select a testbed first.</div>
                    ) : (
                      <div className="multi-select-box">
                        {availableNamespaces.map(ns => (
                          <label key={ns} className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={selectedNamespaces.includes(ns)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedNamespaces(prev => [...prev, ns]);
                                } else {
                                  setSelectedNamespaces(prev => prev.filter(n => n !== ns));
                                }
                              }}
                            />
                            <span>{ns}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="selected-items">
                      Selected: {selectedNamespaces.length > 0 ? selectedNamespaces.join(', ') : 'None'}
                    </div>
                  </label>
                  
                  <label>
                    Pod Names (Optional - leave empty to monitor all pods)
                    {availablePods.length === 0 ? (
                      <div className="info-message">No pods available.</div>
                    ) : (
                      <div className="multi-select-box scrollable">
                        <div className="select-all-button">
                          <button 
                            type="button"
                            onClick={() => setSelectedPods([])}
                            className="btn-small"
                          >
                            Clear All
                          </button>
                        </div>
                        {availablePods.map(pod => (
                          <label key={pod} className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={selectedPods.includes(pod)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPods(prev => [...prev, pod]);
                                } else {
                                  setSelectedPods(prev => prev.filter(p => p !== pod));
                                }
                              }}
                            />
                            <span>{pod}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="selected-items">
                      Selected: {selectedPods.length > 0 ? `${selectedPods.length} pods` : 'All pods (no filter)'}
                    </div>
                  </label>
                </>
              )}
            </div>

            {aiSettings.enable_ai && (
              <div className="advanced-group">
                <h3>PID Tuning (CPU)</h3>
                <div className="pid-inputs">
                  <label>
                    Kp (Proportional)
                    <input
                      type="number"
                      step="0.1"
                      value={aiSettings.pid_tuning.cpu_kp}
                      onChange={(e) => setAISettings(prev => ({
                        ...prev,
                        pid_tuning: { ...prev.pid_tuning, cpu_kp: Number(e.target.value) }
                      }))}
                    />
                  </label>
                  <label>
                    Ki (Integral)
                    <input
                      type="number"
                      step="0.01"
                      value={aiSettings.pid_tuning.cpu_ki}
                      onChange={(e) => setAISettings(prev => ({
                        ...prev,
                        pid_tuning: { ...prev.pid_tuning, cpu_ki: Number(e.target.value) }
                      }))}
                    />
                  </label>
                  <label>
                    Kd (Derivative)
                    <input
                      type="number"
                      step="0.1"
                      value={aiSettings.pid_tuning.cpu_kd}
                      onChange={(e) => setAISettings(prev => ({
                        ...prev,
                        pid_tuning: { ...prev.pid_tuning, cpu_kd: Number(e.target.value) }
                      }))}
                    />
                  </label>
                </div>
                
                <h3>PID Tuning (Memory)</h3>
                <div className="pid-inputs">
                  <label>
                    Kp
                    <input
                      type="number"
                      step="0.1"
                      value={aiSettings.pid_tuning.memory_kp}
                      onChange={(e) => setAISettings(prev => ({
                        ...prev,
                        pid_tuning: { ...prev.pid_tuning, memory_kp: Number(e.target.value) }
                      }))}
                    />
                  </label>
                  <label>
                    Ki
                    <input
                      type="number"
                      step="0.01"
                      value={aiSettings.pid_tuning.memory_ki}
                      onChange={(e) => setAISettings(prev => ({
                        ...prev,
                        pid_tuning: { ...prev.pid_tuning, memory_ki: Number(e.target.value) }
                      }))}
                    />
                  </label>
                  <label>
                    Kd
                    <input
                      type="number"
                      step="0.1"
                      value={aiSettings.pid_tuning.memory_kd}
                      onChange={(e) => setAISettings(prev => ({
                        ...prev,
                        pid_tuning: { ...prev.pid_tuning, memory_kd: Number(e.target.value) }
                      }))}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Advanced Execution Settings */}
      <section className="config-section">
        <h2 style={{ cursor: 'pointer' }} onClick={() => setShowExecutionSettings(!showExecutionSettings)}>
          {showExecutionSettings ? '▼' : '▶'} Advanced Execution Settings
        </h2>
        
        {showExecutionSettings && (
          <div className="advanced-settings">
            <div className="threshold-grid">
              <div className="threshold-input">
                <label>
                  Workload Profile
                  <select value={workloadProfile} onChange={(e) => setWorkloadProfile(e.target.value)}>
                    <option value="sustained">Sustained (steady load)</option>
                    <option value="ramp_up">Ramp Up (gradual increase)</option>
                    <option value="burst">Burst (alternating high/low)</option>
                    <option value="chaos">Chaos (random intensity)</option>
                  </select>
                </label>
                <small style={{ color: '#64748b', display: 'block', marginTop: 4 }}>
                  {workloadProfile === 'ramp_up' && 'Gradually increases from 20% to 100% load over 20 iterations'}
                  {workloadProfile === 'burst' && 'Alternates between 150% and 50% load every 5 iterations'}
                  {workloadProfile === 'chaos' && 'Random load multiplier (0.3x-2.0x) per iteration for stress testing'}
                  {workloadProfile === 'sustained' && 'Constant load level throughout execution (default)'}
                </small>
              </div>

              <div className="threshold-input">
                <label>
                  Max Parallel Operations
                  <input type="number" min="1" max="20" value={maxParallelOps}
                    onChange={(e) => setMaxParallelOps(Number(e.target.value))} />
                </label>
              </div>

              <div className="threshold-input">
                <label>
                  Operations per Iteration
                  <input type="number" min="1" max="20" value={opsPerIteration}
                    onChange={(e) => setOpsPerIteration(Number(e.target.value))} />
                </label>
              </div>

              <div className="threshold-input">
                <label>
                  Timeout (minutes, 0 = no limit)
                  <input type="number" min="0" max="480" value={timeoutMinutes}
                    onChange={(e) => setTimeoutMinutes(Number(e.target.value))} />
                </label>
              </div>
            </div>

            <div className="ai-toggles" style={{ marginTop: 16 }}>
              <label className="toggle-switch">
                <input type="checkbox" checked={parallelExecution}
                  onChange={(e) => setParallelExecution(e.target.checked)} />
                <span className="toggle-slider"></span>
                <span className="toggle-label">Enable Parallel Execution</span>
              </label>

              <label className="toggle-switch">
                <input type="checkbox" checked={autoCleanup}
                  onChange={(e) => setAutoCleanup(e.target.checked)} />
                <span className="toggle-slider"></span>
                <span className="toggle-label">Auto-cleanup entities when execution completes</span>
              </label>

              <label className="toggle-switch">
                <input type="checkbox" checked={mlGuidedOps}
                  onChange={(e) => setMlGuidedOps(e.target.checked)} />
                <span className="toggle-slider"></span>
                <span className="toggle-label">ML-guided operation selection (auto-pick high-impact ops when metrics stagnate)</span>
              </label>
            </div>

            <div className="threshold-grid" style={{ marginTop: 16 }}>
              <div className="threshold-input">
                <label>
                  Entity Cooldown (seconds)
                  <input type="number" min="0" max="60" value={entityCooldown}
                    onChange={(e) => setEntityCooldown(Number(e.target.value))} />
                </label>
                <small style={{ color: '#64748b', display: 'block', marginTop: 4 }}>Min delay between ops of same type (0 = no cooldown)</small>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Tags */}
      <section className="config-section">
        <h2>Tags / Labels</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {tags.map((tag, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 16, background: '#e0f2fe', color: '#0369a1', fontSize: 13 }}>
              {tag}
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#ef4444', padding: 0 }} onClick={() => setTags(tags.filter((_, j) => j !== i))}>x</button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && tagInput.trim()) { setTags([...tags, tagInput.trim()]); setTagInput(''); e.preventDefault(); } }}
            placeholder="Type tag and press Enter"
            style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 8, minWidth: 160 }}
          />
        </div>
        <small style={{ color: '#64748b', display: 'block', marginTop: 6 }}>Tags help filter and compare executions (e.g., "pre-upgrade", "nightly-soak")</small>
      </section>

      {/* Alert Thresholds */}
      <section className="config-section">
        <h2 style={{ cursor: 'pointer' }} onClick={() => setShowAlertSettings(!showAlertSettings)}>
          {showAlertSettings ? '▼' : '▶'} Alert Thresholds
        </h2>
        {showAlertSettings && (
          <div className="advanced-settings">
            <div className="threshold-grid">
              <div className="threshold-input">
                <label>
                  CPU Spike Threshold (%)
                  <input type="number" min="1" max="50" step="0.5" value={cpuSpikeThreshold}
                    onChange={(e) => setCpuSpikeThreshold(Number(e.target.value))} />
                </label>
                <small style={{ color: '#64748b', display: 'block', marginTop: 4 }}>Alert when CPU jumps more than this % in one poll</small>
              </div>
              <div className="threshold-input">
                <label>
                  Memory Spike Threshold (%)
                  <input type="number" min="1" max="50" step="0.5" value={memorySpikeThreshold}
                    onChange={(e) => setMemorySpikeThreshold(Number(e.target.value))} />
                </label>
              </div>
              <div className="threshold-input">
                <label>
                  Failure Rate Threshold (0-1)
                  <input type="number" min="0.05" max="1" step="0.05" value={failureRateThreshold}
                    onChange={(e) => setFailureRateThreshold(Number(e.target.value))} />
                </label>
                <small style={{ color: '#64748b', display: 'block', marginTop: 4 }}>Trigger anomaly when failure rate exceeds this</small>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Longevity Mode */}
      <section className="config-section">
        <h2 style={{ cursor: 'pointer' }} onClick={() => setShowLongevitySettings(!showLongevitySettings)}>
          {showLongevitySettings ? '▼' : '▶'} Longevity Mode (NCM Long-Run Testing)
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={longevityEnabled}
              onChange={(e) => setLongevityEnabled(e.target.checked)}
            />
            <strong>Enable Longevity Mode</strong>
          </label>
          <span style={{ fontSize: 13, color: '#64748b' }}>
            Maintains load at target and runs periodic health checks for extended testing
          </span>
        </div>

        {showLongevitySettings && longevityEnabled && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
            <div>
              <label>Duration (hours)</label>
              <input type="number" min={1} max={720} value={longevityDuration}
                onChange={(e) => setLongevityDuration(Number(e.target.value))} />
              <small style={{ color: '#64748b' }}>0 = run indefinitely until stopped</small>
            </div>
            <div>
              <label>Churn Interval (min)</label>
              <input type="number" min={5} max={240} value={churnIntervalMin}
                onChange={(e) => setChurnIntervalMin(Number(e.target.value))} />
              <small style={{ color: '#64748b' }}>How often to cycle entity operations</small>
            </div>
            <div>
              <label>Health Check Interval (min)</label>
              <input type="number" min={10} max={360} value={healthCheckIntervalMin}
                onChange={(e) => setHealthCheckIntervalMin(Number(e.target.value))} />
              <small style={{ color: '#64748b' }}>How often to run system health checks</small>
            </div>
            <div>
              <label>Checkpoint Interval (min)</label>
              <input type="number" min={30} max={480} value={checkpointIntervalMin}
                onChange={(e) => setCheckpointIntervalMin(Number(e.target.value))} />
              <small style={{ color: '#64748b' }}>How often to save progress report</small>
            </div>
            <div>
              <label>Maintain Load at (%)</label>
              <input type="number" min={20} max={95} value={maintainLoadPct}
                onChange={(e) => setMaintainLoadPct(Number(e.target.value))} />
              <small style={{ color: '#64748b' }}>Re-escalate if load drops below this</small>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <h3 style={{ margin: '12px 0 8px' }}>Health Checks</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {Object.entries({
                  fatal_scan: 'FATAL Log Scanning',
                  process_restarts: 'Process Restart Detection',
                  cgroup_oom: 'Cgroup OOM Monitoring',
                  thread_count: 'Thread Count Check',
                  disk_usage: 'Disk Usage Monitoring',
                  core_dumps: 'Core Dump Detection',
                  memory_leaks: 'Memory Leak Detection',
                }).map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: healthChecks[key] ? '#f0fdf4' : '#f8fafc', border: `1px solid ${healthChecks[key] ? '#22c55e' : '#e2e8f0'}`, borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={healthChecks[key]}
                      onChange={(e) => setHealthChecks(prev => ({...prev, [key]: e.target.checked}))} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Pre-Check & Action Buttons */}
      <section className="action-buttons">
        <button
          onClick={runPreCheck}
          disabled={runningPreCheck || !selectedTestbed}
          className="btn-secondary"
        >
          {runningPreCheck ? '⏳ Checking...' : '🔍 Pre-flight Check'}
        </button>

        <button
          onClick={startExecution}
          disabled={loading || !selectedTestbed || Object.keys(selectedEntities).length === 0}
          className="btn-primary"
        >
          {loading ? '⏳ Starting...' : '🚀 Start AI Execution'}
        </button>
        
        <button
          onClick={() => navigate('/smart-execution/history')}
          className="btn-secondary"
        >
          View History
        </button>
      </section>

      {preCheckResult && (
        <section className="config-section" style={{ marginTop: 16, border: preCheckResult.passed ? '2px solid #22c55e' : '2px solid #ef4444' }}>
          <h2>{preCheckResult.passed ? '✅ Pre-check Passed' : '❌ Pre-check Issues Found'}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div style={{ padding: 8, borderRadius: 8, background: preCheckResult.prometheus ? '#f0fdf4' : '#fef2f2' }}>
              <strong>{preCheckResult.prometheus ? '✅' : '❌'} Prometheus</strong>
              {preCheckResult.baseline_cpu !== undefined && (
                <div style={{ fontSize: 13, color: '#64748b' }}>
                  CPU: {preCheckResult.baseline_cpu?.toFixed(1)}% | Mem: {preCheckResult.baseline_memory?.toFixed(1)}%
                </div>
              )}
            </div>
            <div style={{ padding: 8, borderRadius: 8, background: preCheckResult.ncm_api ? '#f0fdf4' : '#fef2f2' }}>
              <strong>{preCheckResult.ncm_api ? '✅' : '⚠️'} NCM API</strong>
            </div>
            <div style={{ padding: 8, borderRadius: 8, background: preCheckResult.resources ? '#f0fdf4' : '#fef2f2' }}>
              <strong>{preCheckResult.resources ? '✅' : '⚠️'} Resources</strong>
              {preCheckResult.image && <div style={{ fontSize: 13, color: '#64748b' }}>Image: {preCheckResult.image}</div>}
              {preCheckResult.cluster && <div style={{ fontSize: 13, color: '#64748b' }}>Cluster: {preCheckResult.cluster}</div>}
            </div>
          </div>
          {preCheckResult.warnings && preCheckResult.warnings.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {preCheckResult.warnings.map((w: string, i: number) => (
                <div key={i} style={{ padding: '6px 10px', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6, marginBottom: 4, fontSize: 13 }}>
                  ⚠️ {w}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default SmartExecutionConfigureAI;
