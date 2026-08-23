import type { ComponentType } from 'react';

// Dipakai bersama di Jaminan & Denda dan Riwayat — dulu didefinisikan
// lokal di TrackingScreen.tsx, diekstrak supaya tidak diduplikasi.
export function StatCard({
  label,
  value,
  color,
  icon: Icon,
  sub,
  isText,
}: {
  label: string;
  value: number | string;
  color: 'danger' | 'warning' | 'primary' | 'neutral';
  icon: ComponentType<{ className?: string }>;
  sub: string;
  isText?: boolean;
}) {
  const palette = {
    danger: { border: 'border-[#A8412E]/30', bg: 'bg-[#FAF0EE]', text: 'text-[#A8412E]' },
    warning: { border: 'border-[#A65C2A]/30', bg: 'bg-[#F9EFE7]', text: 'text-[#A65C2A]' },
    primary: { border: 'border-[#2B4739]/30', bg: 'bg-[#E8EFEA]', text: 'text-[#2B4739]' },
    neutral: { border: 'border-[#DBD5C1]', bg: 'bg-[#F1EEE2]', text: 'text-[#26302B]' },
  }[color];

  return (
    <div className={`bg-[#FBFAF4] p-4 rounded-2xl border ${palette.border} shadow-xs relative overflow-hidden`}>
      <div className={`absolute right-3 top-3 w-8 h-8 rounded-xl ${palette.bg} flex items-center justify-center ${palette.text}`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-xs text-[#6E6853] font-semibold">{label}</p>
      <p className={`${isText ? 'text-sm sm:text-base' : 'text-xl sm:text-2xl'} font-extrabold ${palette.text} mt-1`}>{value}</p>
      <p className={`text-[10px] ${palette.text} mt-1 font-medium`}>{sub}</p>
    </div>
  );
}
