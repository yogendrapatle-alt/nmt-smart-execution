// src/types/onboarding.ts

export interface OnboardingForm {
  pcIp: string;
  username: string;
  password: string;
  ncmLabel: string;
  prometheusEndpoint?: string;  // ADD THIS TO STORE PROMETHEUS ENDPOINT
  pcUuid?: string;  // ADD THIS TO STORE PC UUID
}

export interface RuleConfig {
  namespace: string;
  pods: string[];
  metrics: MetricConfig[];
}

export interface MetricConfig {
  name: string;
  syncFrequency: number;
  threshold: number;
  alertType: 'slack' | 'email';
  slackHandle?: string;
  timeWindow?: number;
  restartCount?: number;
}

export interface AlertSummary {
  day: string;
  testbed: string;
  alerts: Alert[];
}

export interface Alert {
  id: string;
  timestamp: string;
  severity: 'Low' | 'Moderate' | 'Critical';
  ruleName: string;
  summary?: string;
  description: string;
  podName: string;
  namespace: string;
  metric: string;
  value: string;
  threshold: string;
  operator: string;
  status: string;
  testbed?: string;
  testbed_id?: string;
  metric_value?: number;
  threshold_value?: number;
  acknowledged_at?: string;
  resolved_at?: string;
  duration_minutes?: number | null;
  short_diagnosis?: string;
  is_actionable?: boolean;
  resolved_reason?: string;
  diagnostic_context?: Record<string, unknown>;
}

export interface AlertTimelineEvent {
  timestamp: string;
  event: string;
  type: 'fired' | 'acknowledged' | 'resolved' | 'active' | 'context';
}

export interface AlertDiagnostics {
  timeline: AlertTimelineEvent[];
  root_cause: string;
  impact_assessment: string;
  recommendation: string;
  related_alerts: Array<{
    id: number;
    alert_type: string;
    severity: string;
    status: string;
    message: string;
    timestamp: string;
  }>;
  running_executions: Array<{
    execution_id: string;
    status: string;
    start_time: string;
    end_time: string | null;
  }>;
  live_data: Record<string, any>;
  metric_context: {
    value?: number;
    threshold?: number;
    unit?: string;
    exceeded_by?: number;
    exceeded_pct?: number;
    duration?: string;
    over_threshold?: boolean;
  };
  prometheus_available: boolean;
}

export interface AlertDigest {
  date: string;
  testbeds: {
    [testbedName: string]: Alert[];
  };
}
