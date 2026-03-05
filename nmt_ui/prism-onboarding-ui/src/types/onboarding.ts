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
  summary?: string;        // Add summary field for short alert description
  description: string;
  podName: string;
  namespace: string;
  metric: string;
  value: string;
  threshold: string;
  operator: string;
  status: string; // Allow any string for status to support normalization and backend values
}

export interface AlertDigest {
  date: string;
  testbeds: {
    [testbedName: string]: Alert[];
  };
}
