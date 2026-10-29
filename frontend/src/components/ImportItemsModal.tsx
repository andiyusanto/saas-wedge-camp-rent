import { useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { X, Upload, Download, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp, Image, ImageOff } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatIDR, computeItemRentalPrice } from '../utils/formatters';
import { ModalBackdrop, ModalPanel } from './ModalShell';

type PreviewRowData = {
  code: string | null;
  category: string | null;
  variant: string | null;
  size: string | null;
  color: string | null;
  total_units: number;
  price_per_day: number;
  day2_rate: number;
  day3_rate: number;
  day4_rate: number;
  day5_rate: number;
  extra_day_rate: number;
  readiness_hours: number;
  description: string | null;
  photo_url: string | null;
};

type PreviewRow = {
  rowNumber: number;
  name: string;
  status: 'new' | 'update' | 'unchanged' | 'skipped';
  itemId: string | null;
  diff: { field: string; label: string; from: string; to: string }[];
  reactivatable: boolean;
  reason: string | null;
  data: PreviewRowData | null;
};

// Tampilkan cuma tingkat yang beda dari tingkat sebelumnya (nilai yang
// SUDAH diresolve warisan sel kosong, sama seperti yang dipakai saat
// commit) — alat flat (semua tingkat sama) jadi "Rp25.000/hari" saja,
// bukan enam angka identik berulang.
function priceLadder(d: PreviewRowData): string {
  const tiers: { label: string; value: number }[] = [
    { label: '', value: d.price_per_day },
    { label: 'hari 2', value: d.day2_rate },
    { label: 'hari 3', value: d.day3_rate },
    { label: 'hari 4', value: d.day4_rate },
    { label: 'hari 5', value: d.day5_rate },
    { label: 'hari 6+', value: d.extra_day_rate },
  ];
  const changed = tiers.filter((t, i) => i === 0 || t.value !== tiers[i - 1].value);
  if (changed.length === 1) return `${formatIDR(d.price_per_day)}/hari`;
  return changed.map((t) => (t.label ? `${t.label}: ${formatIDR(t.value)}` : formatIDR(t.value))).join(' · ');
}

function exampleTotal(d: PreviewRowData): string | null {
  const flat = [d.price_per_day, d.day2_rate, d.day3_rate, d.day4_rate, d.day5_rate, d.extra_day_rate].every(
    (v) => v === d.price_per_day,
  );
  if (flat) return null; // alat flat sudah jelas dari "Rp.../hari", total 3 hari tidak nambah informasi
  const total = computeItemRentalPrice(d, 3);
  return `3 hari = ${formatIDR(total)}`;
}

function summaryLine(d: PreviewRowData): string {
  const parts = [d.category, `${d.total_units} unit`, priceLadder(d)].filter(Boolean);
  const total = exampleTotal(d);
  return parts.join(' · ') + (total ? ` (${total})` : '');
}

type UnitWarning = { rowNumber: number; name: string; itemId: string | null; currentlyUsed: number; newTotalUnits: number };

type PreviewResponse = {
  rows: PreviewRow[];
  warnings: UnitWarning[];
  summary: { new: number; updated: number; unchanged: number; skipped: number };
};

type CommitResponse = {
  added: { rowNumber: number; name: string }[];
  updated: { rowNumber: number; name: string }[];
  unchanged: { rowNumber: number; name: string }[];
  skipped: { rowNumber: number; name: string; reason: string }[];
  failed: { rowNumber: number; name: string; error: string }[];
  photos: { ok: { rowNumber: number; name: string }[]; failed: { rowNumber: number; name: string; error: string }[] };
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Gagal membaca file.'));
    reader.readAsDataURL(file);
  });
}

function buildWhatsAppReport(result: CommitResponse): string {
  const lines: string[] = ['*Laporan impor data alat*', ''];
  lines.push(`Ditambah: ${result.added.length}`);
  lines.push(`Diperbarui: ${result.updated.length}`);
  lines.push(`Tidak berubah: ${result.unchanged.length}`);
  if (result.skipped.length > 0) {
    lines.push('', `Dilewati (${result.skipped.length}):`);
    result.skipped.forEach((s) => lines.push(`- Baris ${s.rowNumber} (${s.name || '-'}): ${s.reason}`));
  }
  if (result.failed.length > 0) {
    lines.push('', `Gagal disimpan (${result.failed.length}):`);
    result.failed.forEach((f) => lines.push(`- Baris ${f.rowNumber} (${f.name}): ${f.error}`));
  }
  if (result.photos.failed.length > 0) {
    lines.push('', `Foto gagal diambil (${result.photos.failed.length}):`);
    result.photos.failed.forEach((f) => lines.push(`- Baris ${f.rowNumber} (${f.name}): ${f.error}`));
  }
  return lines.join('\n');
}

export function ImportItemsModal({
  businessId,
  session,
  onClose,
  onImported,
}: {
  businessId: string;
  session: Session;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [step, setStep] = useState<'pilih' | 'pratinjau' | 'laporan'>('pilih');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [reactivateIds, setReactivateIds] = useState<Set<string>>(new Set());
  const [acknowledgedWarning, setAcknowledgedWarning] = useState(false);
  const [report, setReport] = useState<CommitResponse | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  function toggleExpanded(rowNumber: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }

  async function handleFileChange(selected: File | null) {
    setError(null);
    setFile(selected);
    setFileBase64(null);
    if (!selected) return;
    try {
      const base64 = await readFileAsBase64(selected);
      setFileBase64(base64);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handlePreview() {
    if (!file || !fileBase64) {
      setError('Pilih file dulu.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<PreviewResponse>(session, '/api/items/import/preview', {
        method: 'POST',
        body: JSON.stringify({ businessId, fileBase64, filename: file.name }),
      });
      setPreview(result);
      setReactivateIds(new Set());
      setAcknowledgedWarning(false);
      setStep('pratinjau');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!file || !fileBase64 || !preview) return;
    if (preview.warnings.length > 0 && !acknowledgedWarning) {
      setError('Centang "Saya paham" dulu sebelum menyimpan.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<CommitResponse>(session, '/api/items/import/commit', {
        method: 'POST',
        body: JSON.stringify({
          businessId,
          fileBase64,
          filename: file.name,
          reactivateItemIds: [...reactivateIds],
          acknowledgedUnitWarning: acknowledgedWarning,
        }),
      });
      setReport(result);
      setStep('laporan');
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggleReactivate(itemId: string) {
    setReactivateIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function copyReport() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(buildWhatsAppReport(report));
    } catch {
      /* clipboard tidak tersedia, abaikan diam-diam — laporan tetap terlihat di layar */
    }
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] rounded-2xl border border-[#DBD5C1] shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[#26302B]">Impor Data Alat dari Excel/CSV</h2>
            <button onClick={onClose} className="text-[#6E6853] hover:text-[#26302B]">
              <X className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div className="bg-[#A8412E]/10 border border-[#A8412E]/30 rounded-xl p-3 text-xs text-[#A8412E] font-semibold">{error}</div>
          )}

          {step === 'pilih' && (
            <div className="space-y-4">
              <a
                href="/template-data-alat.xlsx"
                download
                className="flex items-center gap-2 text-xs font-semibold text-[#2B4739] hover:underline"
              >
                <Download className="w-4 h-4" />
                Unduh template Excel
              </a>

              <ol className="space-y-2 text-xs text-[#26302B]">
                <li>
                  <span className="font-bold">1. Unduh template</span> — tekan "Unduh template Excel" di atas.
                </li>
                <li>
                  <span className="font-bold">2. Isi data alat</span> — satu baris untuk satu jenis alat. Kolom bertanda *
                  wajib diisi. Harga cukup tulis angka, misalnya 30000. Hapus 3 baris contoh sebelum mengunggah.
                </li>
                <li>
                  <span className="font-bold">3. Simpan file</span>, lalu pilih file itu di bawah.
                </li>
                <li>
                  <span className="font-bold">4. Cek pratinjau</span> — sebelum disimpan, kamu bisa lihat alat mana yang
                  baru, mana yang berubah, dan mana yang perlu diperbaiki.
                </li>
                <li>
                  <span className="font-bold">5. Simpan</span> — alat yang sudah ada diperbarui, bukan dibuat dobel. Alat
                  yang tidak ada di file tidak akan dihapus.
                </li>
              </ol>
              <p className="text-[10px] text-[#6E6853]">
                Bisa .xlsx atau .csv, maksimal 500 baris. Foto boleh pakai link Google Drive (akses: siapa saja yang
                memiliki link).
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs shrink-0"
                >
                  Pilih File
                </button>
                <span className="text-xs text-[#6E6853] truncate">{file ? file.name : 'Belum ada file dipilih'}</span>
              </div>

              <button
                onClick={handlePreview}
                disabled={!file || loading}
                className="w-full px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] disabled:opacity-50 text-white font-bold text-xs shadow-sm transition flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                {loading ? 'Memeriksa file...' : 'Lanjut: Pratinjau'}
              </button>
            </div>
          )}

          {step === 'pratinjau' && preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-[#2B4739]/10 rounded-xl p-2">
                  <p className="text-lg font-bold text-[#2B4739]">{preview.summary.new}</p>
                  <p className="text-[10px] text-[#6E6853]">Baru</p>
                </div>
                <div className="bg-[#A65C2A]/10 rounded-xl p-2">
                  <p className="text-lg font-bold text-[#A65C2A]">{preview.summary.updated}</p>
                  <p className="text-[10px] text-[#6E6853]">Diperbarui</p>
                </div>
                <div className="bg-[#DBD5C1]/40 rounded-xl p-2">
                  <p className="text-lg font-bold text-[#6E6853]">{preview.summary.unchanged}</p>
                  <p className="text-[10px] text-[#6E6853]">Tidak berubah</p>
                </div>
                <div className="bg-[#A8412E]/10 rounded-xl p-2">
                  <p className="text-lg font-bold text-[#A8412E]">{preview.summary.skipped}</p>
                  <p className="text-[10px] text-[#6E6853]">Dilewati</p>
                </div>
              </div>

              {preview.warnings.length > 0 && (
                <div className="bg-[#A8412E]/10 border border-[#A8412E]/40 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-[#A8412E] flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> Peringatan: jumlah unit diturunkan di bawah yang sedang disewa/dipesan
                  </p>
                  <ul className="text-xs text-[#26302B] space-y-1">
                    {preview.warnings.map((w) => (
                      <li key={w.rowNumber}>
                        Baris {w.rowNumber} ({w.name}): unit baru {w.newTotalUnits}, tapi {w.currentlyUsed} unit sedang
                        disewa/dipesan.
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#26302B] pt-1">
                    <input type="checkbox" checked={acknowledgedWarning} onChange={(e) => setAcknowledgedWarning(e.target.checked)} />
                    Saya paham
                  </label>
                </div>
              )}

              <div className="max-h-[42vh] overflow-y-auto space-y-2 pr-1 -mr-1">
                {preview.rows.map((row) => {
                  const isExpanded = expandedRows.has(row.rowNumber);
                  const canExpand = row.status !== 'skipped';
                  return (
                    <div key={row.rowNumber} className="border border-[#E6E1D2] rounded-xl p-2.5 text-xs">
                      <button
                        type="button"
                        onClick={() => canExpand && toggleExpanded(row.rowNumber)}
                        className="w-full text-left"
                        disabled={!canExpand}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#26302B]">
                            Baris {row.rowNumber}: {row.name || '-'}
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`font-semibold ${
                                row.status === 'new'
                                  ? 'text-[#2B4739]'
                                  : row.status === 'update'
                                    ? 'text-[#A65C2A]'
                                    : row.status === 'skipped'
                                      ? 'text-[#A8412E]'
                                      : 'text-[#6E6853]'
                              }`}
                            >
                              {row.status === 'new' && 'Baru'}
                              {row.status === 'update' && 'Diperbarui'}
                              {row.status === 'unchanged' && 'Tidak berubah'}
                              {row.status === 'skipped' && 'Dilewati'}
                            </span>
                            {canExpand &&
                              (isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5 text-[#6E6853]" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-[#6E6853]" />
                              ))}
                          </span>
                        </div>
                        {row.status === 'skipped' && <p className="text-[#A8412E] mt-1 text-left">{row.reason}</p>}
                        {row.data && <p className="text-[#6E6853] mt-1 text-left">{summaryLine(row.data)}</p>}
                      </button>

                      {isExpanded && row.data && (
                        <div className="mt-2 pt-2 border-t border-[#E6E1D2] space-y-2">
                          {row.status === 'update' && row.diff.length > 0 && (
                            <ul className="space-y-0.5">
                              {row.diff.map((d) => (
                                <li key={d.field} className="text-[#A65C2A] font-semibold">
                                  {d.label}: <span className="text-[#6E6853] font-normal">{d.from}</span> →{' '}
                                  {d.to}
                                </li>
                              ))}
                            </ul>
                          )}

                          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[#26302B]">
                            {row.data.code && (
                              <>
                                <dt className="text-[#6E6853]">Kode</dt>
                                <dd>{row.data.code}</dd>
                              </>
                            )}
                            {row.data.variant && (
                              <>
                                <dt className="text-[#6E6853]">Varian</dt>
                                <dd>{row.data.variant}</dd>
                              </>
                            )}
                            {row.data.size && (
                              <>
                                <dt className="text-[#6E6853]">Ukuran</dt>
                                <dd>{row.data.size}</dd>
                              </>
                            )}
                            {row.data.color && (
                              <>
                                <dt className="text-[#6E6853]">Warna</dt>
                                <dd>{row.data.color}</dd>
                              </>
                            )}
                            <dt className="text-[#6E6853]">Jeda persiapan</dt>
                            <dd>{row.data.readiness_hours} jam</dd>
                          </dl>

                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="text-[#6E6853]">
                                <th className="font-normal pr-2 py-0.5">Hari 1</th>
                                <th className="font-normal pr-2 py-0.5">Hari 2</th>
                                <th className="font-normal pr-2 py-0.5">Hari 3</th>
                                <th className="font-normal pr-2 py-0.5">Hari 4</th>
                                <th className="font-normal pr-2 py-0.5">Hari 5</th>
                                <th className="font-normal py-0.5">Hari 6+</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="text-[#26302B] font-semibold">
                                <td className="pr-2">{formatIDR(row.data.price_per_day)}</td>
                                <td className="pr-2">{formatIDR(row.data.day2_rate)}</td>
                                <td className="pr-2">{formatIDR(row.data.day3_rate)}</td>
                                <td className="pr-2">{formatIDR(row.data.day4_rate)}</td>
                                <td className="pr-2">{formatIDR(row.data.day5_rate)}</td>
                                <td>{formatIDR(row.data.extra_day_rate)}</td>
                              </tr>
                            </tbody>
                          </table>

                          {row.data.description && (
                            <p className="text-[#6E6853] line-clamp-3">{row.data.description}</p>
                          )}

                          <p className="flex items-center gap-1.5 text-[#6E6853]">
                            {row.data.photo_url ? (
                              /instagram\.com|facebook\.com|fb\.watch/i.test(row.data.photo_url) ? (
                                <>
                                  <ImageOff className="w-3.5 h-3.5 text-[#A8412E]" />
                                  <span className="text-[#A8412E]">Link Instagram/Facebook — tidak bisa diambil</span>
                                </>
                              ) : (
                                <>
                                  <Image className="w-3.5 h-3.5" /> Ada link foto
                                </>
                              )
                            ) : (
                              <>
                                <ImageOff className="w-3.5 h-3.5" /> Tanpa foto
                              </>
                            )}
                          </p>
                        </div>
                      )}

                      {row.status === 'update' && row.reactivatable && row.itemId && (
                        <label className="flex items-center gap-2 mt-1.5 text-[#26302B]">
                          <input
                            type="checkbox"
                            checked={reactivateIds.has(row.itemId)}
                            onChange={() => toggleReactivate(row.itemId!)}
                          />
                          Alat ini nonaktif — aktifkan lagi?
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="sticky bottom-0 -mx-5 -mb-5 px-5 pb-5 pt-3 bg-[#FBFAF4] border-t border-[#E6E1D2] flex gap-2">
                <button
                  onClick={() => setStep('pilih')}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[#DBD5C1] text-[#26302B] font-bold text-xs"
                >
                  Kembali
                </button>
                <button
                  onClick={handleCommit}
                  disabled={loading || (preview.warnings.length > 0 && !acknowledgedWarning)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] disabled:opacity-50 text-white font-bold text-xs"
                >
                  {loading ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </div>
          )}

          {step === 'laporan' && report && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#2B4739]">
                <CheckCircle2 className="w-5 h-5" />
                <p className="font-bold text-sm">Impor selesai</p>
              </div>
              <div className="text-xs text-[#26302B] space-y-1">
                <p>Ditambah: {report.added.length}</p>
                <p>Diperbarui: {report.updated.length}</p>
                <p>Tidak berubah: {report.unchanged.length}</p>
                <p>Dilewati: {report.skipped.length}</p>
                {report.failed.length > 0 && <p className="text-[#A8412E] font-semibold">Gagal disimpan: {report.failed.length}</p>}
                {report.photos.failed.length > 0 && (
                  <p className="text-[#A65C2A] font-semibold flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> Foto gagal diambil: {report.photos.failed.length}
                  </p>
                )}
              </div>
              <button
                onClick={copyReport}
                className="w-full px-4 py-2.5 rounded-xl border border-[#DBD5C1] text-[#26302B] font-bold text-xs"
              >
                Salin laporan untuk WhatsApp
              </button>
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-bold text-xs"
              >
                Tutup
              </button>
            </div>
          )}
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
