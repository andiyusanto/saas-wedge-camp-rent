// Pencocokan pelanggan via nomor WA (POST /bookings) harus tetap benar
// walau business punya >1.000 baris customers -- PostgREST max_rows=1.000
// (CLAUDE.md bagian 7) memotong hasil DIAM-DIAM kalau fetch-nya tidak
// dipaginasi. Mock supabase client ini mensimulasikan .range() berpaginasi
// 2 halaman (1000 + sisa), memverifikasi fetchAllCustomerPhonePages()/
// findCustomerIdByPhone() tetap menemukan baris yang cocok di HALAMAN KEDUA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllCustomerPhonePages, findCustomerIdByPhone } from '../customerPhoneMatch.js';

const PAGE_SIZE = 1000;

function makeFakeSupabase(allRows: { id: string; phone: string | null }[], bookingRows: { customer_id: string; created_at: string }[] = []) {
  return {
    from(table: string) {
      if (table === 'customers') {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          not() {
            return this;
          },
          order() {
            return this;
          },
          async range(start: number, end: number) {
            return { data: allRows.slice(start, end + 1), error: null };
          },
        };
      }
      if (table === 'bookings') {
        return {
          select() {
            return this;
          },
          in() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return Promise.resolve({ data: bookingRows, error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as any;
}

test('fetchAllCustomerPhonePages: mengambil seluruh baris lewat >1 halaman .range()', async () => {
  const rows = Array.from({ length: PAGE_SIZE + 37 }, (_, i) => ({ id: `id-${i}`, phone: `0812${String(i).padStart(8, '0')}` }));
  const supabase = makeFakeSupabase(rows);
  const result = await fetchAllCustomerPhonePages(supabase, 'biz-1');
  assert.equal(result.length, PAGE_SIZE + 37);
  assert.equal(result[0].id, 'id-0');
  assert.equal(result[PAGE_SIZE + 36].id, `id-${PAGE_SIZE + 36}`);
});

test('findCustomerIdByPhone: menemukan pelanggan yang cuma ada di halaman KEDUA (>1000 baris)', async () => {
  const rows = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({ id: `id-${i}`, phone: `0810${String(i).padStart(7, '0')}` }));
  // Pelanggan target berada di indeks PAGE_SIZE+2 -- pasti terpotong kalau
  // fetch-nya tidak dipaginasi (single query max_rows=1000 cuma dapat
  // indeks 0..999).
  rows[PAGE_SIZE + 2] = { id: 'target-id', phone: '081234000099' };
  const supabase = makeFakeSupabase(rows);
  const id = await findCustomerIdByPhone(supabase, 'biz-1', '+62 8123-4000-099');
  assert.equal(id, 'target-id');
});

test('findCustomerIdByPhone: tidak ketemu -> null', async () => {
  const supabase = makeFakeSupabase([{ id: 'a', phone: '081200000001' }]);
  const id = await findCustomerIdByPhone(supabase, 'biz-1', '081299999999');
  assert.equal(id, null);
});

test('findCustomerIdByPhone: duplikat lintas-halaman -- pakai yang paling baru dipakai', async () => {
  const rows = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({ id: `id-${i}`, phone: `0810${String(i).padStart(7, '0')}` }));
  rows[3] = { id: 'dup-old', phone: '081234000099' };
  rows[PAGE_SIZE + 2] = { id: 'dup-new', phone: '081234000099' };
  const supabase = makeFakeSupabase(rows, [{ customer_id: 'dup-new', created_at: '2026-11-20T00:00:00Z' }]);
  const id = await findCustomerIdByPhone(supabase, 'biz-1', '081234000099');
  assert.equal(id, 'dup-new');
});
