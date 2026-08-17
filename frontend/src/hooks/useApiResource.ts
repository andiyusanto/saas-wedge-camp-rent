import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { apiFetch } from '../lib/api';

// Hook-factory generik buat "GET satu resource, lacak loading/error, refresh
// manual + polling opsional" — dulu useAvailability.ts dan useTrackings.ts
// masing-masing nulis ulang pola ini sendiri. Mutasi (POST/DELETE) tetap
// jadi fungsi terpisah per hook (lihat useTrackings.ts) yang manggil
// refresh() sesudahnya — resource GET-nya saja yang digeneralisasi di sini.
export function useApiResource<T>(
  session: Session | null,
  path: string | null,
  options?: { pollMs?: number },
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session || !path) {
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const body = await apiFetch<T>(session, path);
      setData(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, path]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  // Poll ringan sebagai alternatif query-invalidation library — cukup buat
  // layar stok/transaksi tetap segar kalau lebih dari satu staf memakai
  // Sewalog bersamaan, tanpa perlu vendor manual refresh (lihat CLAUDE.md
  // bagian 4 soal risiko data basi -> double-booking).
  useEffect(() => {
    if (!options?.pollMs || !session || !path) return;
    const id = setInterval(refresh, options.pollMs);
    return () => clearInterval(id);
  }, [options?.pollMs, session, path, refresh]);

  return { data, loading, error, refresh };
}
