import { useEffect } from 'react';
import { waLink, WHATSAPP_DISPLAY } from '../lib/whatsapp';
import './LandingPage.css';

const MSG_UMUM = 'Halo, saya pemilik rental alat kamping. Mau tanya-tanya soal Sewalog.';
const MSG_MULAI = 'Halo, saya mau coba Sewalog untuk usaha rental saya.';

function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.06-1.36A10 10 0 1 0 12 2Zm0 1.8a8.2 8.2 0 0 1 6.94 12.56l-.24.4.83 3.02-3.1-.81-.39.23A8.2 8.2 0 1 1 12 3.8Zm-3.53 4a.86.86 0 0 0-.62.29c-.21.23-.82.8-.82 1.94 0 1.15.84 2.26.96 2.42.12.15 1.63 2.58 4.03 3.55 2 .8 2.4.65 2.84.6.44-.04 1.4-.57 1.6-1.12.2-.55.2-1.02.14-1.12-.06-.1-.22-.16-.46-.28-.24-.12-1.4-.7-1.62-.77-.22-.08-.37-.12-.53.12-.16.24-.6.77-.74.93-.14.16-.27.18-.5.06-.24-.12-1-.37-1.9-1.18-.7-.63-1.18-1.4-1.31-1.64-.14-.24-.01-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.53-1.32-.74-1.8-.19-.47-.4-.4-.53-.41Z" />
    </svg>
  );
}

function CalendarMock() {
  const days = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum'];
  const rows: { name: string; status: ('tersedia' | 'sisa_sedikit' | 'penuh')[] }[] = [
    { name: 'Tenda Dome 4P', status: ['tersedia', 'tersedia', 'sisa_sedikit', 'tersedia', 'penuh'] },
    { name: 'Sleeping Bag', status: ['tersedia', 'tersedia', 'tersedia', 'sisa_sedikit', 'tersedia'] },
  ];
  return (
    <div className="mock-calendar">
      {rows.map((row) => (
        <div className="mock-calendar__row" key={row.name}>
          <span className="mock-calendar__name">{row.name}</span>
          <div className="mock-calendar__strip">
            {row.status.map((status, i) => (
              <span key={days[i]} className={`mock-cell mock-cell--${status}`}>
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
    <div className="mock-form">
      <div className="mock-form__field">
        <span>Nama penyewa</span>
        <div className="mock-input">Budi Santoso</div>
      </div>
      <div className="mock-form__field">
        <span>Alat</span>
        <div className="mock-input">Tenda Dome 4P × 1</div>
      </div>
      <div className="mock-form__row">
        <div className="mock-form__field">
          <span>Ambil</span>
          <div className="mock-input">3 Agu</div>
        </div>
        <div className="mock-form__field">
          <span>Kembali</span>
          <div className="mock-input">5 Agu</div>
        </div>
      </div>
      <div className="mock-form__button">Simpan transaksi</div>
    </div>
  );
}

function TrackingMock() {
  return (
    <div className="mock-tracking">
      <div className="mock-tracking__item">
        <div>
          <div className="mock-tracking__name">Rina W.</div>
          <div className="mock-tracking__sub">Tenda Dome 4P × 1</div>
        </div>
        <span className="mock-badge mock-badge--overdue">Telat 5 jam</span>
      </div>
      <ul className="mock-tracking__penalties">
        <li>Denda keterlambatan: Rp25.000</li>
        <li>Denda kerusakan: Rp50.000 (ritsleting)</li>
      </ul>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="hero-stack" aria-hidden="true">
      <div className="hero-stack__card hero-stack__card--back">
        <span className="hero-stack__label">Jaminan &amp; denda</span>
        <TrackingMock />
      </div>
      <div className="hero-stack__card hero-stack__card--mid">
        <span className="hero-stack__label">Catat transaksi</span>
        <TransactionMock />
      </div>
      <div className="hero-stack__card hero-stack__card--front">
        <span className="hero-stack__label">Kalender ketersediaan</span>
        <CalendarMock />
      </div>
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
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav__brand">
          <img src="/logo.svg" alt="" width="32" height="32" />
          <span>Sewalog</span>
        </div>
        <a className="btn btn--primary btn--sm" href={waLink(MSG_UMUM)} target="_blank" rel="noreferrer">
          <WaIcon />
          Hubungi Kami
        </a>
      </header>

      <section className="hero">
        <div className="hero__copy">
          <h1>Jangan Sampai Alat yang Sama Disewa Dua Kali</h1>
          <p className="hero__subtitle">
            Sewalog bantu kamu lihat stok alat yang masih kosong, catat transaksi sewa dalam hitungan detik, dan
            pantau jaminan &amp; denda — semua dari HP, sambil tetap layani pelanggan di depan rak.
          </p>
          <a className="btn btn--primary btn--lg" href={waLink(MSG_UMUM)} target="_blank" rel="noreferrer">
            <WaIcon />
            Ngobrol Dulu Yuk
          </a>
        </div>
        <div className="hero__visual">
          <HeroPreview />
        </div>
      </section>

      <section className="problems reveal">
        <h2>Masalah yang Sering Bikin Pusing</h2>
        <div className="problems__grid">
          <div className="problem-card">
            <span className="problem-card__number">1</span>
            <h3>Alat Kesewa Dobel</h3>
            <p>
              Stok cuma diingat-ingat atau dicek manual, jadi alat yang sama bisa kesewa ke dua pelanggan di hari
              yang sama.
            </p>
          </div>
          <div className="problem-card">
            <span className="problem-card__number">2</span>
            <h3>Catatan Transaksi Berantakan</h3>
            <p>Nota kertas atau chat WhatsApp gampang hilang, susah dicari lagi waktu mau direkap.</p>
          </div>
          <div className="problem-card">
            <span className="problem-card__number">3</span>
            <h3>Jaminan &amp; Denda Susah Dilacak</h3>
            <p>
              KTP, SIM, atau uang jaminan ketuker antar pelanggan, denda telat dan rusak juga gampang lupa
              dicatat.
            </p>
          </div>
        </div>
      </section>

      <section className="features reveal">
        <h2>Tiga Hal yang Sewalog Bereskan</h2>
        <div className="bento">
          <div className="bento-card">
            <h3>Kalender Ketersediaan</h3>
            <p>Langsung kelihatan alat mana yang masih kosong, tanpa buka-buka catatan lama.</p>
            <div className="bento-card__preview">
              <CalendarMock />
            </div>
          </div>
          <div className="bento-card">
            <h3>Catat Transaksi</h3>
            <p>Isi form singkat sambil pelanggan menunggu — alat, tanggal, sampai total harga otomatis kehitung.</p>
            <div className="bento-card__preview">
              <TransactionMock />
            </div>
          </div>
          <div className="bento-card">
            <h3>Jaminan &amp; Denda</h3>
            <p>Pantau siapa yang telat balikin alat — denda telat dan rusak/hilang dicatat terpisah, rapi.</p>
            <div className="bento-card__preview">
              <TrackingMock />
            </div>
          </div>
        </div>
      </section>

      <section className="how reveal">
        <h2>Cara Mulai</h2>
        <ol className="how__steps">
          <li>
            <span className="how__step-number">1</span>
            <div>
              <h3>Chat Kami Duluan</h3>
              <p>Ceritakan alat dan cara sewa di tempat kamu lewat WhatsApp, nggak perlu isi form apa-apa.</p>
            </div>
          </li>
          <li>
            <span className="how__step-number">2</span>
            <div>
              <h3>Kami Bantu Setup</h3>
              <p>Kami bantu buatkan akun dan masukkan data alat kamu — kamu tinggal pakai.</p>
            </div>
          </li>
          <li>
            <span className="how__step-number">3</span>
            <div>
              <h3>Coba Gratis Dulu</h3>
              <p>Coba langsung di tempat kamu, gratis di tahap awal ini — tanpa kontrak, tanpa kartu kredit.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="cta-final reveal">
        <h2>Masih Ragu? Ngobrol Dulu Aja</h2>
        <p>
          Nggak perlu buru-buru mutusin. Ceritakan cara sewa alat di tempat kamu, biar kami bantu lihat apakah
          Sewalog cocok buat usaha kamu.
        </p>
        <a className="btn btn--primary btn--lg" href={waLink(MSG_MULAI)} target="_blank" rel="noreferrer">
          <WaIcon />
          Hubungi Kami Sekarang
        </a>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer__brand">
          <img src="/logo.svg" alt="" width="24" height="24" />
          <span>Sewalog</span>
        </div>
        <p>Tools operasional rental alat kamping &amp; outdoor · Malang Raya</p>
        <a href={waLink(MSG_UMUM)} target="_blank" rel="noreferrer">
          WhatsApp: {WHATSAPP_DISPLAY}
        </a>
      </footer>
    </div>
  );
}
