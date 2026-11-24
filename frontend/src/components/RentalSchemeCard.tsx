import { useState } from 'react';
import { ListChecks, Check } from 'lucide-react';
import type { Business, BusinessUpdateInput } from '../hooks/useBusiness';
import { useItems } from '../hooks/useItems';
import { supabase } from '../lib/supabaseClient';
import { deriveSchemeOption, settingsForSchemeOption, type RentalSchemeOption } from '../utils/rentalScheme';
import { computePackageTierRates, formatIDR } from '../utils/formatters';

// "Skema Sewa Kamu" (brief Pilih Skema Sewa 24 Nov 2026) -- satu kartu
// sederhana menggantikan perlunya owner mengerti Cara Hitung Durasi
// Sewa + Label Lama Sewa + Minimal/Maksimal Hari sekaligus (sumber
// kebingungan Wasup Outdoor & Sewainaja.yk, lihat brief). Dipakai DUA
// tempat (Kelola Usaha owner-only, dan langkah opsional pasca-
// onboarding) -- komponen yang SAMA, props yang sama (business+onSave),
// supaya tidak ada logika terduplikasi.
function roundToNearest500(value: number): number {
  return Math.round(value / 500) * 500;
}

function labelForOption(option: RentalSchemeOption): string {
  if (option.kind === 'per_hari') return 'Per hari';
  if (option.kind === 'per_malam') return 'Per malam / 24 jam';
  if (option.kind === 'paket') return `Paket ${option.days} hari`;
  return 'Skema kustom';
}

export function RentalSchemeCard({
  businessId,
  business,
  onSave,
  onSkip,
}: {
  businessId: string;
  business: Business;
  onSave: (input: BusinessUpdateInput) => Promise<{ error: string | null }>;
  // Onboarding (brief bagian C) -- tombol "Lewati" eksplisit, tidak ada
  // di Kelola Usaha (selalu omit onSkip di sana).
  onSkip?: () => void;
}) {
  const currentOption = deriveSchemeOption(business);
  const [selected, setSelected] = useState<'per_hari' | 'per_malam' | 'paket' | null>(
    currentOption.kind === 'kustom' ? null : currentOption.kind,
  );
  const [packageDays, setPackageDays] = useState(currentOption.kind === 'paket' ? currentOption.days : 3);
  const [packageMaxMode, setPackageMaxMode] = useState<'tanpa_batas' | 'hanya_paket'>(
    currentOption.kind === 'paket' ? currentOption.maxMode : 'tanpa_batas',
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bantuan harga paket (opsional, cuma relevan untuk opsi Paket).
  const [showPriceHelper, setShowPriceHelper] = useState(false);
  const [priceMeaning, setPriceMeaning] = useState<'paket' | 'per_hari' | null>(null);
  const [overPercent, setOverPercent] = useState('50');
  const [applyDenda, setApplyDenda] = useState(false);
  const [priceApplying, setPriceApplying] = useState(false);
  const [priceApplyError, setPriceApplyError] = useState<string | null>(null);
  const [priceApplied, setPriceApplied] = useState(false);

  const { items, refresh: refreshItems } = useItems(businessId);
  const activeItems = items.filter((i) => !i.deactivated_at);

  function buildOption(): RentalSchemeOption | null {
    if (selected === 'per_hari') return { kind: 'per_hari' };
    if (selected === 'per_malam') return { kind: 'per_malam' };
    if (selected === 'paket') return { kind: 'paket', days: Math.max(2, packageDays), maxMode: packageMaxMode };
    return null;
  }

  const pendingOption = buildOption();

  function summaryLines(option: RentalSchemeOption): string[] {
    const s = settingsForSchemeOption(option as Exclude<RentalSchemeOption, { kind: 'kustom' }>);
    const lines = [
      `Cara hitung durasi sewa: ${s.rental_day_mode === 'per_malam' ? 'Per malam' : 'Per hari kalender'}`,
      `Label lama sewa: ${s.duration_label_style === 'hari_malam' ? 'Hari-malam (mis. "3H2M")' : 'Hari'}`,
      `Minimal hari: ${s.min_rental_days ?? 'tanpa batas'}`,
      `Maksimal hari: ${s.max_rental_days ?? 'tanpa batas'}`,
    ];
    return lines;
  }

  async function handleSave() {
    if (!pendingOption) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const s = settingsForSchemeOption(pendingOption as Exclude<RentalSchemeOption, { kind: 'kustom' }>);
    const { error: err } = await onSave({
      name: business.name,
      owner_name: business.owner_name,
      phone: business.phone,
      address: business.address,
      regency_id: business.regency_id,
      district_id: business.district_id,
      late_tolerance_hours: business.late_tolerance_hours,
      logo_url: business.logo_url,
      timezone: business.timezone ?? 'Asia/Jakarta',
      reschedule_deadline_days: business.reschedule_deadline_days,
      return_deadline_time: business.return_deadline_time,
      return_deadline_next_day: business.return_deadline_next_day ?? false,
      late_fee_mode: applyDenda ? 'per_hari_24jam' : business.late_fee_mode,
      late_fee_per_hour: business.late_fee_per_hour,
      late_fee_per_hour_cap_enabled: business.late_fee_per_hour_cap_enabled,
      // Field yang SUNGGUHAN diatur kartu ini -- lihat settingsForSchemeOption().
      rental_day_mode: s.rental_day_mode,
      // settingsForSchemeOption() SELALU mengembalikan 'hari'/'hari_malam'
      // literal (tidak pernah null) untuk opsi manapun -- tipe
      // RentalSchemeSettings cuma dibuat selebar DurationLabelStyle
      // (termasuk null) supaya bisa dipakai juga membaca setelan
      // business yang SEDANG berlaku (deriveSchemeOption), yang
      // secara teori masih bisa null untuk baris sangat lama.
      duration_label_style: s.duration_label_style ?? 'hari',
      min_rental_days: s.min_rental_days,
      max_rental_days: s.max_rental_days,
    });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    // Onboarding (onSkip tersedia): setelah Simpan sukses, lanjut masuk
    // ke app -- tidak perlu tombol terpisah "Lanjut", "Lewati" dan
    // "setelah Simpan" sama-sama berarti "sudah selesai di langkah ini".
    // Jeda singkat supaya "Tersimpan." sempat terlihat sebelum pindah.
    if (onSkip) setTimeout(onSkip, 900);
  }

  // Pratinjau bantuan harga paket -- dihitung HANYA dari alat aktif,
  // mengecualikan field yang bukan "harga per hari sederhana" tidak
  // relevan di sini (bundle ikuti_alat otomatis ikut lewat komponennya,
  // bundle sendiri DIKECUALIKAN v1, lihat catatan di JSX).
  function previewRows() {
    if (priceMeaning === null) return [];
    return activeItems.map((item) => {
      const packagePrice = priceMeaning === 'paket' ? item.price_per_day : item.price_per_day * packageDays;
      const overRate = roundToNearest500(packagePrice * (Number(overPercent) || 0) / 100);
      return { item, packagePrice, overRate };
    });
  }

  async function handleApplyPackagePricing() {
    const rows = previewRows();
    if (rows.length === 0) return;
    setPriceApplying(true);
    setPriceApplyError(null);
    const updates = rows.map(({ item, packagePrice, overRate }) => {
      const tiers = computePackageTierRates(overRate, Math.min(5, Math.max(2, packageDays)) as 2 | 3 | 4 | 5);
      return { item_id: item.id, price_per_day: packagePrice, ...tiers };
    });
    const { error: rpcError } = (await supabase?.rpc('apply_package_pricing_to_items', {
      p_business_id: businessId,
      p_updates: updates,
    })) ?? { error: { message: 'Belum terhubung' } };
    setPriceApplying(false);
    if (rpcError) {
      setPriceApplyError(rpcError.message);
      return;
    }
    setPriceApplied(true);
    await refreshItems();
    setTimeout(() => setPriceApplied(false), 3000);
  }

  return (
    <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
      <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
        <ListChecks className="w-5 h-5 text-[#2B4739]" />
        <span>Skema Sewa Kamu</span>
      </h2>

      {currentOption.kind === 'kustom' && selected === null && (
        <p className="text-xs text-[#A65C2A] font-semibold">
          Skema kustom — setelanmu sekarang tidak cocok persis dengan salah satu opsi di bawah. Tidak masalah, tetap
          bisa diatur manual lewat Pengaturan Lanjutan. Pilih salah satu opsi di bawah kalau mau menyederhanakan.
        </p>
      )}

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-[#26302B] p-2.5 rounded-xl border border-[#DBD5C1] cursor-pointer hover:bg-[#F1EEE2]">
          <input type="radio" className="mt-0.5 accent-[#2B4739]" checked={selected === 'per_hari'} onChange={() => setSelected('per_hari')} />
          <span>
            <strong>Per hari</strong>
            <br />
            <span className="text-[11px] text-[#6E6853]">Ambil & kembali hari yang sama = 1 hari. Sabtu–Minggu = 2 hari.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-[#26302B] p-2.5 rounded-xl border border-[#DBD5C1] cursor-pointer hover:bg-[#F1EEE2]">
          <input type="radio" className="mt-0.5 accent-[#2B4739]" checked={selected === 'per_malam'} onChange={() => setSelected('per_malam')} />
          <span>
            <strong>Per malam / 24 jam</strong>
            <br />
            <span className="text-[11px] text-[#6E6853]">Sabtu–Minggu = 1 hari.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-[#26302B] p-2.5 rounded-xl border border-[#DBD5C1] cursor-pointer hover:bg-[#F1EEE2]">
          <input type="radio" className="mt-0.5 accent-[#2B4739]" checked={selected === 'paket'} onChange={() => setSelected('paket')} />
          <span className="flex-1">
            <strong>Paket per sekali sewa</strong>
            <br />
            <span className="text-[11px] text-[#6E6853]">
              Mis. 3 hari → label otomatis "3H2M".{' '}
              {selected === 'paket' && (
                <>
                  <input
                    type="number"
                    min={2}
                    value={packageDays}
                    onChange={(e) => setPackageDays(Math.max(2, Number(e.target.value) || 2))}
                    onClick={(e) => e.stopPropagation()}
                    className="w-16 px-2 py-1 ml-1 rounded border border-[#DBD5C1] text-[#26302B] font-bold"
                  />{' '}
                  hari
                </>
              )}
            </span>
          </span>
        </label>
        {selected === 'paket' && (
          <div className="pl-7 space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-[#26302B]">
              <input type="radio" checked={packageMaxMode === 'tanpa_batas'} onChange={() => setPackageMaxMode('tanpa_batas')} className="accent-[#2B4739]" />
              Terima sewa lebih lama dari paket (walk-in boleh melebihi)
            </label>
            <label className="flex items-center gap-2 text-xs text-[#26302B]">
              <input type="radio" checked={packageMaxMode === 'hanya_paket'} onChange={() => setPackageMaxMode('hanya_paket')} className="accent-[#2B4739]" />
              Hanya paket ini (maksimal = {packageDays} hari)
            </label>
          </div>
        )}
      </div>

      {pendingOption && (
        <div className="p-3 rounded-xl bg-[#F1EEE2] border border-[#DBD5C1] space-y-1">
          <p className="text-xs font-bold text-[#26302B]">Yang akan diatur:</p>
          <ul className="text-[11px] text-[#6E6853] list-disc pl-4 space-y-0.5">
            {summaryLines(pendingOption).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {applyDenda && <li>Cara hitung denda: Per hari (24 jam)</li>}
          </ul>
        </div>
      )}

      {pendingOption?.kind === 'paket' && (
        <div className="space-y-2 pt-2 border-t border-[#E6E1D2]">
          {!showPriceHelper ? (
            <button type="button" onClick={() => setShowPriceHelper(true)} className="text-xs font-semibold text-[#2B4739] hover:underline">
              Terapkan harga paket ke semua alat? (opsional) →
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-bold text-[#26302B]">Terapkan harga paket ke semua alat</p>
              <p className="text-[11px] text-[#6E6853]">
                Sebelum melanjutkan, apa arti harga yang sudah ada di katalog alatmu sekarang?
              </p>
              <label className="flex items-start gap-2 text-xs text-[#26302B]">
                <input type="radio" checked={priceMeaning === 'paket'} onChange={() => setPriceMeaning('paket')} className="mt-0.5 accent-[#2B4739]" />
                Harga di katalog = harga 1 paket ({packageDays} hari)
              </label>
              <label className="flex items-start gap-2 text-xs text-[#26302B]">
                <input type="radio" checked={priceMeaning === 'per_hari'} onChange={() => setPriceMeaning('per_hari')} className="mt-0.5 accent-[#2B4739]" />
                Harga di katalog = harga per hari → harga paket = harga × {packageDays}
              </label>

              {priceMeaning && (
                <>
                  <label className="flex items-center gap-2 text-xs text-[#26302B]">
                    Tarif lewat paket (persen dari harga paket, dibulatkan ke Rp500 terdekat):
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={overPercent}
                      onChange={(e) => setOverPercent(e.target.value)}
                      className="w-16 px-2 py-1 rounded border border-[#DBD5C1] text-[#26302B] font-bold"
                    />
                    %
                  </label>

                  <div className="rounded-lg border border-[#DBD5C1] overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-[#F1EEE2] text-left">
                          <th className="p-1.5">Alat</th>
                          <th className="p-1.5 text-right">Harga paket lama</th>
                          <th className="p-1.5 text-right">Harga paket baru</th>
                          <th className="p-1.5 text-right">Tarif lewat paket</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows().map(({ item, packagePrice, overRate }) => (
                          <tr key={item.id} className="border-t border-[#E6E1D2]">
                            <td className="p-1.5">{item.name}</td>
                            <td className="p-1.5 text-right text-[#6E6853]">{formatIDR(item.price_per_day)}</td>
                            <td className="p-1.5 text-right font-bold">{formatIDR(packagePrice)}</td>
                            <td className="p-1.5 text-right">{formatIDR(overRate)}/hari</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-[#6E6853]">
                    Paket Alat (bundle) dengan harga sendiri TIDAK ikut — atur manual di tab Paket. Bundle yang
                    harganya mengikuti alat otomatis ikut.
                  </p>
                  {priceApplyError && <p className="text-[11px] text-[#A8412E]">{priceApplyError}</p>}
                  {priceApplied && <p className="text-[11px] font-semibold text-[#2B4739]">Diterapkan ke {activeItems.length} alat.</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={priceApplying}
                      onClick={handleApplyPackagePricing}
                      className="px-3 py-1.5 rounded-lg bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-xs disabled:opacity-60"
                    >
                      {priceApplying ? 'Menerapkan...' : 'Terapkan ke Semua Alat'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPriceHelper(false);
                        setPriceMeaning(null);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-[#DBD5C1] text-[#6E6853] text-xs"
                    >
                      Batalkan
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-[#26302B] pt-1">
            <input type="checkbox" checked={applyDenda} onChange={(e) => setApplyDenda(e.target.checked)} className="accent-[#2B4739]" />
            Terapkan: Cara hitung denda Per hari (24 jam) — telat 1 hari = tarif lewat paket
          </label>
        </div>
      )}

      {error && <p className="text-xs font-semibold text-[#A8412E]">{error}</p>}

      <div className="flex items-center gap-3 pt-1 border-t border-[#E6E1D2]">
        <button
          type="button"
          disabled={!pendingOption || saving}
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-sm shadow-sm transition disabled:opacity-60"
        >
          <Check className="w-4 h-4" />
          {saving ? 'Menyimpan...' : 'Simpan'}
        </button>
        {saved && <span className="text-xs font-semibold text-[#2B4739]">Tersimpan.</span>}
        {onSkip && (
          <button type="button" onClick={onSkip} className="text-xs font-semibold text-[#6E6853] hover:underline ml-auto">
            Lewati
          </button>
        )}
      </div>
      <p className="text-[11px] text-[#6E6853]">
        Setelan sekarang: <strong>{labelForOption(currentOption)}</strong>
      </p>
    </div>
  );
}
