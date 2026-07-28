// Semua vendor pilot ada di Malang Raya (WIB, UTC+7, tanpa DST) — lihat
// CLAUDE.md bagian 3. "Hari ini" dan aritmetika tanggal sengaja dihitung
// relatif ke WIB, bukan timezone lokal server atau UTC polos, supaya tidak
// bergeser satu hari tergantung di mana server di-deploy (lihat insiden:
// new Date(`${str}T00:00:00`) + toISOString() menggeser tanggal mundur
// satu hari karena local-time parsing dicampur serialisasi UTC).
export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export function todayInWIB(): string {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(dateStr: string, amount: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + amount * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function dateRange(startStr: string, endStr: string): string[] {
  const days: string[] = [];
  let current = startStr;

  while (current <= endStr) {
    days.push(current);
    current = addDays(current, 1);
  }

  return days;
}
