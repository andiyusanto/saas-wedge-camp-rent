import { Globe, MessageCircle } from 'lucide-react';

// Fake-door sengaja — belum ada fitur di baliknya. Tujuannya cuma satu:
// lihat apakah vendor pilot penasaran/tertarik ke tab ini sendiri, sinyal
// murah sebelum commit ke pembangunan storefront+payment publik (lihat
// research/online-checkout-payment-roadmap-2026-08.md syarat #2 — butuh
// konfirmasi kebutuhan nyata dari vendor pilot dulu). Copy sengaja "sedang
// dievaluasi", bukan "segera hadir" — supaya tidak menjanjikan sesuatu yang
// belum pasti dibangun ke pengguna yang non-technical.
const INTEREST_WHATSAPP_NUMBER = '62xxxxxxxxxx';

export function OnlineStoreScreen({ businessName }: { businessName: string }) {
  const message = `Halo Sewalog, saya dari usaha "${businessName}" tertarik dengan fitur Toko Online (link toko sendiri buat pelanggan transaksi online). Boleh cerita lebih lanjut?`;
  const interestUrl = `https://wa.me/${INTEREST_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

  return (
    <div className="max-w-lg mx-auto text-center py-10 space-y-4">
      <div className="w-14 h-14 rounded-2xl bg-[#E8EFEA] text-[#2B4739] flex items-center justify-center mx-auto">
        <Globe className="w-7 h-7" />
      </div>
      <h2 className="text-lg font-bold text-[#26302B]">Toko Online</h2>
      <p className="text-sm text-[#6E6853] leading-relaxed">
        Rencananya: link toko online sendiri (mis. <span className="font-mono text-xs">app.sewalog.com/nama-tokomu</span>)
        supaya pelanggan kamu bisa lihat ketersediaan dan transaksi sendiri tanpa perlu chat WhatsApp dulu.
      </p>
      <p className="text-sm text-[#6E6853] leading-relaxed">
        Fitur ini <strong>sedang kami evaluasi</strong> — belum pasti kapan atau apakah akan dibangun, tergantung
        seberapa banyak vendor yang benar-benar butuh.
      </p>

      <a
        href={interestUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-sm shadow-sm transition active:scale-95"
      >
        <MessageCircle className="w-4 h-4" />
        Tertarik? Kasih Tahu Kami
      </a>
    </div>
  );
}
