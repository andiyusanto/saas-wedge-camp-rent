import { forwardRef, useRef } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const BUTTON_STYLE = {
  light: 'bg-[#F1EEE2] hover:bg-[#E6E1D2] text-[#26302B] border border-[#DBD5C1]',
  dark: 'bg-[#2B4739] hover:bg-[#1E3429] text-[#DBD5C1] hover:text-white border border-[#3A5C4A]',
};

// forwardRef -- dipakai Navbar.tsx untuk menggulir tombol tab AKTIF ke area
// terlihat secara horizontal (container.scrollTo, bukan scrollIntoView) saat
// mount/refresh atau activeTab berubah -- lihat komentar di Navbar.tsx.
export const ScrollableRow = forwardRef<HTMLDivElement, {
  children: ReactNode;
  variant?: 'light' | 'dark';
  className?: string;
}>(function ScrollableRow({ children, variant = 'light', className }, forwardedRef) {
  const ref = useRef<HTMLDivElement>(null);

  function setRefs(node: HTMLDivElement | null) {
    ref.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }

  function scroll(direction: 'left' | 'right') {
    ref.current?.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
  }

  const buttonClass = `p-1.5 rounded-lg shrink-0 transition ${BUTTON_STYLE[variant]}`;

  return (
    <div className="flex items-center gap-1 w-full min-w-0">
      <button type="button" onClick={() => scroll('left')} className={buttonClass} title="Geser ke kiri">
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <div ref={setRefs} className={`flex items-center gap-1.5 overflow-x-auto scrollbar-none scroll-smooth min-w-0 ${className ?? ''}`}>
        {children}
      </div>
      <button type="button" onClick={() => scroll('right')} className={buttonClass} title="Geser ke kanan">
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
});
