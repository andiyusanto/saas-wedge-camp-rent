import { X } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';

// Lightbox sederhana — tap foto alat di Katalog & Stok Alat atau Kalender
// Ketersediaan untuk lihat gambar lebih besar, tanpa keluar dari app
// (permintaan Andi, 29 Okt). Dipakai di dua tempat, jadi dipisah sendiri
// daripada diduplikasi. Tutup cuma lewat tombol X (bukan tap backdrop) —
// konsisten dengan modal lain di app (ConfirmModal, ReturnModal, dst),
// yang semuanya juga tidak punya tap-backdrop-to-close.
export function ImagePreviewModal({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  return (
    <ModalBackdrop>
      <ModalPanel className="max-w-lg w-full max-h-[85vh] flex flex-col items-center">
        <div className="relative">
          <button
            onClick={onClose}
            className="absolute -top-2 -right-2 bg-[#FBFAF4] border border-[#DBD5C1] rounded-full p-1.5 text-[#26302B] shadow-sm"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
          <img src={url} alt={alt} className="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-lg" />
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
