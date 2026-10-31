import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Store, CheckCircle2, ExternalLink, Copy, Check, Sparkles, Loader2, XCircle, CreditCard, AlertTriangle } from 'lucide-react';
import { usePublicPage } from '../hooks/usePublicPage';
import type { PublicPageInput, DpMode, PaymentChangeLog } from '../hooks/usePublicPage';
import { useRegencies } from '../hooks/useRegencies';
import { RegencySelect } from './RegencySelect';
import { slugify, formatDateTimeIndo } from '../utils/formatters';
import { API_BASE_URL } from '../lib/api';
import { apiFetch } from '../lib/api';
import { resizeImageToDataUrl } from '../utils/imageResize';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// VITE_TOKO_PUBLIC_BASE_URL = domain publik Etalase Online kalau custom
// domain toko.sewalog.com sudah disambungkan (lihat backend/.env.example,
// TOKO_PUBLIC_HOST — dua env var ini HARUS konsisten, satu dipakai backend
// buat routing+OG tags, satu dipakai di sini cuma buat menampilkan link
// yang benar ke vendor). Kalau belum di-set (dev lokal), fallback ke
// {API_BASE_URL}/toko — cocok dengan jalur /toko/:slug yang selalu aktif
// di backend apapun konfigurasinya.
const TOKO_BASE_URL = import.meta.env.VITE_TOKO_PUBLIC_BASE_URL ?? `${API_BASE_URL}/toko`;

export function EtalaseOnlineScreen({
  session,
  businessId,
  businessName,
  businessPhone,
  businessAddress,
}: {
  session: Session;
  businessId: string;
  businessName: string;
  businessPhone: string | null;
  businessAddress: string | null;
}) {
  const { page, loading, savePublicPage, checkSlugAvailable, fetchLatestPaymentChange } = usePublicPage(businessId);
  const { provinces, regencies } = useRegencies();

  const [published, setPublished] = useState(false);
  const [slug, setSlug] = useState('');
  // Rencana tahap 4 — kartu "Pesanan Online" (2.4/2.8/2.8b).
  const [acceptOnlineOrders, setAcceptOnlineOrders] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState('');
  const [payTransferEnabled, setPayTransferEnabled] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountHolder, setBankAccountHolder] = useState('');
  const [payQrisEnabled, setPayQrisEnabled] = useState(false);
  const [qrisImageUrl, setQrisImageUrl] = useState('');
  const [uploadingQris, setUploadingQris] = useState(false);
  const [payCashEnabled, setPayCashEnabled] = useState(false);
  const [dpMode, setDpMode] = useState<DpMode>('none');
  const [dpValue, setDpValue] = useState('');
  const [lastPaymentChange, setLastPaymentChange] = useState<PaymentChangeLog | null>(null);
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const slugDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slugCheckSeq = useRef(0);
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [regencyId, setRegencyId] = useState('');
  const [operatingHours, setOperatingHours] = useState('');
  const [publicPhone, setPublicPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sinkron field dari data tersimpan begitu selesai dimuat — kalau belum
  // pernah disimpan sama sekali (page === null), pre-isi slug dari nama
  // usaha, dan alamat/nomor WA publik dari Info Usaha, supaya vendor tidak
  // mulai dari form kosong sama sekali (lihat poin 2 prompt: "minta vendor
  // isi field yang belum ada kalau kosong"). Sama seperti nomor WA publik:
  // ini cuma DEFAULT awal, sekali disimpan (bahkan sama persis nilainya)
  // field ini jadi independen dari Info Usaha — ubah Info Usaha sesudahnya
  // TIDAK ikut mengubah Etalase Online punya sendiri.
  useEffect(() => {
    if (loading) return;
    if (page) {
      setPublished(page.published);
      setSlug(page.slug ?? slugify(businessName));
      setDescription(page.description ?? '');
      setAddress(page.address ?? businessAddress ?? '');
      setRegencyId(page.regency_id ?? '');
      setOperatingHours(page.operating_hours ?? '');
      setPublicPhone(page.public_phone ?? businessPhone ?? '');
      setAcceptOnlineOrders(page.accept_online_orders);
      setConfirmationMessage(page.confirmation_message ?? '');
      setPayTransferEnabled(page.pay_transfer_enabled);
      setBankName(page.bank_name ?? '');
      setBankAccountNumber(page.bank_account_number ?? '');
      setBankAccountHolder(page.bank_account_holder ?? '');
      setPayQrisEnabled(page.pay_qris_enabled);
      setQrisImageUrl(page.qris_image_url ?? '');
      setPayCashEnabled(page.pay_cash_enabled);
      setDpMode(page.dp_mode);
      setDpValue(page.dp_value != null ? String(page.dp_value) : '');
    } else {
      setSlug(slugify(businessName));
      setAddress(businessAddress ?? '');
      setPublicPhone(businessPhone ?? '');
    }
    setSlugStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, page]);

  const publicUrl = page?.published && page.slug ? `${TOKO_BASE_URL}/${page.slug}` : null;

  // Review -c1 (tahap 4, poin 5) — dimuat sekali terpisah dari page (bukan
  // ikut refresh tiap render form) karena murni informasional, tidak perlu
  // sinkron ke state form apa pun.
  useEffect(() => {
    fetchLatestPaymentChange().then(setLastPaymentChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const paymentChangedRecently =
    lastPaymentChange && Date.now() - new Date(lastPaymentChange.created_at).getTime() < 7 * 24 * 60 * 60 * 1000;

  async function handleUploadQris(file: File) {
    setUploadingQris(true);
    setError(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 800);
      const body = await apiFetch<{ url: string }>(session, '/api/uploads/qris-image', {
        method: 'POST',
        body: JSON.stringify({ businessId, image: dataUrl }),
      });
      setQrisImageUrl(body.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah gambar QRIS.');
    } finally {
      setUploadingQris(false);
    }
  }

  const hasAnyPaymentMethod = payTransferEnabled || payQrisEnabled || payCashEnabled;
  // Review -c1 (tahap 4, poin 6): validasi klien HARUS sama dengan check
  // constraint DB (dp_value_matches_mode, migration 037) — persen 1-100,
  // nominal > 0 — supaya error ketahuan di form, bukan pesan Postgres
  // mentah dari savePublicPage() kalau lolos ke sana.
  function dpValidationError(): string | null {
    if (dpMode === 'percent') {
      const n = Number(dpValue);
      if (!dpValue || !Number.isFinite(n) || n < 1 || n > 100) return 'Persen DP harus antara 1-100.';
    } else if (dpMode === 'fixed') {
      const n = Number(dpValue);
      if (!dpValue || !Number.isFinite(n) || n <= 0) return 'Nominal DP harus lebih dari 0.';
    }
    return null;
  }

  // Debounced (300ms, sama seperti pola pencarian pelanggan di
  // NewBookingModal.tsx) — bukan validasi utama (unique constraint di DB +
  // savePublicPage() tetap penjaga sebenarnya, lihat komentar di
  // usePublicPage.ts), cuma feedback lebih awal sebelum Simpan.
  function queueSlugCheck(rawSlug: string) {
    if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current);

    const candidate = slugify(rawSlug.trim());
    // Slug kosong, atau sama persis dengan yang sudah tersimpan buat
    // business ini sendiri — tidak perlu dicek, jelas "tersedia" ke
    // dirinya sendiri.
    if (!candidate || candidate === page?.slug) {
      setSlugStatus('idle');
      return;
    }

    setSlugStatus('checking');
    const seq = ++slugCheckSeq.current;
    slugDebounceRef.current = setTimeout(async () => {
      const { available, error: checkError } = await checkSlugAvailable(candidate);
      if (seq !== slugCheckSeq.current) return; // ada input lebih baru, abaikan hasil basi ini
      if (checkError || available === null) {
        setSlugStatus('idle');
        return;
      }
      setSlugStatus(available ? 'available' : 'taken');
    }, 300);
  }

  useEffect(() => {
    return () => {
      if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current);
    };
  }, []);

  async function handleCopy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Gagal menyalin link. Salin manual dari kotak di atas.');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const cleanSlug = slugify(slug.trim());
    if (published && !cleanSlug) {
      setError('Slug wajib diisi untuk mengaktifkan Etalase Online.');
      return;
    }
    if (published && !SLUG_PATTERN.test(cleanSlug)) {
      setError('Slug cuma boleh huruf kecil, angka, dan tanda hubung (mis. "jawa-timur-outdoor").');
      return;
    }

    // Review -c1 (tahap 4, poin 6): toggle "Terima pesanan online" cuma
    // boleh ON kalau Etalase aktif DAN minimal satu cara bayar aktif —
    // ditegakkan di sini juga (bukan cuma disabled di UI), untuk kasus
    // user sempat centang transfer/qris/cash lalu matikan lagi semua
    // sebelum Simpan sambil toggle utama masih ON dari render sebelumnya.
    if (acceptOnlineOrders && !published) {
      setError('Aktifkan Etalase Online dulu sebelum menyalakan Pesanan Online.');
      return;
    }
    if (acceptOnlineOrders && !hasAnyPaymentMethod) {
      setError('Pilih minimal satu cara bayar sebelum menyalakan Pesanan Online.');
      return;
    }
    if (payTransferEnabled && !bankAccountHolder.trim()) {
      setError('Nama pemilik rekening wajib diisi kalau Transfer Bank diaktifkan.');
      return;
    }
    const dpError = dpValidationError();
    if (dpError) {
      setError(dpError);
      return;
    }

    const input: PublicPageInput = {
      published,
      slug: cleanSlug,
      description: description.trim() || null,
      address: address.trim() || null,
      regency_id: regencyId || null,
      operating_hours: operatingHours.trim() || null,
      public_phone: publicPhone.trim() || null,
      accept_online_orders: acceptOnlineOrders,
      confirmation_message: confirmationMessage.trim() || null,
      pay_transfer_enabled: payTransferEnabled,
      bank_name: payTransferEnabled ? bankName.trim() || null : null,
      bank_account_number: payTransferEnabled ? bankAccountNumber.trim() || null : null,
      bank_account_holder: payTransferEnabled ? bankAccountHolder.trim() || null : null,
      pay_qris_enabled: payQrisEnabled,
      qris_image_url: payQrisEnabled ? qrisImageUrl || null : null,
      pay_cash_enabled: payCashEnabled,
      dp_mode: dpMode,
      dp_value: dpMode === 'none' ? null : Number(dpValue),
    };

    setSubmitting(true);
    const { error: saveError } = await savePublicPage(input);
    setSubmitting(false);

    if (saveError) {
      setError(saveError);
      return;
    }
    setSaved(true);
    fetchLatestPaymentChange().then(setLastPaymentChange);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <p className="text-sm text-[#6E6853]">Memuat...</p>;

  return (
    <form onSubmit={handleSubmit} className="max-w-xl mx-auto space-y-4">
      <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
        <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
          <Store className="w-5 h-5 text-[#2B4739]" />
          <span>Etalase Online</span>
        </h2>
        <p className="text-sm text-[#6E6853] leading-relaxed">
          Halaman publik read-only berisi katalog alat &amp; kontak usahamu — bisa dilihat siapa saja lewat link,
          tanpa perlu login. Transaksi tetap manual lewat WhatsApp, <strong>bukan toko online/checkout</strong>{' '}
          (itu tab "Toko Online" terpisah, masih rencana masa depan yang belum dibangun).
        </p>

        <div className="space-y-3 pt-2 border-t border-[#E6E1D2]">
          <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#F1EEE2] border border-[#DBD5C1] cursor-pointer">
            <span className="text-sm font-semibold text-[#26302B]">Aktifkan Etalase Online</span>
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              className="w-5 h-5 accent-[#2B4739]"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Slug (bagian akhir link)
            <div className="flex gap-2">
              <input
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  queueSlugCheck(e.target.value);
                }}
                placeholder="jawa-timur-outdoor"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
              />
              <button
                type="button"
                onClick={() => {
                  const auto = slugify(businessName);
                  setSlug(auto);
                  queueSlugCheck(auto);
                }}
                title="Isi otomatis dari nama usaha"
                className="shrink-0 px-2.5 rounded-lg bg-white border border-[#DBD5C1] text-[#2B4739] hover:bg-[#E8EFEA] transition"
              >
                <Sparkles className="w-4 h-4" />
              </button>
            </div>
            <span className="text-[11px] text-[#6E6853]">Link jadinya: {TOKO_BASE_URL}/{slugify(slug) || '...'}</span>
            {slugStatus === 'checking' && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#6E6853]">
                <Loader2 className="w-3 h-3 animate-spin" /> Mengecek ketersediaan slug...
              </span>
            )}
            {slugStatus === 'available' && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#2B4739]">
                <Check className="w-3 h-3" /> Slug tersedia.
              </span>
            )}
            {slugStatus === 'taken' && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#A8412E]">
                <XCircle className="w-3 h-3" /> Slug ini sudah dipakai usaha lain, coba yang lain.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Deskripsi singkat
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Rental alat camping & outdoor terlengkap di Malang, siap sewa harian."
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>

          <RegencySelect provinces={provinces} regencies={regencies} value={regencyId} onChange={setRegencyId} />

          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Jam operasional
            <textarea
              value={operatingHours}
              onChange={(e) => setOperatingHours(e.target.value)}
              rows={3}
              placeholder={'SENIN: 12.00–22.00 WIB\nSELASA-SABTU: 09.00–22.00 WIB\nMINGGU: 12.00–22.00 WIB'}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739] font-mono text-xs"
            />
            <span className="text-[11px] text-[#6E6853]">
              Bebas format — satu baris ringkas ("Setiap hari 08.00–17.00") atau dipecah per hari kalau jamnya
              beda-beda, seperti contoh di atas. Baris baru ikut tampil apa adanya di halaman publik.
            </span>
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Alamat
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
            <span className="text-[11px] text-[#6E6853]">
              Default terisi dari Info Usaha, tapi boleh diubah beda — dilihat siapa saja lewat halaman publik.
            </span>
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            No. WhatsApp publik
            <input
              type="tel"
              value={publicPhone}
              onChange={(e) => setPublicPhone(e.target.value)}
              placeholder="08xxxxxxxxxx"
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
            <span className="text-[11px] text-[#6E6853]">
              Ditampilkan sebagai tombol "Hubungi via WhatsApp" di halaman publik. Boleh beda dari nomor di Info Usaha.
            </span>
          </label>
        </div>
      </div>

      {/* Rencana tahap 4, 2.4/2.8/2.8b — kartu baru DI BAWAH kartu
          "Aktifkan Etalase Online" di atas (bukan digabung jadi satu),
          tapi tetap satu <form>/satu tombol Simpan yang sama (lihat
          komentar di atas form) supaya tidak ada dua state "tersimpan"
          terpisah yang membingungkan. */}
      <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
        <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-[#2B4739]" />
          <span>Pesanan Online</span>
        </h2>
        <p className="text-sm text-[#6E6853] leading-relaxed">
          Pelanggan bisa kirim formulir pesanan langsung dari Etalase — BUKAN checkout/pembayaran online, pesanan
          baru jadi transaksi sungguhan setelah kamu Konfirmasi lewat Catat Transaksi biasa (lihat tab Transaksi
          Aktif, bagian "Pesanan masuk").
        </p>

        {paymentChangedRecently && lastPaymentChange && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-[#F9EFE7] border border-[#A65C2A]/40">
            <AlertTriangle className="w-4 h-4 text-[#A65C2A] shrink-0 mt-0.5" />
            <p className="text-xs text-[#A65C2A]">
              Info pembayaran baru diubah {formatDateTimeIndo(lastPaymentChange.created_at)}
              {lastPaymentChange.changed_by_email ? ` oleh ${lastPaymentChange.changed_by_email}` : ''}. Kalau ini
              bukan kamu, segera periksa &amp; ganti password.
            </p>
          </div>
        )}

        <label
          className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer ${
            published && hasAnyPaymentMethod ? 'bg-[#F1EEE2] border-[#DBD5C1]' : 'bg-[#F1EEE2]/50 border-[#DBD5C1] opacity-80'
          }`}
        >
          <div>
            <span className="text-sm font-semibold text-[#26302B]">Terima pesanan online</span>
            {!published && <p className="text-[11px] text-[#A65C2A] font-semibold mt-0.5">Aktifkan Etalase dulu.</p>}
            {published && !hasAnyPaymentMethod && (
              <p className="text-[11px] text-[#A65C2A] font-semibold mt-0.5">Pilih minimal satu cara bayar dulu.</p>
            )}
          </div>
          <input
            type="checkbox"
            checked={acceptOnlineOrders}
            disabled={!published || !hasAnyPaymentMethod}
            onChange={(e) => setAcceptOnlineOrders(e.target.checked)}
            className="w-5 h-5 accent-[#2B4739] disabled:opacity-50"
          />
        </label>

        {
          // Review -c1 (tahap 4, poin 6) bug ditemukan saat verifikasi:
          // field cara bayar/DP SEBELUMNYA cuma muncul kalau
          // acceptOnlineOrders sudah true — padahal toggle itu sendiri
          // cuma bisa dinyalakan kalau SUDAH ada cara bayar aktif (lihat
          // disabled di atas). Itu kebuntuan ayam-telur: vendor tidak
          // pernah bisa mengisi cara bayar sama sekali. Field-field ini
          // SELALU ditampilkan (supaya bisa diisi dulu SEBELUM toggle
          // dinyalakan) — bukan dikondisikan ke acceptOnlineOrders.
        }
        <>
            <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
              Pesan konfirmasi custom (opsional)
              <textarea
                value={confirmationMessage}
                onChange={(e) => setConfirmationMessage(e.target.value)}
                rows={2}
                placeholder="Terima kasih! Kami akan hubungi dalam 1x24 jam."
                className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
              />
            </label>

            <div className="space-y-2 pt-1 border-t border-[#E6E1D2]">
              <p className="text-sm font-semibold text-[#26302B]">Cara bayar yang diterima</p>

              <label className="flex items-center gap-2 text-sm text-[#26302B]">
                <input
                  type="checkbox"
                  checked={payTransferEnabled}
                  onChange={(e) => setPayTransferEnabled(e.target.checked)}
                  className="w-4 h-4 accent-[#2B4739]"
                />
                Transfer Bank
              </label>
              {payTransferEnabled && (
                <div className="pl-6 space-y-2">
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="Nama bank"
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-sm focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                  />
                  <input
                    type="text"
                    value={bankAccountNumber}
                    onChange={(e) => setBankAccountNumber(e.target.value)}
                    placeholder="Nomor rekening"
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-sm focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                  />
                  <input
                    type="text"
                    value={bankAccountHolder}
                    onChange={(e) => setBankAccountHolder(e.target.value)}
                    placeholder="Nama pemilik rekening (wajib)"
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-sm focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                  />
                </div>
              )}

              <label className="flex items-center gap-2 text-sm text-[#26302B]">
                <input
                  type="checkbox"
                  checked={payQrisEnabled}
                  onChange={(e) => setPayQrisEnabled(e.target.checked)}
                  className="w-4 h-4 accent-[#2B4739]"
                />
                QRIS
              </label>
              {payQrisEnabled && (
                <div className="pl-6 space-y-2">
                  {qrisImageUrl && (
                    <img src={qrisImageUrl} alt="QRIS" className="w-32 h-32 object-contain rounded-lg border border-[#DBD5C1] bg-white" />
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploadingQris}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadQris(file);
                    }}
                    className="text-xs text-[#6E6853]"
                  />
                  {uploadingQris && <p className="text-xs text-[#6E6853]">Mengunggah...</p>}
                </div>
              )}

              <label className="flex items-center gap-2 text-sm text-[#26302B]">
                <input
                  type="checkbox"
                  checked={payCashEnabled}
                  onChange={(e) => setPayCashEnabled(e.target.checked)}
                  className="w-4 h-4 accent-[#2B4739]"
                />
                Tunai saat ambil
              </label>
            </div>

            <div className="space-y-2 pt-1 border-t border-[#E6E1D2]">
              <p className="text-sm font-semibold text-[#26302B]">DP (uang muka)</p>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 text-sm text-[#26302B]">
                  <input type="radio" checked={dpMode === 'none'} onChange={() => setDpMode('none')} className="accent-[#2B4739]" />
                  Tidak wajib
                </label>
                <label className="flex items-center gap-1.5 text-sm text-[#26302B]">
                  <input type="radio" checked={dpMode === 'percent'} onChange={() => setDpMode('percent')} className="accent-[#2B4739]" />
                  Persen
                </label>
                <label className="flex items-center gap-1.5 text-sm text-[#26302B]">
                  <input type="radio" checked={dpMode === 'fixed'} onChange={() => setDpMode('fixed')} className="accent-[#2B4739]" />
                  Nominal
                </label>
              </div>
              {dpMode !== 'none' && (
                <input
                  type="number"
                  value={dpValue}
                  onChange={(e) => setDpValue(e.target.value)}
                  placeholder={dpMode === 'percent' ? 'mis. 50 (%)' : 'mis. 50000 (Rp)'}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-sm focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
              )}
            </div>
        </>
      </div>

      {error && <p className="text-xs font-semibold text-[#A8412E]">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-sm shadow-sm transition disabled:opacity-60"
        >
          <CheckCircle2 className="w-4 h-4" />
          {submitting ? 'Menyimpan...' : 'Simpan'}
        </button>
        {saved && <span className="text-xs font-semibold text-[#2B4739]">Tersimpan.</span>}
      </div>

      {publicUrl && (
        <div className="bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-2">
          <h3 className="text-sm font-bold text-[#26302B]">Link Etalase Online-mu</h3>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={publicUrl}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-[#26302B] text-xs font-mono"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 p-2.5 rounded-lg bg-white border border-[#DBD5C1] text-[#2B4739] hover:bg-[#E8EFEA] transition"
              title="Salin link"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-2.5 rounded-lg bg-white border border-[#DBD5C1] text-[#2B4739] hover:bg-[#E8EFEA] transition"
              title="Buka halaman publik"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
          <p className="text-[11px] text-[#6E6853]">
            Bagikan link ini ke calon penyewa lewat WhatsApp/Instagram bio — bisa dibuka siapa saja tanpa login.
          </p>
        </div>
      )}
    </form>
  );
}
