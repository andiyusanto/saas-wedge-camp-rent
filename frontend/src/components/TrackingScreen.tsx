import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Business } from '../hooks/useBusiness';
import { useBookingRequests } from '../hooks/useBookingRequests';
import type { BookingRequest } from '../hooks/useBookingRequests';
import { NewBookingModal } from './NewBookingModal';
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
} from 'lucide-react';
import { useTrackings, buildReceiptData } from '../hooks/useTrackings';
import type { TrackingBooking } from '../hooks/useTrackings';
import { ReturnModal } from './ReturnModal';
import { AddFineModal } from './AddFineModal';
import { ConfirmModal } from './ConfirmModal';
import { InvoiceModal } from './InvoiceModal';
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
} from '../utils/formatters';

type StatusFilter = 'all' | 'overdue' | 'active' | 'pending_pickup';

export function TrackingScreen({
  session,
  business,
  businessName,
  businessAddress,
  businessLogoUrl,
}: {
  session: Session;
  business: Business;
  businessName: string;
  businessAddress: string | null;
  businessLogoUrl: string | null;
}) {
  const { bookings, toleranceHours, loading, error, refresh, cancelBooking, pickupBooking } = useTrackings(session);
  const {
    requests: pendingRequests,
    loading: pendingLoading,
    checkStillConfirmable,
    confirmWithBooking,
    rejectRequest,
    refresh: refreshPendingRequests,
    fetchHistoricalRequests,
  } = useBookingRequests(business.id);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [returnTarget, setReturnTarget] = useState<TrackingBooking | null>(null);
  const [fineTarget, setFineTarget] = useState<TrackingBooking | null>(null);
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
  const totalRetained = bookings.filter((b) => b.deposits.some((d) => d.status === 'ditahan')).length;
  const totalActive = bookings.filter((b) => !b.is_pending_pickup).length;
  const totalUnpaidFines = bookings.reduce((sum, b) => sum + b.penalties.reduce((s, p) => s + p.amount, 0), 0);

  async function runAction(fn: () => Promise<{ error: string | null }>) {
    setActionError(null);
    const { error: err } = await fn();
    if (err) setActionError(err);
  }

  function handleShareWA(b: TrackingBooking) {
    if (!b.customer?.phone) return;
    const text = generateWhatsAppReceipt(buildReceiptData(b, businessName, businessAddress));
    window.open(getWhatsAppShareUrl(b.customer.phone, text), '_blank');
  }

  function handlePrintInvoice(b: TrackingBooking) {
    setInvoiceData(buildReceiptData(b, businessName, businessAddress, businessLogoUrl));
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

  function buildStatusLink(token: string) {
    return `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'}/pesanan/${token}`;
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
                    <p className="font-bold text-[#26302B] text-sm truncate">{r.customer_name}</p>
                    <p className="text-xs text-[#6E6853] truncate">
                      {r.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}
                    </p>
                    <p className="text-xs text-[#6E6853]">
                      {formatDateIndo(r.start_date)} s/d {formatDateIndo(r.end_date)} · {formatIDR(r.estimated_price)}
                    </p>
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
                    className="flex-1 px-3 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs transition"
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Sewa Terlambat" value={totalOverdue} color="danger" icon={AlertOctagon} sub="Perlu tindakan denda" />
        <StatCard label="Jaminan Ditahan" value={totalRetained} color="warning" icon={ShieldAlert} sub="KTP / SIM / STNK / Uang" />
        <StatCard label="Sedang Disewa" value={totalActive} color="primary" icon={Clock} sub="Peralatan di lapangan" />
        <StatCard label="Tunggakan Denda" value={formatIDR(totalUnpaidFines)} color="neutral" icon={DollarSign} sub="Total tercatat" isText />
      </div>

      <div className="bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <ScrollableRow className="sm:w-auto">
            <FilterButton label={`Semua (${bookings.length})`} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
            <FilterButton
              label={`Terlambat (${bookings.filter((b) => b.is_overdue).length})`}
              active={statusFilter === 'overdue'}
              onClick={() => setStatusFilter('overdue')}
              tone="danger"
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
              booking={b}
              onShareWA={() => handleShareWA(b)}
              onPrintInvoice={() => handlePrintInvoice(b)}
              onPickup={() => runAction(() => pickupBooking(b.id))}
              onAddFine={() => setFineTarget(b)}
              onReturn={() => setReturnTarget(b)}
              onCancel={() => setCancelTarget(b)}
            />
          ))
        )}
      </div>

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
            items: confirmPrefillTarget.items.map((i) => ({ itemId: i.item_id, quantity: i.quantity })),
            estimatedPrice: confirmPrefillTarget.estimated_price,
          }}
          onSaved={handleBookingSavedForRequest}
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

function BookingCard({
  booking: b,
  onShareWA,
  onPrintInvoice,
  onPickup,
  onAddFine,
  onReturn,
  onCancel,
}: {
  booking: TrackingBooking;
  onShareWA: () => void;
  onPrintInvoice: () => void;
  onPickup: () => void;
  onAddFine: () => void;
  onReturn: () => void;
  onCancel: () => void;
}) {
  const lateFines = b.penalties.filter((p) => p.type === 'keterlambatan');
  const otherFines = b.penalties.filter((p) => p.type !== 'keterlambatan');
  const totalFines = b.penalties.reduce((sum, p) => sum + p.amount, 0);
  const activeDeposit = b.deposits.find((d) => d.status === 'ditahan');
  const remaining = Math.max(0, b.total_price - b.dp_paid);
  const [showHistory, setShowHistory] = useState(false);

  let statusBadge = (
    <span className="px-2.5 py-1 rounded-md bg-[#E8EFEA] text-[#2B4739] text-xs font-bold border border-[#2B4739]/30">Sedang Disewa</span>
  );
  if (b.is_overdue) {
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
    <div className={`bg-[#FBFAF4] rounded-2xl p-5 border shadow-xs transition ${b.is_overdue ? 'border-[#A8412E] bg-[#FAF0EE]/30' : 'border-[#DBD5C1]'}`}>
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
            {b.customer_photo_url && (
              <img
                src={b.customer_photo_url}
                alt="Foto penyewa"
                className="w-9 h-9 rounded-full object-cover border border-[#DBD5C1] shrink-0"
              />
            )}
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
              <span className="text-[#6E6853]">Tanggal Ambil:</span>
              <strong className="text-[#26302B]">{formatDateIndo(b.start_date)}</strong>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-[#6E6853]">Janji Kembali:</span>
              <strong className={`font-bold ${b.is_overdue ? 'text-[#A8412E]' : 'text-[#26302B]'}`}>{formatDateIndo(b.end_date)}</strong>
            </div>
            {b.picked_up_at && (
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
          <div className="flex items-center justify-between pt-1">
            <span className="text-[#6E6853]">Total Sewa:</span>
            <span className="font-extrabold text-[#26302B] text-sm">{formatIDR(b.total_price)}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#6E6853]">Sisa Tagihan:</span>
            <span className={`font-bold ${remaining > 0 ? 'text-[#A8412E]' : 'text-[#2B4739]'}`}>
              {remaining > 0 ? formatIDR(remaining) : 'LUNAS'}
            </span>
          </div>
        </div>

        <div className="space-y-3 bg-[#F1EEE2] p-3 rounded-xl border border-[#DBD5C1]">
          {activeDeposit && (
            <div>
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#26302B] flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#2B4739]" />
                  Jaminan ({depositLabel(activeDeposit.type)})
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#A65C2A] text-white">DITAHAN</span>
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
