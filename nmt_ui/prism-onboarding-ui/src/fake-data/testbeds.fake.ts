/**
 * Fake Testbeds Data
 * 
 * Generates realistic testbed data for DEMO mode.
 * Cross-linked with executions, rules, and alerts.
 */

export interface FakeTestbed {
  id: number;
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string;
  ncm_ip: string;
  username: string;
  password: string;
  uuid: string;
  timestamp: string;
  testbed_json: {
    testbed_label: string;
    pc_ip: string;
    ncm_ip: string;
    username: string;
    password: string;
    prometheus_endpoint: string;
    ncm_node: string;
    node_port: string;
    onboarded_at: string;
  };
  status?: string;
}

export const FAKE_TESTBEDS: FakeTestbed[] = [
  {
    id: 1,
    unique_testbed_id: 'tb-prod-001-alpha',
    testbed_label: 'Production Cluster Alpha',
    pc_ip: '10.50.100.10',
    ncm_ip: '10.50.100.11',
    username: 'admin',
    password: 'Nutanix.123',
    uuid: '550e8400-e29b-41d4-a716-446655440001',
    timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    testbed_json: {
      testbed_label: 'Production Cluster Alpha',
      pc_ip: '10.50.100.10',
      ncm_ip: '10.50.100.11',
      username: 'admin',
      password: 'Nutanix.123',
      prometheus_endpoint: 'http://10.50.100.11:32000',
      ncm_node: 'ncm-alpha-0',
      node_port: '32000',
      onboarded_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    },
    status: 'active'
  },
  {
    id: 2,
    unique_testbed_id: 'tb-prod-002-beta',
    testbed_label: 'Production Cluster Beta',
    pc_ip: '10.50.100.20',
    ncm_ip: '10.50.100.21',
    username: 'admin',
    password: 'Nutanix.123',
    uuid: '550e8400-e29b-41d4-a716-446655440002',
    timestamp: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    testbed_json: {
      testbed_label: 'Production Cluster Beta',
      pc_ip: '10.50.100.20',
      ncm_ip: '10.50.100.21',
      username: 'admin',
      password: 'Nutanix.123',
      prometheus_endpoint: 'http://10.50.100.21:32001',
      ncm_node: 'ncm-beta-0',
      node_port: '32001',
      onboarded_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString()
    },
    status: 'active'
  },
  {
    id: 3,
    unique_testbed_id: 'tb-staging-001-gamma',
    testbed_label: 'Staging Environment Gamma',
    pc_ip: '10.60.100.10',
    ncm_ip: '10.60.100.11',
    username: 'admin',
    password: 'Nutanix.123',
    uuid: '550e8400-e29b-41d4-a716-446655440003',
    timestamp: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    testbed_json: {
      testbed_label: 'Staging Environment Gamma',
      pc_ip: '10.60.100.10',
      ncm_ip: '10.60.100.11',
      username: 'admin',
      password: 'Nutanix.123',
      prometheus_endpoint: 'http://10.60.100.11:32002',
      ncm_node: 'ncm-gamma-0',
      node_port: '32002',
      onboarded_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    },
    status: 'active'
  },
  {
    id: 4,
    unique_testbed_id: 'tb-dev-001-delta',
    testbed_label: 'Development Cluster Delta',
    pc_ip: '10.70.100.10',
    ncm_ip: '10.70.100.11',
    username: 'admin',
    password: 'Nutanix.123',
    uuid: '550e8400-e29b-41d4-a716-446655440004',
    timestamp: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    testbed_json: {
      testbed_label: 'Development Cluster Delta',
      pc_ip: '10.70.100.10',
      ncm_ip: '10.70.100.11',
      username: 'admin',
      password: 'Nutanix.123',
      prometheus_endpoint: 'http://10.70.100.11:32003',
      ncm_node: 'ncm-delta-0',
      node_port: '32003',
      onboarded_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
    },
    status: 'stopped'
  },
  {
    id: 5,
    unique_testbed_id: 'tb-test-001-epsilon',
    testbed_label: 'Testing Environment Epsilon',
    pc_ip: '10.80.100.10',
    ncm_ip: '10.80.100.11',
    username: 'admin',
    password: 'Nutanix.123',
    uuid: '550e8400-e29b-41d4-a716-446655440005',
    timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    testbed_json: {
      testbed_label: 'Testing Environment Epsilon',
      pc_ip: '10.80.100.10',
      ncm_ip: '10.80.100.11',
      username: 'admin',
      password: 'Nutanix.123',
      prometheus_endpoint: 'http://10.80.100.11:32004',
      ncm_node: 'ncm-epsilon-0',
      node_port: '32004',
      onboarded_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    },
    status: 'failed'
  }
];

export function getFakeTestbeds() {
  return {
    success: true,
    testbeds: FAKE_TESTBEDS
  };
}

export function getFakeTestbedById(testbedId: string) {
  const testbed = FAKE_TESTBEDS.find(tb => tb.unique_testbed_id === testbedId);
  if (testbed) {
    return {
      success: true,
      testbed
    };
  }
  return {
    success: false,
    error: 'Testbed not found'
  };
}
