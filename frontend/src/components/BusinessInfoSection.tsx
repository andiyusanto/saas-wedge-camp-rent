import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Store, CheckCircle2, Upload, X } from 'lucide-react';
import type { Business, BusinessUpdateInput } from '../hooks/useBusiness';
import type { DurationLabelStyle, RentalDayMode } from '../utils/formatters';
import { useRegencies } from '../hooks/useRegencies';
import { RegencySelect } from './RegencySelect';
import { TIMEZONE_OPTIONS, suggestedTimezoneForProvince, type BusinessTimezone } from '../hooks/useRegencies';
import { apiFetch } from '../lib/api';
import { resizeImageToDataUrl } from '../utils/imageResize';
import { usePrinterSettings } from '../hooks/usePrinterSettings';
import { PrinterSetupWizard } from './PrinterSetupWizard';

export function BusinessInfoSection({
  session,
  businessId,
  business,
  ownerEmail,
  onSave,
}: {
  session: Session;
  businessId: string;
  business: Business;
  ownerEmail: string | null;
  onSave: (input: BusinessUpdateInput) => Promise<{ error: string | null }>;
}) {
  const { settings: printerSettings, saveSettings: savePrinterSettings } = usePrinterSettings();
  const [printerWizardOpen, setPrinterWizardOpen] = useState(false);
  const [name, setName] = useState(business.name);
  const [ownerName, setOwnerName] = useState(business.owner_name ?? '');
  const [phone, setPhone] = useState(business.phone ?? '');
  const [address, setAddress] = useState(business.address ?? '');
  const [regencyId, setRegencyId] = useState(business.regency_id ?? '');
  const [districtId, setDistrictId] = useState(business.district_id ?? '');
  const { provinces, regencies } = useRegencies();
  const selectedProvinceName = provinces.find(
    (p) => p.id === regencies.find((r) => r.id === regencyId)?.province_id,
  )?.name;
  const suggestedTimezone = suggestedTimezoneForProvince(selectedProvinceName);
  const [toleranceHours, setToleranceHours] = useState(String(business.late_tolerance_hours));
  const [rentalDayMode, setRentalDayMode] = useState<RentalDayMode>(business.rental_day_mode);
  // Label lama sewa "2H1M" (migration 072) -- cuma relevan/tampil kalau
  // rentalDayMode === 'per_malam' (lihat JSX di bawah).
  const [durationLabelStyle, setDurationLabelStyle] = useState<Exclude<DurationLabelStyle, null>>(business.duration_label_style);
  const [timezone, setTimezone] = useState<BusinessTimezone>(business.timezone ?? 'Asia/Jakarta');
  const [minRentalDays, setMinRentalDays] = useState(business.min_rental_days != null ? String(business.min_rental_days) : '');
  const [maxRentalDays, setMaxRentalDays] = useState(business.max_rental_days != null ? String(business.max_rental_days) : '');
  const [rescheduleDeadlineDays, setRescheduleDeadlineDays] = useState(
    business.reschedule_deadline_days != null ? String(business.reschedule_deadline_days) : '',
  );
  // Batas jam kembali tetap (migration 062) — '' = "Ikuti jam ambil"
  // (default, null di DB). "00:00" dikunci bareng returnDeadlineNextDay
  // (lihat handler di bawah) -- definisi lengkap di CLAUDE.md bagian 4.
  const [returnDeadlineTime, setReturnDeadlineTime] = useState(business.return_deadline_time ?? '');
  const [returnDeadlineNextDay, setReturnDeadlineNextDay] = useState(business.return_deadline_next_day ?? false);
  // Cara hitung denda telat (migration 063) — review -c1 poin 4: nilai
  // Rp/jam DISIMPAN APA ADANYA di state terpisah, TIDAK direset/dihapus
  // saat owner pindah-pindah mode — cuma DIPAKAI (dikirim ke server dan
  // divalidasi) saat lateFeeMode==='per_jam'. Supaya owner yang sempat
  // coba mode "Per jam" lalu pindah balik tidak kehilangan angka yang
  // sudah diketik kalau mau kembali ke mode itu lagi.
  const [lateFeeMode, setLateFeeMode] = useState(business.late_fee_mode);
  const [lateFeePerHour, setLateFeePerHour] = useState(business.late_fee_per_hour != null ? String(business.late_fee_per_hour) : '');
  const [lateFeePerHourCapEnabled, setLateFeePerHourCapEnabled] = useState(business.late_fee_per_hour_cap_enabled);
  const [logoUrl, setLogoUrl] = useState(business.logo_url ?? '');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Review -c1: begitu vendor GANTI pengaturan ini, wajib ditegaskan
  // bahwa transaksi LAMA tidak ikut berubah (snapshot per-transaksi,
  // migration 049) — supaya tidak ada yang mengira mengubah setting ini
  // akan mengubah ulang nota/denda transaksi yang sudah ada.
  const [rentalDayModeJustChanged, setRentalDayModeJustChanged] = useState(false);

  // business bisa berubah dari luar (refresh setelah tab lain aktif) —
  // sinkronkan field kalau belum ada perubahan yang sedang diketik.
  useEffect(() => {
    setName(business.name);
    setOwnerName(business.owner_name ?? '');
    setPhone(business.phone ?? '');
    setAddress(business.address ?? '');
    setRegencyId(business.regency_id ?? '');
    setDistrictId(business.district_id ?? '');
    setToleranceHours(String(business.late_tolerance_hours));
    setRentalDayMode(business.rental_day_mode);
    setDurationLabelStyle(business.duration_label_style);
    setTimezone(business.timezone ?? 'Asia/Jakarta');
    setMinRentalDays(business.min_rental_days != null ? String(business.min_rental_days) : '');
    setMaxRentalDays(business.max_rental_days != null ? String(business.max_rental_days) : '');
    setRescheduleDeadlineDays(business.reschedule_deadline_days != null ? String(business.reschedule_deadline_days) : '');
    setReturnDeadlineTime(business.return_deadline_time ?? '');
    setReturnDeadlineNextDay(business.return_deadline_next_day ?? false);
    setLateFeeMode(business.late_fee_mode);
    setLateFeePerHour(business.late_fee_per_hour != null ? String(business.late_fee_per_hour) : '');
    setLateFeePerHourCapEnabled(business.late_fee_per_hour_cap_enabled);
    setLogoUrl(business.logo_url ?? '');
  }, [business]);

  // Logo usaha (migration 035) — pola sama seperti upload foto alat di
  // ItemsScreen.tsx, cuma maxDimension lebih kecil (512, bukan 1280) dan
  // quality lebih tinggi (0.9) karena logo biasanya elemen flat/teks,
  // bukan foto — kompresi webp lebih kentara di situ dibanding foto.
  async function handleUploadLogo(file: File) {
    setUploadingLogo(true);
    setError(null);

    try {
      const dataUrl = await resizeImageToDataUrl(file, 512, 0.9);
      const body = await apiFetch<{ url: string }>(session, '/api/uploads/business-logo', {
        method: 'POST',
        body: JSON.stringify({ businessId, image: dataUrl }),
      });
      setLogoUrl(body.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah logo.');
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama usaha wajib diisi.');
      return;
    }
    const minDays = minRentalDays.trim() ? Math.max(1, Number(minRentalDays)) : null;
    const maxDays = maxRentalDays.trim() ? Math.max(1, Number(maxRentalDays)) : null;
    if (minDays != null && maxDays != null && minDays > maxDays) {
      setError('Minimal hari sewa tidak boleh lebih besar dari maksimal.');
      return;
    }
    // Review -c1 poin 3: mode per_jam TANPA nominal tidak boleh tersimpan
    // (ditegakkan juga di DB lewat constraint, ini jaring pengaman form
    // supaya pesan errornya jelas, bukan error constraint mentah).
    if (lateFeeMode === 'per_jam' && !(Number(lateFeePerHour) > 0)) {
      setError('Nominal Rp/jam wajib diisi (lebih dari 0) untuk mode "Per jam".');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSaved(false);

    const { error: saveError } = await onSave({
      name: name.trim(),
      owner_name: ownerName.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      regency_id: regencyId || null,
      district_id: (regencyId && districtId) || null,
      late_tolerance_hours: Math.max(0, Number(toleranceHours) || 0),
      logo_url: logoUrl.trim() || null,
      rental_day_mode: rentalDayMode,
      duration_label_style: durationLabelStyle,
      timezone,
      min_rental_days: minDays,
      max_rental_days: maxDays,
      reschedule_deadline_days: rescheduleDeadlineDays.trim() ? Math.max(0, Number(rescheduleDeadlineDays)) : null,
      return_deadline_time: returnDeadlineTime || null,
      // "00:00" SELALU dianggap hari berikutnya (lihat handler input time
      // di bawah, yang mengunci toggle ini begitu jam = 00:00) -- dikirim
      // apa adanya, backend/computeDueAt juga menegakkan ulang (migration 062).
      return_deadline_next_day: returnDeadlineTime ? returnDeadlineNextDay : false,
      late_fee_mode: lateFeeMode,
      // Review -c1 poin 4: nilai Rp/jam yang sudah diketik TETAP dikirim
      // apa adanya walau mode SAAT INI bukan per_jam (tidak dihapus saat
      // pindah-pindah mode) -- cuma tidak DIPAKAI untuk hitung denda
      // selama mode bukan per_jam (lib/penalty.ts).
      late_fee_per_hour: lateFeePerHour.trim() ? Number(lateFeePerHour) : null,
      late_fee_per_hour_cap_enabled: lateFeePerHourCapEnabled,
    });

    setSubmitting(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    setSaved(true);
    setRentalDayModeJustChanged(rentalDayMode !== business.rental_day_mode);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
      <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
        <Store className="w-5 h-5 text-[#2B4739]" />
        <span>Info Usaha</span>
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm text-[#6E6853] mb-1.5">Logo Usaha</label>
          <div className="flex items-center gap-2">
            {logoUrl && (
              <span className="relative shrink-0">
                <img
                  src={logoUrl}
                  alt="Pratinjau logo"
                  className="h-14 w-14 object-contain rounded-lg border border-[#DBD5C1] bg-white"
                />
                <button
                  type="button"
                  onClick={() => setLogoUrl('')}
                  title="Hapus logo"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#A8412E] text-white flex items-center justify-center shadow-sm"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            <label className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-dashed border-[#DBD5C1] px-3 py-2.5 text-xs font-semibold text-[#6E6853] hover:bg-[#F1EEE2] cursor-pointer transition">
              <Upload className="w-4 h-4" />
              {uploadingLogo ? 'Mengunggah...' : logoUrl ? 'Ganti Logo' : 'Upload Logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={uploadingLogo}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadLogo(file);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
          </div>
          <input
            type="url"
            placeholder="atau tempel URL gambar di sini..."
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className="mt-2 w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-sm"
          />
          <span className="text-[11px] text-[#6E6853] block mt-1">
            Opsional — tampil di Etalase Online, preview link WhatsApp, dan Nota Sewa cetak. Tanpa logo, tampilan
            di tempat-tempat itu seperti sekarang.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Nama usaha *
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Nama pemilik
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            No. telepon
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <RegencySelect provinces={provinces} regencies={regencies} value={regencyId} onChange={setRegencyId} districtValue={districtId} onDistrictChange={setDistrictId} />
          <div className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Email pemilik (akun login)
            <p className="px-3 py-2 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-[#26302B]">
              {ownerEmail ?? '-'}
            </p>
          </div>
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            Toleransi telat (jam)
            <input
              type="number"
              min={0}
              step={1}
              value={toleranceHours}
              onChange={(e) => setToleranceHours(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
          Alamat usaha
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            placeholder="Jl. Contoh No. 1, Kecamatan, Kota"
            className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
          />
          <span className="text-[11px] text-[#6E6853]">
            Ikut tercetak di struk WhatsApp dan Nota Sewa cetak/PDF kalau diisi.
          </span>
        </label>
        <p className="text-[11px] text-[#6E6853]">
          Toleransi telat: berapa jam setelah janji kembali sebelum transaksi dianggap terlambat dan mulai kena denda.
        </p>

        <div className="flex flex-col gap-2 pt-2 border-t border-[#E6E1D2]">
          <p className="text-sm font-semibold text-[#26302B]">Batas Jam Kembali</p>
          <label className="flex items-center gap-2 text-sm text-[#26302B]">
            <input
              type="radio"
              checked={!returnDeadlineTime}
              onChange={() => {
                setReturnDeadlineTime('');
                setReturnDeadlineNextDay(false);
              }}
              className="accent-[#2B4739]"
            />
            Ikuti jam ambil (default — sama seperti sekarang)
          </label>
          <label className="flex items-center gap-2 text-sm text-[#26302B]">
            <input type="radio" checked={!!returnDeadlineTime} onChange={() => setReturnDeadlineTime('22:00')} className="accent-[#2B4739]" />
            Jam tetap
          </label>
          {returnDeadlineTime && (
            <div className="flex flex-wrap items-center gap-3 pl-6">
              <input
                type="time"
                value={returnDeadlineTime}
                onChange={(e) => {
                  const value = e.target.value;
                  setReturnDeadlineTime(value);
                  // "00:00"/"24:00" SELALU berarti tengah malam akhir hari
                  // kembali (migration 062) -- toggle "hari berikutnya"
                  // dikunci tercentang supaya tidak ada state form yang
                  // kelihatan kontradiktif (computeDueAt sendiri tetap
                  // menegakkan ulang ini di backend, jaring pengaman).
                  if (value === '00:00') setReturnDeadlineNextDay(true);
                }}
                className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
              />
              <label className="flex items-center gap-2 text-sm text-[#26302B]">
                <input
                  type="checkbox"
                  checked={returnDeadlineNextDay}
                  disabled={returnDeadlineTime === '00:00'}
                  onChange={(e) => setReturnDeadlineNextDay(e.target.checked)}
                  className="accent-[#2B4739] disabled:opacity-60"
                />
                Hari berikutnya
              </label>
            </div>
          )}
          {returnDeadlineTime === '00:00' && (
            <p className="text-[11px] text-[#6E6853] pl-6">00:00 selalu berarti tengah malam akhir hari kembali (hari berikutnya otomatis aktif).</p>
          )}
          <p className="text-[11px] text-[#6E6853]">
            Jam tetap berlaku untuk transaksi BARU yang dicatat setelah disimpan — transaksi yang sudah ada tidak
            ikut berubah. Toleransi telat di atas tetap berlaku di atas batas ini.
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-[#E6E1D2]">
          <p className="text-sm font-semibold text-[#26302B]">Cara Hitung Denda Telat</p>
          <label className="flex items-center gap-2 text-sm text-[#26302B]">
            <input type="radio" checked={lateFeeMode === 'bertahap_12jam'} onChange={() => setLateFeeMode('bertahap_12jam')} className="accent-[#2B4739]" />
            Bertahap per 12 jam (default — 50% tarif tiap blok 12 jam)
          </label>
          <label className="flex items-center gap-2 text-sm text-[#26302B]">
            <input type="radio" checked={lateFeeMode === 'per_hari_24jam'} onChange={() => setLateFeeMode('per_hari_24jam')} className="accent-[#2B4739]" />
            Per hari penuh (24 jam) — lewat toleransi langsung dihitung 1 hari
          </label>
          <label className="flex items-center gap-2 text-sm text-[#26302B]">
            <input type="radio" checked={lateFeeMode === 'per_jam'} onChange={() => setLateFeeMode('per_jam')} className="accent-[#2B4739]" />
            Per jam (nominal tetap per transaksi)
          </label>
          {lateFeeMode === 'per_jam' && (
            <div className="pl-6 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#6E6853]">Rp</span>
                <input
                  type="number"
                  min={0}
                  value={lateFeePerHour}
                  onChange={(e) => setLateFeePerHour(e.target.value)}
                  placeholder="mis. 10000"
                  className="w-32 px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] font-bold focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
                />
                <span className="text-sm text-[#6E6853]">/jam</span>
              </div>
              <label className="flex items-center gap-2 text-sm text-[#26302B]">
                <input
                  type="checkbox"
                  checked={lateFeePerHourCapEnabled}
                  onChange={(e) => setLateFeePerHourCapEnabled(e.target.checked)}
                  className="accent-[#2B4739]"
                />
                Batasi maksimal setara "Per hari penuh" (disarankan)
              </label>
              <p className="text-[11px] text-[#6E6853]">
                Contoh: telat 30 jam dengan Rp10.000/jam = Rp300.000 mentah — tapi kalau batas aktif dan sewa 2 hari
                Rp30rb/hari, saran denda dipotong jadi Rp60.000 (setara 2 hari penuh), tidak pernah lebih mahal dari
                mode "Per hari penuh".
              </p>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-[#26302B]">
            <input type="radio" checked={lateFeeMode === 'tanpa_denda'} onChange={() => setLateFeeMode('tanpa_denda')} className="accent-[#2B4739]" />
            Tanpa denda otomatis
          </label>
          <p className="text-[11px] text-[#6E6853]">
            Berlaku untuk transaksi BARU yang dicatat setelah disimpan — transaksi yang sudah ada tidak ikut berubah.
            Nominal denda di layar Kembalikan tetap bisa diisi manual di mode apa pun.
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-[#E6E1D2]">
          <p className="text-sm font-semibold text-[#26302B]">Cara Hitung Durasi Sewa</p>
          <label className="flex items-start gap-2 text-sm text-[#26302B]">
            <input
              type="radio"
              checked={rentalDayMode === 'per_malam'}
              onChange={() => setRentalDayMode('per_malam')}
              className="mt-0.5 accent-[#2B4739]"
            />
            <span>
              <strong>Per malam</strong> — ambil Sabtu, kembali Minggu = <strong>1 hari</strong>.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-[#26302B]">
            <input
              type="radio"
              checked={rentalDayMode === 'per_hari_kalender'}
              onChange={() => setRentalDayMode('per_hari_kalender')}
              className="mt-0.5 accent-[#2B4739]"
            />
            <span>
              <strong>Per hari kalender</strong> — ambil Sabtu, kembali Minggu = <strong>2 hari</strong>.
            </span>
          </label>
          <p className="text-[11px] text-[#6E6853]">
            Tampilan di aplikasi selalu memakai kata "hari", apa pun pilihannya di sini. Cara ini dipakai untuk
            menghitung harga sewa, struk, nota, dan denda telat bertingkat.
          </p>
          {rentalDayModeJustChanged && (
            <p className="text-xs font-semibold text-[#A65C2A]">
              Berlaku untuk transaksi baru. Transaksi lama tetap dihitung seperti saat dibuat.
            </p>
          )}
          {/* Label lama sewa "2H1M" (brief 23 Nov 2026, migration 072; diperluas
              24 Nov 2026 untuk Per Hari Kalender juga -- Wasup: "1 kali sewa
              = 2 hari 1 malam" meski mode mereka per_hari_kalender, bukan
              per_malam). Dulu cuma tampil untuk Per Malam -- sekarang tampil
              untuk KEDUA mode, cuma contoh teksnya beda (formatRentalDuration
              di utils/formatters.ts punya rumus beda per mode: per_malam =
              "N+1H NM", per_hari_kalender = "NH N-1M", 1 hari tetap "1 hari"
              biasa). Harga/denda/stok tidak tersentuh -- murni teks. */}
          <div className="flex flex-col gap-2 pt-2 border-t border-[#E6E1D2]/60">
            <p className="text-sm font-semibold text-[#26302B]">Label Lama Sewa</p>
            <label className="flex items-start gap-2 text-sm text-[#26302B]">
              <input
                type="radio"
                checked={durationLabelStyle === 'hari'}
                onChange={() => setDurationLabelStyle('hari')}
                className="mt-0.5 accent-[#2B4739]"
              />
              <span>
                <strong>Hari</strong> — mis. "2 hari".
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-[#26302B]">
              <input
                type="radio"
                checked={durationLabelStyle === 'hari_malam'}
                onChange={() => setDurationLabelStyle('hari_malam')}
                className="mt-0.5 accent-[#2B4739]"
              />
              <span>
                <strong>Hari-malam (2H1M)</strong> —{' '}
                {rentalDayMode === 'per_malam' ? (
                  <>mis. 1 malam ditulis "2H1M".</>
                ) : (
                  <>mis. 2 hari ditulis "2H1M".</>
                )}
              </span>
            </label>
            <p className="text-[11px] text-[#6E6853]">
              Murni teks di struk/nota/ringkasan — harga tetap dihitung dan ditampilkan "/hari" di katalog, tidak
              berubah. 1 hari tetap ditulis "1 hari" biasa (tidak ada "1H0M").
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-[#E6E1D2]">
          <p className="text-sm font-semibold text-[#26302B]">Paket Minimal/Maksimal Hari Sewa</p>
          {/* min-w-0 di label + w-full di input -- tanpa ini, lebar bawaan
              <input type="number"> (tidak otomatis menyusut) melebarkan baris
              flex ini sampai terpotong di HP (360-390px), dilaporkan Andi dari
              HP Android 12 Nov 2026 (scrollWidth 501/360). Label "Maksimal
              hari (paket)" juga diperpendek jadi "Maksimal hari" -- kata
              "paket" sudah dijelaskan di teks bantuan di bawah. */}
          <div className="flex gap-3">
            <label className="flex-1 min-w-0 flex flex-col gap-1 text-sm text-[#6E6853]">
              <span>Minimal hari</span>
              <input
                type="number"
                min={1}
                value={minRentalDays}
                onChange={(e) => setMinRentalDays(e.target.value)}
                placeholder="Tanpa batas"
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
              />
            </label>
            <label className="flex-1 min-w-0 flex flex-col gap-1 text-sm text-[#6E6853]">
              <span>Maksimal hari</span>
              <input
                type="number"
                min={1}
                value={maxRentalDays}
                onChange={(e) => setMaxRentalDays(e.target.value)}
                placeholder="Tanpa batas"
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
              />
            </label>
          </div>
          <p className="text-[11px] text-[#6E6853]">
            Minimal diterapkan ketat di Catat Transaksi dan Pesanan Online. Maksimal cuma batas paket — Catat
            Transaksi otomatis mengisi tanggal kembali sesuai paket (masih bisa diubah, ada peringatan kalau
            melebihi), tapi Pesanan Online dari Etalase tidak bisa melebihi paket. Kosongkan untuk tanpa batas.
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-[#E6E1D2]">
          <label className="flex flex-col gap-1 text-sm text-[#6E6853]">
            <span className="font-semibold text-[#26302B]">Ubah Jadwal paling lambat H-berapa</span>
            <input
              type="number"
              min={0}
              value={rescheduleDeadlineDays}
              onChange={(e) => setRescheduleDeadlineDays(e.target.value)}
              placeholder="Kapan saja (tanpa batas)"
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            />
          </label>
          <p className="text-[11px] text-[#6E6853]">
            Hari sebelum tanggal ambil. Cuma PERINGATAN — owner maupun karyawan tetap bisa Ubah Jadwal setelah batas
            ini lewat, tapi wajib isi "Alasan perubahan". Tidak berlaku untuk Perpanjang (alat sudah diambil).
            Kosongkan untuk tanpa batas (boleh ubah jadwal kapan saja sebelum diambil).
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-[#E6E1D2]">
          <p className="text-sm font-semibold text-[#26302B]">Printer Struk</p>
          <p className="text-[11px] text-[#6E6853]">
            {printerSettings
              ? printerSettings.connection === 'none'
                ? 'Belum ada printer diatur — struk dikirim lewat WA / PDF.'
                : `Diatur: ${printerSettings.connection === 'bluetooth' ? 'Bluetooth' : 'USB'} · kertas ${printerSettings.paperWidth}mm. Pengaturan ini per perangkat (HP/laptop lain diatur sendiri).`
              : 'Belum diatur di perangkat ini. Pengaturan per perangkat (HP/laptop lain diatur sendiri).'}
          </p>
          <button
            type="button"
            onClick={() => setPrinterWizardOpen(true)}
            className="self-start px-3 py-1.5 rounded-lg border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] text-xs font-semibold transition"
          >
            {printerSettings ? 'Ubah Pengaturan Printer' : 'Siapkan Printer'}
          </button>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-[#E6E1D2]">
          <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
            <span className="font-semibold text-[#26302B]">Zona Waktu</span>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value as BusinessTimezone)}
              className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
            >
              {TIMEZONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {suggestedTimezone && suggestedTimezone !== timezone && (
            <p className="text-xs font-semibold text-[#A65C2A]">
              Provinsi {selectedProvinceName} biasanya memakai{' '}
              {TIMEZONE_OPTIONS.find((o) => o.value === suggestedTimezone)?.label.split(' ')[0]}.{' '}
              <button
                type="button"
                onClick={() => setTimezone(suggestedTimezone)}
                className="underline text-[#2B4739]"
              >
                Pakai ini
              </button>
            </p>
          )}
          <p className="text-[11px] text-[#6E6853]">
            Dipakai untuk status transaksi, batas jam denda telat, dan batas waktu Pesanan Online. Ganti
            hanya kalau rental Anda memang berada di zona ini.
          </p>
        </div>

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

      <PrinterSetupWizard
        isOpen={printerWizardOpen}
        onClose={() => setPrinterWizardOpen(false)}
        businessName={business.name}
        onSaved={savePrinterSettings}
      />
    </div>
  );
}
