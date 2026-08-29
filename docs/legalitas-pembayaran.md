# Catatan Legal & Regulasi Pembayaran — Sewalog / Rimbasewa

> ## ⚠️ SINTESIS AI, BUKAN OPINI HUKUM — WAJIB DIBACA SEBELUM APAPUN DI BAWAH INI DIPAKAI
>
> Draf awal dokumen ini disusun lewat sesi Claude (web), bukan oleh
> pengacara berlisensi. **Kesimpulan soal tidak perlunya lisensi PJP di
> bagian 2 secara khusus BELUM terverifikasi** dan bertentangan dengan
> riset bersumber (ada kutipan/link, bukan cuma ringkasan) yang sudah
> dilakukan sebelumnya di sesi lain — lihat `research/pjp-licensing-
> submerchant-2026-08.md`, `research/vendor-storefront-payment-2026-08.md`,
> dan `research/online-checkout-payment-roadmap-2026-08.md` (folder
> `research/` sengaja tidak di-commit ke git, cek langsung di working
> directory). Riset itu menyimpulkan pertanyaan ini **genuinely belum
> terjawab** di sumber hukum publik manapun, termasuk soal kerangka baru
> PBI No. 10/2025 (efektif 31 Maret 2026, menggantikan kerangka yang
> mungkin jadi rujukan draf ini) yang belum dibahas sama sekali di sini.
>
> Klaim-klaim lain di dokumen ini (status KBLI, dokumen onboarding gateway,
> kewajiban NIB vendor via Permendag 19/2026, dsb) juga **belum
> masing-masing diverifikasi ke sumber primer** — berguna sebagai starting
> point/checklist, bukan sebagai fakta final buat keputusan bisnis nyata.
>
> **Status "syarat #1" (opini hukum tertulis) di
> `research/online-checkout-payment-roadmap-2026-08.md` TETAP TERBUKA** —
> dokumen ini, seberapa pun rapi, tidak menggantikan opini tertulis dari
> pengacara berlisensi yang paham hukum sistem pembayaran Indonesia.
> Jangan mulai bangun apapun yang menyentuh pembayaran online
> pelanggan-ke-vendor berdasarkan dokumen ini saja.

Dokumen ini berisi konteks regulasi yang perlu jadi rujukan setiap kali ada
keputusan arsitektur yang menyentuh pembayaran, submerchant, atau alur
dana vendor. Ditulis supaya keputusan teknis (misalnya integrasi payment
gateway) tidak diambil tanpa mempertimbangkan batasan hukum di baliknya —
tapi lihat disclaimer di atas soal batas keandalan isinya.

## 1. Status legal platform (per Agustus 2026, belum diverifikasi ke sumber primer)

- Badan usaha: **Perseroan Perorangan** (PT Perorangan), pendiri tunggal.
- Terdaftar lewat AHU Online (`ptp.ahu.go.id`) + NIB via OSS RBA (KBLI 62010
  untuk Sewalog / aktivitas pemrograman komputer).
- KBLI untuk Rimbasewa (marketplace, fase belum dimulai) belum ditentukan —
  KBLI 63122 (dulu kode payung "Portal Web/Platform Digital") diklaim
  **sudah dihapus** di KBLI 2025 (Peraturan BPS No. 7/2025) — klaim ini
  belum diverifikasi ke teks resmi. Kalau benar, klasifikasi sekarang
  berbasis sektor yang diintermediasi, bukan lagi kode generik platform
  digital. Perlu dicek ulang lewat pencarian KBLI di OSS begitu fase
  Rimbasewa dimulai — jangan pakai 63122 tanpa verifikasi ulang.

## 2. Prinsip arsitektur pembayaran — desain default, BUKAN kesimpulan hukum final

**Architecture default yang dipakai selama status legalnya belum
dikonfirmasi**: Rimbasewa/Sewalog tidak pernah menyelenggarakan aktivitas
pembayaran sendiri — arsitekturnya selalu "numpang rel" payment gateway
yang sudah berlisensi (Midtrans / Xendit), bukan menahan dana sendiri.
Ini dipilih sebagai **postur paling aman yang tersedia** selagi pertanyaan
soal perlu-tidaknya izin PJP masih terbuka (lihat disclaimer di atas) —
bukan karena sudah dikonfirmasi otomatis aman dari kewajiban itu.

**Batasan keras yang harus dijaga di level desain sistem, terlepas dari
jawaban akhir pertanyaan lisensi:**
> Dana dari penyewa TIDAK BOLEH pernah masuk ke rekening/entitas
> Rimbasewa/Sewalog sendiri di luar sistem Midtrans/Xendit. Alurnya harus
> selalu: penyewa → saldo Midtrans/Xendit → split otomatis (fitur
> submerchant) → vendor. Jangan pernah desain fitur yang membuat
> Rimbasewa/Sewalog "menampung" dana dulu sebelum diteruskan (semacam
> dompet/escrow milik sendiri) — itu berpotensi masuk wilayah yang jelas
> membutuhkan izin PJP sendiri dari Bank Indonesia, yang mensyaratkan modal
> minimum ratusan juta hingga belasan miliar rupiah tergantung kategori
> aktivitas.

Kalau ada permintaan fitur (dari user manapun, termasuk Andi) yang implisit
butuh Rimbasewa/Sewalog menahan dana sebelum diteruskan ke vendor — flag
dulu ke Andi secara eksplisit sebelum diimplementasikan, jangan diam-diam
dibangun. Ini berlaku independen dari apakah opini hukum tertulis sudah
didapat atau belum.

## 3. Dokumen yang (kemungkinan) dibutuhkan untuk onboarding ke payment gateway

Belum diverifikasi ke dokumentasi resmi terbaru masing-masing gateway —
cross-check ke `research/pjp-licensing-submerchant-2026-08.md` bagian 2
(yang sudah fetch langsung ke docs.xendit.co dan docs.midtrans.com) sebelum
dipakai.

**Xendit** — diklaim mendukung Perseroan Perorangan secara eksplisit:
- NIB (bisa digantikan TDP/SIUP kalau belum terbit)
- Surat Pernyataan Pendirian Perseroan Perorangan
- KTP pemilik/direktur

**Midtrans** — dokumen yang diminta untuk entitas bisnis domestik:
- KTP pemilik bisnis
- NPWP Badan Usaha (PT Perorangan secara hukum tergolong PT, jadi NPWP
  Badan yang terbit otomatis dari proses AHU seharusnya memenuhi syarat —
  tapi konfirmasi ulang langsung ke tim Midtrans saat mendaftar, karena
  dokumentasi resmi mereka belum eksplisit menyebut "Perseroan Perorangan"
  secara terpisah dari PT biasa)

## 4. Kewajiban NIB untuk vendor (klaim belum diverifikasi, relevan untuk fase Rimbasewa nanti)

Draf ini mengklaim **Permendag No. 19 Tahun 2026** (berlaku sejak 8 Juni
2026) mewajibkan NIB untuk seluruh pelaku usaha yang berdagang di platform
digital — bukan cuma platformnya, tapi juga vendor/pedagang yang berjualan
di platform tersebut, dengan tenggat 18 bulan sejak aturan berlaku. **Belum
dicek ke teks resmi Permendag-nya** — verifikasi dulu sebelum dipakai untuk
desain onboarding vendor.

**Implikasi untuk desain onboarding vendor Rimbasewa (fase belum dimulai),
kalau klaim di atas benar:**
- Belum mendesak untuk pilot Sewalog sekarang (masih SaaS-tool, bukan
  marketplace).
- Begitu fase Rimbasewa dimulai, pertimbangkan field/status "NIB vendor"
  sebagai bagian dari `business_profiles` atau `marketplace_consents` —
  bukan wajib di hari pertama, tapi perlu ada jalur untuk vendor
  melengkapi ini dalam periode grace 18 bulan.

## 5. Yang (diklaim) bukan urusan platform — belum diverifikasi

- PJP license dari Bank Indonesia — diklaim bukan kebutuhan Rimbasewa
  selama arsitektur bagian 2 dijaga. **Ini justru klaim inti yang
  disclaimer di atas bilang belum terjawab** — jangan anggap poin ini
  sudah selesai.
- Izin PAJK (OJK Reg 4/2025) — diklaim untuk bisnis *financial aggregator*
  (fintech lending, wealthtech), bukan kategori yang sama dengan
  marketplace barang/jasa seperti Rimbasewa. Distingsi ini masuk akal
  secara konsep (beda regulator: OJK vs BI) tapi belum dicek ke sumber
  primer.

---

*Draf ini titik awal riset/diskusi, bukan rujukan final. Lihat juga tiga
file riset bersumber di `research/` (tidak di-commit git) untuk konteks
yang lebih lengkap dan terverifikasi soal pertanyaan lisensi PJP.*
