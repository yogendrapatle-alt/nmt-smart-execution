// src/hooks/useConfigLoader.ts
import { useState, useCallback } from 'react';
import { fetchConfig } from '../api/configApi';

export function useConfigLoader() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async (pc_ip: string) => {
    setLoading(true);
    setError(null);
    try {
      const config = await fetchConfig(pc_ip);
      setLoading(false);
      return config;
    } catch (err: any) {
      setError(err.message || 'Failed to load config');
      setLoading(false);
      return null;
    }
  }, []);

  return { loadConfig, loading, error };
}
