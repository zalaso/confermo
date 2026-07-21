import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

/**
 * Carica dati dall'API e li tiene aggiornati con un polling leggero:
 * per la segretaria la dashboard è "in tempo reale" senza complicazioni.
 */
export function usePolling<T>(path: string | null, intervalMs = 15_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const refetch = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const result = await get<T>(p);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refetch();
    const h = setInterval(refetch, intervalMs);
    return () => clearInterval(h);
  }, [path, intervalMs, refetch]);

  return { data, error, loading, refetch };
}
