/**
 * Fake Rules Data
 * 
 * Generates realistic rule configurations for DEMO mode.
 * Cross-linked with testbeds.
 */

import { FAKE_TESTBEDS } from './testbeds.fake';

export interface FakeRule {
  id: number;
  unique_rule_id: string;
  testbed_id: string;
  rule_name: string;
  rule_config: any;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const FAKE_RULES: FakeRule[] = [
  // Rules for Production Cluster Alpha (testbed 1)
  {
    id: 1,
    unique_rule_id: 'rule-alpha-cpu-001',
    testbed_id: 'tb-prod-001-alpha',
    rule_name: 'High CPU Usage Alert',
    rule_config: {
      metric: 'cpu_usage',
      threshold: 80,
      duration: '5m',
      severity: 'critical',
      condition: 'above'
    },
    is_active: true,
    created_at: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 2,
    unique_rule_id: 'rule-alpha-mem-002',
    testbed_id: 'tb-prod-001-alpha',
    rule_name: 'Memory Exhaustion Alert',
    rule_config: {
      metric: 'memory_usage',
      threshold: 90,
      duration: '3m',
      severity: 'critical',
      condition: 'above'
    },
    is_active: true,
    created_at: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString()
  },
  // Rules for Production Cluster Beta (testbed 2)
  {
    id: 3,
    unique_rule_id: 'rule-beta-disk-001',
    testbed_id: 'tb-prod-002-beta',
    rule_name: 'Disk Space Warning',
    rule_config: {
      metric: 'disk_usage',
      threshold: 75,
      duration: '10m',
      severity: 'warning',
      condition: 'above'
    },
    is_active: true,
    created_at: new Date(Date.now() - 23 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 23 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 4,
    unique_rule_id: 'rule-beta-restart-002',
    testbed_id: 'tb-prod-002-beta',
    rule_name: 'Pod Restart Alert',
    rule_config: {
      metric: 'pod_restarts',
      threshold: 5,
      duration: '15m',
      severity: 'warning',
      condition: 'above'
    },
    is_active: true,
    created_at: new Date(Date.now() - 23 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 23 * 24 * 60 * 60 * 1000).toISOString()
  },
  // Rules for Staging Environment Gamma (testbed 3)
  {
    id: 5,
    unique_rule_id: 'rule-gamma-latency-001',
    testbed_id: 'tb-staging-001-gamma',
    rule_name: 'API Latency Alert',
    rule_config: {
      metric: 'api_latency',
      threshold: 2000,
      duration: '5m',
      severity: 'warning',
      condition: 'above'
    },
    is_active: true,
    created_at: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 6,
    unique_rule_id: 'rule-gamma-cpu-002',
    testbed_id: 'tb-staging-001-gamma',
    rule_name: 'CPU Throttling Warning',
    rule_config: {
      metric: 'cpu_usage',
      threshold: 70,
      duration: '5m',
      severity: 'warning',
      condition: 'above'
    },
    is_active: false,
    created_at: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
  },
  // Rules for Development Cluster Delta (testbed 4)
  {
    id: 7,
    unique_rule_id: 'rule-delta-errors-001',
    testbed_id: 'tb-dev-001-delta',
    rule_name: 'Error Rate Spike',
    rule_config: {
      metric: 'error_rate',
      threshold: 10,
      duration: '2m',
      severity: 'critical',
      condition: 'above'
    },
    is_active: true,
    created_at: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString()
  },
  // Rules for Testing Environment Epsilon (testbed 5)
  {
    id: 8,
    unique_rule_id: 'rule-epsilon-network-001',
    testbed_id: 'tb-test-001-epsilon',
    rule_name: 'Network Saturation Alert',
    rule_config: {
      metric: 'network_usage',
      threshold: 85,
      duration: '5m',
      severity: 'warning',
      condition: 'above'
    },
    is_active: true,
    created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 9,
    unique_rule_id: 'rule-epsilon-mem-002',
    testbed_id: 'tb-test-001-epsilon',
    rule_name: 'Memory Leak Detection',
    rule_config: {
      metric: 'memory_usage',
      threshold: 85,
      duration: '10m',
      severity: 'warning',
      condition: 'above'
    },
    is_active: true,
    created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 10,
    unique_rule_id: 'rule-alpha-availability-003',
    testbed_id: 'tb-prod-001-alpha',
    rule_name: 'Service Availability Check',
    rule_config: {
      metric: 'service_uptime',
      threshold: 99,
      duration: '1m',
      severity: 'critical',
      condition: 'below'
    },
    is_active: true,
    created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
  }
];

export function getFakeRules() {
  return {
    success: true,
    rules: FAKE_RULES
  };
}

export function getFakeRulesByTestbed(testbedId: string) {
  const rules = FAKE_RULES.filter(rule => rule.testbed_id === testbedId);
  return {
    success: true,
    rules
  };
}

export function getFakeRuleById(ruleId: string) {
  const rule = FAKE_RULES.find(r => r.unique_rule_id === ruleId);
  if (rule) {
    return {
      success: true,
      rule
    };
  }
  return {
    success: false,
    error: 'Rule not found'
  };
}
