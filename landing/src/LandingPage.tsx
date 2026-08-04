import { useEffect } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Calendar, CalendarX, FileWarning, Plus, ShieldAlert, AlertOctagon } from 'lucide-react';
import { waLink, WHATSAPP_DISPLAY } from './lib/whatsapp';

const MSG_UMUM = 'Halo, saya pemilik rental alat kamping. Mau tanya-tanya soal Sewalog.';
const MSG_MULAI = 'Halo, saya mau coba Sewalog untuk usaha rental saya.';

function WaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.06-1.36A10 10 0 1 0 12 2Zm0 1.8a8.2 8.2 0 0 1 6.94 12.56l-.24.4.83 3.02-3.1-.81-.39.23A8.2 8.2 0 1 1 12 3.8Zm-3.53 4a.86.86 0 0 0-.62.29c-.21.23-.82.8-.82 1.94 0 1.15.84 2.26.96 2.42.12.15 1.63 2.58 4.03 3.55 2 .8 2.4.65 2.84.6.44-.04 1.4-.57 1.6-1.12.2-.55.2-1.02.14-1.12-.06-.1-.22-.16-.46-.28-.24-.12-1.4-.7-1.62-.77-.22-.08-.37-.12-.53.12-.16.24-.6.77-.74.93-.14.16-.27.18-.5.06-.24-.12-1-.37-1.9-1.18-.7-.63-1.18-1.4-1.31-1.64-.14-.24-.01-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.53-1.32-.74-1.8-.19-.47-.4-.4-.53-.41Z" />
    </svg>
  );
}

function MockField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[10px] text-[#8A8368] mb-0.5">{label}</span>
      <div className="bg-white border border-[#DBD5C1] rounded-md px-2 py-1 text-[11px] text-[#26302B]">{value}</div>
    </div>
  );
}

const CALENDAR_CELL_CLASS: Record<'tersedia' | 'sisa_sedikit' | 'penuh', string> = {
  tersedia: 'bg-[#2B4739]',
  sisa_sedikit: 'bg-[#B5652E]',
  penuh: 'bg-[#A8412E]',
};

function CalendarMock() {
  const days = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum'];
  const rows: { code: string; name: string; status: ('tersedia' | 'sisa_sedikit' | 'penuh')[] }[] = [
    { code: 'TND-04', name: 'Tenda Dome 4P', status: ['tersedia', 'tersedia', 'sisa_sedikit', 'tersedia', 'penuh'] },
    { code: 'SLB-02', name: 'Sleeping Bag', status: ['tersedia', 'tersedia', 'tersedia', 'sisa_sedikit', 'tersedia'] },
  ];
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.code}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="font-mono text-[9px] font-bold bg-[#2B4739]/10 text-[#2B4739] border border-[#2B4739]/20 rounded px-1.5 py-0.5">
              {row.code}
            </span>
            <span className="text-[11px] font-bold text-[#26302B]">{row.name}</span>
          </div>
          <div className="grid grid-cols-5 gap-[3px]">
            {row.status.map((status, i) => (
              <span
                key={days[i]}
                className={`flex items-center justify-center rounded text-[9px] font-bold text-white py-1 ${CALENDAR_CELL_CLASS[status]}`}
              >
                {days[i]}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TransactionMock() {
  return (
    <div className="space-y-2">
      <MockField label="Nama penyewa" value="Budi Santoso" />
      <MockField label="Alat" value="Tenda Dome 4P × 1" />
      <div className="grid grid-cols-2 gap-2">
        <MockField label="Ambil" value="3 Agu" />
        <MockField label="Kembali" value="5 Agu" />
      </div>
      <MockField label="DP (Rp)" value="50.000" />
      <div className="mt-1 bg-[#2B4739] text-white text-center text-[11px] font-bold rounded-lg py-1.5">
        Simpan transaksi
      </div>
    </div>
  );
}

function TrackingMock() {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-mono text-[9px] font-bold bg-[#2B4739]/10 text-[#2B4739] border border-[#2B4739]/20 rounded px-1.5 py-0.5 inline-block mb-1">
            SWL-0803-02
          </span>
          <div className="text-[12px] font-bold text-[#26302B]">Rina W.</div>
          <div className="text-[10px] text-[#8A8368]">Tenda Dome 4P × 1</div>
        </div>
        <span className="inline-flex items-center gap-1 bg-[#A8412E] text-white text-[9px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap">
          <AlertOctagon className="w-2.5 h-2.5" />
          Telat 5 jam
        </span>
      </div>
      <ul className="text-[10px] text-[#8A8368] pl-4 list-disc space-y-0.5">
        <li>Denda keterlambatan: Rp25.000</li>
        <li>Denda kerusakan: Rp50.000 (ritsleting)</li>
      </ul>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="relative w-full max-w-[300px] h-[300px] lg:max-w-[340px] lg:h-[340px]" aria-hidden="true">
      <div className="absolute inset-0 bg-[#FBFAF4] border border-[#DBD5C1] rounded-2xl shadow-xl p-3.5 rotate-[6deg] translate-x-[10px] translate-y-[6px] opacity-70 z-10">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-[#8A8368] mb-2.5">
          Jaminan &amp; denda
        </span>
        <TrackingMock />
      </div>
      <div className="absolute inset-0 bg-[#FBFAF4] border border-[#DBD5C1] rounded-2xl shadow-xl p-3.5 -rotate-[4deg] -translate-x-[8px] translate-y-[10px] opacity-90 z-20">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-[#8A8368] mb-2.5">
          Catat transaksi
        </span>
        <TransactionMock />
      </div>
      <div className="absolute inset-0 bg-[#FBFAF4] border border-[#DBD5C1] rounded-2xl shadow-xl p-3.5 rotate-[1deg] z-30">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-[#8A8368] mb-2.5">
          Kalender ketersediaan
        </span>
        <CalendarMock />
      </div>
    </div>
  );
}

function ProblemCard({
  icon: Icon,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: string;
}) {
  return (
    <div className="reveal bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-xs p-5 hover:border-[#2B4739]/50 transition">
      <div className="w-10 h-10 rounded-xl bg-[#FAF0EE] border border-[#A8412E]/30 flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-[#A8412E]" />
      </div>
      <h3 className="text-base font-bold text-[#26302B] mb-1.5">{title}</h3>
      <p className="text-sm text-[#8A8368]">{children}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  iconClass,
  title,
  children,
  preview,
  className = '',
}: {
  icon: ComponentType<{ className?: string }>;
  iconClass: string;
  title: string;
  children: string;
  preview: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-xs p-5 flex flex-col gap-3 hover:border-[#2B4739]/50 transition ${className}`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconClass}`}>
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-base font-bold text-[#26302B]">{title}</h3>
      <p className="text-sm text-[#8A8368]">{children}</p>
      <div className="mt-auto pt-3.5 border-t border-[#E6E1D2]">{preview}</div>
    </div>
  );
}

function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    if (!window.IntersectionObserver) {
      els.forEach((el) => el.classList.add('reveal--visible'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal--visible');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export function LandingPage() {
  useScrollReveal();

  return (
    <div className="min-h-screen bg-[#F1EEE2] text-[#26302B] flex flex-col">
      <header className="sticky top-0 z-20 bg-[#2B4739] text-white shadow-md border-b border-[#1E3429]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#F1EEE2] flex items-center justify-center shrink-0">
              <img src="/logo.svg" alt="" className="w-7 h-7" />
            </div>
            <span className="text-xl font-bold">Sewalog</span>
          </div>
          <a
            href={waLink(MSG_UMUM)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 bg-[#B5652E] hover:bg-[#9E5524] active:scale-95 transition text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-xs"
          >
            <WaIcon className="w-4 h-4" />
            Hubungi Kami
          </a>
        </div>
      </header>

      <main className="flex-1">
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-10 lg:pt-16 lg:pb-16 lg:flex lg:items-center lg:gap-12">
          <div className="lg:flex-1">
            <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-extrabold leading-tight text-[#26302B] mb-4">
              Jangan Sampai Alat yang Sama Disewa Dua Kali
            </h1>
            <p className="text-base text-[#8A8368] mb-6 max-w-md">
              Sewalog bantu kamu lihat stok alat yang masih kosong, catat transaksi sewa dalam hitungan detik, dan
              pantau jaminan &amp; denda — semua dari HP, sambil tetap layani pelanggan di depan rak.
            </p>
            <a
              href={waLink(MSG_UMUM)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-[#B5652E] hover:bg-[#9E5524] active:scale-95 transition text-white font-semibold px-6 py-3.5 rounded-xl shadow-md"
            >
              <WaIcon className="w-5 h-5" />
              Ngobrol Dulu Yuk
            </a>
          </div>
          <div className="mt-12 lg:mt-0 lg:flex-1 flex justify-center">
            <HeroPreview />
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <h2 className="reveal text-2xl font-bold text-[#26302B] mb-5">Masalah yang Sering Bikin Pusing</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ProblemCard icon={CalendarX} title="Alat Kesewa Dobel">
              Stok cuma diingat-ingat atau dicek manual, jadi alat yang sama bisa kesewa ke dua pelanggan di hari
              yang sama.
            </ProblemCard>
            <ProblemCard icon={FileWarning} title="Catatan Transaksi Berantakan">
              Nota kertas atau chat WhatsApp gampang hilang, susah dicari lagi waktu mau direkap.
            </ProblemCard>
            <ProblemCard icon={ShieldAlert} title="Jaminan & Denda Susah Dilacak">
              KTP, SIM, atau uang jaminan ketuker antar pelanggan, denda telat dan rusak juga gampang lupa dicatat.
            </ProblemCard>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <h2 className="reveal text-2xl font-bold text-[#26302B] mb-5">Tiga Hal yang Sewalog Bereskan</h2>
          <div className="reveal grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-2 gap-4">
            <FeatureCard
              icon={Calendar}
              iconClass="bg-[#E8EFEA] border border-[#2B4739]/20 text-[#2B4739]"
              title="Kalender Ketersediaan"
              preview={<CalendarMock />}
              className="lg:row-span-2"
            >
              Langsung kelihatan alat mana yang masih kosong, tanpa buka-buka catatan lama.
            </FeatureCard>
            <FeatureCard
              icon={Plus}
              iconClass="bg-[#F9EFE7] border border-[#B5652E]/30 text-[#B5652E]"
              title="Catat Transaksi"
              preview={<TransactionMock />}
            >
              Isi form singkat sambil pelanggan menunggu — alat, tanggal, sampai total harga otomatis kehitung.
            </FeatureCard>
            <FeatureCard
              icon={ShieldAlert}
              iconClass="bg-[#FAF0EE] border border-[#A8412E]/30 text-[#A8412E]"
              title="Jaminan & Denda"
              preview={<TrackingMock />}
            >
              Pantau siapa yang telat balikin alat — denda telat dan rusak/hilang dicatat terpisah, rapi.
            </FeatureCard>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <h2 className="reveal text-2xl font-bold text-[#26302B] mb-5">Cara Mulai</h2>
          <ol className="reveal space-y-5">
            {[
              {
                title: 'Chat Kami Duluan',
                desc: 'Ceritakan alat dan cara sewa di tempat kamu lewat WhatsApp, nggak perlu isi form apa-apa.',
              },
              {
                title: 'Kami Bantu Setup',
                desc: 'Kami bantu buatkan akun dan masukkan data alat kamu — kamu tinggal pakai.',
              },
              {
                title: 'Coba Gratis Dulu',
                desc: 'Coba langsung di tempat kamu, gratis di tahap awal ini — tanpa kontrak, tanpa kartu kredit.',
              },
            ].map((step, i) => (
              <li key={step.title} className="flex items-start gap-3.5">
                <span className="shrink-0 w-8 h-8 rounded-full bg-[#2B4739] text-white font-bold text-sm flex items-center justify-center">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[15px] font-bold text-[#26302B] mb-0.5">{step.title}</h3>
                  <p className="text-sm text-[#8A8368]">{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="reveal max-w-4xl mx-auto px-4 sm:px-6 py-9">
          <div className="bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-xs text-center px-6 py-9 sm:py-11">
            <h2 className="text-2xl font-bold text-[#26302B] mb-3">Masih Ragu? Ngobrol Dulu Aja</h2>
            <p className="text-[#8A8368] max-w-md mx-auto mb-6">
              Nggak perlu buru-buru mutusin. Ceritakan cara sewa alat di tempat kamu, biar kami bantu lihat apakah
              Sewalog cocok buat usaha kamu.
            </p>
            <a
              href={waLink(MSG_MULAI)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-[#B5652E] hover:bg-[#9E5524] active:scale-95 transition text-white font-semibold px-6 py-3.5 rounded-xl shadow-md"
            >
              <WaIcon className="w-5 h-5" />
              Hubungi Kami Sekarang
            </a>
          </div>
        </section>
      </main>

      <footer className="bg-[#1E3429] border-t border-[#3A5C4A] text-[#DBD5C1] text-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2 text-[#FBFAF4] font-bold text-sm">
            <img src="/logo.svg" alt="" className="w-5 h-5" />
            Sewalog
          </div>
          <p>Tools operasional rental alat kamping &amp; outdoor · Malang Raya</p>
          <a href={waLink(MSG_UMUM)} target="_blank" rel="noreferrer" className="text-[#F1EEE2] font-semibold hover:underline">
            WhatsApp: {WHATSAPP_DISPLAY}
          </a>
        </div>
      </footer>
    </div>
  );
}
