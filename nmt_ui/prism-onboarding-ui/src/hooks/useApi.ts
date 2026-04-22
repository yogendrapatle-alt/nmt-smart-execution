/**
 * Lightweight data-fetching hook — no external deps required.
 *
 * Provides loading/error/data states, manual refetch, and
 * stale-while-revalidate behaviour via cacheKey.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseApiOptions<T> {
  /** Async function that returns data */
  fetcher: () => Promise<T>;
  /** If a key changes the fetcher re-runs. Pass `null` to skip fetching. */
  key?: string | null;
  /** Initial data before first fetch completes */
  initialData?: T;
}

interface UseApiResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const cache = new Map<string, { data: unknown; ts: number }>();
const STALE_MS = 30_000;

export function useApi<T>({ fetcher, key, initialData }: UseApiOptions<T>): UseApiResult<T> {
  const [data, setData] = useState<T | undefined>(() => {
    if (key && cache.has(key)) return cache.get(key)!.data as T;
    return initialData;
  });
  const [loading, setLoading] = useState(key !== null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const fetchIdRef = useRef(0);

  const load = useCallback(async () => {
    if (key === null) return;
    const id = ++fetchIdRef.current;

    if (key && cache.has(key)) {
      const cached = cache.get(key)!;
      setData(cached.data as T);
      if (Date.now() - cached.ts < STALE_MS) { setLoading(false); return; }
    }

    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (!mountedRef.current || id !== fetchIdRef.current) return;
      setData(result);
      if (key) cache.set(key, { data: result, ts: Date.now() });
    } catch (err) {
      if (!mountedRef.current || id !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      if (mountedRef.current && id === fetchIdRef.current) setLoading(false);
    }
  }, [fetcher, key]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  return { data, loading, error, refetch: load };
}

/** Invalidate one or all cache keys so the next mount triggers a fresh fetch. */
export function invalidateCache(keyPrefix?: string) {
  if (!keyPrefix) { cache.clear(); return; }
  for (const k of cache.keys()) {
    if (k.startsWith(keyPrefix)) cache.delete(k);
  }
}
