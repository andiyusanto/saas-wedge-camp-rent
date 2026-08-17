import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { X, Calendar, Plus, CheckCircle2, User, ShieldCheck } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import { useItems } from '../hooks/useItems';
import type { Business } from '../hooks/useBusiness';
import { apiFetch } from '../lib/api';
import {
  formatIDR,
  rentalDays,
  todayStr,
  generateWhatsAppReceipt,
  getWhatsAppShareUrl,
  depositLabel,
  computeItemRentalPrice,
} from '../utils/formatters';

type DepositType = '' | 'ktp' | 'sim' | 'stnk' | 'paspor' | 'uang' | 'lainnya';

export function NewBookingModal({
  isOpen,
  onClose,
  session,
  business,
  preselectedItemId,
  preselectedStartDate,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  session: Session;
  business: Business;
  preselectedItemId?: string | null;
  preselectedStartDate?: string | null;
  onSaved: () => void;
}) {
  const { items } = useItems(business.id);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [depositType, setDepositType] = useState<DepositType>('ktp');
  const [depositNote, setDepositNote] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [dpPaid, setDpPaid] = useState('0');
  const [autoOpenWA, setAutoOpenWA] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStartDate(preselectedStartDate || todayStr());
    setEndDate(preselectedStartDate || todayStr());
    setQuantities(preselectedItemId ? { [preselectedItemId]: 1 } : {});
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setDepositType('ktp');
    setDepositNote('');
    setDepositAmount('');
    setDpPaid('0');
    setError(null);
  }, [isOpen, preselectedItemId, preselectedStartDate]);

  const days = useMemo(() => rentalDays(startDate, endDate), [startDate, endDate]);

  const selectedEntries = useMemo(
    () => Object.entries(quantities).filter(([, qty]) => qty > 0),
    [quantities],
  );

  const totalPrice = selectedEntries.reduce((sum, [itemId, qty]) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return sum;
    return sum + qty * computeItemRentalPrice(item.price_per_day, item.discount_min_days, item.discounted_price_per_day, days);
  }, 0);

  const remainingPayment = Math.max(0, totalPrice - (Number(dpPaid) || 0));

  if (!isOpen) return null;

  function toggleItem(itemId: string, checked: boolean) {
    setQuantities((prev) => ({ ...prev, [itemId]: checked ? 1 : 0 }));
  }

  function setQuantity(itemId: string, qty: number, max: number) {
    setQuantities((prev) => ({ ...prev, [itemId]: Math.max(0, Math.min(qty, max)) }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const selectedItems = selectedEntries.map(([item_id, quantity]) => ({ item_id, quantity }));
    if (selectedItems.length === 0) {
      setError('Pilih minimal satu alat.');
      return;
    }

    setSubmitting(true);

    let body: { booking_number: string; status: string };
    try {
      body = await apiFetch(session, '/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          businessId: business.id,
          customer: { name: customerName, phone: customerPhone || null, address: customerAddress || null },
          start_date: startDate,
          end_date: endDate,
          items: selectedItems,
          deposit: depositType ? { type: depositType, amount: depositAmount, note: depositNote || null } : null,
          total_price: totalPrice,
          dp_paid: Number(dpPaid) || 0,
        }),
      });
    } catch (err) {
      setSubmitting(false);
      setError((err as Error).message);
      return;
    }
    setSubmitting(false);

    // Booking sudah tersimpan di server pada titik ini — kegagalan bikin
    // draft struk WA (mis. katalog lokal belum sempat refresh) tidak boleh
    // menahan modal ini tertutup atau bikin layar nyangkut.
    if (autoOpenWA && customerPhone) {
      try {
        const receiptItems = selectedEntries
          .map(([itemId, qty]) => {
            const item = items.find((i) => i.id === itemId);
            return item ? { name: item.name, quantity: qty, price_per_day: item.price_per_day } : null;
          })
          .filter((i): i is { name: string; quantity: number; price_per_day: number } => i !== null);

        const receiptText = generateWhatsAppReceipt({
          bookingNumber: body.booking_number,
          customerName,
          customerPhone,
          startDate,
          endDate,
          items: receiptItems,
          totalPrice,
          dpPaid: Number(dpPaid) || 0,
          depositType: depositType || null,
          depositNote: depositNote || null,
          depositStatus: 'ditahan',
          status: body.status,
          fines: [],
          businessName: business.name,
        });
        window.open(getWhatsAppShareUrl(customerPhone, receiptText), '_blank');
      } catch {
        // struk WA gagal dibuat, transaksi tetap tersimpan — lanjutkan saja.
      }
    }

    onSaved();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-2xl rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <Plus className="w-5 h-5 text-[#A65C2A]" />
            <h2 className="text-lg font-bold">Catat Transaksi Sewa Baru</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-5 text-xs sm:text-sm">
          <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B] flex items-center gap-2">
              <User className="w-4 h-4 text-[#2B4739]" />
              <span>1. Data Penyewa</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Nama Penyewa *</label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">No. WhatsApp *</label>
                <input
                  type="tel"
                  required
                  placeholder="081234567890"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-[#26302B] mb-1">Alamat Singkat / Wilayah</label>
                <input
                  type="text"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B] flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#2B4739]" />
              <span>2. Periode Sewa</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Tanggal Ambil *</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (e.target.value > endDate) setEndDate(e.target.value);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-semibold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Tanggal Kembali *</label>
                <input
                  type="date"
                  required
                  min={startDate}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-semibold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-[#E8EFEA] border border-[#2B4739]/30 text-[#2B4739] text-xs font-semibold flex items-center justify-between">
              <span>Durasi Sewa Terhitung:</span>
              <span className="text-sm font-extrabold">{days} Hari</span>
            </div>
            {startDate > todayStr() && (
              <p className="text-[11px] text-[#A65C2A] font-medium">
                Tanggal ambil di masa depan → transaksi akan berstatus "Siap Diambil" sampai kamu tandai barang
                sudah diambil.
              </p>
            )}
          </div>

          <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B]">3. Pilih Peralatan ({selectedEntries.length} Jenis)</h3>

            {items.length === 0 ? (
              <p className="text-center text-[#6E6853] py-3 italic bg-white/50 rounded-lg border border-dashed border-[#DBD5C1]">
                Belum ada alat di katalog. Tambahkan dulu di tab "Katalog & Stok Alat".
              </p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {items.map((item) => {
                  const qty = quantities[item.id] ?? 0;
                  const checked = qty > 0;
                  const subtotal = qty * computeItemRentalPrice(item.price_per_day, item.discount_min_days, item.discounted_price_per_day, days);

                  return (
                    <div key={item.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-[#DBD5C1]">
                      <label className="flex-1 min-w-0 pr-2 flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => toggleItem(item.id, e.target.checked)}
                          className="w-4 h-4 accent-[#2B4739] shrink-0"
                        />
                        <span className="min-w-0">
                          <p className="font-bold text-[#26302B] truncate">{item.name}</p>
                          <p className="text-[11px] text-[#6E6853]">
                            {formatIDR(item.price_per_day)}/hr
                            {checked && (
                              <>
                                {' '}× {days} hr = <strong className="text-[#2B4739]">{formatIDR(subtotal)}</strong>
                              </>
                            )}
                          </p>
                        </span>
                      </label>

                      {checked && (
                        <div className="flex items-center gap-1 bg-[#F1EEE2] rounded-lg p-1 border border-[#DBD5C1] shrink-0">
                          <button
                            type="button"
                            onClick={() => setQuantity(item.id, qty - 1, item.total_units)}
                            className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B] transition"
                          >
                            -
                          </button>
                          <span className="w-6 text-center font-bold text-[#26302B] text-xs">{qty}</span>
                          <button
                            type="button"
                            onClick={() => setQuantity(item.id, qty + 1, item.total_units)}
                            disabled={qty >= item.total_units}
                            className="w-6 h-6 rounded bg-white font-bold hover:bg-[#DBD5C1] text-[#26302B] transition disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-[#6E6853]">
              Kapasitas dicek ulang otomatis saat disimpan — kalau ada alat yang sudah kepakai di tanggal itu, akan
              ditolak dengan keterangan sisa stok.
            </p>
          </div>

          <div className="space-y-3 bg-[#F1EEE2] p-4 rounded-xl border border-[#DBD5C1]">
            <h3 className="font-bold text-[#26302B] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#2B4739]" />
              <span>4. Jaminan & Pembayaran</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Jenis Jaminan</label>
                <select
                  value={depositType}
                  onChange={(e) => setDepositType(e.target.value as DepositType)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-semibold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                >
                  <option value="">Tanpa jaminan</option>
                  <option value="ktp">{depositLabel('ktp')}</option>
                  <option value="sim">{depositLabel('sim')}</option>
                  <option value="stnk">{depositLabel('stnk')}</option>
                  <option value="paspor">{depositLabel('paspor')}</option>
                  <option value="uang">{depositLabel('uang')}</option>
                  <option value="lainnya">{depositLabel('lainnya')}</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Catatan Identitas Jaminan</label>
                <input
                  type="text"
                  placeholder={depositType ? `Contoh: ${depositLabel(depositType)} a.n. ${customerName || 'Penyewa'}` : ''}
                  value={depositNote}
                  onChange={(e) => setDepositNote(e.target.value)}
                  disabled={!depositType}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739] disabled:opacity-50"
                />
              </div>

              {depositType === 'uang' && (
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-[#26302B] mb-1">Jumlah Deposit Uang (Rp)</label>
                  <input
                    type="number"
                    min={0}
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                  />
                </div>
              )}

              <div>
                <label className="block font-semibold text-[#26302B] mb-1">Uang Muka (DP)</label>
                <input
                  type="number"
                  min={0}
                  step={5000}
                  value={dpPaid}
                  onChange={(e) => setDpPaid(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#6E6853] mb-1">Sisa Bayar Saat Ambil</label>
                <div className="px-3 py-2 rounded-lg bg-[#FAF0EE] border border-[#A8412E]/30 text-[#A8412E] font-extrabold text-sm">
                  {formatIDR(remainingPayment)}
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#2B4739] text-[#FBFAF4] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#DBD5C1]">Total Tagihan Sewa</p>
                <p className="text-lg font-extrabold">{formatIDR(totalPrice)}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 pt-1">
            <input
              type="checkbox"
              id="waCheck"
              checked={autoOpenWA}
              onChange={(e) => setAutoOpenWA(e.target.checked)}
              className="w-4 h-4 accent-[#2B4739] rounded"
            />
            <label htmlFor="waCheck" className="text-xs font-semibold text-[#26302B] cursor-pointer">
              Buka otomatis chat WhatsApp & kirim Nota Sewa Digital setelah disimpan
            </label>
          </div>

          {error && (
            <p className="text-xs font-semibold text-[#A8412E] bg-[#FAF0EE] border border-[#A8412E]/30 rounded-lg p-2.5">
              {error}
            </p>
          )}

          <div className="pt-3 border-t border-[#DBD5C1] flex items-center justify-end space-x-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] font-semibold text-xs transition"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs shadow-md transition flex items-center space-x-2 active:scale-95 disabled:opacity-60"
            >
              <CheckCircle2 className="w-4 h-4 text-[#A65C2A]" />
              <span>{submitting ? 'Menyimpan...' : 'Simpan & Terbitkan Nota'}</span>
            </button>
          </div>
        </form>
      </ModalPanel>
    </ModalBackdrop>
  );
}
