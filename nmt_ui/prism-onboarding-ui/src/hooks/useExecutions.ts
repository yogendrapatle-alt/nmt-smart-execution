import { useCallback } from 'react';
import { useApi, invalidateCache } from './useApi';
import {
  fetchExecutionHistory,
  deleteExecution,
  stopExecution,
  type ExecutionDTO,
} from '../services/api';

export function useExecutions(testbedId?: string) {
  const fetcher = useCallback(() => fetchExecutionHistory(testbedId), [testbedId]);
  const key = testbedId ? `executions:${testbedId}` : 'executions:all';
  const result = useApi<ExecutionDTO[]>({ fetcher, key });

  const remove = async (executionId: string) => {
    await deleteExecution(executionId);
    invalidateCache('executions');
    result.refetch();
  };

  const stop = async (executionId: string) => {
    await stopExecution(executionId);
    invalidateCache('executions');
    result.refetch();
  };

  return { ...result, executions: result.data ?? [], remove, stop };
}
