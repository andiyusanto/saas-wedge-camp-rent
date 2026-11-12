import { useState } from 'react';
import { Search, ShieldCheck, Wallet, Star } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAdminBusinesses } from '../hooks/useAdminBusinesses';
import type { AdminBusinessRow } from '../hooks/useAdminBusinesses';
import { AdminPaymentModal } from './AdminPaymentModal';
import { formatDateIndo } from '../utils/formatters';
import { FOUNDER_CUTOFF_ISO, isFounderEligible } from '../lib/subscriptionConfig';

// Paket final (keputusan Andi 3 Nov 2026) — ganti nama lama "Trial"/
// "Dasar" yang tidak pernah jadi harga sungguhan (lihat subscriptionConfig.ts:
// PRICING). "Pro" (rencana multi-cabang, CLAUDE.md bagian 8 non-goal)
// BELUM ada tier-nya — SENGAJA tidak di-list di bawah ini supaya tidak
// bisa dipilih sebelum fiturnya sungguhan siap; tambah satu baris di
// sini kapan pun sudah siap, select di bawah otomatis ikut tanpa
// perubahan lain.
const PLAN_OPTIONS: { value: string; label: string }[] = [
  { value: 'pendiri', label: 'Pendiri' },
  { value: 'standar', label: 'Standar' },
];

// PENTING — ini CUMA label tampilan dropdown admin, BUKAN sumber harga.
// Harga yang sungguhan ditampilkan ke vendor (halaman Langganan) dan
// disarankan Admin Tools tetap dihitung dari businesses.created_at +
// logika mulai-periode (lihat subscriptionConfig.ts: isFounderPricing(),
// pricingAnnounced()) — TIDAK PERNAH dari kolom subscriptions.plan ini.
// Kolom plan murni label administratif (riwayat/pelaporan), jangan
// bingung keduanya kalau nanti ada perbedaan.
function defaultPlanFor(createdAt: string): 'pendiri' | 'standar' {
  return new Date(createdAt).getTime() < new Date(FOUNDER_CUTOFF_ISO).getTime() ? 'pendiri' : 'standar';
}

// Baris lama (plan null, atau nilai lama 'trial'/'dasar' dari sebelum
// paket final diputuskan) belum pernah di-backfill di DB — tampilkan
// default yang masuk akal di SINI (klien) berdasarkan created_at,
// TANPA menulis apa pun ke DB diam-diam. Andi punya skrip SQL
// normalisasi satu-kali terpisah buat backfill sungguhan kalau mau.
function displayPlan(row: AdminBusinessRow): string {
  if (row.plan === 'pendiri' || row.plan === 'standar') return row.plan;
  return defaultPlanFor(row.signed_up_at);
}

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
  const [founderSavingId, setFounderSavingId] = useState<string | null>(null);
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

  // Tandai/batalkan status Pendiri manual (migration 060) — untuk
  // peserta wawancara yang baru daftar di bulan Januari (tidak lolos
  // aturan otomatis created_at < FOUNDER_CUTOFF_ISO). p_clear mengembalikan
  // ke otomatis; menandai BARU (p_override=true, p_clear=false) ditolak
  // server-side kalau sudah lewat 31 Jan 2027.
  async function handleFounderOverride(businessId: string, override: boolean, clear: boolean) {
    if (!supabase) return;
    setFounderSavingId(businessId);
    setActionError(null);
    const { error: err } = await supabase.rpc('set_founder_override', {
      p_business_id: businessId,
      p_override: override,
      p_clear: clear,
    });
    setFounderSavingId(null);
    if (err) {
      setActionError(err.message);
      return;
    }
    search(query);
  }

  // Override manual founder_price_until — kasus khusus (mis. koreksi
  // tanggal), admin isi langsung tanggalnya.
  async function handleFounderPriceUntilChange(businessId: string, until: string) {
    if (!supabase) return;
    setFounderSavingId(businessId);
    setActionError(null);
    const { error: err } = await supabase.rpc('set_founder_price_until', {
      p_business_id: businessId,
      p_until: until || null,
    });
    setFounderSavingId(null);
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
                {/* Review -c1 3 Nov 2026: owner_email (dan nama usaha)
                    bisa jadi satu token panjang tanpa spasi (mis. alamat
                    Gmail "+tag") — `truncate` (white-space:nowrap)
                    sendirian butuh min-width:0 EKSPLISIT di elemen flex
                    ITU SENDIRI untuk benar-benar terpotong, bukan cuma
                    di parent-nya (min-width default flex item adalah
                    content-based, bukan 0). Di Safari/WebKit lama ini
                    pernah tidak konsisten, jadi dipakai `break-all`
                    (ganti ke baris baru per-karakter kalau perlu) +
                    `min-w-0` di elemen teksnya sendiri sebagai jalan
                    paling pasti lintas-browser, bukan cuma andalan
                    truncate+ellipsis satu baris. */}
                <p className="font-bold text-[#26302B] break-all min-w-0">{row.name}</p>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${STATUS_CLASS[row.status]}`}>
                  {STATUS_LABEL[row.status]}
                </span>
              </div>
              <p className="text-xs text-[#6E6853] break-all min-w-0">{row.owner_email}</p>
              <p className="text-xs text-[#6E6853]">
                Aktif sampai {row.active_until ? formatDateIndo(row.active_until) : '-'} · sejak {formatDateIndo(row.signed_up_at.slice(0, 10))}
              </p>
              {/* Harga Pendiri (migration 060) — badge eligibility + kontrol
                  override manual admin, dan tanggal masa berlaku kalau sudah
                  pernah bayar (null = belum, masih saran pembayaran pertama). */}
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {isFounderEligible(row.signed_up_at, row.founder_override) && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border bg-[#2B4739]/10 text-[#2B4739] border-[#2B4739]/30 flex items-center gap-1">
                    <Star className="w-3 h-3" />
                    Pendiri{row.founder_override === true && ' (manual)'}
                  </span>
                )}
                <button
                  disabled={founderSavingId === row.business_id}
                  onClick={() =>
                    handleFounderOverride(
                      row.business_id,
                      !isFounderEligible(row.signed_up_at, row.founder_override),
                      false,
                    )
                  }
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-[#DBD5C1] text-[#6E6853] hover:bg-[#F1EEE2] transition disabled:opacity-50"
                >
                  {isFounderEligible(row.signed_up_at, row.founder_override) ? 'Batalkan Pendiri' : 'Tandai Pendiri'}
                </button>
                {row.founder_override !== null && (
                  <button
                    disabled={founderSavingId === row.business_id}
                    onClick={() => handleFounderOverride(row.business_id, false, true)}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-[#DBD5C1] text-[#6E6853] hover:bg-[#F1EEE2] transition disabled:opacity-50"
                  >
                    Kembalikan ke otomatis
                  </button>
                )}
                <label className="text-[10px] text-[#6E6853] flex items-center gap-1">
                  Berlaku s/d
                  <input
                    type="date"
                    defaultValue={row.founder_price_until ?? ''}
                    disabled={founderSavingId === row.business_id}
                    onBlur={(e) => handleFounderPriceUntilChange(row.business_id, e.target.value)}
                    className="px-1.5 py-0.5 rounded border border-[#DBD5C1] text-[10px]"
                  />
                </label>
              </div>
            </div>

            {/* shrink-0 lama diganti flex-wrap — select+tombol dulu
                dipaksa satu baris (shrink-0 mencegah dua-duanya
                menyusut), yang di layar sempit bisa ikut mendorong
                lebar kartu melebihi viewport kalau ruang kiri sudah
                habis dipakai nama/email panjang. flex-wrap membiarkan
                tombol turun ke baris sendiri kalau memang tidak muat. */}
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={displayPlan(row)}
                disabled={planSavingId === row.business_id}
                onChange={(e) => handlePlanChange(row.business_id, e.target.value)}
                className="px-2.5 py-2 rounded-lg bg-white border border-[#DBD5C1] text-xs"
              >
                {PLAN_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
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
