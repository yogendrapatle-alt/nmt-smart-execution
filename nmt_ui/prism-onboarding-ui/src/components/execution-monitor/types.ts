export interface PodRestartEvent {
  pod: string;
  namespace: string;
  container: string;
  new_restarts: number;
  total_since_start: number;
  cumulative_total: number;
  detected_at: string;
  execution_elapsed_min: number;
}

export interface PodRestartSummary {
  pod: string;
  namespace: string;
  container: string;
  delta: number;
  baseline: number;
  current: number;
  last_seen: string;
}

export interface PodRestartTracking {
  total_restarts_during_execution: number;
  pods_restarted: number;
  restart_events: PodRestartEvent[];
  pod_summary: PodRestartSummary[];
  baseline_containers_tracked: number;
  last_check: string | null;
}

export interface MonitorData {
  execution_id: string;
  execution_name?: string;
  execution_description?: string;
  status: string;
  iteration: number;
  operations_per_minute: number;
  current_metrics: { cpu: number; memory: number };
  target_metrics: { cpu: number; memory: number };
  phase: string;
  total_operations: number;
  metrics_history: Array<{ timestamp: string; cpu: number; memory: number; phase: string }>;
  pid_stats?: any;
  ml_recommendations?: MLRecommendation[];
  emergency_stop: boolean;
  circuit_breaker_trips: number;
  recent_operations?: RecentOperation[];
  execution_config?: ExecutionConfig;
  latency_summary?: LatencySummary;
  tags?: string[];
  learning_summary?: string;
  alert_thresholds_config?: Record<string, number>;
  sustain?: SustainInfo;
  pod_restart_tracking?: PodRestartTracking;
}

export interface MLRecommendation {
  entity: string;
  operation: string;
  cpu_impact: number;
  memory_impact: number;
  score: number;
  confidence: number;
}

export interface RecentOperation {
  entity_type?: string;
  operation?: string;
  success?: boolean;
  duration?: number;
  timestamp?: string;
}

export interface ExecutionConfig {
  workload_profile: string;
  max_parallel_operations: number;
  parallel_execution: boolean;
  operations_per_iteration: number;
  auto_cleanup: boolean;
}

export interface LatencySummary {
  overall: { min?: number; max?: number; avg?: number; p50?: number; p95?: number; count?: number };
  per_operation: Record<string, { avg?: number; p95?: number; count?: number }>;
}

export interface SustainInfo {
  sustain_minutes: number;
  is_sustaining: boolean;
  sustain_start_time: string | null;
  sustain_elapsed_seconds: number;
  stats: { ops_during_sustain?: number; sustain_ops_per_minute?: number; reescalations?: number };
}

export const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'STOPPED', 'THRESHOLD_REACHED', 'TIMEOUT'];
export const ACTIVE_STATUSES = ['RUNNING', 'SUSTAINING', 'LONGEVITY_SUSTAINING'];

export function isTerminalStatus(status: string | undefined): boolean {
  if (!status) return false;
  return TERMINAL_STATUSES.includes(status.toUpperCase());
}

export function getPhaseIcon(phase: string): string {
  const icons: Record<string, string> = {
    initializing: 'settings', ramp_up: 'trending_up', maintain: 'check_circle',
    sustaining: 'push_pin', longevity_sustaining: 'push_pin', ramp_down: 'trending_down',
    fine_tune: 'tune', completed: 'flag', failed: 'error', emergency_stop: 'report',
  };
  return icons[phase] || 'hourglass_empty';
}

export function getPhaseColor(phase: string): string {
  const colors: Record<string, string> = {
    initializing: '#94a3b8', ramp_up: '#3b82f6', maintain: '#10b981',
    sustaining: '#059669', longevity_sustaining: '#059669', ramp_down: '#f59e0b',
    fine_tune: '#8b5cf6', completed: '#22c55e', failed: '#ef4444', emergency_stop: '#dc2626',
  };
  return colors[phase] || '#64748b';
}
