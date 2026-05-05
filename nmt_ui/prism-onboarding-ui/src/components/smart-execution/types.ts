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

export interface MonitoringRule {
  id: string;
  name: string;
  query: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
  severity: 'Critical' | 'Moderate' | 'Low';
  enabled: boolean;
  description?: string;
  namespace?: string;
  podName?: string;
}

export const QUICK_RULE_TEMPLATES: Omit<MonitoringRule, 'id' | 'enabled'>[] = [
  { name: 'Pod CPU Usage', query: 'PodCPUUsage', operator: '>', threshold: 80, severity: 'Critical', description: 'Alert when any pod CPU usage exceeds threshold' },
  { name: 'Pod Memory Usage', query: 'PodMemoryUsage', operator: '>', threshold: 80, severity: 'Critical', description: 'Alert when any pod memory usage exceeds threshold' },
  { name: 'Container Restarts', query: 'ContainerRestarts', operator: '>', threshold: 5, severity: 'Moderate', description: 'Alert when container restart count exceeds threshold' },
  { name: 'Pod Restarts', query: 'PodRestarts', operator: '>', threshold: 3, severity: 'Moderate', description: 'Alert when pod restart count exceeds threshold' },
  { name: 'CPU Throttling', query: 'ContainerCPUThrottling', operator: '>', threshold: 25, severity: 'Moderate', description: 'Alert when CPU throttling percentage exceeds threshold' },
  { name: 'CH CPU Usage', query: 'CHCPUUsage', operator: '>', threshold: 85, severity: 'Critical', description: 'Alert when Cluster Health CPU usage exceeds threshold' },
  { name: 'CH Memory Usage', query: 'CHMemoryUsage', operator: '>', threshold: 85, severity: 'Critical', description: 'Alert when Cluster Health Memory usage exceeds threshold' },
  { name: 'IDF CPU Usage', query: 'IDFCPUUsage', operator: '>', threshold: 80, severity: 'Moderate', description: 'Alert when IDF CPU usage exceeds threshold' },
  { name: 'IDF Memory Usage', query: 'IDFMemoryUsage', operator: '>', threshold: 80, severity: 'Moderate', description: 'Alert when IDF Memory usage exceeds threshold' },
  { name: 'High CPU Throttling', query: 'HighCPUThrottling', operator: '==', threshold: 1, severity: 'Critical', description: 'Alert when high CPU throttling is detected' },
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
