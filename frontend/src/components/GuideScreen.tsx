import type { ReactNode } from 'react';
import { BookOpen } from 'lucide-react';

// Panduan pemakaian in-app, mengikuti alur fitur nyata di Sewalog. Jaga tetap
// sinkron kalau alur di tab lain berubah (label tombol, urutan langkah, dsb).

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
    <section id={id} className="bg-[#FBFAF4] border border-[#DBD5C1] rounded-2xl shadow-sm p-5 scroll-mt-20">
      <h3 className="text-base font-bold text-[#26302B] flex items-baseline gap-2">
        <span className="text-[#A65C2A] font-mono text-sm">{num}</span>
        {title}
      </h3>
      {kicker && <p className="text-xs text-[#6E6853] mt-1 mb-3">{kicker}</p>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

const TOC: { id: string; num: string; title: string }[] = [
  { id: 'g-1', num: '1', title: 'Masuk & Setup Usaha' },
  { id: 'g-2', num: '2', title: 'Kalender Ketersediaan' },
  { id: 'g-3', num: '3', title: 'Katalog & Stok Alat' },
  { id: 'g-4', num: '4', title: 'Catat Transaksi Sewa' },
  { id: 'g-5', num: '5', title: 'Jaminan & Denda' },
  { id: 'g-6', num: '6', title: 'Kelola Karyawan' },
  { id: 'g-a', num: 'A', title: 'Catatan Penting' },
];

export function GuideScreen() {
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
          {TOC.map((t) => (
            <a key={t.id} href={`#${t.id}`} className="text-xs font-semibold text-[#26302B] hover:text-[#2B4739] hover:underline py-0.5">
              <span className="font-mono text-[#A65C2A] mr-1.5">{t.num}</span>
              {t.title}
            </a>
          ))}
        </div>
      </div>

      <Section id="g-1" num="1" title="Masuk & Setup Usaha" kicker="Langkah pertama saat pertama kali membuka Sewalog.">
        <p>
          Daftar dengan email &amp; password lewat tombol <Ui>Belum punya akun? Daftar</Ui> di halaman login, atau masuk
          langsung kalau sudah punya akun. Sesi login tersimpan di browser sampai kamu menekan tombol keluar (ikon
          pintu) di pojok kanan atas navbar.
        </p>
        <p>
          Akun baru tanpa usaha akan diarahkan ke <Ui>Setup Usaha</Ui> — isi nama usaha, nama pemilik, dan nomor
          telepon, lalu <Ui>Simpan &amp; Lanjut</Ui>. Setelah itu langsung masuk ke Kalender Ketersediaan.
        </p>
        <Note>
          Kalau kamu membuka Sewalog lewat link undangan dari usaha lain (lihat bagian 6), kamu akan diarahkan ke
          layar <Ui>Undangan Bergabung</Ui> alih-alih Setup Usaha — pilih <Ui>Gabung Sekarang</Ui> untuk masuk ke usaha
          yang mengundang, atau <Ui>Lewati</Ui> kalau memang mau bikin usaha sendiri.
        </Note>
      </Section>

      <Section id="g-2" num="2" title="Kalender Ketersediaan" kicker="Layar utama — ringkasan stok tiap alat untuk beberapa hari ke depan.">
        <p>Setiap alat ditampilkan sebagai satu baris dengan strip status harian, bukan grid kalender bulanan penuh:</p>
        <StatusLegend
          items={[
            { label: 'Tersedia', sub: 'stok masih cukup', color: 'bg-[#2B4739]' },
            { label: 'Sisa sedikit', sub: 'mendekati habis', color: 'bg-[#A65C2A]' },
            { label: 'Habis', sub: 'stok penuh terpakai', color: 'bg-[#A8412E]' },
          ]}
        />
        <p>
          Klik salah satu kotak tanggal pada strip untuk langsung membuka form <Ui>Catat Transaksi</Ui> dengan alat dan
          tanggal mulai sudah terisi otomatis. Ketersediaan dihitung langsung dari transaksi aktif — tidak ada jadwal
          tersimpan terpisah yang perlu disinkronkan manual.
        </p>
      </Section>

      <Section id="g-3" num="3" title="Katalog & Stok Alat" kicker="Kelola daftar alat yang bisa disewakan, termasuk harga dan foto.">
        <FieldsTable
          rows={[
            { label: 'Kode & Nama', desc: 'Kode internal (mis. TND-04) dan nama alat yang tampil di seluruh layar lain.' },
            { label: 'Total Stok', desc: 'Jumlah unit yang dimiliki.' },
            { label: 'Harga/hari', desc: 'Tarif harian normal.' },
            {
              label: 'Harga bertingkat',
              desc: 'Opsional — isi "berlaku setelah (hari)" dan "harga setelah diskon" kalau sewa lama dapat harga lebih murah per hari mulai hari tertentu. Kosongkan salah satunya kalau tidak ada diskon.',
            },
            { label: 'Foto', desc: 'Unggah langsung dari galeri/kamera — foto otomatis dikompres sebelum diunggah, tidak perlu tempel URL manual.' },
          ]}
        />
        <p>
          Alat yang sudah tidak dipakai lagi cukup <Ui>Nonaktifkan</Ui> (ikon daya), bukan dihapus — supaya riwayat
          transaksi lama yang memakai alat tersebut tetap utuh dan bisa ditelusuri.
        </p>
      </Section>

      <Section id="g-4" num="4" title="Catat Transaksi Sewa" kicker="Form input cepat, dipakai sambil melayani pelanggan yang menunggu.">
        <Steps
          items={[
            <>Tekan <Ui>Catat Transaksi</Ui> di navbar (selalu terlihat, tidak perlu berpindah tab dulu).</>,
            <>Isi nama &amp; nomor WhatsApp penyewa, lalu centang satu atau lebih alat — bisa multi-item dalam satu transaksi.</>,
            <>Pilih tanggal ambil &amp; kembali. Total harga terhitung otomatis, termasuk harga bertingkat kalau alatnya punya diskon sewa lama (lihat bagian 3).</>,
            <>Pilih jenis jaminan (KTP/SIM/STNK/Paspor/Uang/Lainnya), lalu tekan <Ui>Simpan &amp; Terbitkan Nota</Ui>.</>,
          ]}
        />
        <Note>
          Struk transaksi bisa langsung dikirim ke pelanggan lewat tombol <Ui>Kirim Struk WA</Ui> di layar Jaminan &amp;
          Denda (bagian 5) — tidak perlu ketik ulang rincian secara manual.
        </Note>
      </Section>

      <Section id="g-5" num="5" title="Jaminan & Denda" kicker="Daftar transaksi aktif — status pengambilan barang, jaminan yang ditahan, dan dua jenis denda dipisah eksplisit.">
        <p>Empat kartu ringkasan di atas: Sewa Terlambat, Jaminan Ditahan, Sedang Disewa, dan Tunggakan Denda. Bisa difilter per status transaksi di bawahnya.</p>
        <p className="font-bold text-xs mt-2">Alur satu transaksi</p>
        <Steps
          items={[
            <>Saat pelanggan mengambil barang: tekan <Ui>Tandai Barang Diambil</Ui>.</>,
            <>Saat barang dikembalikan: tekan <Ui>Kembalikan</Ui> — kalkulator denda keterlambatan otomatis menyarankan nominal sesuai tanggal jatuh tempo, dan jaminan bisa langsung dilepas dari layar yang sama.</>,
            <>Kalau ada kerusakan/kehilangan alat: tekan <Ui>Tambah Denda</Ui> kapan saja sebelum transaksi selesai — dipisah dari denda keterlambatan, karena keduanya bisa muncul bersamaan dalam satu transaksi.</>,
          ]}
        />
        <Note>
          Denda keterlambatan dan denda kerusakan/kehilangan sengaja ditampilkan sebagai dua angka terpisah, tidak
          digabung — supaya pemilik bisa langsung tahu penyebabnya tanpa membuka rincian lebih dulu.
        </Note>
        <p>
          Transaksi bisa <Ui>Dibatalkan</Ui> kapan saja sebelum selesai — jaminan yang ditahan otomatis dilepas begitu
          dibatalkan.
        </p>
      </Section>

      <Section id="g-6" num="6" title="Kelola Karyawan" kicker="Undang staf lewat link, tanpa perlu bikin username/password dari sisi pemilik.">
        <Steps
          items={[
            <>Buka tab <Ui>Kelola Karyawan</Ui>, pilih peran (<Ui>Karyawan</Ui> atau <Ui>Pemilik (co-owner)</Ui>), lalu tekan <Ui>Buat Link Undangan</Ui>.</>,
            <>Salin link (ikon salin di samping kode) dan kirim ke calon karyawan lewat WhatsApp.</>,
            <>Karyawan membuka link tersebut, daftar/masuk dengan akunnya sendiri, lalu menekan <Ui>Gabung Sekarang</Ui> — otomatis masuk ke usaha yang sama, tanpa isi form Setup Usaha lagi.</>,
          ]}
        />
        <Note>
          Peran <Ui>Karyawan</Ui> di sini murni label atribusi (siapa yang mencatat transaksi/perubahan) untuk semua
          fitur operasional — karyawan bisa memakai Kalender, Catat Transaksi, Jaminan &amp; Denda, dan Katalog &amp;
          Stok Alat sama seperti pemilik. Satu pengecualian: tab <Ui>Kelola Karyawan</Ui> ini sendiri cuma terlihat
          dan bisa dipakai oleh pemilik — karyawan tidak bisa mengundang atau mengeluarkan anggota tim. Link undangan
          otomatis kedaluwarsa dalam 7 hari kalau belum dipakai, dan bisa dicabut manual kapan saja lewat tombol hapus
          di daftar undangan.
        </Note>
      </Section>

      <Section id="g-a" num="A." title="Catatan Penting">
        <ul className="list-disc pl-5 space-y-1.5 text-xs text-[#26302B]">
          <li><strong>Mobile-first</strong> — semua alur inti (kalender, catat transaksi, jaminan &amp; denda) didesain dipakai sambil berdiri di depan rak alat, bukan di depan laptop.</li>
          <li><strong>Data selalu real-time</strong> — Sewalog sengaja tidak menyimpan data offline/cache agresif, supaya stok yang tampil tidak pernah basi dan menyebabkan double-booking.</li>
          <li><strong>Isolasi data per usaha</strong> — setiap usaha hanya bisa melihat data miliknya sendiri, termasuk kalau kamu tergabung di lebih dari satu usaha lewat undangan.</li>
          <li><strong>Wilayah tervalidasi saat ini</strong>: Malang Raya (Kota Malang, Kabupaten Malang, Kota Batu).</li>
        </ul>
      </Section>
    </div>
  );
}
