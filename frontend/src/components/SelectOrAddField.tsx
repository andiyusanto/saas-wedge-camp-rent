import { useState } from 'react';
import { Plus, Check, X } from 'lucide-react';

// Pilih dari nilai yang sudah pernah dipakai di katalog, atau ketik baru.
// Pola sama seperti fitur setara di Bilbo-Outdoors — tidak ada tabel
// enum/lookup terpisah, daftar pilihan diturunkan live dari katalog
// sendiri (lihat getDistinctValues di ItemsScreen.tsx).
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
        <div className="flex items-center gap-1.5">
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
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
          />
          <button
            type="button"
            onClick={confirmNew}
            title="Gunakan"
            className="p-2 rounded-lg bg-[#2B4739] hover:bg-[#1E3429] text-white transition shrink-0"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewValue('');
            }}
            title="Batal"
            className="p-2 rounded-lg bg-white border border-[#DBD5C1] text-[#6E6853] hover:bg-[#F1EEE2] transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
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
            title={addButtonLabel}
            className="p-2 rounded-lg bg-white border border-[#DBD5C1] text-[#2B4739] hover:bg-[#E8EFEA] transition shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}
    </label>
  );
}
