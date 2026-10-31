import { useState } from 'react';
import { Search, ShieldCheck, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAdminBusinesses } from '../hooks/useAdminBusinesses';
import type { AdminBusinessRow } from '../hooks/useAdminBusinesses';
import { AdminPaymentModal } from './AdminPaymentModal';
import { formatDateIndo } from '../utils/formatters';

const STATUS_LABEL: Record<AdminBusinessRow['status'], string> = {
  aktif: 'Aktif',
  tenggang: 'Tenggang',
  'hanya-baca': 'Hanya-baca',
};

const STATUS_CLASS: Record<AdminBusinessRow['status'], string> = {
  aktif: 'bg-[#2B4739]/10 text-[#2B4739] border-[#2B4739]/30',
  tenggang: 'bg-[#A65C2A]/10 text-[#A65C2A] border-[#A65C2A]/30',
  'hanya-baca': 'bg-[#A8412E]/10 text-[#A8412E] border-[#A8412E]/30',
};

// Alat admin internal — HANYA untuk akun di app_admins (migration 044),
// dicek Navbar via is_app_admin() SEBELUM tab ini bahkan dirender (lihat
// App.tsx), RLS lintas-business sendiri ditegakkan di RPC
// admin_list_businesses (migration 045), bukan di sini.
export function AdminScreen() {
  const { rows, loading, error, search } = useAdminBusinesses();
  const [query, setQuery] = useState('');
  const [paymentTarget, setPaymentTarget] = useState<AdminBusinessRow | null>(null);
  const [planSavingId, setPlanSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handlePlanChange(businessId: string, plan: string) {
    if (!supabase) return;
    setPlanSavingId(businessId);
    setActionError(null);
    const { error: err } = await supabase.rpc('set_subscription_plan', { p_business_id: businessId, p_plan: plan });
    setPlanSavingId(null);
    if (err) {
      setActionError(err.message);
      return;
    }
    search(query);
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
        <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[#2B4739]" />
          <span>Alat Admin — Langganan</span>
        </h2>
        <p className="text-xs text-[#6E6853]">
          Cari business lintas-vendor, catat pembayaran langganan, dan ubah paket. Alat ini cuma kelihatan untuk akun admin.
        </p>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#6E6853] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search(query)}
              placeholder="Cari nama usaha atau email pemilik..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white border border-[#DBD5C1] text-sm"
            />
          </div>
          <button
            onClick={() => search(query)}
            className="px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-sm shadow-sm transition"
          >
            Cari
          </button>
        </div>

        {error && <p className="text-xs text-[#A8412E]">Gagal memuat: {error}</p>}
        {actionError && <p className="text-xs text-[#A8412E]">{actionError}</p>}
      </div>

      <div className="space-y-2">
        {loading && <p className="text-sm text-[#6E6853]">Memuat...</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-[#6E6853]">Tidak ada business yang cocok.</p>
        )}
        {rows.map((row) => (
          <div
            key={row.business_id}
            className="bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1] shadow-xs flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-[#26302B] truncate">{row.name}</p>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${STATUS_CLASS[row.status]}`}>
                  {STATUS_LABEL[row.status]}
                </span>
              </div>
              <p className="text-xs text-[#6E6853] truncate">{row.owner_email}</p>
              <p className="text-xs text-[#6E6853]">
                Aktif sampai {row.active_until ? formatDateIndo(row.active_until) : '-'} · sejak {formatDateIndo(row.signed_up_at.slice(0, 10))}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <select
                value={row.plan ?? ''}
                disabled={planSavingId === row.business_id}
                onChange={(e) => handlePlanChange(row.business_id, e.target.value)}
                className="px-2.5 py-2 rounded-lg bg-white border border-[#DBD5C1] text-xs"
              >
                <option value="trial">Trial</option>
                <option value="dasar">Dasar</option>
                <option value="pro">Pro</option>
              </select>
              <button
                onClick={() => setPaymentTarget(row)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#A65C2A] hover:bg-[#9E5524] text-white font-semibold text-xs shadow-sm transition"
              >
                <Wallet className="w-3.5 h-3.5" />
                Catat Pembayaran
              </button>
            </div>
          </div>
        ))}
      </div>

      {paymentTarget && (
        <AdminPaymentModal
          business={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onSaved={() => {
            setPaymentTarget(null);
            search(query);
          }}
        />
      )}
    </div>
  );
}
