import { AlertTriangle } from 'lucide-react';
import type { Subscription } from '../hooks/useSubscription';
import { SUBSCRIPTION_CONFIG } from '../lib/subscriptionConfig';
import { getWhatsAppShareUrl } from '../utils/formatters';

// Review -c1: teks ke vendor TIDAK BOLEH menyebut nama "Andi" — selalu
// "hubungi Sewalog" + tombol WA resmi (nomor masih placeholder, lihat
// subscriptionConfig.ts). Owner lihat detail (H-14/H-7/H-1/tenggang/
// hanya-baca), karyawan lihat pesan netral ("hubungi pemilik usaha").
export function SubscriptionBanner({
  subscription,
  isOwner,
  businessName,
}: {
  subscription: Subscription | null;
  isOwner: boolean;
  businessName: string;
}) {
  if (!subscription) return null;
  const { status, daysUntilActiveUntil } = subscription;

  // Cuma tampil di hari-hari pengingat spesifik (H-14/H-7/H-1) + SELALU
  // tampil selama tenggang/hanya-baca — bukan tiap hari selama masih
  // aktif jauh dari jatuh tempo (bising, prinsip minim friksi).
  const showReminder = [14, 7, 1].includes(daysUntilActiveUntil);
  if (status === 'aktif' && !showReminder) return null;

  const waUrl = getWhatsAppShareUrl(
    SUBSCRIPTION_CONFIG.supportWhatsApp,
    `Halo Sewalog, saya mau tanya soal langganan usaha "${businessName}".`,
  );

  if (!isOwner) {
    const neutralText =
      status === 'hanya-baca'
        ? 'Akun usaha ini sedang hanya-baca. Hubungi pemilik usaha.'
        : 'Masa aktif usaha ini akan segera habis. Hubungi pemilik usaha.';
    return (
      <div className="bg-[#F9EFE7] border border-[#A65C2A]/40 rounded-xl px-4 py-2.5 text-xs font-semibold text-[#A65C2A] flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>{neutralText}</span>
      </div>
    );
  }

  let text: string;
  let tone: 'warning' | 'danger';
  if (status === 'hanya-baca') {
    text = 'Masa aktif sudah habis — akun ini sekarang hanya-baca. Transaksi yang sedang berjalan tetap bisa diselesaikan.';
    tone = 'danger';
  } else if (status === 'tenggang') {
    text = `Masa aktif sudah habis, masuk masa tenggang. Sisa ${7 + daysUntilActiveUntil} hari sebelum hanya-baca.`;
    tone = 'danger';
  } else if (daysUntilActiveUntil === 1) {
    text = 'Masa aktif habis besok.';
    tone = 'danger';
  } else {
    text = `Masa aktif habis dalam ${daysUntilActiveUntil} hari.`;
    tone = 'warning';
  }

  const colorClasses =
    tone === 'danger'
      ? 'bg-[#FAF0EE] border-[#A8412E]/40 text-[#A8412E]'
      : 'bg-[#F9EFE7] border-[#A65C2A]/40 text-[#A65C2A]';

  return (
    <div className={`border rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-2 ${colorClasses}`}>
      <span className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        {text}
      </span>
      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 px-3 py-1.5 rounded-lg bg-[#2B4739] text-white font-bold whitespace-nowrap"
      >
        Hubungi Sewalog
      </a>
    </div>
  );
}
