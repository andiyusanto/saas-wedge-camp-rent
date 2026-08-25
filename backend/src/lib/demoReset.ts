// Reset & reseed satu akun demo (owner + karyawan) untuk ditunjukkan ke calon
// vendor. Port dari scripts/seed-demo.mjs (CLI) supaya bisa dipicu juga dari
// tombol di layar login (lihat routes/demo.ts) — logika-nya SENGAJA sama
// persis, jaga tetap sinkron kalau salah satu diubah.
//
// SELALU beroperasi cuma di satu business demo yang dikunci lewat
// DEMO_OWNER_EMAIL/DEMO_PASSWORD — tidak pernah menerima business_id dari
// pemanggil, supaya endpoint publik yang memakai ini (routes/demo.ts) tidak
// bisa disalahgunakan untuk menyentuh data vendor asli.

import { todayInWIB, addDays } from './dates.js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;

const OWNER_EMAIL = process.env.DEMO_OWNER_EMAIL ?? 'demo.pemilik@sewalog.test';
const KARYAWAN_EMAIL = process.env.DEMO_KARYAWAN_EMAIL ?? 'demo.karyawan@sewalog.test';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'CobaSewalog2026';
const BUSINESS_NAME = 'Demo — Coba Sewalog';

function selfApiBaseUrl(): string {
  // Panggil diri sendiri lewat localhost, bukan URL publik — booking dibuat
  // lewat endpoint backend asli (bukan insert langsung ke tabel) supaya
  // nomor booking/validasi kapasitas/audit trail tetap konsisten, tanpa
  // perlu tahu domain publiknya sendiri di Render.
  return `http://localhost:${process.env.PORT ?? 3001}`;
}

// Lewat todayInWIB()/addDays() (bukan Date lokal server + toISOString), biar
// tidak kena jebakan pergeseran tanggal yang sama seperti dijelaskan di
// lib/dates.ts — Sewalog pakai WIB (UTC+7) sebagai default timezone.
function todayPlus(days: number): string {
  return addDays(todayInWIB(), days);
}

function computeItemRentalPrice(
  pricePerDay: number,
  discountMinDays: number,
  discountedPricePerDay: number | null,
  days: number,
): number {
  if (!discountedPricePerDay || days <= discountMinDays) return pricePerDay * days;
  const extraDays = days - discountMinDays;
  return pricePerDay * discountMinDays + discountedPricePerDay * extraDays;
}

// Sama persis dengan rentalDays() di frontend/src/utils/formatters.ts.
function rentalDays(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

type AuthSession = { access_token: string; user: { id: string; email: string } };

async function authRequest(path: string, body: unknown): Promise<{ ok: boolean; json: any }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

async function signInOrSignUp(email: string, password: string): Promise<AuthSession> {
  const signIn = await authRequest('token?grant_type=password', { email, password });
  if (signIn.ok) return signIn.json;

  const signUp = await authRequest('signup', { email, password });
  if (!signUp.ok) throw new Error(`Gagal signup/login ${email}: ${JSON.stringify(signUp.json)}`);
  if (signUp.json.access_token) return signUp.json;

  const retry = await authRequest('token?grant_type=password', { email, password });
  if (retry.ok) return retry.json;
  throw new Error(
    `User ${email} kebuat tapi tidak dapat sesi login langsung — cek toggle "Confirm email" di Supabase Auth.`,
  );
}

type FetchInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

async function rest<T = any>(path: string, token: string, init: FetchInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(init.headers ?? {}),
  };
  if (init.method && init.method !== 'GET' && !headers.Prefer) headers.Prefer = 'return=representation';

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`REST ${init.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json as T;
}

async function selfApi<T = any>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${selfApiBaseUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API ${init.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json as T;
}

type ItemDef = {
  code: string;
  name: string;
  category: string;
  variant: string | null;
  size: string | null;
  color: string | null;
  total_units: number;
  price_per_day: number;
  discount_min_days: number;
  discounted_price_per_day: number | null;
  description: string | null;
  condition_note: string | null;
  image_url: string | null;
};

// Foto CC-licensed dari Wikimedia Commons, diunggah sekali lewat endpoint
// upload asli (/api/uploads/item-image) ke R2 — bukan link langsung ke
// Wikimedia, supaya konsisten dengan alur foto vendor sungguhan dan tidak
// bergantung ketersediaan Wikimedia saat demo. Sumber: EurekaTent.JPG (CC
// BY-SA 3.0, SriMesh), Mummy_bag.jpg (public domain), IWATANI_PORTABLE_GAS
// _STOVE.jpg (CC BY-SA 4.0, Dinkun Chen), Self-inflating_mat.jpg (CC BY
// 3.0, Pierrelagrange), Berghaus_Vulcan.jpg (CC BY-SA 2.5, LHOON),
// Petzl_Zoom_headlamp.jpg (CC BY 2.0, Olgierd/Flickr).
const R2_BASE = 'https://image.sewalog.com/items/a8d1e327-5e1a-4d5e-b657-489c93a46e36';

const ITEM_DEFS: ItemDef[] = [
  {
    code: 'TND-01',
    name: 'Tenda Dome 4 Orang',
    category: 'Tenda',
    variant: 'Family Series',
    size: null,
    color: 'Hijau Army',
    total_units: 8,
    price_per_day: 60000,
    discount_min_days: 5,
    discounted_price_per_day: 45000,
    description: 'Tenda dome kapasitas 4 orang, cocok untuk keluarga/kelompok kecil.',
    condition_note: 'Kondisi baik, sudah dicek waterproof.',
    image_url: `${R2_BASE}/06373295-e87c-48a1-8608-370aea0feceb.jpg`,
  },
  {
    code: 'SB-02',
    name: 'Sleeping Bag Dewasa',
    category: 'Perlengkapan Tidur',
    variant: null,
    size: 'Dewasa',
    color: 'Merah',
    total_units: 15,
    price_per_day: 15000,
    discount_min_days: 3,
    discounted_price_per_day: 10000,
    description: 'Sleeping bag ukuran dewasa, tahan suhu dingin dataran tinggi.',
    condition_note: null,
    image_url: `${R2_BASE}/e392549d-1895-4e68-a4b4-eae8d496a6f3.jpg`,
  },
  {
    code: 'KP-03',
    name: 'Kompor Portable + Gas',
    category: 'Perlengkapan Masak',
    variant: null,
    size: null,
    color: null,
    total_units: 6,
    price_per_day: 20000,
    discount_min_days: 5,
    discounted_price_per_day: null,
    description: 'Kompor portable lengkap dengan tabung gas kecil.',
    condition_note: null,
    image_url: `${R2_BASE}/34d26f85-c0b4-4b53-810a-5d7c8d43165a.jpg`,
  },
  {
    code: 'MT-04',
    name: 'Matras Camping',
    category: 'Perlengkapan Tidur',
    variant: null,
    size: null,
    color: null,
    total_units: 20,
    price_per_day: 10000,
    discount_min_days: 5,
    discounted_price_per_day: null,
    description: null,
    condition_note: null,
    image_url: `${R2_BASE}/20f6d80c-8489-4f12-b1ba-f430615b013d.jpg`,
  },
  {
    code: 'CR-05',
    name: 'Carrier 60L',
    category: 'Tas',
    variant: 'Trekking Series',
    size: '60L',
    color: 'Hijau Army',
    total_units: 10,
    price_per_day: 35000,
    discount_min_days: 5,
    discounted_price_per_day: 25000,
    description: 'Tas carrier 60 liter, cocok untuk pendakian 2-4 hari.',
    condition_note: null,
    image_url: `${R2_BASE}/eb953a9a-5339-4962-8338-c7616e5d2edc.jpg`,
  },
  {
    code: 'HL-06',
    name: 'Headlamp LED',
    category: 'Penerangan',
    variant: null,
    size: null,
    color: 'Hitam',
    total_units: 12,
    price_per_day: 8000,
    discount_min_days: 5,
    discounted_price_per_day: null,
    description: null,
    condition_note: null,
    image_url: `${R2_BASE}/61a5169f-d1ec-4e7f-8ecd-ac872d7d0445.jpg`,
  },
];

export type DemoResetResult = {
  businessId: string;
  businessName: string;
  ownerEmail: string;
  karyawanEmail: string;
  password: string;
};

export async function resetDemoData(): Promise<DemoResetResult> {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY belum dikonfigurasi di server.');
  }

  const owner = await signInOrSignUp(OWNER_EMAIL, DEMO_PASSWORD);
  const ownerToken = owner.access_token;
  const ownerId = owner.user.id;

  const businesses = await rest<{ id: string; name: string }[]>(
    `businesses?select=id,name&owner_id=eq.${ownerId}`,
    ownerToken,
  );
  let businessId: string;

  if (businesses.length === 0) {
    // Prefer: return=minimal di dua insert ini SENGAJA — lihat catatan sama
    // di scripts/seed-demo.mjs soal RLS read-back yang kena is_member_of()
    // sebelum baris business_members-nya sendiri ada.
    businessId = crypto.randomUUID();
    await rest('businesses', ownerToken, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: businessId,
        owner_id: ownerId,
        name: BUSINESS_NAME,
        owner_name: 'Pemilik Demo',
        phone: '081234567890',
      }),
    });
    await rest('business_members', ownerToken, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ business_id: businessId, user_id: ownerId, role: 'owner', email: OWNER_EMAIL }),
    });
  } else {
    businessId = businesses[0].id;
  }

  // --- Pastikan akun karyawan demo tergabung di business yang sama ---
  const karyawan = await signInOrSignUp(KARYAWAN_EMAIL, DEMO_PASSWORD);
  const karyawanToken = karyawan.access_token;
  const karyawanId = karyawan.user.id;

  const existingMembership = await rest<{ id: string }[]>(
    `business_members?select=id&business_id=eq.${businessId}&user_id=eq.${karyawanId}`,
    karyawanToken,
  );

  if (existingMembership.length === 0) {
    const invite = await selfApi<{ invite: { code: string } }>('/api/team/invites', ownerToken, {
      method: 'POST',
      body: JSON.stringify({ businessId, role: 'karyawan' }),
    });
    await selfApi('/api/team/invites/redeem', karyawanToken, {
      method: 'POST',
      body: JSON.stringify({ code: invite.invite.code }),
    });
  }

  // --- Tutup transaksi demo lama lewat endpoint asli (bukan hard-delete —
  // booking_status_history sengaja append-only, lihat migration 008) ---
  const oldBookings = await rest<{ id: string; status: string }[]>(
    `bookings?select=id,status&business_id=eq.${businessId}&status=in.(dipesan,aktif)`,
    ownerToken,
  );
  for (const b of oldBookings) {
    if (b.status === 'dipesan') {
      await selfApi(`/api/bookings/${b.id}/pickup`, ownerToken, { method: 'POST' });
    }
    await selfApi(`/api/bookings/${b.id}/cancel`, ownerToken, { method: 'POST' });
  }

  // --- Upsert katalog alat by-kode (bukan delete+insert, sama alasannya) ---
  const existingItems = await rest<{ id: string; code: string }[]>(
    `items?select=id,code&business_id=eq.${businessId}`,
    ownerToken,
  );
  const existingByCode = Object.fromEntries(existingItems.map((i) => [i.code, i.id]));

  const items: Record<string, { id: string; price_per_day: number; discount_min_days: number; discounted_price_per_day: number | null }> = {};
  for (const def of ITEM_DEFS) {
    const existingId = existingByCode[def.code];
    if (existingId) {
      const [row] = await rest<any[]>(`items?id=eq.${existingId}`, ownerToken, {
        method: 'PATCH',
        body: JSON.stringify({ ...def, deactivated_at: null }),
      });
      items[def.code] = row;
    } else {
      const [row] = await rest<any[]>('items', ownerToken, {
        method: 'POST',
        body: JSON.stringify({ business_id: businessId, ...def }),
      });
      items[def.code] = row;
    }
  }

  // --- Transaksi contoh ---
  async function createBooking(params: {
    customer?: { name: string; phone: string };
    customer_id?: string;
    start_date: string;
    end_date: string;
    deposit: { type: string; amount?: number; note?: string };
    entries: [string, number][];
  }) {
    const days = rentalDays(params.start_date, params.end_date);
    const total_price = params.entries.reduce((sum, [code, qty]) => {
      const it = items[code];
      return sum + qty * computeItemRentalPrice(it.price_per_day, it.discount_min_days, it.discounted_price_per_day, days);
    }, 0);

    return selfApi<{ id: string }>('/api/bookings', ownerToken, {
      method: 'POST',
      body: JSON.stringify({
        businessId,
        ...(params.customer_id ? { customer_id: params.customer_id } : { customer: params.customer }),
        start_date: params.start_date,
        end_date: params.end_date,
        items: params.entries.map(([code, qty]) => ({ item_id: items[code].id, quantity: qty })),
        deposit: params.deposit,
        total_price,
      }),
    });
  }

  // Cari id pelanggan yang baru saja dibuat by nama+telepon — dipakai buat
  // reuse customer_id di booking kedua (pelanggan lama), BUKAN cuma
  // mengulang nama yang sama (itu bakal bikin baris customers baru lagi,
  // sama seperti bug lama sebelum fitur reuse pelanggan dibangun).
  async function findCustomerId(name: string, phone: string): Promise<string> {
    const rows = await rest<{ id: string }[]>(
      `customers?select=id&business_id=eq.${businessId}&name=eq.${encodeURIComponent(name)}&phone=eq.${encodeURIComponent(phone)}&order=created_at.desc&limit=1`,
      ownerToken,
    );
    if (!rows.length) throw new Error(`Customer ${name} tidak ditemukan setelah dibuat`);
    return rows[0].id;
  }

  await createBooking({
    customer: { name: 'Dimas Prasetyo', phone: '081234000001' },
    start_date: todayPlus(3),
    end_date: todayPlus(6),
    deposit: { type: 'ktp' },
    entries: [['TND-01', 1], ['MT-04', 2]],
  });

  await createBooking({
    customer: { name: 'Rina Wulandari', phone: '081234000002' },
    start_date: todayPlus(-1),
    end_date: todayPlus(3),
    deposit: { type: 'uang', amount: 100000 },
    entries: [['SB-02', 2], ['KP-03', 1], ['HL-06', 2]],
  });

  // Terlambat, BELUM diproses lewat Pengembalian — nunjukkin badge TERLAMBAT
  // + saran denda keterlambatan yang dihitung live, sebelum staf memprosesnya.
  const overdueBooking = await createBooking({
    customer: { name: 'Bagus Setiawan', phone: '081234000003' },
    start_date: todayPlus(-6),
    end_date: todayPlus(-2),
    deposit: { type: 'sim' },
    entries: [['CR-05', 1], ['TND-01', 1]],
  });
  await selfApi(`/api/bookings/${overdueBooking.id}/penalties`, ownerToken, {
    method: 'POST',
    body: JSON.stringify({
      type: 'kerusakan',
      amount: 50000,
      description: 'Resleting tenda rusak, dilaporkan penyewa sebelum barang dikembalikan.',
    }),
  });

  // Pelanggan lama (repeat customer): booking pertama langsung ditutup
  // (selesai, tepat waktu — end_date hari ini, diproses saat ini juga jadi
  // selalu dalam toleransi), lalu booking kedua reuse customer_id yang sama
  // supaya "Pernah sewa 1x" langsung ada contohnya begitu demo direset,
  // bukan cuma bisa dilihat kalau staf sendiri bikin transaksi duplikat.
  await createBooking({
    customer: { name: 'Ahmad Fauzi', phone: '081234000004' },
    start_date: todayPlus(-3),
    end_date: todayPlus(0),
    deposit: { type: 'paspor' },
    entries: [['MT-04', 1], ['HL-06', 1]],
  });
  const ahmadCustomerId = await findCustomerId('Ahmad Fauzi', '081234000004');
  const [ahmadFirstBooking] = await rest<{ id: string }[]>(
    `bookings?select=id&business_id=eq.${businessId}&customer_id=eq.${ahmadCustomerId}&order=created_at.desc&limit=1`,
    ownerToken,
  );
  await selfApi(`/api/bookings/${ahmadFirstBooking.id}/return`, ownerToken, {
    method: 'POST',
    body: JSON.stringify({ late_fee_amount: 0, extra_penalties: [], return_deposits: true }),
  });

  await createBooking({
    customer_id: ahmadCustomerId,
    start_date: todayPlus(0),
    end_date: todayPlus(2),
    deposit: { type: 'stnk' },
    entries: [['SB-02', 1], ['KP-03', 1]],
  });

  // Transaksi yang sudah DITUTUP tapi telat, dengan DUA jenis denda
  // sekaligus (keterlambatan + kehilangan) — supaya prinsip "dua jenis
  // denda dipisah eksplisit" punya contoh transaksi yang benar-benar
  // selesai diproses, bukan cuma tersirat dari badge TERLAMBAT yang belum
  // diproses (lihat booking Bagus Setiawan di atas untuk sisi "sebelum").
  const lateBooking = await createBooking({
    customer: { name: 'Siti Rahma', phone: '081234000005' },
    start_date: todayPlus(-4),
    end_date: todayPlus(-2),
    deposit: { type: 'lainnya', note: 'Jaminan motor — kesepakatan langsung dengan pelanggan, dipegang terpisah' },
    entries: [['CR-05', 1], ['MT-04', 2]],
  });
  await selfApi(`/api/bookings/${lateBooking.id}/return`, ownerToken, {
    method: 'POST',
    body: JSON.stringify({
      late_fee_amount: 110000,
      extra_penalties: [
        { type: 'kehilangan', amount: 40000, description: '1 matras camping hilang, tidak dikembalikan pelanggan.' },
      ],
      return_deposits: true,
    }),
  });

  return {
    businessId,
    businessName: BUSINESS_NAME,
    ownerEmail: OWNER_EMAIL,
    karyawanEmail: KARYAWAN_EMAIL,
    password: DEMO_PASSWORD,
  };
}
