import { useState } from 'react';
import { Check, X } from 'lucide-react';

// Pilih dari nilai yang sudah pernah dipakai di katalog, atau ketik baru.
// Pola sama seperti fitur setara di Bilbo-Outdoors — tidak ada tabel
// enum/lookup terpisah, daftar pilihan diturunkan live dari katalog
// sendiri (lihat getDistinctValues di ItemsScreen.tsx).
//
// Aksi (tombol tambah / konfirmasi-batal) sengaja diletakkan DI BAWAH
// select/input, bukan di sampingnya — field ini dipakai 3-kolom
// berdampingan (Varian/Ukuran/Warna), jadi tiap kolom cuma ~150px. Tombol
// icon-only di samping input bikin baris "sedang menambah" jadi sangat
// sempit dan sulit dibaca; menumpuk vertikal kasih tiap elemen lebar penuh.
export function SelectOrAddField({
  label,
  value,
  options,
  onChange,
  addButtonLabel,
  newInputPlaceholder,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  addButtonLabel: string;
  newInputPlaceholder: string;
}) {
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState('');

  const selectOptions = Array.from(new Set([...options, value].filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );

  function confirmNew() {
    const trimmed = newValue.trim();
    if (!trimmed) return;
    const existingMatch = selectOptions.find((o) => o.toLowerCase() === trimmed.toLowerCase());
    onChange(existingMatch ?? trimmed);
    setNewValue('');
    setAdding(false);
  }

  return (
    <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
      {label}
      {adding ? (
        <div className="space-y-1.5">
          <input
            type="text"
            autoFocus
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirmNew();
              }
            }}
            placeholder={newInputPlaceholder}
            className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={confirmNew}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-[#2B4739] hover:bg-[#1E3429] text-white text-xs font-semibold transition"
            >
              <Check className="w-3.5 h-3.5" />
              Gunakan
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewValue('');
              }}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-white border border-[#DBD5C1] text-[#6E6853] hover:bg-[#F1EEE2] text-xs font-semibold transition"
            >
              <X className="w-3.5 h-3.5" />
              Batal
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
          >
            <option value="">(Tidak ada)</option>
            {selectOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-[11px] font-semibold text-[#2B4739] hover:underline"
          >
            + {addButtonLabel}
          </button>
        </div>
      )}
    </label>
  );
}
