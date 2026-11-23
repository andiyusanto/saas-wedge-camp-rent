import { useEffect, useState } from 'react';
import { ClipboardList, Trash2, X } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import { ConfirmModal } from './ConfirmModal';
import { formatIDR } from '../utils/formatters';
import { deleteAllBookingDrafts, deleteBookingDraft, listBookingDrafts } from '../hooks/useBookingDrafts';
import type { BookingDraft } from '../hooks/useBookingDrafts';

// Daftar Draf Transaksi (brief 23 Nov 2026) -- dibuka dari tombol
// "Draf (N)" di Navbar. Draf TIDAK menahan stok sama sekali (ditulis
// jelas di sini, diulang lagi di form saat draf dilanjutkan) -- stok
// baru benar-benar dicek saat Simpan seperti biasa.
function ageLabel(updatedAt: number): string {
  const diffMs = Date.now() - updatedAt;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

export function DraftListModal({
  isOpen,
  onClose,
  businessId,
  onResume,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  businessId: string;
  onResume: (draftId: string) => void;
  // Badge "Draf (N)" di Navbar (App.tsx) dihitung dari localStorage di
  // render App.tsx sendiri -- dipanggil setelah hapus satu/semua supaya
  // badge langsung ter-update tanpa harus menutup modal ini dulu.
  onChanged?: () => void;
}) {
  const [drafts, setDrafts] = useState<BookingDraft[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<BookingDraft | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  useEffect(() => {
    if (isOpen) setDrafts(listBookingDrafts(businessId));
  }, [isOpen, businessId]);

  if (!isOpen) return null;

  function refresh() {
    setDrafts(listBookingDrafts(businessId));
    onChanged?.();
  }

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-[#FBFAF4] w-full max-w-md rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[85vh] flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <ClipboardList className="w-5 h-5 text-[#A65C2A]" />
            <h2 className="text-lg font-bold">Draf Transaksi</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3 text-xs sm:text-sm">
          <p className="text-[11px] text-[#6E6853] bg-[#F1EEE2] border border-[#DBD5C1] rounded-lg p-2.5">
            Draf belum mengunci alat. Stok dicek saat Simpan.
          </p>

          {drafts.length === 0 && <p className="text-xs text-[#6E6853] py-4 text-center">Belum ada draf tersimpan.</p>}

          {drafts.map((draft) => (
            <div key={draft.id} className="rounded-xl border border-[#DBD5C1] p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-[#26302B] truncate">{draft.label}</p>
                <p className="text-[11px] text-[#6E6853]">
                  {draft.itemCount} alat/paket · {formatIDR(draft.totalPreview)} · {ageLabel(draft.updatedAt)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    onResume(draft.id);
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-[11px] transition"
                >
                  Lanjutkan
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(draft)}
                  title="Buang draf"
                  className="p-1.5 rounded-lg border border-[#DBD5C1] hover:bg-[#FAF0EE] text-[#A8412E] transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {drafts.length > 0 && (
          <div className="p-4 border-t border-[#DBD5C1] shrink-0">
            <button
              type="button"
              onClick={() => setConfirmDeleteAll(true)}
              className="w-full text-center text-[11px] font-semibold text-[#A8412E] hover:underline"
            >
              Hapus semua draf
            </button>
          </div>
        )}
      </ModalPanel>

      <ConfirmModal
        isOpen={deleteTarget !== null}
        title="Buang Draf?"
        description={`Draf "${deleteTarget?.label ?? ''}" akan dihapus dari perangkat ini.`}
        confirmLabel="Buang"
        onConfirm={() => {
          if (deleteTarget) deleteBookingDraft(businessId, deleteTarget.id);
          refresh();
        }}
        onClose={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        isOpen={confirmDeleteAll}
        title="Hapus Semua Draf?"
        description="Semua draf transaksi di perangkat ini akan dihapus dan tidak bisa dikembalikan."
        confirmLabel="Hapus Semua"
        onConfirm={() => {
          deleteAllBookingDrafts(businessId);
          refresh();
        }}
        onClose={() => setConfirmDeleteAll(false)}
      />
    </ModalBackdrop>
  );
}
