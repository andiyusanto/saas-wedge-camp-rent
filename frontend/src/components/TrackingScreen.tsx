import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
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
} from 'lucide-react';
import { useTrackings } from '../hooks/useTrackings';
import type { TrackingBooking } from '../hooks/useTrackings';
import { ReturnModal } from './ReturnModal';
import { AddFineModal } from './AddFineModal';
import { ConfirmModal } from './ConfirmModal';
import { ScrollableRow } from './ScrollableRow';
import { StatCard } from './StatCard';
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

export function TrackingScreen({ session, businessName }: { session: Session; businessName: string }) {
  const { bookings, toleranceHours, loading, error, refresh, cancelBooking, pickupBooking } = useTrackings(session);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [returnTarget, setReturnTarget] = useState<TrackingBooking | null>(null);
  const [fineTarget, setFineTarget] = useState<TrackingBooking | null>(null);
  const [cancelTarget, setCancelTarget] = useState<TrackingBooking | null>(null);
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
    const activeDeposit = b.deposits.find((d) => d.status === 'ditahan') ?? b.deposits[0];
    const text = generateWhatsAppReceipt({
      bookingNumber: b.booking_number ?? '-',
      customerName: b.customer.name,
      customerPhone: b.customer.phone,
      startDate: b.start_date,
      endDate: b.end_date,
      items: b.items.map((i) => ({ name: i.name, quantity: i.quantity, price_per_day: 0 })),
      totalPrice: b.total_price,
      dpPaid: b.dp_paid,
      depositType: activeDeposit?.type ?? null,
      depositNote: activeDeposit?.note ?? null,
      depositStatus: (activeDeposit?.status as 'ditahan' | 'dikembalikan' | null) ?? null,
      status: b.is_pending_pickup ? 'dipesan' : 'aktif',
      fines: b.penalties,
      businessName,
    });
    window.open(getWhatsAppShareUrl(b.customer.phone, text), '_blank');
  }

  return (
    <div className="space-y-6">
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
  onPickup,
  onAddFine,
  onReturn,
  onCancel,
}: {
  booking: TrackingBooking;
  onShareWA: () => void;
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
                      <span>[{fineLabel(f.type)}]</span>
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
        <button
          onClick={onShareWA}
          className="px-3 py-1.5 rounded-lg bg-[#2B4739] hover:bg-[#1E3429] text-white text-xs font-semibold flex items-center gap-1.5 transition"
        >
          <Send className="w-3.5 h-3.5 text-[#A65C2A]" />
          <span>Kirim Struk WA</span>
        </button>

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
