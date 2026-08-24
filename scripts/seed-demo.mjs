// Reset & reseed satu akun demo (owner + karyawan) untuk ditunjukkan ke calon
// vendor. Dipakai lewat: npm run seed:demo
//
// Aman dijalankan berkali-kali — setiap run menghapus semua item/transaksi
// lama milik business demo lalu membuat set data baru dari nol. Akun login
// (owner & karyawan) serta business-nya sendiri TIDAK dihapus/dibuat ulang,
// supaya kredensial demo yang sudah dibagikan ke calon vendor tetap sama.
//
// Butuh SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (baca dari backend/.env lewat
// --env-file, lihat package.json), dan backend yang sedang jalan di
// API_BASE_URL (default http://localhost:3001) — booking dibuat lewat
// endpoint backend asli (bukan insert langsung ke tabel bookings) supaya
// nomor booking, validasi kapasitas, dan audit trail tetap konsisten dengan
// alur pemakaian sungguhan.

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3001';

const OWNER_EMAIL = process.env.DEMO_OWNER_EMAIL ?? 'demo.pemilik@sewalog.test';
const KARYAWAN_EMAIL = process.env.DEMO_KARYAWAN_EMAIL ?? 'demo.karyawan@sewalog.test';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'CobaSewalog2026';
const BUSINESS_NAME = 'Demo — Coba Sewalog';

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY belum ada di environment.');
  console.error('Jalankan lewat: npm run seed:demo (sudah di-set --env-file=backend/.env)');
  process.exit(1);
}

// Sewalog pakai WIB (UTC+7) sebagai default timezone — semua vendor pilot
// ada di Malang Raya (lihat CLAUDE.md bagian 3). Tanggal dihitung relatif ke
// WIB, bukan timezone lokal mesin yang menjalankan script ini, biar tidak
// bergeser tergantung di mana script dijalankan — sama seperti
// backend/src/lib/dates.ts, dijaga tetap sinkron kalau salah satu diubah.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function todayInWIB() {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(dateStr, amount) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + amount * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function todayPlus(days) {
  return addDays(todayInWIB(), days);
}

function computeItemRentalPrice(pricePerDay, discountMinDays, discountedPricePerDay, days) {
  if (!discountedPricePerDay || days <= discountMinDays) return pricePerDay * days;
  const extraDays = days - discountMinDays;
  return pricePerDay * discountMinDays + discountedPricePerDay * extraDays;
}

// Sama persis dengan rentalDays() di frontend/src/utils/formatters.ts —
// jaga tetap sinkron kalau formulanya berubah di sana.
function rentalDays(start, end) {
  const ms = new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function signInOrSignUp(email, password) {
  const signIn = await authRequest('token?grant_type=password', { email, password });
  if (signIn.ok) return signIn.json;

  const signUp = await authRequest('signup', { email, password });
  if (!signUp.ok) {
    throw new Error(`Gagal signup/login ${email}: ${JSON.stringify(signUp.json)}`);
  }
  if (signUp.json.access_token) return signUp.json;

  // Signup sukses tapi tidak langsung dapat sesi (mis. confirm-email aktif) —
  // coba login sekali lagi untuk kasus di mana project ini sebenarnya sudah
  // punya user ini tapi password beda dari default (jarang terjadi, tapi
  // pesan error di sini lebih jelas daripada retry diam-diam).
  const retry = await authRequest('token?grant_type=password', { email, password });
  if (retry.ok) return retry.json;
  throw new Error(
    `User ${email} kebuat tapi tidak dapat sesi login langsung — cek toggle "Confirm email" di Supabase Auth (harus OFF untuk demo ini bisa login otomatis).`,
  );
}

async function rest(path, token, init = {}) {
  const headers = {
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
  return json;
}

async function api(path, token, init = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API ${init.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  console.log('== Seed akun demo Sewalog ==');
  console.log('Supabase:', SUPABASE_URL);
  console.log('Backend :', API_BASE_URL);

  const owner = await signInOrSignUp(OWNER_EMAIL, DEMO_PASSWORD);
  const ownerToken = owner.access_token;
  const ownerId = owner.user.id;
  console.log('OK login owner:', OWNER_EMAIL);

  let businesses = await rest(`businesses?select=id,name&owner_id=eq.${ownerId}`, ownerToken);
  let businessId;

  if (businesses.length === 0) {
    // Prefer: return=minimal di dua insert ini SENGAJA — kalau minta baris
    // balik (return=representation), PostgREST melakukan read-back yang
    // kena RLS SELECT (is_member_of()), yang di titik ini masih false
    // karena baris business_members belum ada. Sama persis kasus yang
    // dulu dipecahkan di OnboardingScreen.tsx (lihat migration 007).
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
    console.log('OK business demo dibuat:', businessId);
  } else {
    businessId = businesses[0].id;
    console.log('OK business demo sudah ada:', businessId);
  }

  // --- Pastikan akun karyawan demo tergabung di business yang sama ---
  const karyawan = await signInOrSignUp(KARYAWAN_EMAIL, DEMO_PASSWORD);
  const karyawanToken = karyawan.access_token;
  const karyawanId = karyawan.user.id;
  console.log('OK login karyawan:', KARYAWAN_EMAIL);

  const existingMembership = await rest(
    `business_members?select=id&business_id=eq.${businessId}&user_id=eq.${karyawanId}`,
    karyawanToken,
  );

  if (existingMembership.length === 0) {
    const invite = await api('/api/team/invites', ownerToken, {
      method: 'POST',
      body: JSON.stringify({ businessId, role: 'karyawan' }),
    });
    await api('/api/team/invites/redeem', karyawanToken, {
      method: 'POST',
      body: JSON.stringify({ code: invite.invite.code }),
    });
    console.log('OK karyawan demo bergabung ke business');
  } else {
    console.log('OK karyawan demo sudah jadi anggota');
  }

  // --- Reset: tutup transaksi demo lama lewat endpoint asli ---
  // booking_status_history sengaja append-only (tidak ada policy delete —
  // lihat migration 008), jadi bookings lama TIDAK BISA di-hard-delete
  // (bakal kena FK violation). Daripada melanggar prinsip itu, transaksi
  // demo dari run sebelumnya cukup "ditutup" lewat endpoint yang sama
  // dipakai vendor asli (pickup lalu batalkan) — otomatis hilang dari
  // Kalender/Jaminan & Denda karena keduanya cuma menampilkan status
  // dipesan/aktif. Riwayatnya tetap ada di database, tidak pernah dihapus.
  console.log('-- Menutup transaksi demo dari run sebelumnya --');
  const oldBookings = await rest(
    `bookings?select=id,status&business_id=eq.${businessId}&status=in.(dipesan,aktif)`,
    ownerToken,
  );
  for (const b of oldBookings) {
    if (b.status === 'dipesan') {
      await api(`/api/bookings/${b.id}/pickup`, ownerToken, { method: 'POST' });
    }
    await api(`/api/bookings/${b.id}/cancel`, ownerToken, { method: 'POST' });
  }
  console.log(`OK ${oldBookings.length} transaksi lama ditutup`);

  // --- Seed katalog alat ---
  console.log('-- Menambahkan katalog alat demo --');
  const itemDefs = [
    {
      code: 'TND-01',
      name: 'Tenda Dome 4 Orang',
      category: 'Tenda',
      variant: null,
      size: null,
      color: 'Hijau Army',
      total_units: 8,
      price_per_day: 60000,
      discount_min_days: 5,
      discounted_price_per_day: 45000,
      description: 'Tenda dome kapasitas 4 orang, cocok untuk keluarga/kelompok kecil.',
      condition_note: 'Kondisi baik, sudah dicek waterproof.',
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
    },
    {
      code: 'CR-05',
      name: 'Carrier 60L',
      category: 'Tas',
      variant: null,
      size: '60L',
      color: 'Hijau Army',
      total_units: 10,
      price_per_day: 35000,
      discount_min_days: 5,
      discounted_price_per_day: 25000,
      description: 'Tas carrier 60 liter, cocok untuk pendakian 2-4 hari.',
      condition_note: null,
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
    },
  ];

  // Upsert by-kode, bukan delete+insert — item lama mungkin sudah dipakai di
  // booking_items pada transaksi yang ditutup (bukan dihapus) di atas, jadi
  // menghapusnya akan kena FK violation juga. Reset ke nilai seed default
  // kalau sudah ada, insert kalau belum.
  const existingItems = await rest(`items?select=id,code&business_id=eq.${businessId}`, ownerToken);
  const existingByCode = Object.fromEntries(existingItems.map((i) => [i.code, i.id]));

  const items = {};
  for (const def of itemDefs) {
    const existingId = existingByCode[def.code];
    if (existingId) {
      const [row] = await rest(`items?id=eq.${existingId}`, ownerToken, {
        method: 'PATCH',
        body: JSON.stringify({ ...def, deactivated_at: null }),
      });
      items[def.code] = row;
      console.log(`  ~ ${def.name} (diperbarui)`);
    } else {
      const [row] = await rest('items', ownerToken, {
        method: 'POST',
        body: JSON.stringify({ business_id: businessId, image_url: null, ...def }),
      });
      items[def.code] = row;
      console.log(`  + ${def.name}`);
    }
  }

  // --- Seed transaksi contoh (dibuat lewat backend, bukan insert langsung) ---
  console.log('-- Membuat transaksi contoh --');

  async function createBooking({ customer, start_date, end_date, deposit, entries }) {
    const days = rentalDays(start_date, end_date);
    const total_price = entries.reduce((sum, [code, qty]) => {
      const it = items[code];
      return sum + qty * computeItemRentalPrice(it.price_per_day, it.discount_min_days, it.discounted_price_per_day, days);
    }, 0);

    const payload = {
      businessId,
      customer,
      start_date,
      end_date,
      items: entries.map(([code, qty]) => ({ item_id: items[code].id, quantity: qty })),
      deposit,
      total_price,
    };

    const result = await api('/api/bookings', ownerToken, { method: 'POST', body: JSON.stringify(payload) });
    return result;
  }

  await createBooking({
    customer: { name: 'Dimas Prasetyo', phone: '081234000001' },
    start_date: todayPlus(3),
    end_date: todayPlus(6),
    deposit: { type: 'ktp' },
    entries: [['TND-01', 1], ['MT-04', 2]],
  });
  console.log('  + Booking "dipesan" (belum diambil, 3 hari lagi): Dimas Prasetyo');

  await createBooking({
    customer: { name: 'Rina Wulandari', phone: '081234000002' },
    start_date: todayPlus(-1),
    end_date: todayPlus(3),
    deposit: { type: 'uang', amount: 100000 },
    entries: [['SB-02', 2], ['KP-03', 1], ['HL-06', 2]],
  });
  console.log('  + Booking "aktif" (sedang berjalan, on-time): Rina Wulandari');

  const overdueBooking = await createBooking({
    customer: { name: 'Bagus Setiawan', phone: '081234000003' },
    start_date: todayPlus(-6),
    end_date: todayPlus(-2),
    deposit: { type: 'sim' },
    entries: [['CR-05', 1], ['TND-01', 1]],
  });
  await api(`/api/bookings/${overdueBooking.id}/penalties`, ownerToken, {
    method: 'POST',
    body: JSON.stringify({
      type: 'kerusakan',
      amount: 50000,
      description: 'Resleting tenda rusak, dilaporkan penyewa sebelum barang dikembalikan.',
    }),
  });
  console.log('  + Booking "aktif" terlambat (jatuh tempo 2 hari lalu) + denda kerusakan: Bagus Setiawan');

  console.log('\n== Selesai ==');
  console.log('Business demo :', BUSINESS_NAME, `(${businessId})`);
  console.log('Login pemilik :', OWNER_EMAIL, '/', DEMO_PASSWORD);
  console.log('Login karyawan:', KARYAWAN_EMAIL, '/', DEMO_PASSWORD);
}

main().catch((err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
