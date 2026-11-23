import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Contact, Search, AlertTriangle, X, Receipt } from 'lucide-react';
import { useCustomers } from '../hooks/useCustomers';
import type { Customer } from '../hooks/useCustomers';
import { useCustomerTypes } from '../hooks/useCustomerTypes';
import type { CustomerType } from '../hooks/useCustomerTypes';
import { supabase } from '../lib/supabaseClient';
import type { MemberRole } from '../hooks/useBusiness';
import { formatDateIndo, formatIDR } from '../utils/formatters';
import type { ReceiptData } from '../utils/formatters';
import { InvoiceModal } from './InvoiceModal';
import { ModalBackdrop, ModalPanel } from './ModalShell';

// Menu "Pelanggan" (brief 23 Nov 2026, migration 073) -- owner & karyawan
// boleh melihat + memberi label; total belanja (Rp) HANYA owner (pola
// sama Riwayat owner-only, tapi di sini cuma angkanya yang digerbang,
// bukan seluruh tab -- keputusan brief bagian A).
type HistoryRow = { id: string; booking_number: string | null; start_date: string; end_date: string; status: string; total_price: number };

async function fetchCustomerHistory(customerId: string): Promise<HistoryRow[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('bookings')
    .select('id, booking_number, start_date, end_date, status, total_price')
    .eq('customer_id', customerId)
    .order('start_date', { ascending: false })
    .order('id');
  return (data as HistoryRow[]) ?? [];
}

async function fetchReceiptForBooking(bookingId: string): Promise<{
  items: { name: string; quantity: number; price_per_day: number; subtotal: number | null }[];
  saleItems: { name: string; quantity: number; unitPrice: number; subtotal: number }[];
  penalties: { type: string; amount: number }[];
  deposits: { type: string; note: string | null; status: string }[];
  payments: { amount: number; method: string | null; kind: string; note: string | null; paid_at: string }[];
  rentalDayMode: 'per_malam' | 'per_hari_kalender' | null;
  discountTypeName: string | null;
  discountPercent: number | null;
  discountAmount: number;
} | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('bookings')
    .select(
      'rental_day_mode, discount_type_name, discount_percent, discount_amount, booking_items(quantity, subtotal, price_at_booking, items(name)), booking_sale_items(name, quantity, price_at_booking, subtotal), penalties(type, amount), deposits(type, note, status), booking_payments(amount, method, kind, note, paid_at)',
    )
    .eq('id', bookingId)
    .maybeSingle();
  if (!data) return null;
  const bookingItems = (data.booking_items ?? []) as unknown as { quantity: number; subtotal: number | null; price_at_booking: number; items: { name: string } | null }[];
  const saleItemRows = (data.booking_sale_items ?? []) as unknown as { name: string; quantity: number; price_at_booking: number; subtotal: number }[];
  return {
    items: bookingItems.map((bi) => ({
      name: bi.items?.name ?? '',
      quantity: bi.quantity,
      price_per_day: bi.price_at_booking,
      subtotal: bi.subtotal,
    })),
    saleItems: saleItemRows.map((s) => ({ name: s.name, quantity: s.quantity, unitPrice: s.price_at_booking, subtotal: s.subtotal })),
    penalties: data.penalties ?? [],
    deposits: data.deposits ?? [],
    payments: data.booking_payments ?? [],
    rentalDayMode: data.rental_day_mode,
    discountTypeName: data.discount_type_name,
    discountPercent: data.discount_percent,
    discountAmount: data.discount_amount,
  };
}

function CustomerDetailModal({
  customer,
  customerTypes,
  isOwner,
  businessName,
  businessAddress,
  businessLogoUrl,
  onClose,
  onSaved,
}: {
  customer: Customer;
  customerTypes: CustomerType[];
  isOwner: boolean;
  businessName: string;
  businessAddress?: string | null;
  businessLogoUrl?: string | null;
  onClose: () => void;
  onSaved: (id: string, input: Partial<Customer>) => Promise<{ error: string | null }>;
}) {
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [address, setAddress] = useState(customer.address ?? '');
  const [typeId, setTypeId] = useState(customer.customer_type_id ?? '');
  const [watchlisted, setWatchlisted] = useState(customer.is_watchlisted);
  const [note, setNote] = useState(customer.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [invoiceData, setInvoiceData] = useState<ReceiptData | null>(null);

  async function loadHistory() {
    if (history !== null) return;
    setHistory(await fetchCustomerHistory(customer.id));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const { error: err } = await onSaved(customer.id, {
      name: name.trim(),
      phone: phone.trim() || null,
      address: address.trim() || null,
      customer_type_id: typeId || null,
      is_watchlisted: watchlisted,
      note: note.trim() || null,
    });
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  async function openNota(h: HistoryRow) {
    const extras = await fetchReceiptForBooking(h.id);
    if (!extras) return;
    const activeDeposit = extras.deposits.find((d) => d.status === 'ditahan') ?? extras.deposits[0];
    setInvoiceData({
      bookingNumber: h.booking_number ?? '-',
      customerName: customer.name,
      customerPhone: customer.phone ?? '',
      startDate: h.start_date,
      endDate: h.end_date,
      items: extras.items,
      saleItems: extras.saleItems,
      totalPrice: h.total_price,
      dpPaid: extras.payments.reduce((sum, p) => sum + p.amount, 0),
      depositType: activeDeposit?.type ?? null,
      depositNote: activeDeposit?.note ?? null,
      depositStatus: (activeDeposit?.status as 'ditahan' | 'dikembalikan' | null) ?? null,
      status: h.status,
      fines: extras.penalties,
      businessName,
      businessAddress,
      businessLogoUrl,
      rentalDayMode: extras.rentalDayMode,
      payments: extras.payments.map((p) => ({ amount: p.amount, method: p.method, kind: p.kind, note: p.note, paidAt: p.paid_at })),
      isReprint: true,
      reprintedAt: formatDateIndo(new Date().toISOString().slice(0, 10), false),
      discountTypeName: extras.discountTypeName,
      discountPercent: extras.discountPercent,
      discountAmount: extras.discountAmount,
    });
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-md rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <h3 className="font-bold text-base flex items-center gap-2">
            <Contact className="w-5 h-5" /> Detail Pelanggan
          </h3>
          <button onClick={onClose} className="text-white hover:opacity-80">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3 text-sm overflow-y-auto">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama" className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1]" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="No. WhatsApp" className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1]" />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Alamat" className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1]" />
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1]">
            <option value="">Tanpa jenis</option>
            {customerTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} (-{t.discount_percent}%)
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs font-semibold text-[#A8412E]">
            <input type="checkbox" checked={watchlisted} onChange={(e) => setWatchlisted(e.target.checked)} />
            Tandai Waspada
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan bebas (mis. alasan Waspada, preferensi, dsb)"
            className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-xs"
            rows={3}
          />
          {error && <p className="text-xs font-semibold text-[#A8412E]">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 rounded-xl bg-[#2B4739] text-white font-semibold text-sm disabled:opacity-60">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white border border-[#DBD5C1] text-sm">
              Tutup
            </button>
          </div>

          <div className="pt-3 border-t border-[#E6E1D2]">
            <button onClick={loadHistory} className="text-xs font-semibold text-[#2B4739] underline">
              {history === null ? 'Lihat riwayat transaksi' : `Riwayat Transaksi (${history.length})`}
            </button>
            {history !== null && (
              <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#26302B]">{h.booking_number ?? '-'}</p>
                      <p className="text-[#6E6853]">{formatDateIndo(h.start_date, false)} {isOwner && `· ${formatIDR(h.total_price)}`}</p>
                    </div>
                    <button onClick={() => openNota(h)} className="p-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#2B4739] shrink-0" title="Lihat Nota">
                      <Receipt className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {history.length === 0 && <p className="text-xs text-[#6E6853] italic">Belum ada transaksi.</p>}
              </div>
            )}
          </div>
        </div>
      </ModalPanel>
      <InvoiceModal isOpen={invoiceData !== null} onClose={() => setInvoiceData(null)} data={invoiceData} />
    </ModalBackdrop>
  );
}

export function CustomersScreen({
  session: _session,
  businessId,
  role,
  businessName,
  businessAddress,
  businessLogoUrl,
}: {
  session: Session;
  businessId: string;
  role: MemberRole | null;
  businessName: string;
  businessAddress?: string | null;
  businessLogoUrl?: string | null;
}) {
  const { customers, aggregates, loading, loadingMore, hasMore, loadMore, searchQuery, setSearchQuery, typeFilter, setTypeFilter, updateCustomer } =
    useCustomers(businessId);
  const { customerTypes } = useCustomerTypes(businessId);
  const [detailTarget, setDetailTarget] = useState<Customer | null>(null);
  const isOwner = role === 'owner';

  return (
    <div className="space-y-4">
      <div className="bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
        <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
          <Contact className="w-5 h-5 text-[#2B4739]" /> Pelanggan
        </h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6E6853]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama atau WhatsApp..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-sm"
            />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-sm">
            <option value="all">Semua label</option>
            <option value="watchlisted">Waspada</option>
            {customerTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[#6E6853]">Memuat...</p>
      ) : (
        <div className="space-y-2">
          {customers.map((c) => {
            const type = customerTypes.find((t) => t.id === c.customer_type_id);
            const agg = aggregates[c.id];
            return (
              <button
                key={c.id}
                onClick={() => setDetailTarget(c)}
                className="w-full text-left bg-[#FBFAF4] p-3 rounded-xl border border-[#DBD5C1] shadow-xs flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[#26302B] flex items-center gap-1.5 flex-wrap">
                    {c.name}
                    {type && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#E8EFEA] text-[#2B4739]">
                        {type.name} -{type.discount_percent}%
                      </span>
                    )}
                    {c.is_watchlisted && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#FAF0EE] text-[#A8412E] flex items-center gap-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" /> Waspada
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[#6E6853]">{c.phone ?? '-'}</p>
                </div>
                <div className="text-right shrink-0 text-xs text-[#6E6853]">
                  <p>{agg ? `${agg.jumlahSewaTahunIni} sewa tahun ini` : '...'}</p>
                  {isOwner && agg && <p className="font-semibold text-[#26302B]">{formatIDR(agg.totalBelanja)}</p>}
                  {agg?.terakhirSewa && <p>Terakhir: {formatDateIndo(agg.terakhirSewa, false)}</p>}
                </div>
              </button>
            );
          })}
          {customers.length === 0 && <p className="text-sm text-[#6E6853] italic">Belum ada pelanggan.</p>}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-2 rounded-xl bg-white border border-[#DBD5C1] text-sm font-semibold text-[#2B4739]"
            >
              {loadingMore ? 'Memuat...' : 'Muat lebih banyak'}
            </button>
          )}
        </div>
      )}

      {detailTarget && (
        <CustomerDetailModal
          customer={detailTarget}
          customerTypes={customerTypes}
          isOwner={isOwner}
          businessName={businessName}
          businessAddress={businessAddress}
          businessLogoUrl={businessLogoUrl}
          onClose={() => setDetailTarget(null)}
          onSaved={updateCustomer}
        />
      )}
    </div>
  );
}
