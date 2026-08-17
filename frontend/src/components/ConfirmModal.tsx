import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';

// Konfirmasi bergaya modal, cuma untuk aksi destruktif (hapus/batalkan/
// keluarkan) — aksi simpan/tambah SENGAJA tidak lewat ini, supaya alur
// Catat Transaksi (diisi cepat sambil pelanggan menunggu, lihat CLAUDE.md
// bagian 4 & 6) tidak kena friksi tambahan.
export function ConfirmModal({
  isOpen,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memproses, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-sm rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden">
        <div className="flex items-start justify-between px-5 pt-5">
          <div className="w-10 h-10 rounded-xl bg-[#FAF0EE] border border-[#A8412E]/30 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-[#A8412E]" />
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#F1EEE2] text-[#6E6853] transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-3 pb-5">
          <h3 className="font-bold text-[#26302B] text-base mb-1.5">{title}</h3>
          <p className="text-sm text-[#6E6853]">{description}</p>

          {error && <p className="text-xs font-semibold text-[#A8412E] mt-3">{error}</p>}

          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl border border-[#DBD5C1] hover:bg-[#F1EEE2] text-[#26302B] font-semibold text-xs transition disabled:opacity-60"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="px-4 py-2 rounded-xl bg-[#A8412E] hover:bg-[#8D3524] text-white font-bold text-xs shadow-sm transition disabled:opacity-60"
            >
              {submitting ? 'Memproses...' : confirmLabel}
            </button>
          </div>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
