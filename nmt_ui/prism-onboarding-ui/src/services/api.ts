/**
 * Centralized API service layer.
 *
 * Every backend call flows through here, giving us one place to handle
 * base URL resolution, error formatting, and fake-data branching.
 */

import { getApiBase } from '../utils/backendUrl';
import { IS_FAKE_MODE } from '../config/fakeMode';
import {
  getFakeTestbeds,
  getFakeAlerts,
  getFakeAlertsByTestbed,
  getFakeExecutionsByTestbed,
} from '../fake-data';

const base = () => getApiBase();

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/* ─── Testbeds ───────────────────────────────────────── */

export interface TestbedDTO {
  id?: number;
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string;
  ncm_ip?: string;
  prometheus_url?: string;
  username?: string;
  password?: string;
  timestamp: string;
  testbed_json?: Record<string, any>;
}

export async function fetchTestbeds(): Promise<TestbedDTO[]> {
  if (IS_FAKE_MODE) {
    await delay(400);
    const data = getFakeTestbeds();
    return (data.testbeds ?? []) as TestbedDTO[];
  }
  const data = await request<{ success: boolean; testbeds: TestbedDTO[] }>(`${base()}/api/get-testbeds`);
  return data.testbeds ?? [];
}

export async function deleteTestbed(testbedId: string): Promise<void> {
  await request(`${base()}/api/delete-testbed/${testbedId}`, { method: 'DELETE' });
}

/* ─── Alerts ─────────────────────────────────────────── */

export interface AlertDTO {
  id: string;
  testbed_id?: string;
  alert_name?: string;
  ruleName?: string;
  severity: string;
  status?: string;
  message?: string;
  description?: string;
  timestamp?: string;
  triggered_at?: string;
  testbed?: string;
}

export async function fetchAlerts(): Promise<AlertDTO[]> {
  if (IS_FAKE_MODE) {
    await delay(300);
    const data = getFakeAlerts();
    return (data.alerts ?? []) as unknown as AlertDTO[];
  }
  const data = await request<{ success?: boolean; alerts: AlertDTO[] }>(`${base()}/api/alerts`);
  return data.alerts ?? [];
}

export async function fetchAlertsByTestbed(testbedId: string): Promise<AlertDTO[]> {
  if (IS_FAKE_MODE) {
    await delay(300);
    const data = getFakeAlertsByTestbed(testbedId);
    return (data.alerts ?? []) as unknown as AlertDTO[];
  }
  const data = await request<{ success: boolean; alerts: AlertDTO[] }>(`${base()}/api/alerts/${testbedId}`);
  return data.alerts ?? [];
}

/* ─── Smart Execution ────────────────────────────────── */

export interface ExecutionDTO {
  execution_id: string;
  testbed_id?: string;
  execution_name?: string;
  testbed_label?: string;
  status: string;
  start_time?: string;
  started_at?: string;
  end_time?: string;
  completed_at?: string;
  duration_minutes?: number;
  total_operations?: number;
  successful_operations?: number;
  failed_operations?: number;
  success_rate?: number;
  tags?: string[];
}

export async function fetchExecutionHistory(testbedId?: string): Promise<ExecutionDTO[]> {
  if (IS_FAKE_MODE && testbedId) {
    await delay(300);
    const data = getFakeExecutionsByTestbed(testbedId);
    return (data.executions ?? []) as ExecutionDTO[];
  }
  const qs = testbedId ? `?testbed_id=${testbedId}` : '';
  const data = await request<{ success?: boolean; executions: ExecutionDTO[] }>(
    `${base()}/api/smart-execution/history${qs}`,
  );
  return data.executions ?? [];
}

export async function deleteExecution(executionId: string): Promise<void> {
  await request(`${base()}/api/smart-execution/delete/${executionId}`, { method: 'DELETE' });
}

export async function stopExecution(executionId: string): Promise<void> {
  await request(`${base()}/api/smart-execution/stop/${executionId}`, { method: 'POST' });
}

/* ─── Analytics ──────────────────────────────────────── */

export interface AnalyticsOverview {
  period: { start: string; end: string; days: number };
  executions: { total: number; completed: number; failed: number; running: number; success_rate: number };
  operations: { total: number; successful: number; success_rate: number; avg_per_execution: number };
  performance: { avg_duration_minutes: number; avg_operations_per_minute: number; threshold_achievement_rate: number };
  resource_utilization: { avg_cpu_percent: number; avg_memory_percent: number };
}

export interface TrendPoint {
  period: string;
  value: number;
  count: number;
}

export async function fetchAnalyticsOverview(startDate: string, endDate: string): Promise<AnalyticsOverview | null> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  const data = await request<{ success: boolean; overview: AnalyticsOverview }>(
    `${base()}/api/analytics/overview?${params}`,
  );
  return data.success ? data.overview : null;
}

export async function fetchAnalyticsTrends(
  startDate: string, endDate: string, metric: string, granularity = 'daily',
): Promise<TrendPoint[]> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate, metric, granularity });
  const data = await request<{ success: boolean; trends?: { trend_data: TrendPoint[] } }>(
    `${base()}/api/analytics/trends?${params}`,
  );
  return data.trends?.trend_data ?? [];
}

/* ─── Helpers ────────────────────────────────────────── */

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
