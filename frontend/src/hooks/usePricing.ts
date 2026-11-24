import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { apiFetch } from '../lib/api';
import type { PricingTable } from '../lib/subscriptionConfig';

type PricingResponse = {
  announced: boolean;
  pricing: PricingTable | null;
};

// GET /api/pricing -- satu-satunya jalur ambil ANGKA RUPIAH harga
// langganan (review koordinator 24 Nov 2026, lihat komentar panjang di
// subscriptionConfig.ts) -- backend yang memutuskan kapan angka
// dikirim (pricingAnnounced() ATAU is_app_admin), bukan diputuskan di
// sini. `pricing` null berarti BELUM diumumkan (dan pemanggil bukan
// admin) -- caller TIDAK BOLEH menampilkan angka apa pun kalau null.
export function usePricing(session: Session | null) {
  const [pricing, setPricing] = useState<PricingTable | null>(null);
  const [announced, setAnnounced] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!session) {
        setPricing(null);
        setAnnounced(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const body = await apiFetch<PricingResponse>(session, '/api/pricing');
        if (cancelled) return;
        setPricing(body.pricing);
        setAnnounced(body.announced);
      } catch {
        if (cancelled) return;
        setPricing(null);
        setAnnounced(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  return { pricing, announced, loading };
}
