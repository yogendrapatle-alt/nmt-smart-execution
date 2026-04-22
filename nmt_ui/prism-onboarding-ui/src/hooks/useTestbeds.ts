import { useCallback } from 'react';
import { useApi, invalidateCache } from './useApi';
import { fetchTestbeds, deleteTestbed, type TestbedDTO } from '../services/api';

export function useTestbeds() {
  const fetcher = useCallback(() => fetchTestbeds(), []);
  const result = useApi<TestbedDTO[]>({ fetcher, key: 'testbeds' });

  const remove = async (testbedId: string) => {
    await deleteTestbed(testbedId);
    invalidateCache('testbeds');
    result.refetch();
  };

  return { ...result, testbeds: result.data ?? [], remove };
}
