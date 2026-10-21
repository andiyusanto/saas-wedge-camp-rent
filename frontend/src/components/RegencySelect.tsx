import { useEffect, useState } from 'react';
import type { Province, Regency } from '../hooks/useRegencies';

// Provinsi -> Kota/Kabupaten dua tingkat, bukan satu <select> datar — sejak
// data wilayah mencakup seluruh Indonesia (514 kota/kabupaten, migration
// 033), satu dropdown datar diurut nama saja terlalu padat dicari di HP
// (banyak "Kabupaten X"/"Kota X" mirip dari provinsi berbeda, lihat
// CLAUDE.md bagian 6). Provinsi dipilih dulu untuk mempersempit pilihan
// kota/kabupaten-nya.
export function RegencySelect({
  provinces,
  regencies,
  value,
  onChange,
}: {
  provinces: Province[];
  regencies: Regency[];
  value: string;
  onChange: (regencyId: string) => void;
}) {
  const selected = regencies.find((r) => r.id === value);
  const [provinceId, setProvinceId] = useState(selected?.province_id ?? '');

  // regencies/value bisa datang belakangan (fetch async) — sinkronkan
  // provinsi begitu regency yang sudah tersimpan sebelumnya ketemu.
  useEffect(() => {
    if (selected) setProvinceId(selected.province_id);
  }, [selected?.province_id]);

  const filteredRegencies = regencies.filter((r) => r.province_id === provinceId);

  return (
    <>
      <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
        Provinsi
        <select
          value={provinceId}
          onChange={(e) => {
            setProvinceId(e.target.value);
            onChange('');
          }}
          className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739]"
        >
          <option value="">— Pilih provinsi —</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-[#6E6853]">
        Kota/Kabupaten
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={!provinceId}
          className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] focus:outline-none focus:ring-1 focus:ring-[#2B4739] disabled:bg-[#F1EEE2] disabled:text-[#6E6853]"
        >
          <option value="">— Pilih kota/kabupaten —</option>
          {filteredRegencies.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
