import { tzOffsetMs, addDays } from './dates.js';
import { computeItemRentalPrice, type ItemDayRates } from './pricing.js';

const BLOCK_HOURS = 12;
const BLOCK_RATE = 0.5;

// Rumus disepakati: toleransi per-vendor (businesses.late_tolerance_hours),
// lewat itu tiap kelipatan 12 jam kena tambahan 50% harga sewa harian.
// due_at = tanggal end_date, jamnya ikut jam pengambilan barang sungguhan —
// lihat migrations/003_bookings_return_time_and_tolerance.sql &
// migrations/027_booking_picked_up_at.sql.
//
// pickedUpAt (bookings.picked_up_at) dipakai kalau ada — itu jam SUNGGUHAN
// barang diambil fisik, disetel di POST /bookings (kalau langsung 'aktif'
// saat dibuat) atau POST /bookings/:id/pickup (booking yang dipesan duluan,
// diambil belakangan). createdAt (jam booking DICATAT staff) cuma fallback
// untuk baris lama dari sebelum migration 027 ada (picked_up_at null) — buat
// booking yang dipesan duluan lalu diambil berhari-hari kemudian, createdAt
// bisa selisih jauh dari jam ambil sungguhan, itu justru celah yang ditutup
// migration 027 (jangan dijadikan sumber utama lagi kalau picked_up_at ada).
//
// Semua ekstraksi jam sengaja lewat offset WIB tetap (bukan getHours() lokal
// server) — server bisa di-deploy di timezone apa saja, tapi jam ambil barang
// harus dibaca sebagai jam WIB (lihat insiden serupa di lib/dates.ts).
//
// `timezone` (migration 053) = zona rental. Jam ambil dibaca di zona itu,
// jadi batasnya "tanggal kembali, jam yang sama dengan jam ambil" waktu
// setempat. Default WIB = perilaku sebelum 053.
//
// Batas jam kembali TETAP (migration 062, brief 14 Nov 2026) —
// returnDeadlineTime null (default, baris lama) = perilaku di atas TIDAK
// BERUBAH sama sekali. Diisi ("HH:MM") -> due = end_date (+1 hari kalau
// returnDeadlineNextDay) pukul segitu, zona rental, TERLEPAS dari jam
// ambil. "00:00" SELALU dibaca end_date+1 00:00 (tidak pernah dobel
// ditambah lagi walau returnDeadlineNextDay juga true) — lihat migration
// 062 untuk definisi lengkap & alasan dikunci di UI.
export function computeDueAt(
  endDate: string,
  createdAt: string,
  pickedUpAt: string | null = null,
  timezone: string | null = null,
  returnDeadlineTime: string | null = null,
  returnDeadlineNextDay: boolean = false,
): Date {
  const offsetMs = tzOffsetMs(timezone);
  const anchor = pickedUpAt ?? createdAt;
  const anchorMs = new Date(anchor).getTime();

  if (returnDeadlineTime) {
    const [hh, mm] = returnDeadlineTime.split(':').map(Number);
    const isMidnight = hh === 0 && mm === 0;
    const dayOffset = isMidnight || returnDeadlineNextDay ? 1 : 0;
    const [y, m, d] = addDays(endDate, dayOffset).split('-').map(Number);
    let dueAtUtcMs = Date.UTC(y, m - 1, d, hh, mm, 0) - offsetMs;

    // Review -c1 poin 1 (14 Nov 2026): kalau barang BARU diambil setelah
    // jam batas tetap di hari yang sama (mis. ambil jam 23:00, batas
    // 22:00, end_date = hari yang sama) -- due bisa jatuh SEBELUM jam
    // ambil sungguhan, membuat transaksi langsung "terlambat" detik itu
    // juga saat diambil. Geser +1 hari (jam tetap sama) sebagai jaring
    // pengaman -- due TIDAK PERNAH lebih awal dari anchor (jam ambil).
    // Satu kali geser (bukan loop) -- cukup untuk skenario realistis di
    // brief (telat satu hari kalender), bukan klaim menutup kasus anchor
    // yang sudah berhari-hari lewat end_date (di luar cakupan).
    if (dueAtUtcMs <= anchorMs) {
      dueAtUtcMs += 86_400_000;
    }
    return new Date(dueAtUtcMs);
  }

  const anchorLocalMs = anchorMs + offsetMs;
  const anchorLocal = new Date(anchorLocalMs);
  const hours = anchorLocal.getUTCHours();
  const minutes = anchorLocal.getUTCMinutes();
  const seconds = anchorLocal.getUTCSeconds();

  const [y, m, d] = endDate.split('-').map(Number);
  const dueAtUtcMs = Date.UTC(y, m - 1, d, hours, minutes, seconds) - offsetMs;
  return new Date(dueAtUtcMs);
}

export function hoursLate(dueAt: Date, returnAt: Date): number {
  const diffMs = returnAt.getTime() - dueAt.getTime();
  return diffMs / (60 * 60 * 1000);
}

// Toleransi SENGAJA digeser jadi bagian dari deadline efektif (dikurangkan
// dari hoursLateValue dulu SEBELUM dibagi jadi blok 12-jam), bukan cuma
// gerbang ya/tidak "sudah lewat toleransi?" yang lalu balik hitung dari
// hoursLateValue mentah begitu terlewati. Cara lama itu bikin manfaat
// toleransi lenyap tepat di detik dia terlampaui — mis. toleransi 11 jam,
// telat 13 jam (cuma 2 jam lewat toleransi): hoursLateValue mentah (13) lewat
// BLOCK_HOURS (12) jadi 2 blok (1 hari penuh), padahal yang adil cuma 1 blok
// (setengah hari) karena baru 2 jam yang benar-benar "telat" di luar masa
// toleransi. Insiden serupa persis ditemukan & diperbaiki di Bilbo-Outdoors
// (referensi produk sejenis, owner sama), commit c4b61e0, 2026-08-19 — "the
// tolerance was only used to decide whether hoursLate counted as zero days
// late... the tolerance's benefit evaporated entirely the moment it was
// exceeded". Sewalog kena bug yang sama persis, diperbaiki di sini dengan
// pola yang sama: toleransi menggeser garis mulai hitung, bukan gerbang biner.
// Jumlah blok 12-jam yang sudah lewat toleransi — dipakai BAIK oleh
// computeLateFee() (tarif flat/legacy) MAUPUN computeTieredLateFee() di
// bawah (tarif bertingkat, migration 034+). Diekstrak supaya dua rumus
// itu selalu sepakat soal "berapa hari/blok yang terlambat", cuma beda
// di TARIF per bloknya — lihat komentar migration 034 soal alasan
// pemisahan ini.
function computeLateBlocks(hoursLateValue: number, toleranceHours: number): number {
  const effectiveLateHours = hoursLateValue - toleranceHours;
  if (effectiveLateHours <= 0) return 0;
  return Math.ceil(effectiveLateHours / BLOCK_HOURS);
}

export function computeLateFee(
  hoursLateValue: number,
  toleranceHours: number,
  dailyRate: number,
): number {
  const blocks = computeLateBlocks(hoursLateValue, toleranceHours);
  // Dibulatkan ke rupiah terdekat (koordinator 16 Nov 2026) -- blok ganjil
  // (setengah hari, BLOCK_RATE=0.5) × tarif ganjil bisa desimal (mis.
  // 1 blok × 0.5 × Rp37.665 = Rp18.832,5). Diterima: denda ini cuma
  // SARAN, vendor tetap bisa ubah manual, dan selisihnya ≤ Rp0,5.
  return Math.round(blocks * BLOCK_RATE * dailyRate);
}

// Denda keterlambatan bertingkat (migration 034) — rumus marginal ala
// Bilbo-Outdoors (server.ts calculate-late: harga(durasi+telat) -
// harga(durasi)) DIGABUNG dengan mekanisme blok 12-jam/50% Sewalog yang
// sudah ada (TIDAK diubah: cara menghitung jumlah blok tetap lewat
// computeLateBlocks() di atas, sama persis seperti computeLateFee()).
//
// Setiap blok = 12 jam = SETENGAH hari telat, pada 50% tarif. 2 blok =
// 1 hari telat penuh (100% tarif hari itu). Jadi:
//   fullLateDays = floor(blocks / 2)   -- jumlah hari telat PENUH
//   hasHalfBlock = blocks % 2 === 1    -- sisa setengah hari (kalau ganjil)
//
// Tarif hari ke-(rentDuration+k) = marginal dari computeItemRentalPrice:
// harga(rentDuration+k) - harga(rentDuration+k-1). Fee untuk fullLateDays
// hari penuh = harga(rentDuration+fullLateDays) - harga(rentDuration)
// (teleskopik, jumlah semua marginal di antaranya). Kalau ada sisa
// setengah blok, tambah 50% dari marginal hari BERIKUTNYA (hari ke
// fullLateDays+1) — pola "50% tarif hari itu" yang sama seperti blok
// biasa, cuma tarifnya sekarang tarif-hari-itu (bisa beda per hari),
// bukan dailyRate flat.
//
// Diverifikasi: untuk item FLAT (semua tingkat = price_per_day), rumus
// ini menghasilkan angka IDENTIK dengan computeLateFee() lama (lihat
// catatan verifikasi di riwayat kerja) — backward-compatible by
// construction, bukan cuma diasumsikan.
export function computeTieredLateFee(
  hoursLateValue: number,
  toleranceHours: number,
  rentDuration: number,
  rates: ItemDayRates,
): number {
  const blocks = computeLateBlocks(hoursLateValue, toleranceHours);
  if (blocks <= 0) return 0;
  const fullLateDays = Math.floor(blocks / 2);
  const hasHalfBlock = blocks % 2 === 1;

  let fee = computeItemRentalPrice(rates, rentDuration + fullLateDays) - computeItemRentalPrice(rates, rentDuration);
  if (hasHalfBlock) {
    const nextDayMarginal =
      computeItemRentalPrice(rates, rentDuration + fullLateDays + 1) -
      computeItemRentalPrice(rates, rentDuration + fullLateDays);
    // Dibulatkan ke rupiah terdekat (koordinator 16 Nov 2026) -- marginal
    // ganjil × 50% bisa desimal, sama alasan computeLateFee() di atas.
    fee += Math.round(BLOCK_RATE * nextDayMarginal);
  }
  return fee;
}

// Untuk tampilan rincian (dialog pengembalian/nota) — jumlah "hari
// telat" dalam satuan yang sama dengan computeTieredLateFee() di atas
// (0.5 per blok ganjil), supaya tarif efektif per-hari yang ditampilkan
// (fee / lateDaysEquivalent) konsisten dengan fee yang sungguhan dipakai.
export function lateDaysEquivalent(hoursLateValue: number, toleranceHours: number): number {
  const blocks = computeLateBlocks(hoursLateValue, toleranceHours);
  return blocks * BLOCK_RATE;
}

// ============================================================
// Cara hitung denda telat (migration 063, brief 15 Nov 2026)
// ============================================================
// Empat mode per rental, snapshot per transaksi (bookings.late_fee_mode,
// null = 'bertahap_12jam', perilaku di atas TIDAK disentuh sama sekali
// oleh kode di bawah ini -- regresi default terjamin by construction).
export type LateFeeMode = 'bertahap_12jam' | 'per_hari_24jam' | 'per_jam' | 'tanpa_denda';

// Jumlah hari telat PENUH (dibulatkan ke ATAS per 24 jam, lewat toleransi
// 1 menit pun sudah 1 hari, TANPA setengah hari seperti mode bertahap) --
// dasar bagi mode "per_hari_24jam" (fee sungguhan) DAN batas atas mode
// "per_jam" (pembanding, lihat computeFullDayLateFee/Flat di bawah).
export function fullDayLateDays(hoursLateValue: number, toleranceHours: number): number {
  const effectiveLateHours = hoursLateValue - toleranceHours;
  return effectiveLateHours <= 0 ? 0 : Math.ceil(effectiveLateHours / 24);
}

// Mode "per_hari_24jam" — tarif marginal bertingkat (sama basis
// computeItemRentalPrice seperti computeTieredLateFee), TANPA mekanisme
// blok 12-jam/50%: tiap hari telat = 100% tarif hari itu, tidak ada
// setengah hari.
export function computeFullDayLateFee(
  hoursLateValue: number,
  toleranceHours: number,
  rentDuration: number,
  rates: ItemDayRates,
): number {
  const lateDays = fullDayLateDays(hoursLateValue, toleranceHours);
  if (lateDays <= 0) return 0;
  return computeItemRentalPrice(rates, rentDuration + lateDays) - computeItemRentalPrice(rates, rentDuration);
}

// Sama seperti di atas, untuk baris booking_items lama (snapshot tarif
// bertingkat null, dari sebelum migration 034) — fallback tarif flat,
// pola sama fallback di computeLateFee/computeTieredLateFee.
export function computeFullDayLateFeeFlat(hoursLateValue: number, toleranceHours: number, dailyRate: number): number {
  return fullDayLateDays(hoursLateValue, toleranceHours) * dailyRate;
}

// Mode "per_jam" — SATU angka PER TRANSAKSI (bukan per alat, keputusan
// Andi 15 Nov 2026 v1 — "dikali jumlah alat" ditunda ke v2), dengan batas
// atas OPSIONAL (aktif default) = PERSIS jumlah yang dihasilkan mode
// "per hari penuh" untuk telat sejumlah jam yang sama (dihitung dari
// `fullDayFeeTotal`, dijumlahkan tiap alat oleh pemanggil — lihat
// routes/trackings.ts). Review -c1 poin 3: kalau `perHourRate` null/<=0
// (seharusnya tidak pernah terjadi karena constraint businesses_late_fee_
// per_hour_required_check di migration 063, tapi snapshot booking LAMA
// bisa saja punya data tidak konsisten) -- DIPERLAKUKAN AMAN, balikin 0
// dengan flag `needsManualInput` supaya caller bisa tampilkan "isi
// manual", BUKAN melempar error.
export function computeHourlyLateFee(
  hoursLateValue: number,
  toleranceHours: number,
  perHourRate: number | null,
  capEnabled: boolean,
  fullDayFeeTotal: number,
): { fee: number; hours: number; cap: number | null; capped: boolean; needsManualInput: boolean } {
  const effectiveLateHours = Math.max(0, hoursLateValue - toleranceHours);
  const hours = Math.ceil(effectiveLateHours);

  if (perHourRate == null || perHourRate <= 0) {
    return { fee: 0, hours, cap: null, capped: false, needsManualInput: hours > 0 };
  }

  const rawFee = hours * perHourRate;
  const cap = capEnabled ? fullDayFeeTotal : null;
  // Math.round sebagai jaring pengaman (koordinator 16 Nov 2026) -- hours
  // dan perHourRate sudah integer jadi rawFee selalu bulat di jalur normal,
  // tapi fullDayFeeTotal (cap, dijumlahkan dari beberapa alat oleh
  // pemanggil) bisa saja membawa sisa desimal dari sumber lain.
  const fee = Math.round(cap != null ? Math.min(rawFee, cap) : rawFee);
  return { fee, hours, cap, capped: cap != null && rawFee > cap, needsManualInput: false };
}
