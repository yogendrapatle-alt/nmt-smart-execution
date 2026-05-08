export interface Testbed {
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string;
  ncm_ip: string;
  prometheus_endpoint: string;
  status?: string;
}

export interface AISettings {
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

export interface PresetConfig {
  id: string;
  label: string;
  icon: string;
  description: string;
  gradient: string;
  entities: Record<string, string[]>;
  cpuThreshold: number;
  memoryThreshold: number;
  stopCondition: string;
  workloadProfile: string;
  maxParallelOps: number;
  opsPerIteration: number;
  parallelExecution: boolean;
  autoCleanup: boolean;
  timeoutMinutes: number;
  sustainMinutes: number;
  longevityEnabled: boolean;
  longevityDuration: number;
  aiEnabled: boolean;
  mlEnabled: boolean;
  tags: string[];
}

export const OPERATIONS_MAP: Record<string, string[]> = {
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

export const AVAILABLE_ENTITIES = Object.keys(OPERATIONS_MAP);

export function getAvailableOperations(entity: string): string[] {
  return OPERATIONS_MAP[entity] || ['CREATE', 'DELETE', 'LIST'];
}

export type RuleScope = 'pod' | 'node' | 'cluster';
export type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==' | '!=';
export type LogicalOperator = 'AND' | 'OR';
export type MetricUnit = 'Percentage' | 'Memory (GB)' | 'Time (ms)' | 'Count' | 'Raw';

/**
 * A single condition inside a (possibly composite) monitoring rule.
 *
 * ``podNames`` is the modern multi-select form; ``podName`` (singular) is the
 * legacy single-pod field kept for back-compat. The backend treats both the
 * same — multiple pod names get joined into a single ``pod=~"(p1|p2|…)"``
 * regex when the rule is evaluated.
 */
export interface RuleCondition {
  scope?: RuleScope;
  query: string;
  queryMode?: 'quick' | 'raw';
  operator: ComparisonOperator;
  threshold: number;
  unit?: MetricUnit;
  namespace?: string;
  namespaces?: string[];
  podName?: string;
  podNames?: string[];
  nodeInstance?: string;
  nodeInstances?: string[];
}

export interface MonitoringRule {
  id: string;
  name: string;
  // Single-condition fields (legacy — kept for back-compat).
  query: string;
  operator: ComparisonOperator;
  threshold: number;
  severity: 'Critical' | 'Moderate' | 'Low';
  enabled: boolean;
  description?: string;
  namespace?: string;
  podName?: string;
  // ── New (all optional, back-compat) ────────────────────────────
  scope?: RuleScope;
  queryMode?: 'quick' | 'raw';
  unit?: MetricUnit;
  namespaces?: string[];
  podNames?: string[];
  nodeInstance?: string;
  nodeInstances?: string[];
  // Composite rule: when present + non-empty, the rule is evaluated as
  // `c0 <logicalOperator> c1 <logicalOperator> c2 …`.
  conditions?: RuleCondition[];
  logicalOperator?: LogicalOperator;
  // Phase-4 carry-over (log collection on violation):
  collectLogs?: boolean;
  logDurationHours?: number;
  // Versioning so future loaders can migrate older shapes.
  schemaVersion?: number;
}

/**
 * Heuristic mapping from a query name to its natural unit, used by the editor
 * to auto-fill the Unit field and validate threshold ranges. Mirrors the legacy
 * Phase-1 unit-restriction matrix but keyed on the query names actually used
 * in this codebase.
 */
export function getDefaultUnit(query: string): MetricUnit {
  const q = (query || '').toLowerCase();
  if (q.includes('cputhrott')) return 'Percentage';
  if (q.includes('cpu')) return 'Percentage';
  if (q.includes('memoryusage') || q.includes('memory_')) return 'Percentage';
  if (q.includes('memory')) return 'Memory (GB)';
  if (q.includes('disk') && q.includes('usage')) return 'Percentage';
  if (q.includes('disk') || q.includes('storage')) return 'Memory (GB)';
  if (q.includes('latency') || q.includes('time') || q.includes('duration')) return 'Time (ms)';
  if (q.includes('restart') || q.includes('count') || q.includes('error') || q.includes('drop')) return 'Count';
  if (q.includes('load')) return 'Count';
  if (q.includes('ratio') || q.includes('percent') || q.includes('throttling')) return 'Percentage';
  return 'Raw';
}

/**
 * For a given query, the units the user is *allowed* to choose. Memory queries
 * may legitimately be in either GB or % depending on whether the underlying
 * PromQL is normalised to the request limit, so we return both.
 */
export function getAllowedUnits(query: string): MetricUnit[] {
  const q = (query || '').toLowerCase();
  if (!q) return ['Percentage', 'Memory (GB)', 'Time (ms)', 'Count', 'Raw'];
  if (q.includes('cputhrott') || q.includes('throttling')) return ['Percentage'];
  if (q.includes('cpu') && !q.includes('memory')) return ['Percentage'];
  if (q.includes('memory') || q.includes('storage')) return ['Memory (GB)', 'Percentage'];
  if (q.includes('disk') && q.includes('usage')) return ['Percentage'];
  if (q.includes('disk')) return ['Memory (GB)', 'Time (ms)', 'Count'];
  if (q.includes('latency') || q.includes('time') || q.includes('duration')) return ['Time (ms)'];
  if (q.includes('restart') || q.includes('count') || q.includes('error') || q.includes('drop') || q.includes('inode')) return ['Count'];
  if (q.includes('load')) return ['Count'];
  return ['Raw', 'Percentage', 'Memory (GB)', 'Time (ms)', 'Count'];
}

/** Validate a threshold value against the chosen unit. Returns null if valid,
 *  otherwise a short message suitable for an inline warning. */
export function validateThreshold(value: number, unit?: MetricUnit): string | null {
  if (Number.isNaN(value)) return 'Threshold must be a number';
  if (unit === 'Percentage' && (value < 0 || value > 100)) return 'Percentage must be 0–100';
  if (unit === 'Memory (GB)' && value < 0) return 'Memory must be ≥ 0';
  if (unit === 'Time (ms)' && value < 0) return 'Time must be ≥ 0';
  if (unit === 'Count' && value < 0) return 'Count must be ≥ 0';
  return null;
}

export const QUICK_RULE_TEMPLATES: Omit<MonitoringRule, 'id' | 'enabled'>[] = [
  // Pod-scoped
  { name: 'Pod CPU Usage', query: 'PodCPUUsage', operator: '>', threshold: 80, severity: 'Critical', scope: 'pod', description: 'Alert when any pod CPU usage exceeds threshold' },
  { name: 'Pod Memory Usage', query: 'PodMemoryUsage', operator: '>', threshold: 80, severity: 'Critical', scope: 'pod', description: 'Alert when any pod memory usage exceeds threshold' },
  { name: 'Container Restarts', query: 'ContainerRestarts', operator: '>', threshold: 5, severity: 'Moderate', scope: 'pod', description: 'Alert when container restart count exceeds threshold' },
  { name: 'Pod Restarts', query: 'PodRestarts', operator: '>', threshold: 3, severity: 'Moderate', scope: 'pod', description: 'Alert when pod restart count exceeds threshold' },
  { name: 'CPU Throttling', query: 'ContainerCPUThrottling', operator: '>', threshold: 25, severity: 'Moderate', scope: 'pod', description: 'Alert when CPU throttling percentage exceeds threshold' },
  { name: 'CH CPU Usage', query: 'CHCPUUsage', operator: '>', threshold: 85, severity: 'Critical', scope: 'pod', description: 'Alert when Cluster Health CPU usage exceeds threshold' },
  { name: 'CH Memory Usage', query: 'CHMemoryUsage', operator: '>', threshold: 85, severity: 'Critical', scope: 'pod', description: 'Alert when Cluster Health Memory usage exceeds threshold' },
  { name: 'IDF CPU Usage', query: 'IDFCPUUsage', operator: '>', threshold: 80, severity: 'Moderate', scope: 'pod', description: 'Alert when IDF CPU usage exceeds threshold' },
  { name: 'IDF Memory Usage', query: 'IDFMemoryUsage', operator: '>', threshold: 80, severity: 'Moderate', scope: 'pod', description: 'Alert when IDF Memory usage exceeds threshold' },
  { name: 'High CPU Throttling', query: 'HighCPUThrottling', operator: '==', threshold: 1, severity: 'Critical', scope: 'pod', description: 'Alert when high CPU throttling is detected' },
  // Node-scoped (Phase-2)
  { name: 'Node CPU Usage', query: 'NodeCPUUsage', operator: '>', threshold: 85, severity: 'Critical', scope: 'node', description: 'Alert when a node CPU usage exceeds threshold' },
  { name: 'Node Memory Usage', query: 'NodeMemoryUsage', operator: '>', threshold: 85, severity: 'Critical', scope: 'node', description: 'Alert when a node memory usage exceeds threshold' },
  { name: 'Node Disk Usage', query: 'NodeDiskUsage', operator: '>', threshold: 85, severity: 'Moderate', scope: 'node', description: 'Alert when node root filesystem usage exceeds threshold' },
  { name: 'Node Load (5m)', query: 'NodeLoadAvg5m', operator: '>', threshold: 4, severity: 'Moderate', scope: 'node', description: 'Alert when node 5-min load average exceeds threshold' },
  // Cluster-scoped (Phase-2)
  { name: 'Cluster Avg CPU', query: 'ClusterAvgCPU', operator: '>', threshold: 80, severity: 'Critical', scope: 'cluster', description: 'Alert when cluster-wide average CPU exceeds threshold' },
  { name: 'Cluster Avg Memory', query: 'ClusterAvgMemory', operator: '>', threshold: 80, severity: 'Critical', scope: 'cluster', description: 'Alert when cluster-wide average memory exceeds threshold' },
  { name: 'Cluster Max CPU', query: 'ClusterMaxCPU', operator: '>', threshold: 90, severity: 'Critical', scope: 'cluster', description: 'Alert when any node CPU in the cluster exceeds threshold' },
  { name: 'Cluster Max Memory', query: 'ClusterMaxMemory', operator: '>', threshold: 90, severity: 'Critical', scope: 'cluster', description: 'Alert when any node memory in the cluster exceeds threshold' },
];

export const PRESET_TEMPLATES: PresetConfig[] = [
  {
    id: 'smoke',
    label: 'Smoke Test',
    icon: 'local_fire_department',
    description: 'Quick validation — minimal entities, low thresholds, 10-min timeout',
    gradient: 'linear-gradient(135deg, #f97316, #ea580c)',
    entities: { vm: ['CREATE', 'DELETE', 'LIST'], project: ['CREATE', 'DELETE'], category: ['CREATE', 'DELETE'] },
    cpuThreshold: 40, memoryThreshold: 35, stopCondition: 'any',
    workloadProfile: 'sustained', maxParallelOps: 3, opsPerIteration: 2,
    parallelExecution: true, autoCleanup: true, timeoutMinutes: 10, sustainMinutes: 2,
    longevityEnabled: false, longevityDuration: 0, aiEnabled: true, mlEnabled: false,
    tags: ['smoke-test', 'quick-validation'],
  },
  {
    id: 'functional',
    label: 'Functional',
    icon: 'verified',
    description: 'Moderate entity set with full CRUD — standard thresholds, 30-min run',
    gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)',
    entities: {
      vm: ['CREATE', 'DELETE', 'LIST', 'UPDATE', 'POWER_ON', 'POWER_OFF'],
      project: ['CREATE', 'UPDATE', 'DELETE', 'LIST'],
      image: ['CREATE', 'DELETE', 'LIST'],
      category: ['CREATE', 'DELETE'],
      subnet: ['LIST'], cluster: ['LIST'],
      endpoint: ['CREATE', 'DELETE', 'LIST'],
    },
    cpuThreshold: 70, memoryThreshold: 65, stopCondition: 'any',
    workloadProfile: 'sustained', maxParallelOps: 5, opsPerIteration: 3,
    parallelExecution: true, autoCleanup: true, timeoutMinutes: 30, sustainMinutes: 5,
    longevityEnabled: false, longevityDuration: 0, aiEnabled: true, mlEnabled: true,
    tags: ['functional-test'],
  },
  {
    id: 'soak',
    label: 'Soak Test',
    icon: 'water_drop',
    description: 'Sustained high load — ramp up to 80% CPU, 2-hour timeout, steady pressure',
    gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
    entities: {
      vm: ['CREATE', 'DELETE', 'LIST', 'UPDATE', 'POWER_ON', 'POWER_OFF', 'CLONE', 'SNAPSHOT_CREATE', 'SNAPSHOT_DELETE'],
      project: ['CREATE', 'UPDATE', 'DELETE', 'LIST'],
      image: ['CREATE', 'DELETE', 'LIST', 'UPDATE'],
      category: ['CREATE', 'DELETE'],
      endpoint: ['CREATE', 'DELETE', 'LIST'],
      runbook: ['CREATE', 'DELETE', 'LIST', 'EXECUTE'],
      blueprint_single_vm: ['CREATE', 'DELETE', 'EXECUTE', 'LIST'],
    },
    cpuThreshold: 80, memoryThreshold: 75, stopCondition: 'any',
    workloadProfile: 'ramp_up', maxParallelOps: 8, opsPerIteration: 5,
    parallelExecution: true, autoCleanup: false, timeoutMinutes: 120, sustainMinutes: 10,
    longevityEnabled: false, longevityDuration: 0, aiEnabled: true, mlEnabled: true,
    tags: ['soak-test', 'high-load'],
  },
  {
    id: 'longevity',
    label: 'Longevity',
    icon: 'hourglass_bottom',
    description: 'Extended 24h+ run with health checks — stable load, periodic checkpoints',
    gradient: 'linear-gradient(135deg, #10b981, #059669)',
    entities: {
      vm: ['CREATE', 'DELETE', 'LIST', 'UPDATE', 'POWER_ON', 'POWER_OFF'],
      project: ['CREATE', 'UPDATE', 'DELETE', 'LIST'],
      image: ['CREATE', 'DELETE', 'LIST'],
      category: ['CREATE', 'DELETE'],
      endpoint: ['CREATE', 'DELETE', 'LIST'],
      runbook: ['CREATE', 'DELETE', 'LIST'],
    },
    cpuThreshold: 70, memoryThreshold: 65, stopCondition: 'any',
    workloadProfile: 'sustained', maxParallelOps: 5, opsPerIteration: 3,
    parallelExecution: true, autoCleanup: false, timeoutMinutes: 0, sustainMinutes: 5,
    longevityEnabled: true, longevityDuration: 24, aiEnabled: true, mlEnabled: true,
    tags: ['longevity-test', 'endurance'],
  },
  {
    id: 'chaos',
    label: 'Chaos',
    icon: 'bolt',
    description: 'Aggressive random intensity — all entities, high thresholds, chaos profile',
    gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
    entities: Object.fromEntries(
      Object.entries(OPERATIONS_MAP).map(([entity, ops]) => [entity, ops])
    ),
    cpuThreshold: 90, memoryThreshold: 85, stopCondition: 'all',
    workloadProfile: 'chaos', maxParallelOps: 15, opsPerIteration: 8,
    parallelExecution: true, autoCleanup: false, timeoutMinutes: 60, sustainMinutes: 5,
    longevityEnabled: false, longevityDuration: 0, aiEnabled: true, mlEnabled: true,
    tags: ['chaos-test', 'stress-test'],
  },
];
