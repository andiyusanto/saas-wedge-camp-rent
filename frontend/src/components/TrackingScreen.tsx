import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Business } from '../hooks/useBusiness';
import { useBookingRequests } from '../hooks/useBookingRequests';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import type { BookingRequest } from '../hooks/useBookingRequests';
import { NewBookingModal } from './NewBookingModal';
import { apiFetch, API_BASE_URL } from '../lib/api';

// Sama persis pola TOKO_BASE_URL di EtalaseOnlineScreen.tsx -- VITE_TOKO_PUBLIC_BASE_URL
// HARUS konsisten dengan TOKO_PUBLIC_HOST di backend (lib/publicUrls.ts).
const TOKO_BASE_URL = import.meta.env.VITE_TOKO_PUBLIC_BASE_URL ?? `${API_BASE_URL}/toko`;
import { ModalBackdrop, ModalPanel } from './ModalShell';
import {
  ShieldAlert,
  AlertTriangle,
  Clock,
  DollarSign,
  Send,
  Phone,
  ShieldCheck,
  PlusCircle,
  RotateCcw,
  AlertOctagon,
  PackageCheck,
  History,
  ChevronDown,
  ChevronUp,
  Printer,
  CalendarClock,
  Loader2,
  Wrench,
} from 'lucide-react';
import { useTrackings, buildReceiptData } from '../hooks/useTrackings';
import type { TrackingBooking } from '../hooks/useTrackings';
import { ReturnModal } from './ReturnModal';
import { AddFineModal } from './AddFineModal';
import { RescheduleModal } from './RescheduleModal';
import { UbahAlatModal } from './UbahAlatModal';
import { PickupConfirmModal } from './PickupConfirmModal';
import { ConfirmModal } from './ConfirmModal';
import { InvoiceModal } from './InvoiceModal';
import { PaymentModal } from './PaymentModal';
import { computeRemainingBalance } from '../utils/formatters';
import { ScrollableRow } from './ScrollableRow';
import { StatCard } from './StatCard';
import type { ReceiptData } from '../utils/formatters';
import {
  formatDateIndo,
  formatDateTimeIndo,
  formatIDR,
  depositLabel,
  fineLabel,
  bookingStatusLabel,
  generateWhatsAppReceipt,
  getWhatsAppShareUrl,
  groupReceiptItemsByBundle,
  PAYMENT_PLAN_LABEL,
} from '../utils/formatters';

export type StatusFilter = 'all' | 'overdue' | 'active' | 'pending_pickup';

// Mulai Sewa + ambil lebih awal (brief 23 Nov 2026) -- tanggal picked_up_at
// dibaca lewat Date lokal BROWSER (device staf secara fisik ada di zona
// rental, pola yang sama dengan todayStr()/formatDateTimeIndo di seluruh
// frontend, CLAUDE.md bagian 4), bukan offset manual seperti backend.
function pickedUpDateStr(pickedUpAt: string): string {
  const d = new Date(pickedUpAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pickedUpBeforeStart(b: { is_pending_pickup: boolean; picked_up_at: string | null; start_date: string }): boolean {
  return !b.is_pending_pickup && !!b.picked_up_at && pickedUpDateStr(b.picked_up_at) < b.start_date;
}

export function TrackingScreen({
  session,
  business,
  businessName,
  businessAddress,
  businessLogoUrl,
  writable = true,
  onNavigateToGuide,
  initialFilter,
}: {
  session: Session;
  business: Business;
  businessName: string;
  businessAddress: string | null;
  businessLogoUrl: string | null;
  // Rencana langganan: Konfirmasi pesanan online = bikin booking baru,
  // dikunci kalau hanya-baca — Tolak/return/cancel/denda TIDAK disentuh
  // (tetap terbuka, lihat migration 044 bagian 6).
  writable?: boolean;
  onNavigateToGuide: (sectionId: string) => void;
  // Label "Telat, N unit terkunci..." di Kalender (brief 17 Nov 2026) --
  // membuka tab ini dengan filter Terlambat SUDAH aktif, bukan default
  // "Semua". Cuma dibaca SEKALI saat mount (komponen ini unmount tiap
  // tab berpindah, lihat App.tsx), jadi menekan tab menu Transaksi Aktif
  // secara manual nanti (initialFilter kosong) tetap kembali ke default.
  initialFilter?: StatusFilter;
}) {
  const {
    bookings,
    toleranceHours,
    rescheduleDeadlineDays,
    publicPageSlug,
    lateFeeMode,
    timezone,
    loading,
    error,
    refresh,
    cancelBooking,
    pickupBooking,
    addPayment,
    rescheduleBooking,
    extendBooking,
    updateBookingItems,
  } = useTrackings(session);
  const {
    requests: pendingRequests,
    loading: pendingLoading,
    checkStillConfirmable,
    confirmWithBooking,
    rejectRequest,
    refresh: refreshPendingRequests,
    fetchHistoricalRequests,
  } = useBookingRequests(business.id);
  const push = usePushNotifications(session, business.id);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialFilter ?? 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [returnTarget, setReturnTarget] = useState<TrackingBooking | null>(null);
  const [fineTarget, setFineTarget] = useState<TrackingBooking | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<{ booking: TrackingBooking; mode: 'ubah_jadwal' | 'perpanjang' } | null>(null);
  const [ubahAlatTarget, setUbahAlatTarget] = useState<TrackingBooking | null>(null);
  const [pickupTarget, setPickupTarget] = useState<TrackingBooking | null>(null);
  // Rencana tahap 4, bagian "Pesanan masuk" — alur Konfirmasi.
  const [confirmPrefillTarget, setConfirmPrefillTarget] = useState<BookingRequest | null>(null);
  const [confirmPrecheckError, setConfirmPrecheckError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<BookingRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectedForWA, setRejectedForWA] = useState<{ request: BookingRequest; reason: string } | null>(null);
  // Review -c1 (tahap 4, poin 1b): kalau booking SUDAH tersimpan tapi
  // confirm_booking_request gagal setelahnya (pesanan sudah diproses
  // staff lain / kedaluwarsa di tengah jalan), booking itu jadi "yatim"
  // — menahan stok tanpa pernah tertaut ke booking_requests manapun.
  // JANGAN dibiarkan diam-diam begitu saja — tampilkan pesan jelas +
  // tombol untuk membatalkannya lewat alur Batalkan yang SUDAH ADA
  // (melepas stok+jaminan), bukan state baru yang belum teruji.
  const [orphanBooking, setOrphanBooking] = useState<{ bookingId: string; customerName: string } | null>(null);
  const [showOldRequests, setShowOldRequests] = useState(false);
  const [oldRequests, setOldRequests] = useState<BookingRequest[] | null>(null);

  async function toggleOldRequests() {
    if (!showOldRequests && oldRequests === null) {
      setOldRequests(await fetchHistoricalRequests());
    }
    setShowOldRequests((v) => !v);
  }
  const [cancelTarget, setCancelTarget] = useState<TrackingBooking | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<TrackingBooking | null>(null);
  const [invoiceData, setInvoiceData] = useState<ReceiptData | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <p className="text-sm text-[#6E6853]">Memuat...</p>;
  if (error) return <p className="text-sm text-[#A8412E]">Gagal memuat: {error}</p>;

  const filtered = bookings.filter((b) => {
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'overdue' && b.is_overdue) ||
      (statusFilter === 'active' && !b.is_pending_pickup) ||
      (statusFilter === 'pending_pickup' && b.is_pending_pickup);

    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (b.customer?.name ?? '').toLowerCase().includes(q) ||
      (b.booking_number ?? '').toLowerCase().includes(q) ||
      (b.customer?.phone ?? '').includes(searchQuery);

    return matchesStatus && matchesSearch;
  });

  const totalOverdue = bookings.filter((b) => b.is_overdue).length;
  // Brief 15 Nov 2026 (Bondowoso, demo): jaminan booking 'dipesan' belum
  // SUNGGUHAN diterima (barang+KTP belum diserahkan) — stat ini cuma
  // menghitung yang SUDAH diambil (aktif/telat), bukan jaminan "rencana"
  // dari Catat Transaksi. deposits.status TETAP 'ditahan' di DB sejak
  // awal (tidak diubah) -- derivasi murni dari status booking di sini.
  const totalRetained = bookings.filter((b) => !b.is_pending_pickup && b.deposits.some((d) => d.status === 'ditahan')).length;
  const totalActive = bookings.filter((b) => !b.is_pending_pickup).length;
  const totalUnpaidFines = bookings.reduce((sum, b) => sum + b.penalties.reduce((s, p) => s + p.amount, 0), 0);

  async function runAction(fn: () => Promise<{ error: string | null }>) {
    setActionError(null);
    const { error: err } = await fn();
    if (err) setActionError(err);
  }

  function handleShareWA(b: TrackingBooking) {
    if (!b.customer?.phone) return;
    const text = generateWhatsAppReceipt(buildReceiptData(b, businessName, businessAddress, undefined, timezone));
    window.open(getWhatsAppShareUrl(b.customer.phone, text), '_blank');
  }

  function handlePrintInvoice(b: TrackingBooking) {
    setInvoiceData(buildReceiptData(b, businessName, businessAddress, businessLogoUrl, timezone));
  }

  // Review -c1 (tahap 4, poin 1a): precheck LANGSUNG dari DB tepat
  // sebelum membuka modal prefill — daftar di layar bisa basi (polling
  // 60 detik, atau staff lain di perangkat lain sudah memproses duluan).
  async function handleOpenConfirm(r: BookingRequest) {
    setConfirmPrecheckError(null);
    const check = await checkStillConfirmable(r.id);
    if (!check.ok) {
      setConfirmPrecheckError(check.reason);
      await refreshPendingRequests();
      return;
    }
    setConfirmPrefillTarget(r);
  }

  // Dipanggil dari onSaved NewBookingModal SETELAH booking baru benar-benar
  // tersimpan server-side (stok sudah ditahan di titik ini) — confirm_
  // booking_request tinggal menautkan baris booking_requests ke booking
  // itu. Kalau RPC ini gagal (pesanan sudah diproses staff lain / sempat
  // kedaluwarsa persis di jendela waktu ini, lihat review -c1 poin 1),
  // booking yang sudah terlanjur dibuat itu JADI YATIM — ditangani lewat
  // orphanBooking state di bawah, BUKAN dibiarkan diam begitu saja.
  async function handleBookingSavedForRequest(bookingId: string) {
    const target = confirmPrefillTarget;
    setConfirmPrefillTarget(null);
    if (!target) return;

    const { error: err } = await confirmWithBooking(target.id, bookingId);
    if (err) {
      setOrphanBooking({ bookingId, customerName: target.customer_name });
      setActionError(
        `Transaksi untuk ${target.customer_name} sudah tersimpan, TAPI gagal menautkan ke pesanan online (${err}). ` +
          'Transaksinya tetap valid, tapi pesanan online ini belum tertandai selesai — batalkan transaksi ini kalau tidak jadi dipakai, atau hubungi dukungan.',
      );
    }
    refresh();
    refreshPendingRequests();
  }

  // Brief 12 Nov 2026: halaman status sekarang satu jalur di bawah Etalase
  // (toko.sewalog.com/{slug}/pesanan/{token}). publicPageSlug null untuk
  // karyawan di business tanpa Etalase disetel (RPC get_public_page_slug,
  // migration 059, tetap mengembalikan null kalau Etalase memang belum
  // pernah dibuat) -- jatuh balik ke format lama, tetap benar lewat
  // redirect 301 di backend (routes/etalase.ts).
  function buildStatusLink(token: string) {
    if (publicPageSlug) return `${TOKO_BASE_URL}/${publicPageSlug}/pesanan/${token}`;
    return `${API_BASE_URL}/pesanan/${token}`;
  }

  async function handleRejectSubmit() {
    if (!rejectTarget) return;
    setRejectSubmitting(true);
    const { error: err } = await rejectRequest(rejectTarget.id, rejectReason.trim());
    setRejectSubmitting(false);
    if (err) {
      setActionError(err);
      return;
    }
    setRejectedForWA({ request: rejectTarget, reason: rejectReason.trim() });
    setRejectTarget(null);
    setRejectReason('');
  }

  // Review -c1 (poin 3): WA ke pelanggan tersedia di 3 titik — baris
  // daftar (hubungi langsung), dan setelah Tolak (kabari alasannya +
  // link status). Pesan selalu menyertakan link status (buildStatusLink)
  // supaya pelanggan bisa cek ulang tanpa nanya lagi.
  function handleContactRequestWA(r: BookingRequest) {
    const text = `Halo ${r.customer_name}, terkait pesanan online Anda untuk ${r.start_date} s/d ${r.end_date} di ${businessName}.`;
    window.open(getWhatsAppShareUrl(r.customer_phone, text), '_blank');
  }

  function handleRejectedWA() {
    if (!rejectedForWA) return;
    const { request, reason } = rejectedForWA;
    const text =
      `Halo ${request.customer_name}, mohon maaf pesanan online Anda di ${businessName} untuk ${request.start_date} s/d ${request.end_date} ` +
      `tidak bisa kami proses${reason ? ` (${reason})` : ''}. Cek detail: ${buildStatusLink(request.confirmation_token)}`;
    window.open(getWhatsAppShareUrl(request.customer_phone, text), '_blank');
  }

  return (
    <div className="space-y-6">
      {orphanBooking && (
        <div className="bg-[#FAF0EE] border border-[#A8412E]/40 rounded-2xl p-4 space-y-2">
          <p className="text-sm font-bold text-[#A8412E]">Transaksi tersimpan, tapi gagal ditautkan ke pesanan online</p>
          <p className="text-xs text-[#6E6853]">
            Transaksi untuk {orphanBooking.customerName} sudah tersimpan dan stok sudah ditahan — tapi gagal menandai
            pesanan online-nya selesai. Kalau transaksi ini memang jadi dipakai, biarkan saja (cari manual di daftar di
            bawah). Kalau TIDAK jadi, batalkan supaya stoknya lepas lagi:
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => runAction(() => cancelBooking(orphanBooking.bookingId)).then(() => setOrphanBooking(null))}
              className="px-3 py-2 rounded-xl bg-[#A8412E] hover:bg-[#8D3524] text-white font-bold text-xs transition"
            >
              Batalkan transaksi barusan
            </button>
            <button
              onClick={() => setOrphanBooking(null)}
              className="px-3 py-2 rounded-xl border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] font-semibold text-xs transition"
            >
              Biarkan, ini valid
            </button>
          </div>
        </div>
      )}

      {rejectedForWA && (
        <div className="bg-[#F9EFE7] border border-[#A65C2A]/40 rounded-2xl p-4 flex items-center justify-between gap-3">
          <p className="text-xs text-[#A65C2A] font-semibold">Pesanan {rejectedForWA.request.customer_name} ditolak.</p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleRejectedWA}
              className="px-3 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs transition"
            >
              Kabari pelanggan di WA
            </button>
            <button onClick={() => setRejectedForWA(null)} className="px-2 text-[#6E6853] text-xs">
              Tutup
            </button>
          </div>
        </div>
      )}

      {confirmPrecheckError && (
        <p className="text-xs font-semibold text-[#A8412E] bg-[#FAF0EE] border border-[#A8412E]/30 rounded-lg p-2.5">
          {confirmPrecheckError}
        </p>
      )}

      <PushNotificationCard push={push} onNavigateToGuide={onNavigateToGuide} />

      {!pendingLoading && pendingRequests.length > 0 && (
        <div className="bg-[#F9EFE7] rounded-2xl border border-[#A65C2A]/40 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-[#A65C2A]/30">
            <h3 className="font-bold text-[#A65C2A] text-sm">Pesanan masuk ({pendingRequests.length})</h3>
          </div>
          <div className="divide-y divide-[#A65C2A]/20">
            {pendingRequests.map((r) => (
              <div key={r.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-bold text-[#26302B] text-sm truncate">{r.customer_name}</p>
                      {/* Kode pendek (migration 051) — 6 karakter pertama
                          booking_requests.id, dihitung ulang di sini dari
                          r.id yang sudah ada (bukan field backend baru) —
                          SAMA PERSIS rumus order_code di
                          get_booking_request_status (etalase.ts), supaya
                          pelanggan & vendor bisa saling cocokkan kalau
                          pelanggan menghubungi admin yang berbeda dari
                          yang pertama ditunjukkan. */}
                      <span className="shrink-0 text-[10px] font-mono font-bold text-[#A65C2A] bg-[#F9EFE7] border border-[#A65C2A]/30 rounded px-1.5 py-0.5">
                        {r.id.slice(0, 6).toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-[#6E6853] truncate">
                      {/* Paket Alat Tahap 2 -- grup ber-bundle_instance_id
                          sama tampil "Paket X ×N" + rincian, bukan
                          komponen lepas (brief bagian D), reuse
                          groupReceiptItemsByBundle() yang sudah ada. */}
                      {groupReceiptItemsByBundle(
                        r.items.map((i) => ({
                          name: i.name,
                          quantity: i.quantity,
                          price_per_day: 0,
                          bundle_instance_id: i.bundle_instance_id,
                          bundle_name: i.bundle_name,
                          bundle_quantity: i.bundle_quantity,
                        })),
                      )
                        .map((group) =>
                          group.bundleName
                            ? `Paket ${group.bundleName}${group.bundleQuantity && group.bundleQuantity > 1 ? ` ×${group.bundleQuantity}` : ''}`
                            : group.items.map((i) => `${i.name} ×${i.quantity}`).join(', '),
                        )
                        .join(', ')}
                    </p>
                    <p className="text-xs text-[#6E6853]">
                      {formatDateIndo(r.start_date)} s/d {formatDateIndo(r.end_date)} · {formatIDR(r.estimated_price)}
                    </p>
                    {r.payment_method && (
                      <p className="text-xs text-[#6E6853]">Rencana bayar: {PAYMENT_PLAN_LABEL[r.payment_method]}</p>
                    )}
                    {r.note && <p className="text-xs text-[#6E6853] italic">"{r.note}"</p>}
                  </div>
                  <button
                    onClick={() => handleContactRequestWA(r)}
                    title={r.customer_phone}
                    className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[#DBD5C1] bg-white text-[#2B4739] text-xs font-bold hover:bg-[#F1EEE2] transition"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenConfirm(r)}
                    disabled={!writable}
                    title={!writable ? 'Masa aktif langganan sudah habis — hubungi Sewalog untuk memperpanjang.' : undefined}
                    className="flex-1 px-3 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#2B4739]"
                  >
                    Konfirmasi
                  </button>
                  <button
                    onClick={() => setRejectTarget(r)}
                    className="flex-1 px-3 py-2 rounded-xl border border-[#A8412E]/40 text-[#A8412E] hover:bg-[#FAF0EE] font-bold text-xs transition"
                  >
                    Tolak
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={toggleOldRequests} className="text-xs font-semibold text-[#6E6853] hover:text-[#2B4739] underline">
        {showOldRequests ? 'Sembunyikan pesanan lama' : 'Lihat pesanan lama'}
      </button>
      {showOldRequests && (
        <div className="bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] divide-y divide-[#DBD5C1]">
          {(oldRequests ?? []).length === 0 ? (
            <p className="p-4 text-xs text-[#6E6853]">Belum ada pesanan ditolak/kedaluwarsa.</p>
          ) : (
            (oldRequests ?? []).map((r) => (
              <div key={r.id} className="p-3 flex items-center justify-between gap-2 text-xs">
                <span className="text-[#26302B]">
                  {r.customer_name} — {formatDateIndo(r.start_date)}
                </span>
                <span className={`font-bold ${r.status === 'ditolak' ? 'text-[#A8412E]' : 'text-[#6E6853]'}`}>
                  {r.status === 'ditolak' ? 'Ditolak' : 'Kedaluwarsa'}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Cara hitung denda telat (migration 063) -- label stat & filter
          ikut setting LIVE business (lateFeeMode dari atas), BUKAN
          campuran snapshot tiap transaksi (satu angka agregat tidak
          masuk akal berubah per baris) -- keputusan koordinator 15 Nov
          2026. Badge per kartu tetap ikut snapshot transaksi itu sendiri. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {lateFeeMode === 'tanpa_denda' ? (
          <StatCard label="Belum Kembali" value={totalOverdue} color="warning" icon={AlertOctagon} sub="Lewat batas kembali" />
        ) : (
          <StatCard label="Sewa Terlambat" value={totalOverdue} color="danger" icon={AlertOctagon} sub="Perlu tindakan denda" />
        )}
        <StatCard label="Jaminan Ditahan" value={totalRetained} color="warning" icon={ShieldAlert} sub="KTP / SIM / STNK / Uang" />
        <StatCard label="Sedang Disewa" value={totalActive} color="primary" icon={Clock} sub="Peralatan di lapangan" />
        <StatCard label="Tunggakan Denda" value={formatIDR(totalUnpaidFines)} color="neutral" icon={DollarSign} sub="Total tercatat" isText />
      </div>

      <div className="bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <ScrollableRow className="sm:w-auto">
            <FilterButton label={`Semua (${bookings.length})`} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
            <FilterButton
              label={`${lateFeeMode === 'tanpa_denda' ? 'Belum Kembali' : 'Terlambat'} (${bookings.filter((b) => b.is_overdue).length})`}
              active={statusFilter === 'overdue'}
              onClick={() => setStatusFilter('overdue')}
              tone={lateFeeMode === 'tanpa_denda' ? 'warning' : 'danger'}
            />
            <FilterButton
              label={`Sedang Disewa (${bookings.filter((b) => !b.is_pending_pickup).length})`}
              active={statusFilter === 'active'}
              onClick={() => setStatusFilter('active')}
              tone="primary"
            />
            <FilterButton
              label={`Siap Diambil (${bookings.filter((b) => b.is_pending_pickup).length})`}
              active={statusFilter === 'pending_pickup'}
              onClick={() => setStatusFilter('pending_pickup')}
              tone="warning"
            />
          </ScrollableRow>
          <input
            type="text"
            placeholder="Cari nama / kode booking..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-64 px-3 py-1.5 text-xs rounded-xl bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
          />
        </div>
        <p className="text-[11px] text-[#6E6853]">Toleransi telat vendor: {toleranceHours} jam.</p>
      </div>

      {actionError && (
        <p className="text-xs font-semibold text-[#A8412E] bg-[#FAF0EE] border border-[#A8412E]/30 rounded-lg p-2.5">
          {actionError}
        </p>
      )}

      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="bg-[#FBFAF4] rounded-2xl p-8 border border-[#DBD5C1] text-center text-[#6E6853] text-sm">
            Tidak ada transaksi pada filter ini.
          </div>
        ) : (
          filtered.map((b) => (
            <BookingCard
              key={b.id}
              session={session}
              booking={b}
              onShareWA={() => handleShareWA(b)}
              onPrintInvoice={() => handlePrintInvoice(b)}
              onPickup={() => setPickupTarget(b)}
              onAddFine={() => setFineTarget(b)}
              onReturn={() => setReturnTarget(b)}
              onCancel={() => setCancelTarget(b)}
              onReschedule={() => setRescheduleTarget({ booking: b, mode: b.is_pending_pickup ? 'ubah_jadwal' : 'perpanjang' })}
              onUbahAlat={() => setUbahAlatTarget(b)}
              onCatatPembayaran={() => setPaymentTarget(b)}
              rescheduleDeadlineDays={rescheduleDeadlineDays}
            />
          ))
        )}
      </div>

      <PaymentModal
        isOpen={paymentTarget !== null}
        onClose={() => setPaymentTarget(null)}
        remaining={
          paymentTarget
            ? computeRemainingBalance(
                paymentTarget.total_price,
                paymentTarget.penalties.reduce((sum, p) => sum + p.amount, 0),
                paymentTarget.dp_paid,
              )
            : 0
        }
        mode={
          paymentTarget &&
          computeRemainingBalance(
            paymentTarget.total_price,
            paymentTarget.penalties.reduce((sum, p) => sum + p.amount, 0),
            paymentTarget.dp_paid,
          ) < 0
            ? 'refund'
            : 'bayar'
        }
        defaultMethod={paymentTarget?.payment_plan ?? null}
        onSubmit={(body) => addPayment(paymentTarget!.id, body)}
      />

      <UbahAlatModal
        isOpen={ubahAlatTarget !== null}
        onClose={() => setUbahAlatTarget(null)}
        booking={ubahAlatTarget}
        businessId={business.id}
        updateBookingItems={updateBookingItems}
        businessName={businessName}
        businessAddress={businessAddress}
        businessLogoUrl={businessLogoUrl}
        onDone={() => {
          setUbahAlatTarget(null);
          refresh();
        }}
      />

      <PickupConfirmModal
        isOpen={pickupTarget !== null}
        onClose={() => setPickupTarget(null)}
        booking={pickupTarget}
        pickupBooking={pickupBooking}
        onDone={() => {
          setPickupTarget(null);
          refresh();
        }}
      />

      <RescheduleModal
        isOpen={rescheduleTarget !== null}
        onClose={() => setRescheduleTarget(null)}
        booking={rescheduleTarget?.booking ?? null}
        mode={rescheduleTarget?.mode ?? 'ubah_jadwal'}
        rescheduleDeadlineDays={rescheduleDeadlineDays}
        rescheduleBooking={rescheduleBooking}
        extendBooking={extendBooking}
        businessName={businessName}
        businessAddress={businessAddress}
        businessLogoUrl={businessLogoUrl}
        onDone={() => {
          setRescheduleTarget(null);
          refresh();
        }}
      />

      <ReturnModal
        isOpen={returnTarget !== null}
        onClose={() => setReturnTarget(null)}
        booking={returnTarget}
        businessName={businessName}
        session={session}
        onDone={() => {
          setReturnTarget(null);
          refresh();
        }}
      />

      <AddFineModal
        isOpen={fineTarget !== null}
        onClose={() => setFineTarget(null)}
        booking={fineTarget}
        session={session}
        onSaved={() => {
          setFineTarget(null);
          refresh();
        }}
      />

      <ConfirmModal
        isOpen={cancelTarget !== null}
        title="Batalkan Transaksi?"
        description={`Transaksi ${cancelTarget?.customer?.name ?? 'ini'} akan dibatalkan. Jaminan yang ditahan otomatis dilepas.`}
        confirmLabel="Batalkan"
        onConfirm={async () => {
          const { error: err } = await cancelBooking(cancelTarget!.id);
          if (err) throw new Error(err);
        }}
        onClose={() => setCancelTarget(null)}
      />

      <InvoiceModal isOpen={invoiceData !== null} onClose={() => setInvoiceData(null)} data={invoiceData} />

      {confirmPrefillTarget && (
        <NewBookingModal
          isOpen={true}
          onClose={() => setConfirmPrefillTarget(null)}
          session={session}
          business={business}
          requestPrefill={{
            customerName: confirmPrefillTarget.customer_name,
            customerPhone: confirmPrefillTarget.customer_phone,
            startDate: confirmPrefillTarget.start_date,
            endDate: confirmPrefillTarget.end_date,
            items: confirmPrefillTarget.items.map((i) => ({
              itemId: i.item_id,
              quantity: i.quantity,
              bundleId: i.bundle_id,
              bundleInstanceId: i.bundle_instance_id,
              bundleName: i.bundle_name,
              bundleQuantity: i.bundle_quantity,
            })),
            estimatedPrice: confirmPrefillTarget.estimated_price,
            paymentPlan: confirmPrefillTarget.payment_method,
          }}
          onSaved={handleBookingSavedForRequest}
          writable={writable}
        />
      )}

      {rejectTarget && (
        <ModalBackdrop>
          <ModalPanel className="bg-[#FBFAF4] w-full max-w-sm rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden p-5 space-y-3">
            <h3 className="font-bold text-[#26302B] text-base">Tolak pesanan {rejectTarget.customer_name}?</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Alasan (opsional, akan terlihat pelanggan)"
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setRejectTarget(null);
                  setRejectReason('');
                }}
                disabled={rejectSubmitting}
                className="px-4 py-2 rounded-xl border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] font-semibold text-xs transition disabled:opacity-60"
              >
                Batal
              </button>
              <button
                onClick={handleRejectSubmit}
                disabled={rejectSubmitting}
                className="px-4 py-2 rounded-xl bg-[#A8412E] hover:bg-[#8D3524] text-white font-bold text-xs shadow-sm transition disabled:opacity-60"
              >
                {rejectSubmitting ? 'Memproses...' : 'Tolak'}
              </button>
            </div>
          </ModalPanel>
        </ModalBackdrop>
      )}
    </div>
  );
}


function FilterButton({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: 'danger' | 'primary' | 'warning';
}) {
  const activeBg =
    tone === 'danger' ? 'bg-[#A8412E] text-white' : tone === 'primary' ? 'bg-[#2B4739] text-white' : tone === 'warning' ? 'bg-[#A65C2A] text-white' : 'bg-[#2B4739] text-[#FBFAF4]';
  const inactiveBg =
    tone === 'danger'
      ? 'bg-[#FAF0EE] text-[#A8412E] hover:bg-[#FAF0EE]/80'
      : tone === 'primary'
        ? 'bg-[#E8EFEA] text-[#2B4739] hover:bg-[#E8EFEA]/80'
        : tone === 'warning'
          ? 'bg-[#F9EFE7] text-[#A65C2A] hover:bg-[#F9EFE7]/80'
          : 'bg-[#F1EEE2] text-[#26302B] hover:bg-[#E6E1D2]';

  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${active ? activeBg + ' shadow-xs' : inactiveBg}`}
    >
      {label}
    </button>
  );
}

// Notifikasi push: Pesanan Online baru (v1) — research/brief-notifikasi-push-2026-11.md.
// Opt-in PER PERANGKAT (bukan per akun) — anggota yang login di HP dan
// laptop harus mengaktifkan di masing-masing.
function PushNotificationCard({
  push,
  onNavigateToGuide,
}: {
  push: ReturnType<typeof usePushNotifications>;
  onNavigateToGuide: (sectionId: string) => void;
}) {
  // isStandalone/isIos dipakai cuma untuk pilih SATU pesan "izin ditolak" yang
  // paling sesuai (brief 2026-11-11, review -c1 untuk 60dbdde) -- address bar
  // ("ikon gembok") tidak ada kalau Sewalog dibuka sebagai aplikasi terpasang.
  const { isStandalone, isIos } = useInstallPrompt();
  if (push.loading) return null;
  // Env VAPID belum diisi di server — kartu ini tidak ditampilkan sama
  // sekali (bukan ditampilkan disabled), sesuai brief #6.
  if (!push.featureAvailable) return null;

  if (!push.supported) {
    return (
      <div className="bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] p-4 text-xs text-[#6E6853]">
        Notifikasi push tidak didukung di browser ini.
      </div>
    );
  }

  if (push.iosNeedsHomeScreen) {
    return (
      <div className="bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] p-4 space-y-1">
        <p className="font-bold text-[#26302B] text-sm">Notifikasi Pesanan Online</p>
        <p className="text-xs text-[#6E6853]">
          Di iPhone, notifikasi cuma bisa aktif setelah Sewalog ditambahkan ke Layar Utama: tombol{' '}
          <span className="font-semibold">Bagikan</span> di Safari → <span className="font-semibold">Tambah ke Layar Utama</span> →
          buka Sewalog dari ikon itu, lalu aktifkan notifikasi dari sana.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-[#26302B] text-sm">Notifikasi Pesanan Online</p>
          <p className="text-xs text-[#6E6853]">
            {push.subscribed
              ? 'Aktif di perangkat ini — pemberitahuan muncul saat ada pesanan baru dari Etalase Online.'
              : 'Dapat pemberitahuan di perangkat ini saat ada pesanan baru dari Etalase Online, walau Sewalog tidak dibuka.'}
          </p>
        </div>
        {push.subscribed ? (
          <button
            onClick={push.disable}
            disabled={push.disabling}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1E3429]/10 hover:bg-[#1E3429]/20 text-[#2B4739] font-semibold text-xs transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {/* Jeda beberapa detik di HP (lepas langganan di pushManager +
                hapus di server) tanpa umpan balik apa pun -- dilaporkan Andi
                12 Nov 2026 -- spinner + disabled supaya tidak kelihatan diam
                dan tidak bisa diklik dobel. */}
            {push.disabling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {push.disabling ? 'Mematikan...' : 'Matikan'}
          </button>
        ) : (
          <button
            onClick={push.enable}
            disabled={push.enabling}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-xs transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {/* Browser tidak akan menampilkan dialog izin lagi selama 'denied' --
                klik di sini cuma mengecek ulang Notification.permission (lewat
                push.enable yang sama), bukan mencoba minta izin baru. Label beda
                supaya tidak kelihatan seperti tombol "Aktifkan" yang berfungsi
                normal -- review koordinator (2026-11-11). */}
            {push.enabling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {push.enabling ? 'Mengaktifkan...' : push.permission === 'denied' ? 'Coba Lagi' : 'Aktifkan'}
          </button>
        )}
      </div>
      {push.permission === 'denied' && (
        <p className="text-xs text-[#A8412E]">
          {isStandalone && isIos
            ? 'Izin notifikasi ditolak. Buka Pengaturan HP (bukan di dalam Sewalog) → Notifikasi → Sewalog → Izinkan Notifikasi.'
            : isStandalone
              ? 'Izin notifikasi ditolak. Tekan lama ikon Sewalog di layar utama → Info aplikasi → Notifikasi → Aktifkan.'
              : 'Izin notifikasi ditolak browser. Buka pengaturan situs di browser (ikon gembok di address bar) untuk mengizinkan notifikasi, lalu coba lagi.'}
          {' '}
          <button
            type="button"
            onClick={() => onNavigateToGuide('g-notifikasi-denied')}
            className="underline font-semibold"
          >
            Lihat panduan
          </button>
        </p>
      )}
      {push.retryStillBlocked && (
        <p className="text-xs font-semibold text-[#A8412E]">
          Masih diblokir — izinnya belum berubah. Ikuti langkah di atas dulu, lalu coba lagi.
        </p>
      )}
      {push.error && <p className="text-xs text-[#A8412E]">{push.error}</p>}
      {push.subscribed && (
        <div className="flex items-center gap-2">
          <button
            onClick={push.sendTest}
            disabled={push.testSending}
            className="px-3 py-1.5 rounded-lg border border-[#DBD5C1] text-[#2B4739] font-semibold text-xs disabled:opacity-50"
          >
            {push.testSending ? 'Mengirim...' : 'Kirim notifikasi uji'}
          </button>
          {push.testResult && <p className="text-xs text-[#6E6853]">{push.testResult}</p>}
        </div>
      )}
    </div>
  );
}

// Audit privasi 2 Nov 2026 — foto penyewa tidak lagi di bucket publik,
// jadi tidak ada URL tetap untuk ditaruh langsung di <img src>. Komponen
// ini minta link presigned (umur 5 menit) SETIAP KALI dipasang ke layar
// (mount), tidak pernah menyimpan/memakai ulang link lama — sesuai
// instruksi audit (frontend selalu fetch link baru, tidak caching).
function CustomerPhotoThumbnail({ session, bookingId }: { session: Session; bookingId: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ url: string }>(session, `/api/bookings/${bookingId}/customer-photo`)
      .then((body) => {
        if (!cancelled) setUrl(body.url);
      })
      .catch(() => {
        // Tidak ada foto, atau link gagal dibuat — diam saja, thumbnail
        // cuma tidak tampil (bukan error blocking, foto ini opsional).
      });
    return () => {
      cancelled = true;
    };
  }, [session, bookingId]);

  if (!url) return null;
  return (
    <img
      src={url}
      alt="Foto penyewa"
      className="w-9 h-9 rounded-full object-cover border border-[#DBD5C1] shrink-0"
    />
  );
}

function BookingCard({
  session,
  booking: b,
  onShareWA,
  onPrintInvoice,
  onPickup,
  onAddFine,
  onReturn,
  onCancel,
  onReschedule,
  onUbahAlat,
  onCatatPembayaran,
  rescheduleDeadlineDays,
}: {
  session: Session;
  booking: TrackingBooking;
  onShareWA: () => void;
  onPrintInvoice: () => void;
  onPickup: () => void;
  onAddFine: () => void;
  onReturn: () => void;
  onCancel: () => void;
  onReschedule: () => void;
  onUbahAlat: () => void;
  onCatatPembayaran: () => void;
  rescheduleDeadlineDays: number | null;
}) {
  const lateFines = b.penalties.filter((p) => p.type === 'keterlambatan');
  const otherFines = b.penalties.filter((p) => p.type !== 'keterlambatan');
  const totalFines = b.penalties.reduce((sum, p) => sum + p.amount, 0);
  const activeDeposit = b.deposits.find((d) => d.status === 'ditahan');
  // Pelunasan (brief 17 Nov 2026) -- sisa tagihan SEKARANG termasuk denda
  // (computeRemainingBalance), tidak lagi cuma total_price-dp_paid.
  // SENGAJA tidak di-clamp ke 0 -- "Lebih Bayar" ditampilkan terpisah di
  // bawah kalau negatif (mis. setelah Ubah Alat mengurangi total setelah
  // sudah dibayar), bukan disamakan dengan LUNAS.
  const remaining = computeRemainingBalance(b.total_price, totalFines, b.dp_paid);
  const [showHistory, setShowHistory] = useState(false);

  // Cara hitung denda telat (migration 063): mode 'tanpa_denda' DIPERHALUS
  // (keputusan Andi 15 Nov 2026) -- status DB telat/is_overdue TETAP sama
  // (filter "Terlambat" tetap jalan), cuma tampilannya warning (abu/oranye)
  // bukan merah "TERLAMBAT", supaya tidak kelihatan seperti tagihan denda
  // yang memang tidak dipungut rental ini.
  const lateFeeDisabled = b.late_fee_mode === 'tanpa_denda';

  let statusBadge = (
    <span className="px-2.5 py-1 rounded-md bg-[#E8EFEA] text-[#2B4739] text-xs font-bold border border-[#2B4739]/30">Sedang Disewa</span>
  );
  if (b.is_overdue && lateFeeDisabled) {
    statusBadge = (
      <span className="px-2.5 py-1 rounded-md bg-[#F9EFE7] text-[#A65C2A] text-xs font-extrabold border border-[#A65C2A]/40 flex items-center gap-1 w-fit">
        <AlertOctagon className="w-3.5 h-3.5" /> LEWAT BATAS KEMBALI {b.hours_late} JAM
      </span>
    );
  } else if (b.is_overdue) {
    statusBadge = (
      <span className="px-2.5 py-1 rounded-md bg-[#A8412E] text-white text-xs font-extrabold border border-[#A8412E] flex items-center gap-1 w-fit">
        <AlertOctagon className="w-3.5 h-3.5" /> TERLAMBAT {b.hours_late} JAM
      </span>
    );
  } else if (b.is_pending_pickup) {
    statusBadge = (
      <span className="px-2.5 py-1 rounded-md bg-[#F9EFE7] text-[#A65C2A] text-xs font-bold border border-[#A65C2A]/30">Siap Diambil</span>
    );
  }

  return (
    <div
      className={`bg-[#FBFAF4] rounded-2xl p-5 border shadow-xs transition ${
        b.is_overdue && lateFeeDisabled
          ? 'border-[#A65C2A]/50 bg-[#F9EFE7]/30'
          : b.is_overdue
            ? 'border-[#A8412E] bg-[#FAF0EE]/30'
            : 'border-[#DBD5C1]'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-[#E6E1D2] gap-2">
        <div className="flex items-center space-x-3">
          <span className="font-mono text-xs font-bold text-[#2B4739] bg-[#E8EFEA] px-2.5 py-1 rounded-md border border-[#2B4739]/20">
            {b.booking_number ?? '-'}
          </span>
        </div>
        {statusBadge}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-4 text-xs">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {b.has_customer_photo && <CustomerPhotoThumbnail session={session} bookingId={b.id} />}
            <h4 className="font-bold text-sm text-[#26302B]">{b.customer?.name}</h4>
          </div>
          {b.customer?.phone && (
            <p className="text-[#6E6853] flex items-center gap-1">
              <Phone className="w-3.5 h-3.5 text-[#2B4739]" />
              <span>{b.customer.phone}</span>
            </p>
          )}
          {b.customer?.address && <p className="text-[#6E6853] italic">{b.customer.address}</p>}

          <div className="p-2.5 rounded-xl bg-[#F1EEE2] border border-[#DBD5C1] space-y-1 mt-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-[#6E6853]">Mulai Sewa:</span>
              <strong className="text-[#26302B]">
                {formatDateIndo(b.start_date)}
                {pickedUpBeforeStart(b) && <span className="ml-1 text-[9px] font-normal text-[#A65C2A]">Diambil lebih awal</span>}
              </strong>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-[#6E6853]">Janji Kembali:</span>
              <strong className={`font-bold ${b.is_overdue ? 'text-[#A8412E]' : 'text-[#26302B]'}`}>{formatDateIndo(b.end_date)}</strong>
            </div>
            {/* "Diambil" (brief 23 Nov 2026) -- CUMA tampil kalau TANGGAL
                picked_up_at berbeda dari start_date, supaya pengambilan
                tepat waktu/walk-in biasa tetap tampil PERSIS seperti
                sebelum fitur ini ada (regresi). */}
            {b.picked_up_at && pickedUpDateStr(b.picked_up_at) !== b.start_date && (
              <div className="flex justify-between text-[11px]">
                <span className="text-[#6E6853]">Diambil:</span>
                <strong className="text-[#26302B]">{formatDateTimeIndo(b.picked_up_at)}</strong>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h5 className="font-semibold text-[#26302B] uppercase text-[10px] tracking-wider">Item Disewa ({b.items.length}):</h5>
          <ul className="space-y-1 bg-white p-2.5 rounded-xl border border-[#DBD5C1] max-h-28 overflow-y-auto">
            {b.items.map((it, idx) => (
              <li key={idx} className="flex justify-between text-[11px]">
                <span className="text-[#26302B] font-medium">
                  • {it.name} ({it.quantity}x)
                </span>
              </li>
            ))}
          </ul>
          {/* Barang Jual (habis pakai), v1 (brief 16 Nov 2026) -- ringkas
              saja ("+2 barang jual"), rincian lengkap ada di struk/Nota. */}
          {b.sale_items.length > 0 && (
            <p className="text-[11px] text-[#6E6853]">
              + {b.sale_items.reduce((sum, s) => sum + s.quantity, 0)} barang jual
            </p>
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[#6E6853]">Total Sewa:</span>
            <span className="font-extrabold text-[#26302B] text-sm">{formatIDR(b.total_price)}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#6E6853]">{remaining < 0 ? 'Lebih Bayar:' : 'Sisa Tagihan:'}</span>
            <span className={`font-bold ${remaining > 0 ? 'text-[#A8412E]' : remaining < 0 ? 'text-[#A65C2A]' : 'text-[#2B4739]'}`}>
              {remaining > 0 ? formatIDR(remaining) : remaining < 0 ? formatIDR(Math.abs(remaining)) : 'LUNAS'}
            </span>
          </div>
          {/* Perbaikan koordinator 17 Nov 2026: "Bayar" cuma relevan kalau
              masih ada sisa (remaining>0) -- kalau LUNAS (remaining===0)
              tidak ada aksi yang relevan sama sekali (disembunyikan,
              bukan cuma dinonaktifkan). Kalau Lebih Bayar (remaining<0),
              bukan "Bayar" lagi (tidak ada yang perlu dibayar) -- tawarkan
              "Catat Pengembalian" (koreksi/refund, owner-only, ditegakkan
              backend) supaya vendor sadar ada uang yang mesti dikembalikan. */}
          {remaining > 0 && (
            <button
              type="button"
              onClick={onCatatPembayaran}
              className="w-full text-center text-[11px] font-bold text-[#2B4739] underline pt-1"
            >
              Catat Pembayaran
            </button>
          )}
          {remaining < 0 && (
            <button
              type="button"
              onClick={onCatatPembayaran}
              className="w-full text-center text-[11px] font-bold text-[#A65C2A] underline pt-1"
            >
              Catat Pengembalian
            </button>
          )}
        </div>

        <div className="space-y-3 bg-[#F1EEE2] p-3 rounded-xl border border-[#DBD5C1]">
          {activeDeposit && (
            <div>
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#26302B] flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#2B4739]" />
                  Jaminan ({depositLabel(activeDeposit.type)})
                </span>
                {/* Brief 15 Nov 2026: booking 'dipesan' belum sungguhan
                    menerima jaminan (barang+KTP belum diserahkan) --
                    badge netral abu, bukan "DITAHAN" oranye, sampai
                    dikonfirmasi lewat dialog Ambil. */}
                {b.is_pending_pickup ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#DBD5C1] text-[#6E6853]">RENCANA SAAT AMBIL</span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#A65C2A] text-white">DITAHAN</span>
                )}
              </div>
              {activeDeposit.note && (
                <p className="text-[11px] text-[#6E6853] mt-1 bg-white p-2 rounded-lg border border-[#DBD5C1]">{activeDeposit.note}</p>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-[#DBD5C1] space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#A8412E] flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Rincian Denda ({b.penalties.length})
              </span>
              <span className="font-extrabold text-[#A8412E]">{formatIDR(totalFines)}</span>
            </div>

            {b.penalties.length === 0 ? (
              <p className="text-[10px] text-[#6E6853] italic">Tidak ada denda pada sewa ini.</p>
            ) : (
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {lateFines.map((f) => (
                  <div key={f.id} className="p-1.5 rounded-lg bg-[#FAF0EE] border border-[#A8412E]/30 text-[10px]">
                    <div className="flex justify-between font-bold text-[#A8412E]">
                      <span>[{fineLabel(f.type)}]</span>
                      <span>{formatIDR(f.amount)}</span>
                    </div>
                    {f.description && <p className="text-[#26302B]">{f.description}</p>}
                  </div>
                ))}
                {otherFines.map((f) => (
                  <div key={f.id} className="p-1.5 rounded-lg bg-[#F9EFE7] border border-[#A65C2A]/30 text-[10px]">
                    <div className="flex justify-between font-bold text-[#A65C2A]">
                      <span>
                        [{fineLabel(f.type)}]
                        {f.item_name && <span className="font-normal"> ({f.item_name})</span>}
                      </span>
                      <span>{formatIDR(f.amount)}</span>
                    </div>
                    {f.description && <p className="text-[#26302B]">{f.description}</p>}
                  </div>
                ))}
              </div>
            )}
            {/* Bebaskan denda telat (migration 077) -- hanya tampil kalau
                pernah dibebaskan, TIDAK membuat baris penalties apa pun. */}
            {b.late_fee_waived_amount != null && b.late_fee_waived_amount > 0 && (
              <p className="text-[10px] text-[#A65C2A] italic">
                Denda telat dibebaskan ({formatIDR(b.late_fee_waived_amount)})
                {b.late_fee_waived_reason ? ` — ${b.late_fee_waived_reason}` : ''}
              </p>
            )}
          </div>
        </div>
      </div>

      {b.history.length > 0 && (
        <div className="pt-3 mt-3 border-t border-[#E6E1D2]">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-bold text-[#6E6853] hover:text-[#26302B] transition"
          >
            <History className="w-3.5 h-3.5" />
            <span>Riwayat Status ({b.history.length})</span>
            {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showHistory && (
            <ol className="mt-2 space-y-1.5">
              {b.history.map((h, idx) => (
                <li key={idx} className="flex items-start gap-2 text-[11px]">
                  <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#2B4739] mt-1.5" />
                  <span className="text-[#26302B]">
                    <strong>{bookingStatusLabel(h.status)}</strong> oleh {h.changed_by_name}
                    <span className="text-[#6E6853]"> · {formatDateTimeIndo(h.created_at)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {b.reschedule_history.length > 0 && (
        <div className="pt-3 mt-3 border-t border-[#E6E1D2]">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#6E6853] mb-2">
            <CalendarClock className="w-3.5 h-3.5" />
            <span>Riwayat Perubahan Jadwal ({b.reschedule_history.length})</span>
          </p>
          <ol className="space-y-1.5">
            {b.reschedule_history.map((h, idx) => (
              <li key={idx} className="text-[11px] text-[#26302B] bg-[#F1EEE2] border border-[#DBD5C1] rounded-lg p-2">
                <strong>{h.action === 'ubah_jadwal' ? 'Ubah jadwal' : 'Perpanjang'}</strong>
                {': '}
                {formatDateIndo(h.old_start_date)}–{formatDateIndo(h.old_end_date)} → {formatDateIndo(h.new_start_date)}–
                {formatDateIndo(h.new_end_date)}
                {h.past_deadline && rescheduleDeadlineDays != null && (
                  <span className="text-[#A65C2A] font-semibold"> · Melewati batas H-{rescheduleDeadlineDays}</span>
                )}
                <span className="text-[#6E6853]"> · oleh {h.changed_by_name} · {formatDateTimeIndo(h.created_at)}</span>
                {h.reason && <p className="text-[#6E6853] italic mt-0.5">Alasan: {h.reason}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {b.item_change_history.length > 0 && (
        <div className="pt-3 mt-3 border-t border-[#E6E1D2]">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#6E6853] mb-2">
            <Wrench className="w-3.5 h-3.5" />
            <span>Riwayat Ubah Alat ({b.item_change_history.length})</span>
          </p>
          <ol className="space-y-1.5">
            {b.item_change_history.map((h, idx) => (
              <li key={idx} className="text-[11px] text-[#26302B] bg-[#F1EEE2] border border-[#DBD5C1] rounded-lg p-2">
                <strong>Sebelum</strong>: {h.old_items.map((it) => `${it.name} ×${it.quantity}`).join(', ') || '(tidak ada)'}{' '}
                ({formatIDR(h.old_total_price)})
                <br />
                <strong>Sesudah</strong>: {h.new_items.map((it) => `${it.name} ×${it.quantity}`).join(', ') || '(tidak ada)'}{' '}
                ({formatIDR(h.new_total_price)})
                <span className="text-[#6E6853]"> · oleh {h.changed_by_name} · {formatDateTimeIndo(h.created_at)}</span>
                {h.reason && <p className="text-[#6E6853] italic mt-0.5">Alasan: {h.reason}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between pt-3 mt-3 border-t border-[#E6E1D2] gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onShareWA}
            className="px-3 py-1.5 rounded-lg bg-[#2B4739] hover:bg-[#1E3429] text-white text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Send className="w-3.5 h-3.5 text-[#A65C2A]" />
            <span>Kirim Struk WA</span>
          </button>
          <button
            onClick={onPrintInvoice}
            className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Printer className="w-3.5 h-3.5 text-[#2B4739]" />
            <span>Cetak Nota</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {b.is_pending_pickup && (
            <button
              onClick={onPickup}
              className="px-3 py-1.5 rounded-lg bg-[#A65C2A] hover:bg-[#9E5524] text-white text-xs font-bold transition flex items-center gap-1"
            >
              <PackageCheck className="w-3.5 h-3.5" />
              Tandai Barang Diambil
            </button>
          )}

          {!b.is_pending_pickup && (
            <button
              onClick={onAddFine}
              className="px-3 py-1.5 rounded-lg bg-[#FAF0EE] border border-[#A8412E]/40 text-[#A8412E] hover:bg-[#A8412E] hover:text-white text-xs font-bold transition flex items-center gap-1"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Tambah Denda
            </button>
          )}

          {!b.is_pending_pickup && (
            <button
              onClick={onReturn}
              className="px-3 py-1.5 rounded-lg bg-[#2B4739] hover:bg-[#1E3429] text-white text-xs font-bold shadow-xs transition flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#A65C2A]" />
              Proses Pengembalian
            </button>
          )}

          <button
            onClick={onReschedule}
            className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] text-xs font-bold transition flex items-center gap-1"
          >
            <CalendarClock className="w-3.5 h-3.5 text-[#2B4739]" />
            {b.is_pending_pickup ? 'Ubah Jadwal' : 'Perpanjang'}
          </button>

          {b.is_pending_pickup && (
            <button
              onClick={onUbahAlat}
              className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] text-xs font-bold transition flex items-center gap-1"
            >
              <Wrench className="w-3.5 h-3.5 text-[#2B4739]" />
              Ubah Alat
            </button>
          )}

          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#A8412E] hover:bg-[#FAF0EE] text-xs font-bold transition"
          >
            Batalkan
          </button>
        </div>
      </div>
    </div>
  );
}
