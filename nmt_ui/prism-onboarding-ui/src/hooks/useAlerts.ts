import { useCallback } from 'react';
import { useApi } from './useApi';
import { fetchAlerts, fetchAlertsByTestbed, type AlertDTO } from '../services/api';

export function useAlerts() {
  const fetcher = useCallback(() => fetchAlerts(), []);
  return { ...useApi<AlertDTO[]>({ fetcher, key: 'alerts:all' }), alerts: undefined as AlertDTO[] | undefined };
}

export function useAlertsByTestbed(testbedId: string | null) {
  const fetcher = useCallback(() => fetchAlertsByTestbed(testbedId!), [testbedId]);
  const result = useApi<AlertDTO[]>({ fetcher, key: testbedId ? `alerts:${testbedId}` : null });
  return { ...result, alerts: result.data ?? [] };
}
