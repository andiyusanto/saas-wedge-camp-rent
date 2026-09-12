import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Store, CheckCircle2, ExternalLink, Copy, Check, Sparkles, Loader2, XCircle } from 'lucide-react';
import { usePublicPage } from '../hooks/usePublicPage';
import type { PublicPageInput } from '../hooks/usePublicPage';
import { slugify } from '../utils/formatters';
import { API_BASE_URL } from '../lib/api';

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
  businessId,
  businessName,
  businessPhone,
  businessAddress,
}: {
  businessId: string;
  businessName: string;
  businessPhone: string | null;
  businessAddress: string | null;
}) {
  const { page, regencies, loading, savePublicPage, checkSlugAvailable } = usePublicPage(businessId);

  const [published, setPublished] = useState(false);
  const [slug, setSlug] = useState('');
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
    } else {
      setSlug(slugify(businessName));
      setAddress(businessAddress ?? '');
      setPublicPhone(businessPhone ?? '');
    }
    setSlugStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, page]);

  const publicUrl = page?.published && page.slug ? `${TOKO_BASE_URL}/${page.slug}` : null;

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

    const input: PublicPageInput = {
      published,
      slug: cleanSlug,
      description: description.trim() || null,
      address: address.trim() || null,
      regency_id: regencyId || null,
      operating_hours: operatingHours.trim() || null,
      public_phone: publicPhone.trim() || null,
    };

    setSubmitting(true);
    const { error: saveError } = await savePublicPage(input);
    setSubmitting(false);

    if (saveError) {
      setError(saveError);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <p className="text-sm text-[#6E6853]">Memuat...</p>;

  return (
    <div className="max-w-xl mx-auto space-y-4">
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

        <form onSubmit={handleSubmit} className="space-y-3 pt-2 border-t border-[#E6E1D2]">
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

          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Kota
            <select
              value={regencyId}
              onChange={(e) => setRegencyId(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            >
              <option value="">— Pilih kota —</option>
              {regencies.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

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

          {error && <p className="text-xs font-semibold text-[#A8412E]">{error}</p>}

          <div className="flex items-center gap-3 pt-1 border-t border-[#E6E1D2]">
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
        </form>
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
    </div>
  );
}
