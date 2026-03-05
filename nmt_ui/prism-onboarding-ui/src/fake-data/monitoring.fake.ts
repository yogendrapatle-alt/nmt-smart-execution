/**
 * Fake Monitoring Data
 * 
 * Generates realistic monitoring metrics for DEMO mode.
 * Provides 7 days of time-series data for charts.
 */

import { FAKE_TESTBEDS } from './testbeds.fake';
import { FAKE_EXECUTIONS } from './executions.fake';

export interface FakeMetricPoint {
  timestamp: string;
  value: number;
}

export interface FakeMetrics {
  testbed_id: string;
  cpu_usage: FakeMetricPoint[];
  memory_usage: FakeMetricPoint[];
  disk_usage: FakeMetricPoint[];
  network_in: FakeMetricPoint[];
  network_out: FakeMetricPoint[];
  pod_restarts: FakeMetricPoint[];
  api_latency: FakeMetricPoint[];
}

// Generate realistic time-series data
function generateMetricSeries(
  days: number,
  intervalMinutes: number,
  baseValue: number,
  variance: number,
  spikes: boolean = false
): FakeMetricPoint[] {
  const points: FakeMetricPoint[] = [];
  const totalPoints = (days * 24 * 60) / intervalMinutes;
  
  for (let i = 0; i < totalPoints; i++) {
    const timestamp = new Date(Date.now() - (totalPoints - i) * intervalMinutes * 60 * 1000);
    let value = baseValue + (Math.random() - 0.5) * variance;
    
    // Add occasional spikes
    if (spikes && Math.random() < 0.05) {
      value = baseValue + variance * (1 + Math.random());
    }
    
    // Ensure non-negative
    value = Math.max(0, value);
    
    points.push({
      timestamp: timestamp.toISOString(),
      value: parseFloat(value.toFixed(2))
    });
  }
  
  return points;
}

// Generate metrics for each testbed (active ones only)
export const FAKE_MONITORING_DATA: FakeMetrics[] = FAKE_TESTBEDS
  .filter(tb => tb.status === 'active')
  .map(testbed => ({
    testbed_id: testbed.unique_testbed_id,
    cpu_usage: generateMetricSeries(7, 30, 45, 20, true), // 7 days, 30min intervals, base 45%, ±20%
    memory_usage: generateMetricSeries(7, 30, 60, 15, true), // base 60%, ±15%
    disk_usage: generateMetricSeries(7, 60, 50, 10, false), // slower changing
    network_in: generateMetricSeries(7, 30, 1000, 500, true), // MB/s
    network_out: generateMetricSeries(7, 30, 800, 400, true), // MB/s
    pod_restarts: generateMetricSeries(7, 60, 0.5, 1.5, true), // occasional restarts
    api_latency: generateMetricSeries(7, 30, 150, 100, true) // ms
  }));

export function getFakeMonitoringData(testbedId: string, hours: number = 24) {
  const metrics = FAKE_MONITORING_DATA.find(m => m.testbed_id === testbedId);
  
  if (!metrics) {
    return {
      success: false,
      error: 'No monitoring data for this testbed (may be stopped or failed)'
    };
  }
  
  // Filter to requested time range
  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  const filterPoints = (points: FakeMetricPoint[]) => 
    points.filter(p => new Date(p.timestamp) >= cutoffTime);
  
  return {
    success: true,
    metrics: {
      cpu_usage: filterPoints(metrics.cpu_usage),
      memory_usage: filterPoints(metrics.memory_usage),
      disk_usage: filterPoints(metrics.disk_usage),
      network_in: filterPoints(metrics.network_in),
      network_out: filterPoints(metrics.network_out),
      pod_restarts: filterPoints(metrics.pod_restarts),
      api_latency: filterPoints(metrics.api_latency)
    }
  };
}

export function getFakeExecutionTimeline(executionId: string) {
  const execution = FAKE_EXECUTIONS.find(ex => ex.execution_id === executionId);
  
  if (!execution) {
    return {
      success: false,
      error: 'Execution not found'
    };
  }
  
  // Generate timeline events
  const startTime = new Date(execution.start_time);
  const events = [
    {
      timestamp: startTime.toISOString(),
      event: 'Execution Started',
      details: `Workload execution initiated for ${execution.testbed_label}`
    }
  ];
  
  // Add operation events
  const numEvents = Math.min(execution.completed_operations, 20); // Limit events for demo
  for (let i = 0; i < numEvents; i++) {
    const eventTime = new Date(startTime.getTime() + (i + 1) * 60000); // 1 min apart
    const operations = ['create', 'update', 'delete'];
    const entities = ['VM', 'Project', 'Blueprint', 'Subnet'];
    const operation = operations[Math.floor(Math.random() * operations.length)];
    const entity = entities[Math.floor(Math.random() * entities.length)];
    const success = Math.random() < 0.9; // 90% success rate
    
    events.push({
      timestamp: eventTime.toISOString(),
      event: success ? `${operation} ${entity} succeeded` : `${operation} ${entity} failed`,
      details: success 
        ? `Successfully ${operation}d ${entity.toLowerCase()}-${i + 1}`
        : `Failed to ${operation} ${entity.toLowerCase()}-${i + 1}: API timeout`
    });
  }
  
  // Add completion event if not running
  if (execution.status !== 'RUNNING' && execution.end_time) {
    events.push({
      timestamp: execution.end_time,
      event: `Execution ${execution.status}`,
      details: execution.status === 'COMPLETED' 
        ? `Completed with ${execution.successful_operations}/${execution.total_operations} successful operations`
        : execution.last_error || `Execution ${execution.status.toLowerCase()}`
    });
  }
  
  return {
    success: true,
    timeline: events
  };
}

export function getFakeSystemHealth() {
  // Calculate aggregate health from all testbeds
  const activeTestbeds = FAKE_TESTBEDS.filter(tb => tb.status === 'active').length;
  const totalTestbeds = FAKE_TESTBEDS.length;
  const runningExecutions = FAKE_EXECUTIONS.filter(ex => ex.status === 'RUNNING').length;
  const failedExecutions = FAKE_EXECUTIONS.filter(ex => ex.status === 'FAILED').length;
  
  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (failedExecutions > 5 || activeTestbeds < totalTestbeds * 0.5) {
    status = 'unhealthy';
  } else if (failedExecutions > 2 || activeTestbeds < totalTestbeds * 0.8) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }
  
  return {
    success: true,
    health: {
      status,
      testbeds: {
        total: totalTestbeds,
        active: activeTestbeds,
        stopped: FAKE_TESTBEDS.filter(tb => tb.status === 'stopped').length,
        failed: FAKE_TESTBEDS.filter(tb => tb.status === 'failed').length
      },
      executions: {
        running: runningExecutions,
        completed: FAKE_EXECUTIONS.filter(ex => ex.status === 'COMPLETED').length,
        failed: failedExecutions,
        stopped: FAKE_EXECUTIONS.filter(ex => ex.status === 'STOPPED').length
      }
    }
  };
}
