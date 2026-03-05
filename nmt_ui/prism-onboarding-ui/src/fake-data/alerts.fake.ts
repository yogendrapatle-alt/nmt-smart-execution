/**
 * Fake Alerts Data
 * 
 * Generates realistic alert data for DEMO mode.
 * Cross-linked with testbeds, executions, and rules.
 */

import { FAKE_TESTBEDS } from './testbeds.fake';
import { FAKE_EXECUTIONS } from './executions.fake';
import { FAKE_RULES } from './rules.fake';

export interface FakeAlert {
  id: number;
  alert_id: string;
  testbed_id: string;
  testbed_label?: string;
  execution_id?: string;
  rule_id?: string;
  alert_name: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'firing' | 'resolved' | 'acknowledged';
  message: string;
  triggered_at: string;
  resolved_at?: string;
  slack_sent: boolean;
  metric_name?: string;
  metric_value?: number;
  threshold?: number;
}

const ALERT_TYPES = [
  { name: 'High CPU Usage', metric: 'cpu_usage', severity: 'critical' as const },
  { name: 'Memory Exhaustion', metric: 'memory_usage', severity: 'critical' as const },
  { name: 'Disk Space Low', metric: 'disk_usage', severity: 'warning' as const },
  { name: 'Pod Restart Detected', metric: 'pod_restarts', severity: 'warning' as const },
  { name: 'API Latency High', metric: 'api_latency', severity: 'warning' as const },
  { name: 'Error Rate Spike', metric: 'error_rate', severity: 'critical' as const },
  { name: 'Network Saturation', metric: 'network_usage', severity: 'warning' as const },
  { name: 'Service Unavailable', metric: 'service_uptime', severity: 'critical' as const }
];

// Generate 120+ alerts
export const FAKE_ALERTS: FakeAlert[] = [];

for (let i = 0; i < 130; i++) {
  const testbed = FAKE_TESTBEDS[Math.floor(Math.random() * FAKE_TESTBEDS.length)];
  const alertType = ALERT_TYPES[Math.floor(Math.random() * ALERT_TYPES.length)];
  const hoursAgo = Math.floor(Math.random() * 7 * 24); // Within 7 days
  const triggeredAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  
  // 30% of alerts are still firing
  const isFiring = Math.random() < 0.3;
  const isAcknowledged = !isFiring && Math.random() < 0.2;
  const status = isFiring ? 'firing' : (isAcknowledged ? 'acknowledged' : 'resolved');
  
  const resolvedAt = !isFiring ? new Date(triggeredAt.getTime() + (10 + Math.random() * 180) * 60 * 1000) : undefined;
  
  // Link some alerts to executions (40% chance)
  const linkedExecution = Math.random() < 0.4 
    ? FAKE_EXECUTIONS.find(ex => ex.testbed_id === testbed.unique_testbed_id && ex.status === 'FAILED')
    : undefined;
  
  // Link to rule (70% chance)
  const linkedRule = Math.random() < 0.7
    ? FAKE_RULES.find(rule => rule.testbed_id === testbed.unique_testbed_id && rule.is_active)
    : undefined;
  
  const metricValue = alertType.metric === 'cpu_usage' ? 80 + Math.random() * 20 :
                      alertType.metric === 'memory_usage' ? 85 + Math.random() * 15 :
                      alertType.metric === 'disk_usage' ? 70 + Math.random() * 30 :
                      alertType.metric === 'pod_restarts' ? 5 + Math.floor(Math.random() * 10) :
                      alertType.metric === 'api_latency' ? 2000 + Math.random() * 3000 :
                      alertType.metric === 'error_rate' ? 10 + Math.random() * 20 :
                      alertType.metric === 'network_usage' ? 85 + Math.random() * 15 :
                      50 + Math.random() * 50;
  
  const threshold = linkedRule ? linkedRule.rule_config.threshold : metricValue * 0.8;
  
  FAKE_ALERTS.push({
    id: i + 1,
    alert_id: `alert-${String(i + 1).padStart(6, '0')}`,
    testbed_id: testbed.unique_testbed_id,
    testbed_label: testbed.testbed_label,
    execution_id: linkedExecution?.execution_id,
    rule_id: linkedRule?.unique_rule_id,
    alert_name: alertType.name,
    severity: alertType.severity,
    status,
    message: `${alertType.name} detected on ${testbed.testbed_label}: ${alertType.metric} at ${metricValue.toFixed(2)}`,
    triggered_at: triggeredAt.toISOString(),
    resolved_at: resolvedAt?.toISOString(),
    slack_sent: Math.random() < 0.8, // 80% sent to Slack
    metric_name: alertType.metric,
    metric_value: metricValue,
    threshold
  });
}

// Sort by most recent first
FAKE_ALERTS.sort((a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime());

export function getFakeAlerts(limit = 100) {
  return {
    success: true,
    alerts: FAKE_ALERTS.slice(0, limit)
  };
}

export function getFakeAlertsByTestbed(testbedId: string) {
  const alerts = FAKE_ALERTS.filter(alert => alert.testbed_id === testbedId);
  return {
    success: true,
    alerts
  };
}

export function getFakeAlertsByExecution(executionId: string) {
  const alerts = FAKE_ALERTS.filter(alert => alert.execution_id === executionId);
  return {
    success: true,
    alerts
  };
}

export function getFakeAlertStats() {
  const criticalFiring = FAKE_ALERTS.filter(a => a.severity === 'critical' && a.status === 'firing').length;
  const warningFiring = FAKE_ALERTS.filter(a => a.severity === 'warning' && a.status === 'firing').length;
  const resolved = FAKE_ALERTS.filter(a => a.status === 'resolved').length;
  
  return {
    success: true,
    stats: {
      total: FAKE_ALERTS.length,
      firing: FAKE_ALERTS.filter(a => a.status === 'firing').length,
      critical: criticalFiring,
      warning: warningFiring,
      resolved,
      acknowledged: FAKE_ALERTS.filter(a => a.status === 'acknowledged').length
    }
  };
}
