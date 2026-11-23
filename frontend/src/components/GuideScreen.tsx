import { useEffect, type ReactNode } from 'react';
import { BookOpen, MessageCircle } from 'lucide-react';
import { getWhatsAppShareUrl } from '../utils/formatters';
import { peekPendingGuideScroll, clearPendingGuideScroll } from '../lib/guideNavigation';
import { SHOW_TOKO_ONLINE_TAB } from './Navbar';
import {
  LateFeeIllustration,
  PackageDaysIllustration,
  DurationModeIllustration,
  TieredPriceIllustration,
  ReadinessIllustration,
  RescheduleVsExtendIllustration,
  InstallDeviceIllustration,
} from './guideIllustrations';

// Panduan pemakaian in-app, mengikuti alur fitur nyata di Sewalog. Jaga tetap
// sinkron kalau alur di tab lain berubah (label tombol, urutan langkah, dsb).

// Nomor dari VITE_SUPPORT_WHATSAPP_NUMBER (lihat frontend/.env.example) —
// sama dengan nomor di OnlineStoreScreen.tsx dan landing/src/lib/whatsapp.ts,
// satu nomor support Sewalog yang sama dipakai di tiga tempat.
const SEWALOG_SUPPORT_WHATSAPP = import.meta.env.VITE_SUPPORT_WHATSAPP_NUMBER ?? '62xxxxxxxxxx';

function Ui({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block bg-[#F1EEE2] border border-[#DBD5C1] rounded-md px-1.5 py-0.5 font-mono text-[11px] text-[#26302B] whitespace-nowrap">
      {children}
    </span>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="border-l-4 border-[#A65C2A] bg-[#FBF3EA] rounded-r-lg p-3 text-xs text-[#26302B] leading-relaxed">
      {children}
    </div>
  );
}

function FieldsTable({ rows }: { rows: { label: string; desc: ReactNode }[] }) {
  return (
    <table className="w-full text-left border-collapse text-xs">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-b border-[#E6E1D2] align-top last:border-0">
            <td className="py-2 pr-3 font-bold w-32 shrink-0 text-[#26302B]">{r.label}</td>
            <td className="py-2 text-[#6E6853] leading-relaxed">{r.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2 my-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="shrink-0 w-5 h-5 rounded-full bg-[#2B4739] text-[#FBFAF4] font-mono text-[10px] font-bold flex items-center justify-center mt-0.5">
            {i + 1}
          </span>
          <span className="text-xs text-[#26302B] leading-relaxed">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function StatusLegend({ items }: { items: { label: string; sub: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2 my-1">
      {items.map((s) => (
        <div key={s.label} className="flex items-center gap-2 rounded-lg border border-[#DBD5C1] bg-white px-2.5 py-1.5">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.color}`} />
          <span className="text-xs font-bold text-[#26302B]">{s.label}</span>
          <span className="text-[11px] text-[#6E6853]">— {s.sub}</span>
        </div>
      ))}
    </div>
  );
}

interface SectionProps {
  id: string;
  num: string;
  title: string;
  kicker?: string;
  children: ReactNode;
}

function Section({ id, num, title, kicker, children }: SectionProps) {
  return (
    <section id={id} className="bg-[#FBFAF4] border border-[#DBD5C1] rounded-2xl shadow-sm p-5">
      <h3 className="text-base font-bold text-[#26302B] flex items-baseline gap-2">
        <span className="text-[#A65C2A] font-mono text-sm">{num}</span>
        {title}
      </h3>
      {kicker && <p className="text-xs text-[#6E6853] mt-1 mb-3">{kicker}</p>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// Navbar (Navbar.tsx) adalah satu-satunya <header> sticky di halaman ini
// (logo+tombol + baris tab, keduanya ikut sticky sebagai satu blok) —
// tingginya beda signifikan antara HP (baris tab bisa wrap/scroll) dan
// desktop, jadi offset scroll TIDAK BOLEH angka tetap (class scroll-mt-*
// lama cuma menebak satu angka, ketinggalan di satu ukuran layar). Ukur
// tinggi sungguhan header lewat getBoundingClientRect() tiap kali diklik
// (permintaan Andi) — dipakai bareng TOC maupun link rujukan di dalam
// teks (SectionLink di bawah), supaya dua-duanya konsisten.
function scrollToGuideSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const header = document.querySelector('header');
  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const top = target.getBoundingClientRect().top + window.scrollY - headerBottom - 12;
  window.scrollTo({ top, behavior: 'smooth' });
}

// Link rujukan di dalam teks ("...lihat bagian 3") — sebelumnya cuma
// teks polos tidak bisa diklik. Pakai handler scroll yang sama dengan
// TOC (scrollToGuideSection) supaya offset header dihormati di sini
// juga, bukan cuma dari daftar isi di atas.
function SectionLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <a
      href={`#${id}`}
      onClick={(e) => {
        e.preventDefault();
        scrollToGuideSection(id);
      }}
      className="text-[#2B4739] font-semibold underline decoration-[#2B4739]/40 hover:decoration-[#2B4739] underline-offset-2"
    >
      {children}
    </a>
  );
}

// ID section SENGAJA deskriptif, tidak terikat ke angka tampilan (num) --
// urutan/nomor bisa berubah lagi di masa depan (seperti sinkronisasi 11 Nov
// 2026 ini) tanpa perlu ganti id, jadi SectionLink di bawah tidak ikut rusak.
// Urutan di sini WAJIB sama dengan urutan tab Navbar (lihat Navbar.tsx):
// Kalender, Transaksi Aktif, Katalog, Riwayat, Kelola Usaha, Etalase &
// Pesanan Online, Langganan, Panduan -- Setup/Catat Transaksi/Pasang di
// Layar Utama bukan tab, ditaruh di posisi yang logis mengajarkan alurnya.
const TOC: { id: string; num: string; title: string }[] = [
  { id: 'g-setup', num: '1', title: 'Masuk & Setup Usaha' },
  { id: 'g-pasang', num: '1b', title: 'Pasang Sewalog di Layar Utama' },
  { id: 'g-kalender', num: '2', title: 'Kalender Ketersediaan' },
  { id: 'g-transaksi-aktif', num: '3', title: 'Transaksi Aktif' },
  { id: 'g-cetak-thermal', num: '3b', title: 'Cetak Struk ke Printer Thermal' },
  { id: 'g-catat', num: '4', title: 'Catat Transaksi Sewa' },
  { id: 'g-katalog', num: '5', title: 'Katalog & Stok Alat' },
  { id: 'g-riwayat', num: '6', title: 'Riwayat Transaksi' },
  { id: 'g-kelola-usaha', num: '7', title: 'Kelola Usaha' },
  { id: 'g-etalase', num: '8', title: 'Etalase & Pesanan Online' },
  { id: 'g-pesanan', num: '8b', title: 'Pesanan Online' },
  { id: 'g-notifikasi', num: '8c', title: 'Notifikasi Pesanan Online' },
  // Tab-nya sendiri disembunyikan dari Navbar sejak 2 Nov 2026 (lihat
  // SHOW_TOKO_ONLINE_TAB, Navbar.tsx) — entri TOC & Section-nya ikut
  // disembunyikan di bawah (filter saat render), bukan dihapus, supaya
  // konsisten: tidak ada gunanya mengiklankan Panduan untuk tab yang
  // tidak bisa diakses sama sekali. Ditaruh sebagai "8d" (bukan "9") --
  // 10 Nov 2026 Navbar menaruh tab ini berdekatan dengan Etalase, dan "9"
  // sekarang dipakai Langganan supaya urutan Panduan sinkron dengan Navbar.
  { id: 'g-toko', num: '8d', title: 'Toko Online' },
  { id: 'g-langganan', num: '9', title: 'Langganan' },
  { id: 'g-catatan', num: 'A', title: 'Catatan Penting' },
];

export function GuideScreen({ businessName }: { businessName: string }) {
  const feedbackMessage = `Halo Sewalog, saya dari usaha "${businessName}" mau kasih masukan/keluhan soal aplikasi:\n\n`;
  const feedbackUrl = getWhatsAppShareUrl(SEWALOG_SUPPORT_WHATSAPP, feedbackMessage);

  // Dipicu dari tombol "Lihat panduan" di kartu Notifikasi (TrackingScreen.tsx)
  // lewat requestGuideScroll -- tunggu satu frame supaya section-nya sudah
  // ter-render dulu sebelum discroll.
  useEffect(() => {
    const pending = peekPendingGuideScroll();
    if (!pending) return;
    // Baru dihapus SAAT benar-benar discroll (bukan di awal efek) supaya
    // double-invoke StrictMode tidak saling menghabiskan nilainya -- lihat
    // catatan di guideNavigation.ts.
    const t = setTimeout(() => {
      clearPendingGuideScroll();
      scrollToGuideSection(pending);
    }, 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-[#E8EFEA] text-[#2B4739] flex items-center justify-center shrink-0">
          <BookOpen className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[#26302B]">Panduan Penggunaan</h2>
          <p className="text-xs text-[#6E6853]">Cara pakai Sewalog dari awal sampai transaksi selesai.</p>
        </div>
      </div>

      <div className="bg-white border border-[#DBD5C1] rounded-2xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          {TOC.filter((t) => t.id !== 'g-toko' || SHOW_TOKO_ONLINE_TAB).map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              onClick={(e) => {
                e.preventDefault();
                scrollToGuideSection(t.id);
              }}
              className="text-xs font-semibold text-[#26302B] hover:text-[#2B4739] hover:underline py-0.5"
            >
              <span className="font-mono text-[#A65C2A] mr-1.5">{t.num}</span>
              {t.title}
            </a>
          ))}
        </div>
      </div>

      <Section id="g-setup" num="1" title="Masuk & Setup Usaha" kicker="Langkah pertama saat pertama kali membuka Sewalog.">
        <p>
          Daftar dengan email &amp; password lewat tombol <Ui>Belum punya akun? Daftar</Ui> di halaman login, atau masuk
          langsung kalau sudah punya akun. Sesi login tersimpan di browser sampai kamu menekan tombol keluar (ikon
          pintu) di pojok kanan atas navbar.
        </p>
        <p>
          Lupa password? Tekan <Ui>Lupa Password?</Ui> di halaman login, isi email, lalu cek inbox (termasuk folder
          spam) untuk link reset. Klik link itu untuk masuk ke layar <Ui>Buat Password Baru</Ui>, isi password baru,
          dan langsung masuk memakainya. Berlaku sama untuk pemilik maupun karyawan — password itu urusan akun login,
          bukan peran usaha.
        </p>
        <p>
          Akun baru tanpa usaha akan diarahkan ke <Ui>Setup Usaha</Ui> — isi nama usaha, nama pemilik, dan nomor
          telepon, lalu <Ui>Simpan &amp; Lanjut</Ui>. Setelah itu langsung masuk ke Kalender Ketersediaan — kosong
          sampai alatnya diisi lewat tab <Ui>Katalog &amp; Stok Alat</Ui> (<SectionLink id="g-katalog">bagian 5</SectionLink>). Kalau alatnya banyak, lebih cepat
          lewat <Ui>Impor dari Excel</Ui> daripada mengetik satu per satu — lihat <SectionLink id="g-katalog">bagian 5</SectionLink>.
        </p>
        <Note>
          Kalau kamu membuka Sewalog lewat link undangan dari usaha lain (lihat <SectionLink id="g-kelola-usaha">bagian 7</SectionLink>), kamu akan diarahkan ke
          layar <Ui>Undangan Bergabung</Ui> alih-alih Setup Usaha — pilih <Ui>Gabung Sekarang</Ui> untuk masuk ke usaha
          yang mengundang, atau <Ui>Lewati</Ui> kalau memang mau bikin usaha sendiri. Satu akun hanya bisa terhubung
          ke satu usaha — kalau akunmu sudah terhubung ke usaha lain, pakai email lain untuk menerima undangan ini.
        </Note>
        <Note>
          Data usaha (nama, nama pemilik, no. telepon, dan toleransi telat sebelum kena denda) bisa diubah kapan saja
          lewat bagian <Ui>Info Usaha</Ui> di tab <Ui>Kelola Usaha</Ui> (lihat <SectionLink id="g-kelola-usaha">bagian 7</SectionLink>) — cuma terlihat dan bisa
          diakses oleh pemilik.
        </Note>
      </Section>

      <Section
        id="g-pasang"
        num="1b"
        title="Pasang Sewalog di Layar Utama"
        kicker="Sekali dipasang, Sewalog dibuka seperti aplikasi — bukan lewat browser setiap kali, dan notifikasi (bagian 8c) di iPhone butuh ini dulu."
      >
        <InstallDeviceIllustration />
        <p className="text-xs text-[#26302B] leading-relaxed">
          Android/laptop bisa juga lewat tombol <Ui>Pasang Aplikasi</Ui> di navbar (ikon unduh di dekat tombol Keluar)
          — tombol itu otomatis hilang kalau Sewalog sudah terpasang, atau kalau browsernya tidak mendukung instal.
        </p>
        <Note>
          Di iPhone/iPad, notifikasi Pesanan Online (<SectionLink id="g-notifikasi">bagian 8c</SectionLink>) baru bisa
          aktif SETELAH langkah "Tambah ke Layar Utama" di atas — browser Safari biasa (belum dipasang) tidak
          mendukung notifikasi web sama sekali.
        </Note>
      </Section>

      <Section id="g-kalender" num="2" title="Kalender Ketersediaan" kicker="Layar utama — ringkasan stok tiap alat untuk beberapa hari ke depan.">
        <p>Setiap alat ditampilkan sebagai satu baris dengan strip status harian, bukan grid kalender bulanan penuh:</p>
        <StatusLegend
          items={[
            { label: 'Tersedia', sub: 'stok masih cukup', color: 'bg-[#2B4739]' },
            { label: 'Sisa sedikit', sub: 'mendekati habis', color: 'bg-[#A65C2A]' },
            { label: 'Habis', sub: 'stok penuh terpakai', color: 'bg-[#A8412E]' },
          ]}
        />
        <p>
          Tekan tombol <Ui>+ Sewa Alat Ini</Ui> di bawah kartu alat untuk langsung membuka form <Ui>Catat Transaksi</Ui>{' '}
          dengan alat dan tanggal yang sedang dilihat sudah terisi otomatis. Ketersediaan dihitung langsung dari
          transaksi aktif — tidak ada jadwal tersimpan terpisah yang perlu disinkronkan manual.
        </p>
        <Note>
          Alat yang sedang disewa (status <Ui>Sedang Disewa</Ui>) memblokir stok sampai tanggal kembali yang
          dijadwalkan — tanggal SETELAH itu tetap tersedia untuk booking baru. Tapi kalau sudah lewat tanggal kembali
          dan belum ditandai <Ui>Kembalikan</Ui>, alat itu terkunci untuk booking baru TANPA BATAS WAKTU sampai kamu
          memproses pengembaliannya lewat <Ui>Proses Pengembalian</Ui> (<SectionLink id="g-transaksi-aktif">bagian 3</SectionLink>) — jadi kalau Kalender menunjukkan alat
          "Habis" padahal menurutmu sudah waktunya kembali, cek dulu Transaksi Aktif, mungkin ada transaksi yang
          belum ditutup. Alat yang sedang dalam kondisi ini ditandai label <Ui>Telat, N unit terkunci sampai
          dikembalikan</Ui> di kartunya (N = total unit yang terkunci, nama penyewa menyusul setelah tanda "·") —
          tekan labelnya untuk langsung membuka Transaksi Aktif dengan filter <Ui>Terlambat</Ui> sudah aktif. Segera
          tekan <Ui>Proses Pengembalian</Ui> begitu alatnya benar-benar kembali supaya stoknya cepat terbuka lagi
          untuk pelanggan lain.
        </Note>
        <Note>
          Kalau sudah punya <Ui>Paket</Ui> aktif di Katalog, muncul grup <Ui>Paket</Ui> di atas daftar alat — sisa per
          hari dihitung dari sisa komponen paling sedikit (bukan stok terpisah). Sama seperti alat, ada tombol{' '}
          <Ui>+ Sewa Paket Ini</Ui> untuk langsung membuka Catat Transaksi dengan isi paket sudah terpilih otomatis.
          Kalau hari tertentu sisa sedikit/habis, muncul keterangan kecil "Terbatas: [nama alat]" — alat itu yang
          jumlahnya paling mepet, jadi penyebab paketnya tidak bisa dipesan lebih banyak. Grup ini bisa dilipat, dan
          status lipatnya diingat di perangkat itu saja. Paket yang salah satu alatnya dinonaktifkan tidak ditampilkan
          sama sekali, sama seperti di Catat Transaksi/Etalase. Ada juga chip filter <Ui>📦 Paket</Ui> (sesudah{' '}
          <Ui>Semua</Ui>) kalau mau lihat daftar paket saja — kotak <Ui>Cari alat atau paket</Ui> ikut mencari nama
          paket juga.
        </Note>
      </Section>

      <Section id="g-transaksi-aktif" num="3" title="Transaksi Aktif" kicker="Daftar transaksi aktif — status pengambilan barang, jaminan yang ditahan, dan dua jenis denda dipisah eksplisit.">
        <p>Empat kartu ringkasan di atas: Sewa Terlambat, Jaminan Ditahan, Sedang Disewa, dan Tunggakan Denda. Bisa difilter per status transaksi di bawahnya.</p>
        <Note>
          Jaminan untuk transaksi <Ui>Siap Diambil</Ui> belum sungguhan diterima (barang+identitas belum diserahkan)
          — tampil netral "Rencana saat ambil", BUKAN "Ditahan", dan TIDAK ikut dihitung di kartu{' '}
          <Ui>Jaminan Ditahan</Ui>. Baru berubah jadi "Ditahan" setelah dikonfirmasi lewat dialog saat{' '}
          <Ui>Tandai Barang Diambil</Ui> ditekan.
        </Note>
        <p className="font-bold text-xs mt-2">Alur satu transaksi</p>
        <Steps
          items={[
            <>
              Saat pelanggan mengambil barang: tekan <Ui>Tandai Barang Diambil</Ui> — muncul dialog pengingat
              jaminan, wajib dicentang sebelum lanjut (bisa ganti jenis jaminan kalau pelanggan bawa yang beda, mis.
              SIM bukan KTP, atau pilih jaminan kalau transaksinya belum punya sama sekali).
            </>,
            <>Saat barang dikembalikan: tekan <Ui>Kembalikan</Ui> — kalkulator denda keterlambatan otomatis menyarankan nominal sesuai tanggal jatuh tempo, dan jaminan bisa langsung dilepas dari layar yang sama.</>,
            <>Kalau ada kerusakan/kehilangan alat: tekan <Ui>Tambah Denda</Ui> kapan saja sebelum transaksi selesai — dipisah dari denda keterlambatan, karena keduanya bisa muncul bersamaan dalam satu transaksi.</>,
          ]}
        />
        <Note>
          Denda keterlambatan dan denda kerusakan/kehilangan sengaja ditampilkan sebagai dua angka terpisah, tidak
          digabung — supaya pemilik bisa langsung tahu penyebabnya tanpa membuka rincian lebih dulu.
        </Note>
        <Note>
          Tarif denda keterlambatan mengikuti harga per hari alatnya (<SectionLink id="g-katalog">bagian 5</SectionLink>), bukan cuma tarif hari pertama —
          kalau alatmu punya harga per hari yang lebih murah untuk sewa lama, telat dihitung pakai tarif hari
          berikutnya sesuai pola itu. Contoh: sewa 2 hari lalu telat 1 hari, dendanya pakai tarif hari ke-3 alat itu,
          bukan tarif hari ke-1. Alat dengan harga tetap tidak berubah perhitungannya. Dihitung per alat (rinciannya
          tampil di layar <Ui>Kembalikan</Ui>), tetap menghormati toleransi telat usaha (<SectionLink id="g-setup">bagian 1</SectionLink>) sebelum mulai
          dihitung, dan nominalnya tetap bisa diubah manual sebelum disimpan.
        </Note>
        <LateFeeIllustration />
        <Note>
          Untuk transaksi dengan lebih dari satu alat, denda kerusakan/kehilangan bisa ditautkan ke alat spesifik
          mana yang kena (muncul sebagai pilihan dropdown di <Ui>Tambah Denda</Ui> dan di layar <Ui>Kembalikan</Ui>)
          — nama alatnya lalu ikut tampil di rincian denda, struk WA, dan Nota Sewa. Untuk transaksi satu alat,
          penautan ini otomatis, tidak perlu dipilih manual.
        </Note>
        <Note>
          Batas waktu pengembalian dihitung dari jam <Ui>Tandai Barang Diambil</Ui> ditekan (jam pengambilan barang
          sungguhan, muncul sebagai baris "Diambil: ..." di kartu transaksi) — bukan dari jam transaksi pertama kali
          dicatat. Untuk booking yang dipesan duluan lalu diambil beberapa hari kemudian, ini memastikan toleransi
          telat dihitung dari jam ambil yang benar, bukan jam pesan.
        </Note>
        <Note>
          Boleh menekan <Ui>Tandai Barang Diambil</Ui> SEBELUM tanggal Mulai Sewa (pelanggan ambil lebih awal) — stok
          malam tambahan itu ikut dicek otomatis, sama seperti transaksi normal. Kalau muncul pesan{' '}
          <em>"Alat ... tidak cukup pada ..."</em>, artinya alat itu sudah dipakai transaksi lain pada malam
          tersebut — transaksi TETAP berstatus <Ui>Siap Diambil</Ui> (tidak ada yang berubah/hilang), coba lagi nanti
          atau tanyakan ke pelanggan apa bisa ambil di tanggal Mulai Sewa aslinya.
        </Note>
        <p>
          Transaksi bisa <Ui>Dibatalkan</Ui> kapan saja sebelum selesai — jaminan yang ditahan otomatis dilepas begitu
          dibatalkan.
        </p>
        <p className="font-bold text-xs mt-2">Ubah Jadwal &amp; Perpanjang</p>
        <p>
          Tombol <Ui>Ubah Jadwal</Ui> (transaksi <Ui>Siap Diambil</Ui>, boleh ganti tanggal ambil DAN kembali) atau{' '}
          <Ui>Perpanjang</Ui> (transaksi <Ui>Aktif</Ui>, cuma tanggal kembali yang bisa dimajukan) di tiap kartu
          transaksi. Stok tanggal baru dicek otomatis, dan kalau jumlah hari berubah, total harga dihitung ulang dari
          tarif alat SAAT transaksi ini dibuat (bukan harga katalog sekarang) — tetap bisa diubah manual kalau perlu.
          Perpanjang otomatis menggeser batas telat, jadi pelanggan yang minta tambah hari sebelum terlambat tidak
          kena denda.
        </p>
        <RescheduleVsExtendIllustration />
        <Note>
          Owner bisa atur <Ui>Ubah Jadwal paling lambat H-berapa</Ui> di Kelola Usaha — ini CUMA PERINGATAN, bukan
          penolakan. Mengubah jadwal setelah batas ini lewat tetap bisa dilakukan oleh owner maupun karyawan, asal
          kolom <Ui>Alasan perubahan</Ui> diisi. Aturan ini tidak berlaku untuk Perpanjang (barang sudah diambil).
          Semua perubahan tercatat di <Ui>Riwayat Perubahan Jadwal</Ui> di kartu transaksi, lengkap dengan siapa,
          kapan, dan alasannya — lalu ada tombol <Ui>Kirim Jadwal Baru via WA</Ui> untuk kabari pelanggan.
        </Note>
        <p className="font-bold text-xs mt-2">Ubah Alat</p>
        <p>
          Tombol <Ui>Ubah Alat</Ui> (transaksi <Ui>Siap Diambil</Ui> saja — tanggal tidak ikut berubah di sini)
          untuk menambah, mengurangi jumlah, atau menghapus alat sebelum barang diambil. Alat yang sudah ada tetap
          pakai harga saat transaksi dibuat, alat baru pakai harga katalog sekarang, dan stok dicek ulang otomatis.
          Minimal satu alat harus tersisa — kalau mau membatalkan seluruh pesanan, pakai tombol <Ui>Batalkan</Ui>.
          Semua perubahan tercatat di <Ui>Riwayat Ubah Alat</Ui>, lalu ada tombol{' '}
          <Ui>Kirim Rincian Baru via WA</Ui> untuk kabari pelanggan.
        </p>
        <Note>
          Transaksi berisi paket (<SectionLink id="g-katalog">bagian 5</SectionLink>) tampil terkelompok di{' '}
          <Ui>Ubah Alat</Ui> di bawah judul "Paket X" — selama tidak disentuh, label paketnya tetap ada. Mengubah
          jumlah atau menghapus salah satu baris komponen melepas label paket untuk SISA baris di grup itu juga
          (bukan cuma baris yang diubah), tapi harga baris lain yang tidak disentuh tidak ikut berubah. Alat baru
          yang ditambah lewat Ubah Alat tidak pernah ikut jadi bagian paket.
        </Note>
        <Note>
          Tombol <Ui>Cetak Nota</Ui> di tiap kartu transaksi membuka versi nota yang bisa langsung dicetak atau
          disimpan sebagai PDF lewat dialog print browser (pilih tujuan "Simpan sebagai PDF") — tidak perlu aplikasi
          tambahan. Di jendela yang sama ada juga tombol <Ui>Cetak Struk</Ui> untuk printer struk kecil (thermal) —
          lihat <SectionLink id="g-cetak-thermal">bagian 3b</SectionLink>.
        </Note>
        <Note>
          Struk WA dan Nota Sewa untuk transaksi berisi paket menampilkan "Paket X ×N" sebagai satu baris ringkas,
          dengan rincian alat penyusunnya di bawahnya — bukan daftar alat lepas tanpa pengelompokan.
        </Note>

        <p className="font-bold text-xs mt-2">Pelunasan (melunasi DP)</p>
        <p>
          <Ui>Sisa Tagihan</Ui> di tiap kartu sekarang menghitung sewa + barang jual + denda dikurangi yang sudah
          dibayar — kalau negatif (lebih bayar, mis. setelah Ubah Alat mengurangi total setelah pelanggan sudah
          bayar), tampil sebagai <Ui>Lebih Bayar</Ui> (bukan "LUNAS") supaya tidak kelupaan dikembalikan/dikoreksi.
        </p>
        <Steps
          items={[
            <>Tekan <Ui>Catat Pembayaran</Ui> di kartu transaksi (muncul kalau sisa belum 0) — isi nominal (ada
              tombol cepat "Lunasi sisa"), cara bayar, catatan opsional. Karyawan boleh memakai ini.</>,
            <>Atau centang <Ui>Lunasi sekarang</Ui> langsung di dialog <Ui>Tandai Barang Diambil</Ui> (sisa saat itu
              baru sewa+barang jual, denda belum ada) atau di dialog <Ui>Proses Pengembalian</Ui> SETELAH denda
              diisi (sisa sudah termasuk denda).</>,
          ]}
        />
        <Note>
          Pembayaran tidak bisa melebihi sisa tagihan — sistem menolaknya. Riwayat pembayaran (termasuk DP awal)
          bisa dilihat di Nota (<Ui>Cetak Nota</Ui>) bersama status LUNAS/Sisa/Lebih Bayar.
        </Note>

        <p className="font-bold text-xs mt-2">Batalkan (bukan hapus)</p>
        <p>
          Tidak ada hapus permanen transaksi di Sewalog — <Ui>Batalkan</Ui> cuma mengubah status, riwayatnya tetap
          ada (siapa, kapan, alasan). Karyawan bisa membatalkan transaksi <Ui>Siap Diambil</Ui>/<Ui>Sedang Disewa</Ui>{' '}
          seperti biasa. <strong>Pemilik usaha</strong> juga bisa membatalkan transaksi yang SUDAH{' '}
          <Ui>Selesai</Ui>/<Ui>Terlambat</Ui> (lewat <Ui>Riwayat Transaksi</Ui>, <SectionLink id="g-riwayat">bagian 6</SectionLink>) untuk kasus salah input — alasan WAJIB diisi untuk ini.
        </p>
        <Note>
          Membatalkan transaksi yang sudah ada pembayarannya TIDAK menghapus pembayaran itu — muncul peringatan
          "Ada pembayaran Rp X, pastikan sudah dikembalikan" dan tombol opsional "Catat pengembalian dana" supaya
          laporan kas tetap jujur. Kalau tidak dicatat, uang itu tetap terhitung diterima di Laporan.
        </Note>
      </Section>

      <Section
        id="g-cetak-thermal"
        num="3b"
        title="Cetak Struk ke Printer Thermal"
        kicker="Bisa dari HP Android atau laptop. iPhone belum bisa ke printer Bluetooth."
      >
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#DBD5C1]">
              <th className="py-1.5 pr-2 font-bold text-[#26302B]">Perangkat</th>
              <th className="py-1.5 pr-2 font-bold text-[#26302B]">Bisa?</th>
              <th className="py-1.5 font-bold text-[#26302B]">Cara</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#E6E1D2]">
              <td className="py-1.5 pr-2 text-[#26302B]">Android + printer Bluetooth</td>
              <td className="py-1.5 pr-2 text-[#2B4739] font-bold">Bisa</td>
              <td className="py-1.5 text-[#6E6853]">Lewat aplikasi bantu RawBT</td>
            </tr>
            <tr className="border-b border-[#E6E1D2]">
              <td className="py-1.5 pr-2 text-[#26302B]">Laptop + USB</td>
              <td className="py-1.5 pr-2 text-[#2B4739] font-bold">Bisa</td>
              <td className="py-1.5 text-[#6E6853]">Cetak lewat browser + driver printer</td>
            </tr>
            <tr className="border-b border-[#E6E1D2]">
              <td className="py-1.5 pr-2 text-[#26302B]">iPhone + Bluetooth</td>
              <td className="py-1.5 pr-2 text-sewa-danger font-bold">Tidak bisa</td>
              <td className="py-1.5 text-[#6E6853]">Kirim struk WA / simpan PDF</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-2 text-[#26302B]">iPhone + printer Wi-Fi (AirPrint)</td>
              <td className="py-1.5 pr-2 text-[#2B4739] font-bold">Bisa</td>
              <td className="py-1.5 text-[#6E6853]">Cetak lewat browser</td>
            </tr>
          </tbody>
        </table>

        <p className="font-bold text-xs mt-2">Siapkan sekali di tombol Cetak Struk (Nota) atau kartu Printer Struk di Kelola Usaha</p>
        <Steps
          items={[
            <>Pilih cara printer tersambung: Bluetooth ke HP, kabel USB ke laptop, atau belum punya printer.</>,
            <>
              Khusus Bluetooth di Android: pasang aplikasi bantu <Ui>RawBT</Ui> (gratis, sekali saja), sambungkan
              printer lewat Pengaturan Bluetooth HP (PIN biasanya 0000/1234), lalu buka RawBT dan pilih printer
              tersebut.
            </>,
            <>Pilih ukuran kertas (58 mm paling umum, atau 80 mm) — ukur lebar gulungan kertas kalau tidak yakin.</>,
            <>Tekan <Ui>Cetak Tes</Ui> — kalau kertas keluar, tekan <Ui>Ya</Ui> untuk menyimpan pengaturan.</>,
          ]}
        />
        <Note>
          Pengaturan printer disimpan PER PERANGKAT (di HP/laptop itu sendiri), bukan ke akun — kalau usahamu dipakai
          di beberapa HP, tiap HP perlu disiapkan sendiri-sendiri sekali. Teks kecil <Ui>Printer: ... · Ubah</Ui> di
          bawah tombol <Ui>Cetak Struk</Ui> membuka ulang wizard ini kapan saja.
        </Note>
        <Note>
          HP Huawei tanpa Google Play (hanya AppGallery): belum ada kepastian RawBT tersedia di sana — kalau tidak
          ditemukan, cetak lewat Bluetooth belum didukung di HP tersebut untuk sekarang, pakai kirim struk lewat WA
          atau simpan PDF.
        </Note>

        <p className="font-bold text-xs mt-2">Masalah umum</p>
        <FieldsTable
          rows={[
            { label: 'Kertas kosong', desc: 'Cek sisi kertas — gosok dengan kuku, sisi yang menghitam adalah sisi cetak, mungkin gulungannya terbalik.' },
            { label: 'Tulisan terpotong', desc: 'Ukuran kertas yang dipilih salah — ubah lewat teks "Printer: ... · Ubah" ke 58 mm atau 80 mm sesuai printer.' },
            { label: 'Printer tidak muncul', desc: 'Pastikan sudah dipasangkan (paired) di Pengaturan Bluetooth HP dan dipilih di dalam aplikasi RawBT.' },
            { label: 'Huruf aneh di struk', desc: 'Biasanya normal setelah dicoba ulang — struk sudah otomatis memakai huruf standar, bukan huruf khusus.' },
            { label: 'RawBT tidak terbuka', desc: 'Pastikan RawBT sudah terpasang (lihat langkah di atas) — tanpa RawBT terpasang, tombol Cetak Struk tidak bisa meneruskan ke printer Bluetooth.' },
          ]}
        />
      </Section>

      <Section id="g-catat" num="4" title="Catat Transaksi Sewa" kicker="Form input cepat, dipakai sambil melayani pelanggan yang menunggu.">
        <Steps
          items={[
            <>Tekan <Ui>Catat Transaksi</Ui> di navbar (selalu terlihat, tidak perlu berpindah tab dulu).</>,
            <>Ketik nama penyewa — kalau pernah sewa sebelumnya, daftar saran pelanggan lama muncul otomatis (dicari dari nama, HP, atau alamat, jadi bisa ketik salah satu yang paling diingat). Tiap saran menampilkan HP dan alamat sekaligus supaya mudah dibedakan kalau ada nama yang sama. Pilih salah satu untuk mengisi HP/Alamat sekaligus, atau lanjut ketik biasa untuk pelanggan baru.</>,
            <>Isi nomor WhatsApp penyewa (kalau belum otomatis terisi). Opsional: tekan <Ui>Foto Wajah / Setengah Badan</Ui> untuk ambil foto singkat penyewa dari kamera.</>,
            <>Cari alat lewat kotak pencarian (nama, varian, ukuran, atau warna) kalau katalog sudah banyak, lalu centang satu atau lebih alat — bisa multi-item dalam satu transaksi. Varian/ukuran/warna alat (kalau diisi) ditampilkan di bawah nama alat supaya tidak salah pilih antar varian yang mirip.</>,
            <>Pilih <Ui>Mulai Sewa</Ui> &amp; <Ui>Tanggal Kembali</Ui>. Total harga terhitung otomatis, termasuk harga per hari kalau alatnya punya tarif lebih murah untuk sewa lama (lihat <SectionLink id="g-katalog">bagian 5</SectionLink>).</>,
            <>Pilih jenis jaminan (KTP/SIM/STNK/Paspor/Uang/Lainnya) — kalau pilih <Ui>Uang</Ui>, jumlah deposit WAJIB diisi lebih dari
            Rp0 (ditolak kalau kosong, di form maupun server). Jenis jaminan lain tidak wajib isi jumlah. Lalu tekan <Ui>Simpan &amp; Terbitkan Nota</Ui>.</>,
          ]}
        />
        <Note>
          Memilih pelanggan lama dari daftar saran menautkan transaksi baru ke data pelanggan yang sama (bukan bikin
          baris baru) — muncul catatan kecil "Pernah sewa Nx" sebagai konfirmasi. Kalau salah satu field diedit manual
          setelah memilih, pilihan itu otomatis dilepas dan dianggap pelanggan baru saat disimpan.
        </Note>
        <Note>
          Kolom <Ui>Uang Muka (DP)</Ui> &amp; <Ui>Cara Bayar DP</Ui> opsional — isi kalau pelanggan sudah bayar
          sebagian saat transaksi dicatat. DP TIDAK BOLEH melebihi Total Harga (ditolak kalau dipaksakan). Sisa
          tagihannya nanti dilunasi lewat <Ui>Catat Pembayaran</Ui> di Transaksi Aktif — lihat{' '}
          <SectionLink id="g-transaksi-aktif">bagian 3</SectionLink>, bagian Pelunasan.
        </Note>
        <Note>
          Kalau muncul pesan <em>"Alat ... tidak cukup pada ... (sisa 0, diminta N)"</em> saat Simpan, artinya stok
          alat itu baru saja habis diambil kasir lain tepat sebelum kamu — BUKAN kesalahan input kamu. Transaksi ini
          sengaja TIDAK tersimpan sama sekali (bukan separuh tersimpan), supaya stok tidak pernah dobel-dipesan.
          Kurangi jumlah alatnya, pilih tanggal lain, atau cek Kalender Ketersediaan (<SectionLink id="g-kalender">bagian 2</SectionLink>) dulu sebelum coba
          Simpan lagi.
        </Note>
        <Note>
          Untuk transaksi yang langsung <Ui>Sedang Disewa</Ui> (ambil hari ini, bukan dipesan dulu) dan tidak pilih
          jaminan sama sekali — muncul kotak centang tambahan "Konfirmasi: tidak ada jaminan untuk transaksi ini",
          wajib dicentang sebelum bisa disimpan, supaya tidak kelupaan tanpa sadar.
        </Note>
        <Note>
          Catatan Identitas Jaminan (opsional) cukup jenis &amp; nama saja, mis. "KTP a.n. Budi" — JANGAN tulis nomor
          KTP/SIM/dokumen lain. Sewalog sengaja tidak pernah menyimpan nomor identitas semacam itu.
        </Note>
        <Note>
          Foto penyewa sengaja bukan foto KTP/dokumen — cukup wajah/setengah badan, untuk bukti siapa yang mengambil
          barang kalau ada sengketa jaminan nanti, tanpa menyimpan data sensitif seperti NIK. Muncul sebagai foto
          bulat kecil di samping nama pelanggan pada kartu transaksi di layar Transaksi Aktif (<SectionLink id="g-transaksi-aktif">bagian 3</SectionLink>).
        </Note>
        <Note>
          Struk transaksi bisa langsung dikirim ke pelanggan lewat tombol <Ui>Kirim Struk WA</Ui> di layar Transaksi
          Aktif (<SectionLink id="g-transaksi-aktif">bagian 3</SectionLink>) — tidak perlu ketik ulang rincian secara manual. Ada juga tombol <Ui>Cetak Nota</Ui> di
          sebelahnya untuk versi cetak/PDF (lihat <SectionLink id="g-transaksi-aktif">bagian 3</SectionLink>).
        </Note>
        <Note>
          Kalau punya paket (<SectionLink id="g-katalog">bagian 5</SectionLink>), bagian <Ui>Pilih Paket</Ui>
          muncul di atas daftar alat satuan — centang paket, atur jumlah paketnya, lalu tetap bisa menambah alat
          lain di luar paket itu lewat daftar alat biasa di bawahnya (dua baris terpisah kalau alatnya sama,
          harganya memang beda). Tidak butuh salah satu komponen paket? Kurangi atau hapus barisnya di rincian
          paket sebelum Simpan — muncul info "Isi paket diubah", harga paket berkurang persis sebesar porsi alat
          yang dikurangi/dihapus itu, komponen lain tetap harga semula.
        </Note>
        <Note>
          Kalau punya Barang Jual (<SectionLink id="g-katalog">bagian 5</SectionLink>), bagian lipat{' '}
          <Ui>Tambahan: barang jual</Ui> muncul di bagian bawah form — harganya flat (tidak tergantung jumlah hari
          sewa), langsung dijumlahkan ke Total Harga. Stok otomatis berkurang saat Simpan, dan kembali otomatis
          kalau transaksi ini dibatalkan nanti.
        </Note>
        <Note>
          <Ui>Mulai Sewa</Ui> ≠ <Ui>Diambil</Ui>: <Ui>Mulai Sewa</Ui> adalah tanggal masa sewa mulai dihitung (dipakai
          untuk harga &amp; denda telat). Kalau barang SUNGGUHAN diambil lebih awal dari itu (mis. malam sebelumnya,
          toleransi perjalanan), tanggal/jam pengambilan sungguhan muncul sebagai baris terpisah "Diambil: ..." di
          kartu transaksi, struk, dan Nota — malam pengambilan itu sendiri tetap GRATIS (tidak menambah hari sewa),
          tapi stoknya otomatis ikut terkunci sejak malam itu juga (supaya tidak dobel-dipesan).
        </Note>
        <Note>
          Kalau <Ui>Mulai Sewa</Ui> dipilih di masa depan (bukan hari ini), muncul kotak centang{' '}
          <Ui>Alat diambil sekarang</Ui> — centang kalau pelanggan sungguhan membawa barangnya SEKARANG juga (bukan
          nanti di tanggal Mulai Sewa). Transaksi langsung berstatus <Ui>Sedang Disewa</Ui> (sama seperti walk-in
          biasa, jaminan &amp; Lunasi Sekarang ikut muncul), dan stok langsung terkunci mulai hari ini. Hanya bisa
          dipakai kalau Mulai Sewa maksimal <strong>2 hari</strong> dari hari ini (lebih dari itu, catat sebagai
          pesanan biasa dulu, lalu tekan <Ui>Tandai Barang Diambil</Ui> belakangan di Transaksi Aktif — lihat{' '}
          <SectionLink id="g-transaksi-aktif">bagian 3</SectionLink>) — kalau tepat di batas 2 hari, muncul teks kecil
          "Stok terkunci mulai hari ini" sebagai pengingat.
        </Note>
        <Note>
          Cara tanggal ambil &amp; kembali dihitung jadi "berapa hari" tergantung pengaturan{' '}
          <Ui>Cara Hitung Durasi Sewa</Ui> di tab Kelola Usaha (<SectionLink id="g-kelola-usaha">bagian 7</SectionLink>) — default <strong>per malam</strong> (ambil
          Sabtu, kembali Minggu = 1 hari, tanggal ambil &amp; kembali tidak boleh sama). Kalau usahamu pakai{' '}
          <strong>per hari kalender</strong>, tanggal ambil &amp; kembali boleh sama (dihitung 1 hari) dan Sabtu-Minggu
          jadi 2 hari.
        </Note>
      </Section>

      <Section id="g-katalog" num="5" title="Katalog & Stok Alat" kicker="Kelola daftar alat yang bisa disewakan, termasuk harga dan foto.">
        <FieldsTable
          rows={[
            { label: 'Kode & Nama', desc: 'Kode internal (mis. TND-04) dan nama alat yang tampil di seluruh layar lain.' },
            { label: 'Total Stok', desc: 'Jumlah unit yang dimiliki.' },
            { label: 'Harga/hari', desc: 'Tarif harian normal.' },
            {
              label: 'Harga per hari',
              desc: 'Opsional, lewat "Atur harga per hari" — isi tarif hari ke-2 sampai ke-5 dan hari ke-6 dst kalau sewa lama dapat harga lebih murah per hari. Tingkat yang dikosongkan otomatis ikut tarif tingkat sebelumnya, jadi alat dengan harga tetap cukup isi "Sewa /Hari" saja.',
            },
            {
              label: 'Paket N hari',
              desc: 'Untuk alat sewa flat per-trip (bukan per hari lepas): isi "Sewa /Hari" dengan harga paketnya, isi "Tarif lewat paket" kalau ada tarif untuk sewa melewati paket, lalu klik tombol Paket 2/3/4/5 hari — otomatis mengisi hari ke-2 sampai N dengan Rp0 dan hari setelahnya dengan "Tarif lewat paket" tadi. Lihat juga pengaturan Paket Minimal/Maksimal Hari Sewa (bagian 7).',
            },
            { label: 'Foto', desc: 'Unggah langsung dari galeri/kamera — foto otomatis dikompres sebelum diunggah, tidak perlu tempel URL manual.' },
            {
              label: 'Jeda persiapan',
              desc: 'Opsional, dalam JAM — berapa jam alat ini butuh dibersihkan/dicek sebelum siap disewa lagi setelah kembali (mis. lampu/kompor cukup beberapa jam, tenda bisa perlu lebih lama). 0 (default) berarti langsung bisa disewa lagi hari itu juga. Alat dengan jeda persiapan tidak akan muncul tersedia sampai jedanya lewat, baik di Kalender, saat Catat Transaksi, maupun di halaman publik Etalase Online — dihitung per hari kalender (kurang dari 24 jam tetap memblokir hari kembalinya penuh, bukan cuma sebagian jam itu saja).',
            },
          ]}
        />
        <p>
          Alat yang sudah tidak dipakai lagi cukup <Ui>Nonaktifkan</Ui> (ikon daya), bukan dihapus — supaya riwayat
          transaksi lama yang memakai alat tersebut tetap utuh dan bisa ditelusuri.
        </p>
        <TieredPriceIllustration />
        <PackageDaysIllustration />
        <ReadinessIllustration />

        <h4 className="text-sm font-bold text-[#26302B] pt-2">Paket Alat (gabungan beberapa alat jadi satu)</h4>
        <p>
          Untuk paket yang sering disewa bersamaan (mis. "Paket Tektok" = tenda + carrier + headlamp), buka tab{' '}
          <Ui>Paket</Ui> di samping tab <Ui>Alat</Ui> di layar ini — terlihat dan bisa dikelola oleh pemilik{' '}
          <strong>maupun karyawan</strong>, sama seperti tab Alat.
        </p>
        <Steps
          items={[
            <>Tekan <Ui>Tambah Paket</Ui>, isi nama paket dan pilih minimal 2 alat (atau 1 alat dengan jumlah
              minimal 2) dari katalog beserta jumlah masing-masing.</>,
            <>Pilih <Ui>Cara Harga Paket</Ui>: <Ui>Ikuti harga alat</Ui> (total otomatis dari harga katalog tiap
              alat komponen, bisa ditambah potongan opsional persen atau nominal Rp per hari) atau{' '}
              <Ui>Harga paket sendiri</Ui> (nominal tetap per hari, bisa bertingkat sama seperti harga alat biasa).</>,
            <>Simpan — paket langsung bisa dipilih di Catat Transaksi (<SectionLink id="g-catat">bagian 4</SectionLink>).</>,
          ]}
        />
        <Note>
          Paket <strong>bukan</strong> alat baru dengan stok sendiri — saat dipilih di Catat Transaksi, paket
          otomatis dipecah jadi alat satuan penyusunnya. Kalender ketersediaan, jeda persiapan, dan denda telat
          semuanya tetap dihitung per alat seperti biasa, tidak ada rumus stok tambahan untuk paket.
        </Note>
        <Note>
          Paket yang salah satu alat penyusunnya sedang <Ui>Nonaktif</Ui> tidak bisa dipilih — muncul tanda
          peringatan di kartu paket (di layar ini) dan di Catat Transaksi, sampai alat itu diaktifkan lagi atau
          dikeluarkan dari resep paket (lewat <Ui>Ubah</Ui>).
        </Note>
        <p>
          Tips: foto semua isi paket dalam satu frame (ditata di lantai/alas) supaya pelanggan langsung tahu
          isinya. Kalau foto paket dikosongkan, Etalase otomatis memakai foto alat pertama dalam paket.
        </p>
        <h4 className="text-sm font-bold text-[#26302B] pt-2">Barang Jual (habis pakai)</h4>
        <p>
          Untuk barang yang dijual-belikan ke pelanggan (bukan disewakan), mis. baterai, jas hujan plastik, hand
          warmer — buka tab <Ui>Barang Jual</Ui> di samping tab <Ui>Alat</Ui>/<Ui>Paket</Ui>. Sewalog{' '}
          <strong>bukan aplikasi kasir</strong> — fitur ini sengaja ringan, tanpa modal/laba, riwayat stok masuk,
          atau barcode.
        </p>
        <Steps
          items={[
            <>Tekan <Ui>Tambah Barang</Ui>, isi nama, harga jual per buah, stok sekarang, dan batas stok menipis
              (opsional, cuma buat badge peringatan).</>,
            <>Simpan — barang langsung bisa ditambahkan di bagian <Ui>Tambahan: barang jual</Ui> saat{' '}
              <Ui>Catat Transaksi</Ui> (<SectionLink id="g-catat">bagian 4</SectionLink>) atau <Ui>Ubah Alat</Ui> (<SectionLink id="g-transaksi-aktif">bagian 3</SectionLink>).</>,
          ]}
        />
        <p>
          Stok baru datang? Tekan <Ui>+ Tambah stok</Ui> di daftar (cukup isi jumlahnya) — jangan edit angka Stok di
          form <Ui>Ubah</Ui> untuk menambah stok, karena itu MENIMPA angkanya langsung (bisa salah kalau ada
          transaksi lain yang baru saja mengurangi stok di saat yang bersamaan). Form <Ui>Ubah</Ui> dipakai untuk
          koreksi angka yang memang keliru, bukan penambahan rutin.
        </p>
        <Note>
          Stok berkurang OTOMATIS saat transaksi disimpan, dan KEMBALI otomatis kalau transaksi itu dibatalkan —
          tidak berubah sama sekali saat alat lain dalam transaksi yang sama ditandai Diambil/Dikembalikan/Selesai
          (barang jual sudah lepas tangan begitu transaksinya tersimpan, beda dari alat sewa yang masih berputar).
        </Note>
        <Note>
          Barang jual yang sudah dinonaktifkan tetap boleh dikurangi/dihapus dari transaksi yang sudah
          memuatnya lewat <Ui>Ubah Alat</Ui> (supaya stoknya bisa dikembalikan), tapi tidak bisa dipilih sebagai
          tambahan baru — sama seperti alat sewa yang dinonaktifkan.
        </Note>
        <Note>
          Di struk WA, Nota Sewa cetak, dan struk printer thermal (<SectionLink id="g-cetak-thermal">bagian 3b</SectionLink>), barang jual selalu tampil di
          bagian TERPISAH dari alat sewa (dengan Total Sewa dan Total Barang Jual sendiri-sendiri) — supaya tidak
          tercampur dengan alat yang harus dikembalikan.
        </Note>

        <h4 className="text-sm font-bold text-[#26302B] pt-2">Impor dari Excel (banyak alat sekaligus)</h4>
        <p>
          Dipakai saat pertama kali mengisi banyak alat sekaligus, atau mengubah harga banyak alat dalam satu waktu —
          daripada mengetik satu per satu. Tombol <Ui>Tambah Alat Baru</Ui> dan <Ui>Impor dari Excel</Ui> ada di
          sub-tab <Ui>Alat</Ui>, sebaris dengan kotak <Ui>Cari</Ui> — <Ui>Impor dari Excel</Ui> cuma terlihat untuk
          pemilik usaha.
        </p>
        <Steps
          items={[
            <>Tekan <Ui>Impor dari Excel</Ui>, lalu unduh template Excel-nya.</>,
            <>Isi data alat di template — satu baris untuk satu jenis alat, kolom bertanda * wajib diisi, harga cukup
              angka (mis. 30000). Hapus baris contoh sebelum menyimpan.</>,
            <>Simpan file, lalu pilih file itu di layar impor.</>,
            <>Cek pratinjau — lihat alat mana yang baru, mana yang berubah (dengan rincian apa yang berubah), dan mana
              yang perlu diperbaiki dulu sebelum lanjut.</>,
            <>Tekan <Ui>Simpan</Ui>. Alat yang sudah ada diperbarui (bukan dibuat dobel), alat baru ditambahkan.</>,
          ]}
        />
        <Note>
          Beberapa aturan penting: alat dicocokkan lewat Kode (kalau Kode kosong, lewat kombinasi nama + varian +
          ukuran + warna) — isi Kode supaya pencocokan lebih aman. Sel yang dikosongkan di file TIDAK menghapus data
          lama. Alat yang tidak ada di file tetap aman, tidak dihapus. Alat yang sudah dinonaktifkan tidak otomatis
          aktif lagi hanya karena muncul di file. Harga hari ke-2 dst adalah tarif HARI ITU SENDIRI (bukan total),
          kosongkan kalau sama dengan hari sebelumnya. Foto boleh diisi lewat link Google Drive yang dibagikan "siapa
          saja yang memiliki link" — link Instagram/Facebook tidak bisa dipakai. Kalau jumlah unit diturunkan sampai
          di bawah unit yang sedang disewa/dipesan, akan muncul peringatan dan kamu perlu centang "Saya paham" dulu
          sebelum bisa menyimpan.
        </Note>
        <Note>
          Alat harga paket (sewa flat N hari, lihat <SectionLink id="g-katalog">bagian 5</SectionLink>) — isi hari 1 = harga
          paket, hari 2 sampai hari ke-N = 0, lalu isi hari setelahnya (termasuk "Harga hari 6 dst") kalau ada tarif
          lewat paket. Contoh baris di template: Paket Camping 4H (hari 1 = 100000, hari 2–4 = 0, hari 5 dst =
          20000). JANGAN biarkan sel di antara hari 2..6 kosong kalau ada tarif lewat paket — sel kosong ikut
          mewarisi tarif hari sebelumnya, jadi kalau hari sebelumnya 0, sel kosong itu ikut jadi Rp0 juga (bukan
          tarif lewat paket yang kamu maksud). Pratinjau impor akan menandai baris seperti ini dengan peringatan,
          tapi impornya tetap bisa dilanjutkan — isi dulu sel yang kelewat sebelum tekan Simpan.
        </Note>
      </Section>

      <Section id="g-riwayat" num="6" title="Riwayat Transaksi" kicker="Khusus pemilik — rekap semua transaksi termasuk yang sudah selesai/dibatalkan, plus ringkasan omset & piutang.">
        <p>
          Beda dari layar Transaksi Aktif yang cuma menampilkan status yang sedang berjalan, Riwayat Transaksi menampilkan{' '}
          <Ui>semua</Ui> status — termasuk yang sudah <Ui>Selesai</Ui> atau <Ui>Dibatalkan</Ui>, yang setelah
          ditutup tidak akan muncul lagi di layar lain manapun.
        </p>
        <FieldsTable
          rows={[
            { label: 'Total Transaksi', desc: 'Jumlah transaksi pada rentang tanggal yang dipilih (tidak termasuk yang Dibatalkan).' },
            {
              label: 'Sudah Diterima',
              desc:
                'Total uang muka/pembayaran yang sudah tercatat masuk, dihitung dari transaksi yang tanggal AMBILnya ada di rentang ini (tidak termasuk yang Dibatalkan) — BEDA dari "Uang Diterima" di sub-tab Laporan di bawah, yang dihitung dari tanggal uangnya DICATAT, bukan tanggal ambil.',
            },
            { label: 'Piutang', desc: 'Sisa tagihan yang belum lunas dari transaksi yang belum dibatalkan.' },
            {
              label: 'Jatuh Tempo Hari Ini',
              desc: 'Transaksi aktif yang jadwal kembalinya hari ini — angka ini selalu real-time, tidak ikut rentang tanggal yang dipilih.',
            },
          ]}
        />
        <Note>
          Transaksi <Ui>Dibatalkan</Ui> sengaja tidak ikut dihitung di keempat angka ringkasan di atas — batal
          artinya transaksinya tidak pernah benar-benar terjadi. Daftar tabel di bawah SEKARANG default
          menyembunyikan baris Dibatalkan juga (centang <Ui>Tampilkan dibatalkan</Ui> untuk melihatnya lagi) —
          dropdown Status tetap bisa memilih "Dibatalkan" secara eksplisit kapan saja.
        </Note>
        <Note>
          Tombol <Ui>Nota</Ui> di tiap baris membuka nota yang sama seperti di Transaksi Aktif, ditandai{' '}
          <Ui>SALINAN — dicetak ulang {'{tanggal}'}</Ui> karena ini cetak ulang, bukan transaksi baru — cocok kalau
          pelanggan minta bukti transaksi lama. Tombol <Ui>Bayar</Ui> (muncul kalau sisa belum 0, di status apa pun
          kecuali Dibatalkan) ada di sini juga — lihat <SectionLink id="g-transaksi-aktif">bagian 3</SectionLink>
          untuk penjelasan Pelunasan. <Ui>Batalkan transaksi…</Ui> ada di menu titik tiga (⋯) di ujung kanan tiap
          baris, bukan tombol merah lepas — supaya tidak gampang kepencet tidak sengaja.
        </Note>
        <p>
          Filter tanggal (default: awal bulan berjalan sampai hari ini), status, dan pencarian nama/kode booking
          bisa dipakai bersamaan. Tombol <Ui>Unduh Excel</Ui> ada di bawah baris filter — isinya mengikuti filter
          yang sedang dipakai, sama persis dengan angka kecil di sebelahnya ("N transaksi sesuai filter").
        </p>
        <p>Isinya 3 sheet:</p>
        <ul className="list-disc pl-5 space-y-1 text-xs text-[#26302B]">
          <li>
            <span className="font-bold">Transaksi</span> — rincian per transaksi, dengan denda telat dan denda
            kerusakan/hilang dipisah jadi dua kolom sendiri.
          </li>
          <li>
            <span className="font-bold">Ringkasan</span> — jumlah transaksi, omset, sudah dibayar, piutang, dan
            total tiap jenis denda.
          </li>
          <li>
            <span className="font-bold">Per Alat</span> — alat paling laku dan pendapatannya masing-masing.
          </li>
        </ul>
        <Note>
          Kalau sedang memakai filter status atau pencarian, angka di sheet Ringkasan cuma untuk transaksi yang
          cocok dengan filter itu, bukan seluruh usaha. Transaksi <Ui>Dibatalkan</Ui> tetap tercantum di sheet
          Transaksi, tapi tidak ikut dihitung di Ringkasan.
        </Note>
        <p>
          Bagian <Ui>Peralatan Terlaris Disewa</Ui> menampilkan alat yang paling sering disewa pada rentang tanggal
          yang sama (juga tidak termasuk transaksi Dibatalkan), dikelompokkan per kategori — tekan judul kategori
          buat buka/tutup daftar alatnya. Berguna buat lihat alat mana yang perlu ditambah stoknya atau justru
          jarang dipakai. Yang tampil 3 kategori teratas; tekan <Ui>Lihat semua</Ui> untuk menampilkan kategori
          lainnya.
        </p>
        <Note>Sama seperti Kelola Usaha, tab ini cuma terlihat dan bisa diakses oleh pemilik.</Note>

        <h4 className="text-sm font-bold text-[#26302B] pt-2">Laporan</h4>
        <p>
          Sub-tab <Ui>Laporan</Ui> di samping <Ui>Transaksi</Ui> — murni dari data yang sudah tersimpan, <strong>BUKAN</strong>{' '}
          laporan keuangan/neraca lengkap (tidak ada input pengeluaran). Ada dua bagian: <Ui>Pemasukan per Bulan</Ui>{' '}
          dan <Ui>Laporan per Alat</Ui>, masing-masing punya tombol <Ui>Unduh Excel</Ui> sendiri (terpisah dari
          tombol Unduh Excel tab Transaksi, letaknya di dekat pemilih tahun/periode masing-masing bagian) yang
          berisi kedua sheet laporan sekaligus.
        </p>
        <Steps
          items={[
            <>
              <Ui>Pemasukan per Bulan</Ui>: pilih tahun, lihat grafik batang 12 bulan — tekan salah satu batang untuk
              lihat rincian bulan itu: pendapatan sewa, denda telat, denda rusak/hilang, belum lunas, jumlah
              transaksi, rata-rata per transaksi, dan naik/turun (%) dibanding bulan sebelumnya. Angka{' '}
              <Ui>Uang Diterima</Ui> di sini dihitung dari BULAN UANGNYA DICATAT masuk — bukan bulan tanggal ambil
              seperti angka lainnya di laporan ini. Jadi uang muka yang dibayar bulan lalu untuk sewa yang baru mulai
              bulan ini akan muncul di bulan lalu, bukan bulan ini. Kalau ada pembatalan yang uangnya dikembalikan
              lewat <Ui>Catat Pengembalian</Ui> (<SectionLink id="g-transaksi-aktif">bagian 3</SectionLink>), angka
              ini ikut berkurang di bulan pengembaliannya dicatat.
            </>,
            <>
              <Ui>Laporan per Alat</Ui>: pilih periode (bulan/tahun/rentang tanggal bebas), lihat tabel per alat
              (kolom pertama Kategori, lalu Nama Alat) — berapa kali disewa, total unit-hari, pendapatan, dan persen
              keterpakaian. Bisa diurutkan berdasarkan Pendapatan/Keterpakaian/Jumlah Sewa/Kategori. Alat aktif yang
              tidak pernah disewa di periode itu ditampilkan
              terpisah di bawah tabel, begitu juga ringkasan paket (berapa kali tiap paket dipilih) kalau usahamu
              punya Paket Alat (<SectionLink id="g-katalog">bagian 5</SectionLink>), dan ringkasan{' '}
              <Ui>Penjualan Barang</Ui> (berapa kali terjual + pendapatan) kalau usahamu punya Barang Jual (<SectionLink id="g-katalog">bagian 5</SectionLink>).
            </>,
          ]}
        />
        <Note>
          Kolom <Ui>Penjualan Barang</Ui> di <Ui>Pemasukan per Bulan</Ui> cuma muncul kalau pernah ada penjualan
          barang jual di tahun itu. Total Pemasukan sudah menjumlahkan sewa + barang jual + denda — tidak dihitung
          dobel.
        </Note>
        <Note>
          Bulan dihitung dari tanggal AMBIL (konsisten dengan tab Transaksi), dan transaksi Dibatalkan tidak dihitung
          di kedua bagian. Januari (atau bulan pertama yang ada datanya) tidak punya pembanding "naik/turun" karena
          tidak ada data bulan sebelumnya dalam tahun yang sama.
        </Note>
        <Note>
          Keterpakaian dihitung dari hari KALENDER ambil s/d kembali yang jatuh DI DALAM periode yang dipilih —
          kalau sewanya melintasi batas periode (mis. mulai akhir bulan lalu, kembali awal bulan ini), cuma hari
          yang masuk periode ini yang dihitung, supaya angkanya tidak pernah lebih dari 100%. Dibagi stok alat SAAT
          INI × jumlah hari periode — kalau stok diubah di tengah periode, perubahan itu tidak dihitung ulang ke
          belakang.
        </Note>
        <Note>
          Pendapatan per alat dihitung dari rincian/subtotal tiap alat di transaksi — bisa sedikit berbeda dari
          total transaksi yang tampil di tab Pemasukan per Bulan kalau vendor pernah mengubah total harga transaksi
          secara manual (mis. lewat diskon khusus yang tidak tercermin di harga per alat).
        </Note>
      </Section>
      <Section id="g-kelola-usaha" num="7" title="Kelola Usaha" kicker="Info usaha dan kelola staf, digabung jadi satu tab karena sama-sama urusan admin sesekali, bukan dipakai harian.">
        <p>
          Bagian <Ui>Info Usaha</Ui> di paling atas tab ini untuk ubah nama usaha, nama pemilik, no. telepon, alamat
          usaha, dan toleransi telat (lihat <SectionLink id="g-setup">bagian 1</SectionLink>). Alamat di sini ikut tercetak otomatis di struk WhatsApp dan
          Nota Sewa cetak/PDF kalau diisi — beda dari alamat di tab <Ui>Etalase &amp; Pesanan Online</Ui> (<SectionLink id="g-etalase">bagian 8</SectionLink>) yang tampil
          publik ke siapa saja, alamat di sini murni buat kebutuhan internal/struk.
        </p>
        <p>
          Kota usaha diisi lewat dua dropdown bertingkat (Provinsi → Kota/Kabupaten) yang mencakup seluruh Indonesia,
          plus dropdown ketiga <Ui>Kecamatan (opsional)</Ui> yang muncul begitu Kota dipilih. Kecamatan ikut tampil di
          halaman Etalase publik (<SectionLink id="g-etalase">bagian 8</SectionLink>) supaya calon pelanggan tahu lokasi usahamu lebih persis — rental lama
          tidak wajib mengisinya.
        </p>
        <p>
          Kartu <Ui>Printer Struk</Ui> di tab ini membuka wizard yang sama dengan tombol <Ui>Cetak Struk</Ui> di Nota
          (<SectionLink id="g-cetak-thermal">bagian 3b</SectionLink>) — berguna kalau mau menyiapkan printer dari sini
          dulu sebelum ada transaksi.
        </p>
        <p className="font-bold text-xs mt-2">Zona Waktu</p>
        <p>
          Pilih <Ui>WIB</Ui>, <Ui>WITA</Ui>, atau <Ui>WIT</Ui> sesuai lokasi usahamu — ada saran otomatis berdasarkan
          provinsi yang dipilih di Kota, tapi TIDAK PERNAH diganti otomatis, kamu yang memutuskan. Dipakai untuk
          status transaksi (aktif/dipesan), ketersediaan kalender, batas jam denda telat, dan batas waktu Pesanan
          Online (<SectionLink id="g-pesanan">bagian 8b</SectionLink>).
        </p>
        <Note>
          Mengganti Zona Waktu CUMA berlaku ke depan — transaksi yang masih aktif ikut dihitung ulang dengan zona
          baru (koreksi ke arah benar, selisih 1-2 jam), tapi denda yang sudah tercatat tidak berubah. Rental lama
          tetap WIB sampai pemiliknya sendiri menggantinya.
        </Note>
        <p className="font-bold text-xs mt-2">Batas Jam Kembali</p>
        <p>
          Di bawah Toleransi telat — pilih <Ui>Ikuti jam ambil</Ui> (default, sama seperti sekarang) atau{' '}
          <Ui>Jam tetap</Ui> (mis. maks 22.00, atau 00.00 + <Ui>Hari berikutnya</Ui> untuk "besoknya maks jam
          segini"). Begitu diisi, batas telat transaksi jadi JAM ITU di hari kembali — bukan lagi jam ambil barang
          seperti biasanya — tapi Toleransi telat (jam) tetap berlaku DI ATAS batas ini seperti biasa. Cuma berlaku
          untuk transaksi BARU yang dicatat setelah disimpan, transaksi yang sudah ada tidak ikut berubah. Kalau
          diisi, baris "Kembali paling lambat" ikut muncul di struk WhatsApp, Nota Sewa, dan halaman Etalase
          publik/status pesanan.
        </p>
        <p className="font-bold text-xs mt-2">Cara Hitung Denda Telat</p>
        <p>
          Di bawah Batas Jam Kembali — empat pilihan: <Ui>Bertahap per 12 jam</Ui> (default, sama seperti sekarang —
          50% tarif tiap blok 12 jam), <Ui>Per hari penuh (24 jam)</Ui> (lewat toleransi 1 menit pun langsung
          dihitung 1 hari, tanpa setengah hari), <Ui>Per jam</Ui> (nominal Rp tetap PER TRANSAKSI, bukan per alat —
          wajib isi nominal lebih dari Rp0), dan <Ui>Tanpa denda otomatis</Ui> (saran Rp0, rincian disembunyikan).
          Toleransi telat tetap jadi titik mulai hitung di SEMUA pilihan, dan nominal di layar <Ui>Kembalikan</Ui>{' '}
          tetap bisa diisi manual apa pun modenya.
        </p>
        <Note>
          Mode <Ui>Per jam</Ui> punya batas atas opsional (aktif default): "Batasi maksimal setara Per hari penuh" —
          supaya telat lama tidak membengkak tanpa batas. Contoh: telat 30 jam dengan Rp10.000/jam harusnya
          Rp300.000, tapi kalau sewa 2 hari Rp30rb/hari, batas atas memotongnya jadi Rp60.000 (setara 2 hari penuh,
          sama seperti kalau pakai mode "Per hari penuh" untuk telat sejumlah jam yang sama).
        </Note>
        <Note>
          Mode <Ui>Tanpa denda otomatis</Ui>: status "Terlambat" di kartu transaksi & kartu ringkasan berubah jadi
          "Lewat Batas Kembali" (warna abu/oranye, bukan merah) — supaya tidak kelihatan seperti tagihan denda yang
          memang tidak dipungut rental ini. Jumlah jam telat tetap tampil, dan filter "Terlambat" (sekarang "Belum
          Kembali") tetap berfungsi seperti biasa.
        </Note>
        <p className="text-[11px] text-[#6E6853]">
          Berlaku untuk transaksi BARU yang dicatat setelah disimpan — transaksi yang sudah ada tidak ikut berubah.
        </p>
        <p className="font-bold text-xs mt-2">Cara Hitung Durasi Sewa</p>
        <p>
          Pengaturan ini juga ada di kartu <Ui>Info Usaha</Ui>, di bawah Toleransi telat — menentukan berapa "hari"
          yang dihitung untuk harga sewa, struk, nota, dan denda telat bertingkat (<SectionLink id="g-katalog">bagian 5</SectionLink> &amp; <SectionLink id="g-transaksi-aktif">3</SectionLink>) di SELURUH
          aplikasi, termasuk Etalase &amp; Pesanan Online (<SectionLink id="g-etalase">bagian 8</SectionLink>/<SectionLink id="g-pesanan">8b</SectionLink>).
        </p>
        <FieldsTable
          rows={[
            {
              label: 'Per malam',
              desc: 'DEFAULT untuk semua usaha. Ambil Sabtu, kembali Minggu = 1 hari. Tanggal ambil dan kembali TIDAK BOLEH sama (minimal beda 1 hari) — berlaku di Catat Transaksi maupun formulir Pesanan Online di Etalase.',
            },
            {
              label: 'Per hari kalender',
              desc: 'Cara lama. Ambil Sabtu, kembali Minggu = 2 hari. Ambil dan kembali di hari yang sama tetap boleh (dihitung 1 hari).',
            },
          ]}
        />
        <DurationModeIllustration />
        <Note>
          Tampilan di aplikasi selalu memakai kata "hari" (tidak pernah "malam"), apa pun pilihan di sini. Mengganti
          pengaturan ini CUMA berlaku untuk transaksi BARU — transaksi yang sudah dicatat sebelumnya tetap dihitung
          persis seperti saat dibuat, tidak ikut berubah.
        </Note>
        <p className="font-bold text-xs mt-2">Label Lama Sewa</p>
        <p>
          Muncul HANYA kalau <Ui>Cara Hitung Durasi Sewa</Ui> di atas diatur <Ui>Per malam</Ui> — pilih{' '}
          <Ui>Hari</Ui> (default, mis. "1 hari") atau <Ui>Hari-malam (2H1M)</Ui> (mis. 1 malam ditulis "2H1M", 2
          malam "3H2M") untuk menyamakan istilah di struk/nota dengan kebiasaan sebagian vendor outdoor. Murni ganti
          teks — harga tetap dihitung dan ditampilkan "/hari" di Katalog &amp; Stok Alat, tidak ada yang berubah
          soal rumus harga/denda/stok. Pindah ke <Ui>Per hari kalender</Ui> otomatis menyembunyikan pengaturan ini
          lagi (teks balik ke "N hari" di transaksi baru, pilihan 2H1M tetap tersimpan kalau mau dipakai lagi nanti).
        </p>
        <p className="font-bold text-xs mt-2">Paket Minimal/Maksimal Hari Sewa</p>
        <p>
          Juga di kartu <Ui>Info Usaha</Ui>, di bawah Cara Hitung Durasi Sewa. Untuk usaha yang sewa per-trip/paket
          (bukan per hari lepas) — mis. maksimal 4 hari dengan harga 1 hari sama dengan 4 hari.
        </p>
        <FieldsTable
          rows={[
            {
              label: 'Minimal hari',
              desc: 'Batas KERAS. Tanggal kembali di bawah minimal tidak bisa dipilih di Catat Transaksi maupun Pesanan Online.',
            },
            {
              label: 'Maksimal hari',
              desc: 'Batas PAKET, bukan batas keras. Catat Transaksi otomatis mengisi tanggal kembali sesuai paket (masih bisa diubah manual, ada peringatan kalau melebihi). Pesanan Online dari Etalase tidak bisa melebihi paket sama sekali.',
            },
          ]}
        />
        <Note>
          Begitu Minimal/Maksimal hari diisi, tanggal kembali terisi otomatis saat tanggal mulai dipilih (di Catat
          Transaksi maupun Etalase) — tidak perlu menghitung sendiri.
        </Note>
        <Note>
          Kosongkan salah satu atau keduanya untuk tanpa batas (perilaku biasa). Harga tetap memakai Harga per hari
          di <Ui>Katalog &amp; Stok Alat</Ui> (<SectionLink id="g-katalog">bagian 5</SectionLink>) — tombol <Ui>Paket N hari</Ui> di form alat mengisi hari ke-2 sampai N
          dengan Rp0 (sudah termasuk harga paket di "Sewa /Hari") DAN hari setelahnya dengan isian <Ui>Tarif lewat
          paket</Ui>. Diganti HANYA berlaku untuk transaksi baru, sama seperti Cara Hitung Durasi Sewa di atas.
        </Note>
        <Note>
          Denda telat untuk paket tetap memakai rumus bertingkat biasa (<SectionLink id="g-transaksi-aktif">bagian 3</SectionLink>),
          dihitung dari "Tarif lewat paket". Contoh paket 4 hari Rp100rb dengan tarif lewat paket Rp20rb: telat
          setengah hari → Rp10rb, telat sehari penuh → Rp20rb. Kalau "Tarif lewat paket" dibiarkan kosong (jadi ikut
          Rp0), aplikasi tidak menyarankan denda otomatis untuk paket itu — vendor isi manual saat Proses
          Pengembalian kalau mau tetap mendenda.
        </Note>
        <p className="pt-1">
          Di bawahnya ada bagian <Ui>Kelola Karyawan</Ui> untuk undang staf lewat link, tanpa perlu bikin
          username/password dari sisi pemilik:
        </p>
        <Steps
          items={[
            <>Pilih peran (<Ui>Karyawan</Ui> atau <Ui>Pemilik (co-owner)</Ui>), lalu tekan <Ui>Buat Link Undangan</Ui>.</>,
            <>Salin link (ikon salin di samping kode) dan kirim ke calon karyawan lewat WhatsApp.</>,
            <>Karyawan membuka link tersebut, daftar/masuk dengan akunnya sendiri, lalu menekan <Ui>Gabung</Ui> — otomatis masuk ke usaha yang sama, tanpa isi form Setup Usaha lagi.</>,
          ]}
        />
        <Note>
          Satu akun hanya bisa terhubung ke satu usaha. Kalau karyawan yang diundang sudah terhubung ke usaha lain,
          dia perlu pakai email lain untuk menerima undangan ini.
        </Note>
        <Note>
          Peran <Ui>Karyawan</Ui> di sini murni label atribusi (siapa yang mencatat transaksi/perubahan) untuk semua
          fitur operasional — karyawan bisa memakai Kalender, Catat Transaksi, Transaksi Aktif, dan Katalog &amp;
          Stok Alat sama seperti pemilik. Satu pengecualian: tab <Ui>Kelola Usaha</Ui> ini sendiri (Info Usaha maupun
          Kelola Karyawan) cuma terlihat dan bisa dipakai oleh pemilik — karyawan tidak bisa mengundang atau
          mengeluarkan anggota tim. Link undangan otomatis kedaluwarsa dalam 7 hari kalau belum dipakai, dan bisa
          dicabut manual kapan saja lewat tombol hapus
          di daftar undangan.
        </Note>
      </Section>

      <Section id="g-etalase" num="8" title="Etalase & Pesanan Online" kicker="Halaman publik read-only berisi katalog alat & kontak usahamu — sudah bisa dipakai sekarang, gratis, tanpa login.">
        <p>
          Nyalakan toggle <Ui>Aktifkan Etalase Online</Ui> untuk dapat link publik (mis.{' '}
          <span className="font-mono text-xs">toko.sewalog.com/nama-usahamu</span>) yang bisa dibagikan ke siapa saja
          lewat WhatsApp/Instagram bio — dibuka tanpa perlu login, menampilkan nama usaha, kota, deskripsi, alamat,
          jam operasional (boleh satu baris ringkas, atau dipecah per hari kalau jamnya beda-beda — mis. "SENIN:
          12.00–22.00" di baris pertama, "SELASA-SABTU: 09.00–22.00" di baris berikutnya), tombol WhatsApp, dan
          katalog alat (foto, kategori, harga per hari). Kalau katalognya
          punya lebih dari satu kategori, muncul pill filter di atas daftar alat supaya pengunjung bisa lompat
          langsung ke kategori yang dicari; foto tiap alat juga bisa di-zoom (tekan foto, muncul ukuran penuh)
          buat lihat detail sebelum tanya lebih lanjut. Pengunjung juga bisa isi tanggal ambil &amp; kembali di
          halaman itu untuk lihat sisa unit tersedia per alat sepanjang periode itu (bukan cuma satu hari) — kalau
          ada hari di tengah periode yang stoknya lebih sedikit, angka yang ditampilkan ikut angka terendah itu,
          bukan cuma hari pertama.
        </p>
        <Note>
          Paket yang kamu buat di <Ui>Katalog &amp; Stok Alat</Ui> (<SectionLink id="g-katalog">bagian 5</SectionLink>) otomatis tampil di katalog sebagai
          kategori <Ui>📦 Paket</Ui> tersendiri di pill filter (langsung setelah <Ui>Semua</Ui>) — cuma kalau paketnya
          aktif DAN semua alat di dalamnya juga aktif. Di filter <Ui>Semua</Ui>, kartu paket tampil lebih dulu
          sebelum alat satuan. Kartu paket menampilkan foto (foto paket kalau diisi, atau otomatis foto alat
          pertama di dalamnya kalau tidak), isi paket, dan harga — termasuk harga coret + "Hemat Rp..." kalau
          paketnya pakai potongan. Sisa paket yang bisa dipesan dihitung dari sisa alat komponennya sendiri (bukan
          stok terpisah) — kalau salah satu alat di dalam paket habis, paketnya ikut tampil habis. Tips: foto semua
          isi paket dalam satu frame (ditata di lantai/alas) supaya pelanggan langsung tahu isinya.
        </Note>
        <Note>
          <strong>Ini bukan toko online/checkout</strong> — tidak ada pembayaran online sungguhan di halaman
          publiknya. Secara default calon penyewa cuma bisa cek ketersediaan lalu diarahkan chat WhatsApp, sama
          seperti alur manual yang sudah berjalan sekarang. Kalau fitur <Ui>Pesanan Online</Ui> (<SectionLink id="g-pesanan">bagian 8b</SectionLink>) kamu
          nyalakan, pengunjung bisa kirim formulir pesanan langsung dari halaman ini juga — tapi itu cuma formulir,
          bukan pembayaran, pesanannya tetap kamu yang Konfirmasi manual.
        </Note>
        <p>
          Slug (bagian akhir link) otomatis terisi dari nama usaha saat pertama diaktifkan — bisa diedit manual,
          asal masih unik dan cuma huruf kecil/angka/tanda hubung. Kalau usaha lain sudah pakai slug yang sama
          (mis. nama usaha yang mirip), langsung kelihatan sambil ketik ("Slug ini sudah dipakai usaha lain") —
          tidak perlu tunggu sampai tekan Simpan. Alamat dan nomor WhatsApp publik di sini otomatis terisi awal dari{' '}
          <Ui>Info Usaha</Ui> (<SectionLink id="g-kelola-usaha">bagian 7</SectionLink>) — tapi begitu disimpan, keduanya independen, boleh diubah beda dari Info
          Usaha kapan saja (mis. usahamu punya nomor CS terpisah, atau alamat publik yang sengaja beda dari alamat
          internal di struk).
        </p>
        <Note>Sama seperti Kelola Usaha, tab ini cuma terlihat dan bisa diakses oleh pemilik.</Note>
      </Section>

      <Section
        id="g-pesanan"
        num="8b"
        title="Pesanan Online"
        kicker="Pelanggan bisa kirim formulir pesanan langsung dari Etalase — tetap kamu yang Konfirmasi lewat Catat Transaksi biasa, bukan checkout otomatis."
      >
        <p>
          Semua pengaturan ada di tab <Ui>Etalase &amp; Pesanan Online</Ui>, di kartu "Pesanan Online" (di bawah kartu
          Etalase Online). Urutan menyalakannya:
        </p>
        <Steps
          items={[
            <>
              Aktifkan dulu <Ui>Etalase Online</Ui> (<SectionLink id="g-etalase">bagian 8</SectionLink>) — Pesanan Online tidak bisa dinyalakan kalau Etalase-nya
              masih mati.
            </>,
            <>
              Pilih minimal satu <strong>cara bayar</strong> (Transfer Bank/QRIS/Tunai saat ambil) dan isi detailnya
              (nomor rekening, gambar QRIS, dsb) — tombol <Ui>Terima pesanan online</Ui> cuma bisa dinyalakan kalau
              sudah ada minimal satu cara bayar aktif. Kalau usahamu punya lebih dari satu rekening, tekan{' '}
              <Ui>+ Tambah rekening</Ui> di bawah Transfer Bank (sampai 5) — rekening pertama otomatis jadi{' '}
              <Ui>Rekening Utama</Ui>, urutannya bisa diatur lewat tombol panah naik/turun, dan ada tombol{' '}
              <Ui>Hapus</Ui> (minta konfirmasi dulu) kalau sudah tidak dipakai. Semua rekening aktif akan ditampilkan
              ke pelanggan sebagai kartu terpisah (masing-masing punya tombol <Ui>Salin nomor</Ui> sendiri) di halaman
              status pesanannya setelah kamu Konfirmasi.
            </>,
            <>
              Isi <strong>Nomor WA admin untuk pesanan online</strong> — sampai 3 nomor (label tetap <Ui>Admin
              1</Ui>/<Ui>Admin 2</Ui>/<Ui>Admin 3</Ui>, tidak bisa diganti nama), supaya lebih dari satu orang bisa
              bantu tanggapi pesanan lewat WA. <Ui>Admin 1</Ui> boleh dikosongkan — otomatis pakai nomor WA publik
              Etalase (<SectionLink id="g-etalase">bagian 8</SectionLink>). <Ui>Admin 2</Ui>/<Ui>Admin 3</Ui> opsional, isi
              kalau memang ada admin lain yang ikut pegang HP toko.
            </>,
            <>
              Atur <strong>DP (uang muka)</strong> kalau mau (opsional) — "Tidak wajib", persen dari total, atau
              nominal tetap. Pelanggan lihat angka DP-nya setelah pesanannya kamu Konfirmasi (lihat bagian "Apa yang
              pelanggan lihat" di bawah).
            </>,
            <>
              Isi <strong>Syarat &amp; Ketentuan</strong> sewa kalau mau (opsional, lihat penjelasan lengkap di bawah)
              — bisa pakai tombol <Ui>Pakai contoh</Ui> sebagai titik awal, lalu diedit sesuai usahamu.
            </>,
            <>
              Atur <strong>Batas konfirmasi (jam)</strong> — berapa lama pesanan menunggu sebelum otomatis
              kedaluwarsa kalau belum sempat kamu tanggapi (2-72 jam, default 24). Pesanan yang kedaluwarsa tidak
              bisa dikonfirmasi lagi — pelanggan diarahkan pesan ulang atau chat WA langsung.
            </>,
            <>
              Terakhir, nyalakan toggle <Ui>Terima pesanan online</Ui> lalu <Ui>Simpan</Ui>. Begitu aktif, tombol
              "Pesan Sekarang" muncul di halaman Etalase publikmu.
            </>,
          ]}
        />

        <p className="font-bold text-[#26302B] text-sm pt-1">Menangani pesanan yang masuk</p>
        <p>
          Pesanan baru muncul di tab <Ui>Transaksi Aktif</Ui>, bagian "Pesanan masuk" (dengan badge angka di tab
          navigasi) — bukan langsung jadi transaksi, cuma permintaan yang menunggu kamu tanggapi. Dua tombol:
        </p>
        <FieldsTable
          rows={[
            {
              label: 'Konfirmasi',
              desc: 'Membuka form Catat Transaksi yang SUDAH TERISI dari data pesanan (nama, nomor WA, tanggal, alat/paket) — tinggal dicek/dilengkapi (jaminan, dsb) lalu Simpan seperti transaksi biasa. Begitu disimpan, pesanan ini resmi jadi transaksi aktif dan hilang dari daftar "Pesanan masuk".',
            },
            {
              label: 'Tolak',
              desc: 'Isi alasan (opsional, akan terlihat pelanggan di halaman status mereka) lalu Tolak — tidak ada transaksi yang dibuat. Pelanggan bisa lihat alasannya dan diarahkan chat WA atau pesan ulang.',
            },
          ]}
        />
        <Note>
          Pelanggan juga bisa pesan <Ui>Paket</Ui> (<SectionLink id="g-etalase">bagian 8</SectionLink>), bukan cuma alat satuan — daftar "Pesanan masuk" dan
          form Konfirmasi menampilkannya sebagai "Paket X ×N" + rincian isinya, bukan alat lepas tak terhubung.
          Kalau paketnya SUDAH DIUBAH atau dinonaktifkan sejak pesanan itu masuk (mis. kamu edit resepnya di
          Katalog), form Konfirmasi tetap otomatis mengisi alat-alatnya satu per satu (dari data pesanan asli) +
          peringatan kecil supaya kamu cek ulang jumlah &amp; harganya — bukan dibiarkan kosong begitu saja.
        </Note>
        <p>
          Kalau dibiarkan sampai lewat <Ui>Batas konfirmasi</Ui>, pesanan otomatis berubah status jadi kedaluwarsa
          (dicek ulang tiap kali kamu buka tab Transaksi Aktif) — hilang dari "Pesanan masuk", tidak bisa dikonfirmasi
          lagi, dan pelanggan lihat status "Kedaluwarsa" di halaman mereka.
        </p>

        <p className="font-bold text-[#26302B] text-sm pt-1">Apa yang pelanggan lihat</p>
        <p>
          Setelah kirim pesanan, pelanggan diarahkan ke halaman status pribadi (link unik, bukan untuk dibagikan
          sembarangan) yang menunjukkan status pesanannya (Menunggu konfirmasi, Dikonfirmasi, Ditolak, atau
          Kedaluwarsa).
          Informasi cara bayar (nomor rekening, QRIS, atau nominal DP/total yang harus dibayar) <strong>cuma muncul
          setelah kamu Konfirmasi</strong> — sebelum itu pelanggan cuma lihat ringkasan pesanannya dan Total sewa
          (harga katalog), belum ada instruksi bayar apa pun.
        </p>
        <p>
          Halaman status itu juga menampilkan tombol kirim WA — satu tombol per nomor <Ui>Admin</Ui> yang kamu isi
          (lihat langkah di atas), lengkap dengan catatan "Cukup hubungi salah satu admin" kalau nomornya lebih dari
          satu, supaya pelanggan tidak kirim pesan yang sama ke semua admin sekaligus. Tiap halaman status juga punya{' '}
          <strong>kode pesanan 6 karakter</strong> (mis. "607B5D") yang SAMA PERSIS dengan yang tampil di kartu
          "Pesanan masuk"-mu di atas — kalau pelanggan kebetulan menghubungi admin yang berbeda dari yang pertama
          kali dia pakai, kode ini yang dipakai buat mencocokkan itu pesanan yang mana (pesan WA-nya sendiri juga
          sudah otomatis menyertakan kode + link status ini, jadi biasanya tidak perlu dicocokkan manual).
        </p>
        <Note>
          <strong>Sewalog tidak pernah menerima atau menyimpan dana dari pelanggan.</strong> Transfer/QRIS/tunai
          langsung ke rekening atau tangan usahamu sendiri — Sewalog cuma menampilkan info pembayaran yang kamu isi
          sendiri, tidak ikut proses transaksi uangnya sama sekali.
        </Note>
        <Note>
          Info rekening/QRIS yang dilihat pelanggan dibekukan PERSIS seperti saat kamu Konfirmasi pesanan itu — kalau
          sesudahnya kamu ganti/hapus rekening di Pesanan Online, pesanan yang SUDAH dikonfirmasi tetap menampilkan
          info lama (tidak ikut berubah diam-diam), supaya pelanggan tidak bingung tiba-tiba transfer ke rekening
          yang berbeda dari yang pertama kali ditampilkan.
        </Note>

        <p className="font-bold text-[#26302B] text-sm pt-1">Syarat &amp; Ketentuan sewa</p>
        <p>
          Kalau diisi, pelanggan WAJIB centang setuju sebelum bisa kirim pesanan — kotak centangnya di formulir
          pelanggan HANYA muncul kalau Syarat &amp; Ketentuan sudah diisi. Kalau Pesanan Online aktif tapi belum
          diisi sama sekali, muncul pengingat oranye "Belum ada Syarat &amp; Ketentuan..." di kartu ini dengan
          tombol <Ui>Isi sekarang</Ui> yang langsung menggulir ke bagian ini. Teksnya juga muncul di halaman
          Etalase (bagian "Syarat Sewa", terlihat siapa saja meski Pesanan Online sedang mati) supaya calon penyewa
          bisa baca duluan sebelum datang. Tiap kali kamu ubah teksnya, Sewalog menyimpan <strong>versi mana yang
          disetujui pelanggan saat itu</strong> sebagai bukti — kalau nanti kamu edit lagi teksnya, pesanan-pesanan
          lama tetap menunjukkan versi yang benar-benar mereka setujui waktu itu, bukan ikut berubah ke versi
          terbaru. Kalau kamu sempat ubah teksnya SETELAH pelanggan buka form tapi SEBELUM mereka kirim, sistem
          otomatis minta mereka baca ulang versi terbaru dan centang lagi — supaya tidak ada yang tercatat setuju ke
          sesuatu yang tidak pernah mereka baca.
        </p>
      </Section>

      <Section
        id="g-notifikasi"
        num="8c"
        title="Notifikasi Pesanan Online"
        kicker="Diberi tahu di perangkatmu sendiri begitu ada pesanan baru dari Etalase Online, walau Sewalog tidak sedang dibuka."
      >
        <p>
          Kartu <Ui>Notifikasi Pesanan Online</Ui> ada di tab <Ui>Transaksi Aktif</Ui>, di dekat bagian "Pesanan
          masuk" — tekan <Ui>Aktifkan</Ui> dan izinkan notifikasi saat browser bertanya. Ini{' '}
          <strong>per perangkat</strong>, bukan per akun: kalau kamu buka Sewalog dari HP dan laptop, aktifkan di
          masing-masing. Isi notifikasinya sengaja singkat (nama pelanggan, jumlah alat, tanggal ambil-kembali) —
          tanpa nomor WA, harga, atau alamat, supaya tetap aman kalau terbaca di layar kunci. Ada juga tombol{' '}
          <Ui>Kirim notifikasi uji</Ui> untuk memastikan notifikasi di perangkatmu benar-benar jalan.
        </p>
        <p>
          <strong>Di Android/desktop</strong>, langsung bisa diaktifkan dari browser biasa. <strong>Di iPhone</strong>,
          notifikasi cuma bisa aktif setelah Sewalog ditambahkan ke Layar Utama (tombol <Ui>Bagikan</Ui> di Safari →{' '}
          <Ui>Tambah ke Layar Utama</Ui>) — kartu di atas akan menunjukkan petunjuk ini otomatis kalau terdeteksi
          dibuka dari Safari biasa.
        </p>
        <div id="g-notifikasi-denied">
          <p className="font-bold text-xs mt-2">Kalau izin terlanjur ditolak</p>
          <p className="text-xs text-[#6E6853] mb-1">
            Begitu browser/HP menolak izin notifikasi, kartu di atas tidak akan bertanya lagi secara otomatis —
            harus diizinkan ulang manual lewat pengaturan, caranya beda tergantung cara Sewalog dibuka:
          </p>
          <FieldsTable
            rows={[
              { label: 'Android, lewat Chrome', desc: 'Ikon gembok/⋮ di address bar → Setelan situs → Notifikasi → Izinkan.' },
              {
                label: 'Android, sudah dipasang',
                desc: 'Tekan lama ikon Sewalog di layar utama → Info aplikasi → Notifikasi → Aktifkan.',
              },
              {
                label: 'iPhone, sudah dipasang',
                desc: 'Pengaturan (bukan di dalam Sewalog) → Notifikasi → Sewalog → Izinkan Notifikasi.',
              },
              { label: 'Laptop (Chrome/Edge)', desc: 'Ikon gembok di address bar → Notifikasi → Izinkan.' },
            ]}
          />
          <Note>
            Kartu <Ui>Notifikasi Pesanan Online</Ui> otomatis menampilkan salah satu petunjuk di atas yang paling
            sesuai begitu izin ditolak, lengkap dengan tautan balik ke sini. Selama izinnya masih diblokir, menekan{' '}
            <Ui>Coba Lagi</Ui> cuma menampilkan pesan "Masih diblokir..." (browser tidak bisa menanyakan ulang izin
            yang sudah ditolak) — begitu diizinkan lewat pengaturan dan kamu kembali ke Sewalog, status diperbarui
            OTOMATIS (tidak perlu muat ulang halaman) dan tombol <Ui>Aktifkan</Ui> muncul lagi.
          </Note>
        </div>
      </Section>

      {SHOW_TOKO_ONLINE_TAB && (
        <Section id="g-toko" num="8d" title="Toko Online" kicker="Belum jadi fitur — halaman ini buat lihat seberapa banyak pemilik usaha yang tertarik.">
          <p>
            Tab ini menjelaskan rencana <strong>toko online berbayar</strong> per usaha (mis.{' '}
            <span className="font-mono text-xs">app.sewalog.com/nama-tokomu</span>) supaya pelanggan bisa lihat
            ketersediaan dan transaksi <strong>sekaligus bayar online</strong> sendiri tanpa chat WhatsApp dulu.
            Fiturnya <strong>belum dibangun</strong> — tab ini sengaja ditampilkan lebih dulu buat lihat seberapa
            banyak pemilik usaha yang tertarik, lewat tombol <Ui>Tertarik? Kasih Tahu Kami</Ui> yang membuka WhatsApp.
          </p>
          <Note>
            Beda dari <Ui>Etalase Online</Ui> (<SectionLink id="g-etalase">bagian 8</SectionLink>) yang murni etalase informasi dan sudah bisa dipakai sekarang
            — tab ini soal transaksi/pembayaran online sungguhan, yang butuh evaluasi lebih dulu (lisensi, kesiapan
            pilot) sebelum dibangun.
          </Note>
          <Note>Sama seperti Kelola Usaha, tab ini cuma terlihat dan bisa diakses oleh pemilik.</Note>
        </Section>
      )}

      {/* TODO 4 Des 2026: update bagian ini begitu harga berlangganan resmi diumumkan -- JANGAN diubah sebelum tanggal itu. */}
      <Section id="g-langganan" num="9" title="Langganan" kicker="Status masa aktif usahamu dan cara konfirmasi pembayaran — belum dikenakan biaya sampai 31 Desember 2026.">
        <p>
          Sewalog <strong>gratis sampai 31 Desember 2026</strong>. Harga setelahnya belum diputuskan — akan
          diumumkan sebelum tanggal itu, jadi tab ini belum menampilkan angka apa pun untuk saat ini.
        </p>
        <FieldsTable
          rows={[
            { label: 'Aktif', desc: 'Normal, semua fitur bisa dipakai seperti biasa.' },
            {
              label: 'Masa Tenggang',
              desc: 'Masa aktif baru habis — semua fitur masih bisa dipakai, tapi usaha ini akan jadi Hanya-baca kalau tidak diperpanjang sebelum masa tenggangnya habis.',
            },
            {
              label: 'Hanya-baca',
              desc: 'Masa tenggang sudah habis — transaksi BARU terkunci (tidak bisa Catat Transaksi lagi), tapi transaksi yang sedang berjalan tetap bisa diselesaikan/dikembalikan seperti biasa.',
            },
          ]}
        />
        <p>
          Pembayaran dikonfirmasi <strong>manual lewat WhatsApp</strong>, bukan otomatis — tombol <Ui>Konfirmasi
          Bayar via WA</Ui> di tab ini membuka chat ke Sewalog. Info rekening pembayaran (kalau sudah tersedia) dan
          riwayat pembayaran yang sudah tercatat juga ada di tab ini.
        </p>
        <Note>Sama seperti Kelola Usaha, tab ini cuma terlihat dan bisa diakses oleh pemilik.</Note>
      </Section>

      <Section id="g-catatan" num="A." title="Catatan Penting">
        <ul className="list-disc pl-5 space-y-1.5 text-xs text-[#26302B]">
          <li><strong>Mobile-first</strong> — semua alur inti (kalender, catat transaksi, transaksi aktif) didesain dipakai sambil berdiri di depan rak alat, bukan di depan laptop.</li>
          <li><strong>Data selalu real-time</strong> — Sewalog sengaja tidak menyimpan data offline/cache agresif, supaya stok yang tampil tidak pernah basi dan menyebabkan double-booking.</li>
          <li><strong>Isolasi data per usaha</strong> — setiap usaha hanya bisa melihat data miliknya sendiri. Satu akun cuma bisa terhubung ke satu usaha (lihat <SectionLink id="g-setup">bagian 1</SectionLink> &amp; <SectionLink id="g-kelola-usaha">7</SectionLink>).</li>
          <li>
            <strong>Syarat &amp; kebijakan privasi</strong> — baca{' '}
            <a
              href="https://sewalog.com/syarat"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#2B4739]"
            >
              Syarat &amp; Ketentuan
            </a>{' '}
            dan{' '}
            <a
              href="https://sewalog.com/privasi"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#2B4739]"
            >
              Kebijakan Privasi
            </a>{' '}
            Sewalog untuk detail lengkap soal data yang disimpan dan cara kami memperlakukannya.
          </li>
          <li><strong>Wilayah</strong>: bisa dipakai rental di seluruh Indonesia (WIB, WITA, dan WIT — atur zona waktu di Kelola Usaha).</li>
          <li>
            <strong>Keamanan &amp; keandalan data</strong> — datamu disimpan di server cloud di luar Indonesia (Asia Tenggara), terenkripsi, dan terpisah per rental. Rental lain tidak bisa melihat datamu.
            <br />
            Tips (khusus pemilik): ekspor <SectionLink id="g-riwayat">Riwayat</SectionLink> ke Excel sebulan sekali dan simpan di HP atau Google Drive-mu sendiri sebagai cadangan pribadi.
            <br />
            Kalau Sewalog sedang tidak bisa dibuka, kabari kami lewat{' '}
            <a
              href={getWhatsAppShareUrl(SEWALOG_SUPPORT_WHATSAPP, 'Halo, saya mau laporan Sewalog sedang tidak bisa dibuka.')}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#2B4739]"
            >
              WhatsApp 0896-4945-4000
            </a>.
          </li>
        </ul>
      </Section>

      <a
        href={feedbackUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-[#DBD5C1] text-[#2B4739] text-sm font-semibold hover:bg-[#F1EEE2] transition"
      >
        <MessageCircle className="w-4 h-4" />
        Kirim Masukan / Keluhan lewat WhatsApp
      </a>
    </div>
  );
}
