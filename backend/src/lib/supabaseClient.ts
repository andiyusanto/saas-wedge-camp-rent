import { createClient } from '@supabase/supabase-js';
import type { Request } from 'express';
import WebSocket from 'ws';

const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY wajib diisi di .env');
}

// Klien per-request: pakai JWT milik user yang login (dari header Authorization),
// bukan Secret Key, supaya RLS (owner_id = auth.uid()) tetap berlaku dan
// isolasi antar-vendor tidak bisa dilewati dari backend.
export function createRequestClient(req: Request) {
  const authHeader = req.headers.authorization ?? '';

  return createClient(supabaseUrl!, supabasePublishableKey!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
    // Node 20 belum punya WebSocket native (baru stabil di Node 22+), padahal
    // supabase-js selalu menyiapkan realtime client saat construct meski tidak
    // dipakai — tanpa transport ini createClient() langsung throw di runtime ini.
    realtime: { transport: WebSocket as any },
  });
}
