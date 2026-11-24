import type { AdminBusinessRow } from '../hooks/useAdminBusinesses';

// CSV ringan (brief admin-metrik-rental 24 Nov 2026, "opsional kalau
// ringan") -- TANPA library baru (exceljs cuma dipakai Riwayat/export
// .xlsx, overkill untuk satu tabel sederhana ini). Kolom "Nilai
// transaksi" ikut digerbang `showTxnValue` yang SAMA dengan tabel HTML
// -- kalau flag mati, kolom itu TIDAK ADA sama sekali di CSV (bukan
// cuma disembunyikan di UI tapi bocor lewat unduhan).
function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildAdminBusinessesCsv(rows: AdminBusinessRow[], showTxnValue: boolean): string {
  const headers = [
    'Nama usaha',
    'Email pemilik',
    'Status',
    'Aktif sampai',
    'Terdaftar',
    'Alat aktif',
    'Transaksi (bulan)',
    ...(showTxnValue ? ['Nilai transaksi (bulan)'] : []),
    'Terakhir aktif',
    'Diajak oleh',
  ];

  const lines = [headers.join(',')];

  for (const row of rows) {
    const cells = [
      row.name,
      row.owner_email,
      row.status,
      row.active_until ?? '',
      row.signed_up_at.slice(0, 10),
      String(row.active_items_count),
      String(row.txn_count_month),
      ...(showTxnValue ? [String(row.txn_value_month)] : []),
      row.last_active_date ?? '',
      row.referred_by_name ?? '',
    ];
    lines.push(cells.map((c) => escapeCsvField(c)).join(','));
  }

  return lines.join('\n');
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
