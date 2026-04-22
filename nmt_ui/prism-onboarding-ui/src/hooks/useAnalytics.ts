import { useCallback } from 'react';
import { useApi } from './useApi';
import {
  fetchAnalyticsOverview,
  fetchAnalyticsTrends,
  type AnalyticsOverview,
  type TrendPoint,
} from '../services/api';

export function useAnalyticsOverview(startDate: string, endDate: string) {
  const fetcher = useCallback(
    () => fetchAnalyticsOverview(startDate, endDate),
    [startDate, endDate],
  );
  const key = `analytics:overview:${startDate}:${endDate}`;
  const result = useApi<AnalyticsOverview | null>({ fetcher, key });
  return { ...result, overview: result.data ?? null };
}

export function useAnalyticsTrends(
  startDate: string, endDate: string, metric: string, granularity = 'daily',
) {
  const fetcher = useCallback(
    () => fetchAnalyticsTrends(startDate, endDate, metric, granularity),
    [startDate, endDate, metric, granularity],
  );
  const key = `analytics:trends:${startDate}:${endDate}:${metric}:${granularity}`;
  const result = useApi<TrendPoint[]>({ fetcher, key });
  return { ...result, trends: result.data ?? [] };
}
