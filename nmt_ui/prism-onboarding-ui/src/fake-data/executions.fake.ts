/**
 * Fake Executions Data
 * 
 * Generates realistic execution data for DEMO mode.
 * Cross-linked with testbeds.
 */

import { FAKE_TESTBEDS } from './testbeds.fake';

export interface FakeExecution {
  execution_id: string;
  testbed_id: string;
  testbed_label?: string;
  status: string;
  progress: number;
  total_operations: number;
  completed_operations: number;
  successful_operations: number;
  failed_operations: number;
  start_time: string;
  end_time?: string;
  created_at: string;
  duration_minutes?: number;
  config?: any;
  last_error?: string;
}

const STATUSES = ['COMPLETED', 'RUNNING', 'FAILED', 'STOPPED'];
const ENTITY_TYPES = ['VM', 'Project', 'Blueprint', 'Application', 'Subnet', 'Cluster'];

function generateExecutionId(index: number): string {
  const date = new Date(Date.now() - index * 60 * 60 * 1000);
  return `NMT-${date.toISOString().split('T')[0].replace(/-/g, '')}-${String(index).padStart(6, '0')}`;
}

// Generate 50 executions across testbeds
export const FAKE_EXECUTIONS: FakeExecution[] = [];

for (let i = 0; i < 50; i++) {
  const testbed = FAKE_TESTBEDS[i % FAKE_TESTBEDS.length];
  const status = i === 0 ? 'RUNNING' : i === 1 ? 'RUNNING' : STATUSES[Math.floor(Math.random() * STATUSES.length)];
  const hoursAgo = i * 2 + Math.floor(Math.random() * 10);
  const startTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  
  const totalOps = 10 + Math.floor(Math.random() * 90);
  let completedOps, successfulOps, failedOps, progress;
  
  if (status === 'RUNNING') {
    completedOps = Math.floor(totalOps * (0.3 + Math.random() * 0.4));
    successfulOps = completedOps;
    failedOps = 0;
    progress = Math.floor((completedOps / totalOps) * 100);
  } else if (status === 'COMPLETED') {
    completedOps = totalOps;
    successfulOps = totalOps - Math.floor(Math.random() * 3);
    failedOps = completedOps - successfulOps;
    progress = 100;
  } else if (status === 'FAILED') {
    completedOps = Math.floor(totalOps * (0.2 + Math.random() * 0.5));
    successfulOps = Math.floor(completedOps * 0.6);
    failedOps = completedOps - successfulOps;
    progress = Math.floor((completedOps / totalOps) * 100);
  } else { // STOPPED
    completedOps = Math.floor(totalOps * (0.3 + Math.random() * 0.3));
    successfulOps = completedOps;
    failedOps = 0;
    progress = Math.floor((completedOps / totalOps) * 100);
  }
  
  const duration = status !== 'RUNNING' ? Math.floor(10 + Math.random() * 120) : undefined;
  const endTime = status !== 'RUNNING' ? new Date(startTime.getTime() + (duration || 30) * 60 * 1000) : undefined;
  
  const entityType = ENTITY_TYPES[Math.floor(Math.random() * ENTITY_TYPES.length)];
  
  FAKE_EXECUTIONS.push({
    execution_id: generateExecutionId(i),
    testbed_id: testbed.unique_testbed_id,
    testbed_label: testbed.testbed_label,
    status,
    progress,
    total_operations: totalOps,
    completed_operations: completedOps,
    successful_operations: successfulOps,
    failed_operations: failedOps,
    start_time: startTime.toISOString(),
    end_time: endTime?.toISOString(),
    created_at: startTime.toISOString(),
    duration_minutes: duration,
    config: {
      entities: [
        {
          type: entityType.toLowerCase(),
          operations: {
            create: Math.floor(totalOps * 0.4),
            update: Math.floor(totalOps * 0.3),
            delete: Math.floor(totalOps * 0.3)
          }
        }
      ],
      duration: duration || 60,
      parallel_executions: Math.floor(1 + Math.random() * 5),
      distribution: 'LINEAR'
    },
    last_error: status === 'FAILED' ? `Failed to ${['create', 'update', 'delete'][Math.floor(Math.random() * 3)]} ${entityType}: API timeout` : undefined
  });
}

export function getFakeExecutions(limit = 50) {
  return {
    success: true,
    executions: FAKE_EXECUTIONS.slice(0, limit)
  };
}

export function getFakeExecutionById(executionId: string) {
  const execution = FAKE_EXECUTIONS.find(ex => ex.execution_id === executionId);
  if (execution) {
    return {
      success: true,
      ...execution,
      stats: {
        total_operations: execution.total_operations,
        completed_operations: execution.completed_operations,
        successful_operations: execution.successful_operations,
        failed_operations: execution.failed_operations,
        pending_operations: execution.total_operations - execution.completed_operations,
        success_rate: execution.completed_operations > 0 
          ? (execution.successful_operations / execution.completed_operations) * 100 
          : 0,
        progress_percentage: execution.progress
      }
    };
  }
  return {
    success: false,
    error: 'Execution not found'
  };
}

export function getFakeExecutionsByTestbed(testbedId: string) {
  const executions = FAKE_EXECUTIONS.filter(ex => ex.testbed_id === testbedId);
  return {
    success: true,
    executions
  };
}
