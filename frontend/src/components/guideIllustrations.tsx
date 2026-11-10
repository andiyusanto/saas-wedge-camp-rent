import type { ReactNode } from 'react';
import { formatIDR } from '../utils/formatters';
import {
  LATE_FEE_EXAMPLE,
  PACKAGE_DAYS_EXAMPLE,
  DURATION_MODE_EXAMPLE,
  TIERED_PRICE_EXAMPLE,
  READINESS_EXAMPLE,
} from '../utils/guideIllustrationData';

// Enam ilustrasi perhitungan di Panduan (GuideScreen.tsx) — komponen React
// murni (bukan gambar statis), supaya kalau rumusnya berubah di kode asli,
// ilustrasi ini gampang diupdate juga (tidak ada file gambar terpisah yang
// bisa basi). Semua angka contoh di sini WAJIB cocok dengan fungsi asli
// (computeTieredLateFee, computeItemRentalPrice, rentalDuration, aturan
// readiness di usedUnitsOn) — diverifikasi lewat
// frontend/src/utils/__tests__/guideIllustrations.test.ts (angka diimpor
// dari file itu, bukan ditulis ulang di sini, supaya tidak bisa kebablasan
// beda).
//
// Token warna dari CLAUDE.md bagian 5 — sengaja TIDAK pakai warna baru:
// primary #2B4739 (hijau pinus, dipakai juga untuk "zona toleransi" di
// ilustrasi 1 sesuai permintaan Andi), warning/rust #A65C2A, danger
// #A8412E, muted #6E6853, surface #FBFAF4, border #DBD5C1, canvas #F1EEE2.
// Mobile-first: grid/flex-wrap, tanpa lebar tetap yang bisa overflow di
// 360px (diverifikasi screenshot Playwright, lihat knowladge/).

function IllustrationFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-[#F1EEE2] border border-[#DBD5C1] rounded-xl p-3 my-2">
      <p className="text-[11px] font-bold text-[#6E6853] uppercase tracking-wide mb-2">{title}</p>
      {children}
    </div>
  );
}

// 1. Denda telat — garis waktu paket 4 hari, tarif lewat paket Rp20rb,
// toleransi 2 jam, batas kembali Jum 10:00. Angka sama persis dengan
// backend/src/lib/__tests__/packageDays.test.ts (denda telat bertingkat),
// diverifikasi ulang terhadap computeTieredLateFee() di guideIllustrations.test.ts.
export function LateFeeIllustration() {
  return (
    <IllustrationFrame title="Contoh: paket 4 hari, tarif lewat paket Rp20.000, toleransi 2 jam, batas kembali Jum 10:00">
      <div className="space-y-1.5">
        {LATE_FEE_EXAMPLE.points.map((p) => (
          <div key={p.label} className="flex items-center gap-2 bg-[#FBFAF4] border border-[#DBD5C1] rounded-lg px-2.5 py-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: p.inTolerance ? '#2B4739' : '#A65C2A' }}
            />
            <span className="font-mono text-[11px] font-bold text-[#26302B] w-16 shrink-0">{p.label}</span>
            <span className="text-[11px] text-[#6E6853] flex-1">{p.note}</span>
            <span className={`text-xs font-extrabold shrink-0 ${p.fee > 0 ? 'text-[#A8412E]' : 'text-[#2B4739]'}`}>
              {p.fee > 0 ? formatIDR(p.fee) : 'Rp0'}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[#6E6853] mt-2">
        <span className="inline-block w-2 h-2 rounded-full bg-[#2B4739] mr-1 align-middle" /> dalam toleransi ·{' '}
        <span className="inline-block w-2 h-2 rounded-full bg-[#A65C2A] mr-1 align-middle" /> tiap blok 12 jam lewat
        toleransi
      </p>
    </IllustrationFrame>
  );
}

// 2. Paket N hari — strip 6 kotak hari. Angka identik dengan
// packageDays.test.ts (paket 4 hari Rp100rb, tarif lewat paket Rp20rb).
export function PackageDaysIllustration() {
  const days = [1, 2, 3, 4, 5, 6];
  return (
    <IllustrationFrame title='Contoh: tombol "Paket 4 hari", Sewa /Hari Rp100.000, Tarif lewat paket Rp20.000'>
      <div className="grid grid-cols-6 gap-1">
        {days.map((d) => {
          const isDay1 = d === 1;
          const isIncluded = d >= 2 && d <= 4;
          const isOver = d >= 5;
          return (
            <div
              key={d}
              className="rounded-lg border px-0.5 py-1.5 text-center overflow-hidden"
              style={{
                backgroundColor: isDay1 ? '#2B4739' : isOver ? '#A65C2A' : '#FBFAF4',
                borderColor: isIncluded ? '#DBD5C1' : 'transparent',
                color: isDay1 || isOver ? '#FBFAF4' : '#6E6853',
              }}
            >
              <p className="text-[8px] font-bold opacity-90 leading-tight">H{d}</p>
              <p className="text-[7.5px] font-mono leading-tight mt-0.5 break-words">
                {isDay1 ? '100rb' : isIncluded ? 'paket' : '20rb'}
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px]">
        {PACKAGE_DAYS_EXAMPLE.totals.map((t) => (
          <span key={t.days} className="text-[#26302B]">
            <strong>{t.days} hari</strong> = <span className="font-bold text-[#2B4739]">{formatIDR(t.total)}</span>
          </span>
        ))}
      </div>
    </IllustrationFrame>
  );
}

// 3. Per malam vs per hari kalender — rentalDuration('Sabtu','Minggu', mode).
export function DurationModeIllustration() {
  return (
    <IllustrationFrame title="Contoh: ambil Sabtu, kembali Minggu">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="bg-[#FBFAF4] border border-[#DBD5C1] rounded-lg p-2.5">
          <p className="text-[11px] font-bold text-[#26302B]">Per malam</p>
          <p className="text-[11px] text-[#6E6853] mt-0.5">Sabtu → Minggu</p>
          <p className="text-sm font-extrabold text-[#2B4739] mt-1">{DURATION_MODE_EXAMPLE.perMalam} hari</p>
        </div>
        <div className="bg-[#FBFAF4] border border-[#DBD5C1] rounded-lg p-2.5">
          <p className="text-[11px] font-bold text-[#26302B]">Per hari kalender</p>
          <p className="text-[11px] text-[#6E6853] mt-0.5">Sabtu → Minggu</p>
          <p className="text-sm font-extrabold text-[#A65C2A] mt-1">{DURATION_MODE_EXAMPLE.perHariKalender} hari</p>
        </div>
      </div>
      <p className="text-[10px] text-[#6E6853] mt-2">
        Tampilan di aplikasi selalu memakai kata "hari" (tidak pernah "malam"), apa pun mode yang dipilih.
      </p>
    </IllustrationFrame>
  );
}

// 4. Harga bertingkat — tangga tarif. Total 3 hari diverifikasi lewat
// computeItemRentalPrice di unit test.
export function TieredPriceIllustration() {
  const max = TIERED_PRICE_EXAMPLE.rates[0].price;
  return (
    <IllustrationFrame title="Contoh: harga hari 1 Rp30.000, hari 2 Rp20.000, hari 3 dst Rp10.000">
      <div className="flex items-end gap-2 h-20">
        {TIERED_PRICE_EXAMPLE.rates.map((r) => (
          <div key={r.day} className="flex-1 flex flex-col items-center justify-end h-full">
            <div
              className="w-full rounded-t-md bg-[#2B4739]"
              style={{ height: `${Math.max(12, (r.price / max) * 100)}%` }}
            />
            <p className="text-[9px] font-bold text-[#26302B] mt-1">Hari {r.day}</p>
            <p className="text-[9px] font-mono text-[#6E6853]">{formatIDR(r.price)}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[#26302B] mt-2">
        Total sewa 3 hari = <span className="font-bold text-[#2B4739]">{formatIDR(TIERED_PRICE_EXAMPLE.total3Days)}</span>
      </p>
    </IllustrationFrame>
  );
}

// 5. Jeda persiapan — alat kembali Senin, jeda 48 jam -> ceil(48/24)=2
// hari terblokir (Senin + 1 hari lagi = Selasa), tersedia lagi Rabu.
// Sama persis dengan aturan usedUnitsOn() (lib/availability.ts).
export function ReadinessIllustration() {
  return (
    <IllustrationFrame title="Contoh: alat kembali Senin, Jeda persiapan 48 jam">
      <div className="grid grid-cols-3 gap-1.5">
        {READINESS_EXAMPLE.days.map((d) => {
          const blocked = d.status !== 'Tersedia';
          return (
            <div
              key={d.label}
              className="rounded-lg border p-2 text-center"
              style={{
                backgroundColor: blocked ? '#A8412E' : '#2B4739',
                borderColor: 'transparent',
                color: '#FBFAF4',
              }}
            >
              <p className="text-[10px] font-bold">{d.label}</p>
              <p className="text-[9px] opacity-90 mt-0.5 leading-tight">{d.status}</p>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-[#6E6853] mt-2">
        Dibulatkan ke atas per hari kalender: 1–24 jam cuma memblokir hari kembalinya sendiri, 25–48 jam memblokir
        hari kembali + 1 hari lagi, dst.
      </p>
    </IllustrationFrame>
  );
}

// 6. Ubah Jadwal vs Perpanjang — dua garis waktu konseptual (bukan dari
// fungsi hitung, murni ilustrasi alur).
export function RescheduleVsExtendIllustration() {
  return (
    <IllustrationFrame title="Ubah Jadwal vs Perpanjang">
      <div className="space-y-3">
        <div>
          <p className="text-[11px] font-bold text-[#26302B] mb-1">
            Ubah Jadwal <span className="text-[#A65C2A] font-normal">(status Siap Diambil)</span>
          </p>
          <div className="flex flex-col gap-0.5 text-[10px]">
            <span className="line-through text-[#6E6853]">Rab, 12-11-2026 → Jum, 14-11-2026</span>
            <span className="font-bold text-[#2B4739]">→ Kam, 13-11-2026 → Sab, 15-11-2026</span>
          </div>
          <p className="text-[10px] text-[#6E6853] mt-0.5">Tanggal ambil DAN kembali bisa bergeser.</p>
        </div>
        <div className="border-t border-[#DBD5C1] pt-2">
          <p className="text-[11px] font-bold text-[#26302B] mb-1">
            Perpanjang <span className="text-[#A65C2A] font-normal">(status Aktif)</span>
          </p>
          <div className="flex flex-col gap-0.5 text-[10px]">
            <span className="text-[#6E6853]">Ambil Rab, 12-11-2026 (sudah diambil)</span>
            <span className="text-[#6E6853] line-through">Kembali Jum, 14-11-2026</span>
            <span className="font-bold text-[#2B4739]">→ Kembali Min, 16-11-2026</span>
          </div>
          <p className="text-[10px] text-[#6E6853] mt-0.5">
            Cuma tanggal kembali yang maju — batas telat ikut bergeser ke tanggal baru.
          </p>
        </div>
      </div>
    </IllustrationFrame>
  );
}
