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

// Logo placeholder demo (migration 035) — sama persis dengan DEMO_LOGO_URL
// di backend/src/lib/demoReset.ts (beda runtime, jaga tetap sinkron).
const DEMO_LOGO_URL = 'https://image.sewalog.com/logos/a8d1e327-5e1a-4d5e-b657-489c93a46e36/demo-placeholder.png';

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

// Sabtu terdekat SETELAH hari ini (kalau hari ini sendiri Sabtu, maju ke
// Sabtu minggu depan) — sama persis dengan nextWeekend() di
// backend/src/lib/demoReset.ts, jaga tetap sinkron kalau salah satu diubah.
function nextWeekend() {
  const today = todayInWIB();
  const [y, m, d] = today.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Minggu..6=Sabtu
  let toSaturday = (6 - dow + 7) % 7;
  if (toSaturday === 0) toSaturday = 7;
  const saturday = addDays(today, toSaturday);
  return { saturday, sunday: addDays(saturday, 1) };
}

// Sama persis dengan computeItemRentalPrice() di
// frontend/src/utils/formatters.ts dan backend/src/lib/demoReset.ts
// (migration 034) — tiga runtime beda, jaga tetap sinkron. `rates` =
// { price_per_day, day2_rate, day3_rate, day4_rate, day5_rate, extra_day_rate }.
function dailyRateForDay(rates, day) {
  switch (day) {
    case 1:
      return rates.price_per_day;
    case 2:
      return rates.day2_rate;
    case 3:
      return rates.day3_rate;
    case 4:
      return rates.day4_rate;
    case 5:
      return rates.day5_rate;
    default:
      return rates.extra_day_rate;
  }
}

function computeItemRentalPrice(rates, days) {
  if (days <= 0) return 0;
  let total = 0;
  for (let day = 1; day <= Math.min(days, 5); day++) total += dailyRateForDay(rates, day);
  if (days > 5) total += (days - 5) * rates.extra_day_rate;
  return total;
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

// Sisa unit TERKECIL di antara startDate..startDate+days-1, lewat endpoint
// GET /api/availability yang sudah ada — sama persis dengan remainingUnits()
// di backend/src/lib/demoReset.ts, jaga tetap sinkron. SENGAJA bukan
// reimplementasi usedUnitsOn() sendiri di sini, supaya "penuh" yang dicatat
// selalu sepakat dengan validasi kapasitas POST /bookings yang sungguhan.
async function remainingUnits(itemCode, startDate, days, token) {
  const resp = await api(`/api/availability?start_date=${startDate}&days=${days}`, token);
  const item = resp.items.find((i) => i.code === itemCode);
  if (!item) throw new Error(`remainingUnits: item ${itemCode} tidak ditemukan di /api/availability`);
  return Math.min(...item.remaining);
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
        address: 'Jl. Coba Sewalog No. 1, Malang',
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

  // Idempotent di setiap reset — lihat komentar sama di demoReset.ts.
  await rest(`businesses?id=eq.${businessId}`, ownerToken, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ logo_url: DEMO_LOGO_URL }),
  });

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

  // --- Reset: hapus TOTAL rantai booking demo lama (status apa pun) ---
  // Dulu cuma menutup dipesan/aktif via /pickup+/cancel — booking yang
  // sudah selesai/telat tidak pernah tersentuh (tidak ada endpoint produk
  // untuk "membuka lagi" transaksi yang sudah ditutup, sengaja, demi
  // integritas data vendor asli), jadi menumpuk selamanya dan akhirnya
  // overflow kapasitas item dengan readiness_hours>0 (lihat catatan
  // panjang di migrations/036_reset_demo_bookings.sql). Sekarang lewat
  // RPC security-definer reset_demo_bookings() (migration 036), yang
  // menghapus booking_status_history/penalties/deposits/booking_items/
  // bookings untuk business demo SAJA — fungsinya sendiri memverifikasi
  // business_id + pemanggil benar-benar demo sebelum menghapus apa pun,
  // jadi tidak perlu/tidak boleh menambah policy DELETE generik yang akan
  // melanggar prinsip append-only booking_status_history untuk vendor
  // asli.
  console.log('-- Menghapus transaksi demo dari run sebelumnya --');
  await rest('rpc/reset_demo_bookings', ownerToken, {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ p_business_id: businessId }),
  });
  console.log('OK transaksi lama dihapus');

  // --- Seed katalog alat ---
  console.log('-- Menambahkan katalog alat demo --');

  // Foto CC-licensed dari Wikimedia Commons, diunggah sekali lewat endpoint
  // upload asli (/api/uploads/item-image) ke R2 — bukan link langsung ke
  // Wikimedia, supaya konsisten dengan alur foto vendor sungguhan dan tidak
  // bergantung ketersediaan Wikimedia saat demo. Sumber: EurekaTent.JPG (CC
  // BY-SA 3.0, SriMesh), Mummy_bag.jpg (public domain), IWATANI_PORTABLE_GAS
  // _STOVE.jpg (CC BY-SA 4.0, Dinkun Chen), Self-inflating_mat.jpg (CC BY
  // 3.0, Pierrelagrange), Berghaus_Vulcan.jpg (CC BY-SA 2.5, LHOON),
  // Petzl_Zoom_headlamp.jpg (CC BY 2.0, Olgierd/Flickr). URL diikat ke
  // businessId demo yang sekarang — kalau business demo pernah dibuat ulang
  // dengan id baru, foto ini perlu diunggah ulang.
  const R2_BASE = 'https://image.sewalog.com/items/a8d1e327-5e1a-4d5e-b657-489c93a46e36';

  const itemDefs = [
    {
      code: 'TND-01',
      name: 'Tenda Dome 4 Orang',
      category: 'Tenda',
      variant: 'Family Series',
      size: null,
      color: 'Hijau Army',
      total_units: 8,
      // Contoh harga bertingkat per-hari (migration 034): hari 1 Rp30rb,
      // hari 2 Rp20rb, hari 3 dst Rp10rb/hari (4 hari = 70rb, 7 hari =
      // 100rb) — satu-satunya alat demo yang sengaja diubah polanya.
      price_per_day: 30000,
      day2_rate: 20000,
      day3_rate: 10000,
      day4_rate: 10000,
      day5_rate: 10000,
      extra_day_rate: 10000,
      // Contoh jeda persiapan (migration 028, satuan jam) — tenda butuh 24 jam
      // diangin-anginkan sebelum disewa lagi, supaya fitur ini kelihatan aktif
      // di demo. Alat lain (headlamp, kompor) sengaja tetap 0 — item-item itu
      // realistis cukup dilap sebentar, tidak butuh jeda sama sekali.
      readiness_hours: 24,
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
      // Setara perilaku lama (diskon setelah 3 hari jadi 10rb/hari).
      price_per_day: 15000,
      day2_rate: 15000,
      day3_rate: 15000,
      day4_rate: 10000,
      day5_rate: 10000,
      extra_day_rate: 10000,
      readiness_hours: 0,
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
      // Flat.
      price_per_day: 20000,
      day2_rate: 20000,
      day3_rate: 20000,
      day4_rate: 20000,
      day5_rate: 20000,
      extra_day_rate: 20000,
      readiness_hours: 0,
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
      // Flat.
      price_per_day: 10000,
      day2_rate: 10000,
      day3_rate: 10000,
      day4_rate: 10000,
      day5_rate: 10000,
      extra_day_rate: 10000,
      readiness_hours: 0,
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
      // Setara perilaku lama (diskon setelah 5 hari jadi 25rb/hari).
      price_per_day: 35000,
      day2_rate: 35000,
      day3_rate: 35000,
      day4_rate: 35000,
      day5_rate: 35000,
      extra_day_rate: 25000,
      // Contoh kedua jeda persiapan (selain Tenda Dome) — carrier butuh dicek
      // jahitan/kebersihan lebih menyeluruh (48 jam = 2 hari kalender).
      readiness_hours: 48,
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
      // Flat.
      price_per_day: 8000,
      day2_rate: 8000,
      day3_rate: 8000,
      day4_rate: 8000,
      day5_rate: 8000,
      extra_day_rate: 8000,
      readiness_hours: 0,
      description: null,
      condition_note: null,
      image_url: `${R2_BASE}/61a5169f-d1ec-4e7f-8ecd-ac872d7d0445.jpg`,
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
        body: JSON.stringify({ business_id: businessId, ...def }),
      });
      items[def.code] = row;
      console.log(`  + ${def.name}`);
    }
  }

  // --- Etalase Online contoh (published, sama persis logikanya dengan
  // demoReset.ts — supaya verifikasi hidup /toko/{slug} bisa langsung
  // dilakukan sehabis seed, tanpa perlu isi manual dulu) ---
  console.log('-- Mengaktifkan Etalase Online demo --');
  const [malangRegency] = await rest(`regencies?select=id&name=eq.Kota Malang`, ownerToken);
  const existingPublicPage = await rest(`public_pages?select=business_id&business_id=eq.${businessId}`, ownerToken);
  const publicPagePayload = {
    published: true,
    slug: 'demo-coba-sewalog',
    description: 'Rental alat camping & outdoor terlengkap di Malang — tenda, sleeping bag, kompor, hingga carrier. Siap sewa harian, alat terawat.',
    address: 'Jl. Coba Sewalog No. 1, Malang',
    regency_id: malangRegency?.id ?? null,
    operating_hours: 'SENIN: 12.00–22.00 WIB\nSELASA-SABTU: 09.00–22.00 WIB\nMINGGU: 12.00–22.00 WIB',
    public_phone: '081234567890',
  };
  if (existingPublicPage.length === 0) {
    await rest('public_pages', ownerToken, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ business_id: businessId, ...publicPagePayload }),
    });
  } else {
    await rest(`public_pages?business_id=eq.${businessId}`, ownerToken, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(publicPagePayload),
    });
  }

  // --- Seed transaksi contoh (dibuat lewat backend, bukan insert langsung) ---
  console.log('-- Membuat transaksi contoh --');

  async function createBooking({ customer, customer_id, start_date, end_date, deposit, entries }) {
    const days = rentalDays(start_date, end_date);
    const subtotalFor = (code, qty) => qty * computeItemRentalPrice(items[code], days);
    const total_price = entries.reduce((sum, [code, qty]) => sum + subtotalFor(code, qty), 0);

    const payload = {
      businessId,
      ...(customer_id ? { customer_id } : { customer }),
      start_date,
      end_date,
      items: entries.map(([code, qty]) => ({ item_id: items[code].id, quantity: qty, subtotal: subtotalFor(code, qty) })),
      deposit,
      total_price,
    };

    const result = await api('/api/bookings', ownerToken, { method: 'POST', body: JSON.stringify(payload) });
    return result;
  }

  // Cari id pelanggan yang baru saja dibuat by nama+telepon — dipakai buat
  // reuse customer_id di booking kedua (pelanggan lama), BUKAN cuma
  // mengulang nama yang sama (itu bakal bikin baris customers baru lagi,
  // sama seperti bug lama sebelum fitur reuse pelanggan dibangun).
  async function findCustomerId(name, phone) {
    const rows = await rest(
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
  console.log('  + Booking "dipesan" (belum diambil, 3 hari lagi): Dimas Prasetyo');

  await createBooking({
    customer: { name: 'Rina Wulandari', phone: '081234000002' },
    start_date: todayPlus(-1),
    end_date: todayPlus(3),
    deposit: { type: 'uang', amount: 100000 },
    entries: [['SB-02', 2], ['KP-03', 1], ['HL-06', 2]],
  });
  console.log('  + Booking "aktif" (sedang berjalan, on-time): Rina Wulandari');

  // Terlambat, BELUM diproses lewat Pengembalian — nunjukkin badge TERLAMBAT
  // + saran denda keterlambatan yang dihitung live, sebelum staf memprosesnya.
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
  const [ahmadFirstBooking] = await rest(
    `bookings?select=id&business_id=eq.${businessId}&customer_id=eq.${ahmadCustomerId}&order=created_at.desc&limit=1`,
    ownerToken,
  );
  await api(`/api/bookings/${ahmadFirstBooking.id}/return`, ownerToken, {
    method: 'POST',
    body: JSON.stringify({ late_fee_amount: 0, extra_penalties: [], return_deposits: true }),
  });
  console.log('  + Booking "selesai" (tepat waktu): Ahmad Fauzi (transaksi pertama)');

  await createBooking({
    customer_id: ahmadCustomerId,
    start_date: todayPlus(0),
    end_date: todayPlus(2),
    deposit: { type: 'stnk' },
    entries: [['SB-02', 1], ['KP-03', 1]],
  });
  console.log('  + Booking "aktif" (pelanggan lama, reuse customer_id): Ahmad Fauzi (transaksi kedua)');

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
  await api(`/api/bookings/${lateBooking.id}/return`, ownerToken, {
    method: 'POST',
    body: JSON.stringify({
      late_fee_amount: 110000,
      extra_penalties: [
        { type: 'kehilangan', amount: 40000, description: '1 matras camping hilang, tidak dikembalikan pelanggan.' },
      ],
      return_deposits: true,
    }),
  });
  console.log('  + Booking "telat" (sudah ditutup, denda keterlambatan + kehilangan): Siti Rahma');

  // Satu alat PENUH di akhir pekan terdekat — lihat komentar yang sama di
  // backend/src/lib/demoReset.ts untuk alasan lengkapnya (dihitung lewat
  // remainingUnits(), bukan angka hardcode, karena TND-01 sudah dipakai
  // booking lain di atas dan jumlahnya tergantung hari script dijalankan).
  const { saturday, sunday } = nextWeekend();
  const tndRemaining = await remainingUnits('TND-01', saturday, 2, ownerToken);
  if (tndRemaining > 0) {
    await createBooking({
      customer: { name: 'Yoga Pratama', phone: '081234000006' },
      start_date: saturday,
      end_date: sunday,
      deposit: { type: 'ktp' },
      entries: [['TND-01', tndRemaining]],
    });
    console.log(`  + Booking "dipesan" (PENUH, ${tndRemaining} unit): Yoga Pratama, Tenda Dome ${saturday}..${sunday}`);
  } else {
    console.log(`  (TND-01 sudah penuh di ${saturday}..${sunday} tanpa booking tambahan, dilewati)`);
  }

  console.log('\n== Selesai ==');
  console.log('Business demo :', BUSINESS_NAME, `(${businessId})`);
  console.log('Login pemilik :', OWNER_EMAIL, '/', DEMO_PASSWORD);
  console.log('Login karyawan:', KARYAWAN_EMAIL, '/', DEMO_PASSWORD);
}

main().catch((err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
