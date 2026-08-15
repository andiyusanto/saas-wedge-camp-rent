import { Router } from 'express';
import crypto from 'node:crypto';
import { createRequestClient } from '../lib/supabaseClient.js';

const router = Router();

const INVITE_TTL_DAYS = 7;

router.get('/team/members', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const supabase = createRequestClient(req);
  const { data, error } = await supabase
    .from('business_members')
    .select('id, user_id, role, email, created_at')
    .order('created_at');

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.json({ members: data });
});

router.get('/team/invites', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const supabase = createRequestClient(req);
  const { data, error } = await supabase
    .from('business_invites')
    .select('id, code, role, expires_at, used_at, created_at')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.json({ invites: data });
});

router.post('/team/invites', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { businessId, role } = req.body ?? {};

  if (!businessId || !['owner', 'karyawan'].includes(role)) {
    res.status(400).json({ error: 'Data tidak lengkap' });
    return;
  }

  const supabase = createRequestClient(req);
  const code = crypto.randomBytes(20).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  if (!userId) {
    res.status(401).json({ error: 'Sesi login tidak valid' });
    return;
  }

  const { data, error } = await supabase
    .from('business_invites')
    .insert({
      business_id: businessId,
      code,
      role,
      created_by: userId,
      expires_at: expiresAt.toISOString(),
    })
    .select('id, code, role, expires_at')
    .single();

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.status(201).json({ invite: data });
});

router.delete('/team/invites/:id', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const supabase = createRequestClient(req);
  const { error } = await supabase.from('business_invites').delete().eq('id', req.params.id);

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.json({ ok: true });
});

router.delete('/team/members/:id', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const supabase = createRequestClient(req);
  const { error } = await supabase.from('business_members').delete().eq('id', req.params.id);

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.json({ ok: true });
});

// Redeem kode undangan — hanya butuh login (belum tentu member bisnis
// manapun). Validasi kode persis dilakukan di sini (bukan cuma di RLS
// insert_self_via_valid_invite, yang cuma cek "ada undangan valid untuk
// business+role ini", bukan kecocokan kode persis) — lihat migration 007.
router.post('/team/invites/redeem', async (req, res) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Belum login' });
    return;
  }

  const { code } = req.body ?? {};
  if (!code) {
    res.status(400).json({ error: 'Kode undangan wajib diisi' });
    return;
  }

  const supabase = createRequestClient(req);

  const { data: invite, error: inviteError } = await supabase
    .from('business_invites')
    .select('id, business_id, role, used_at, expires_at')
    .eq('code', code)
    .maybeSingle();

  if (inviteError || !invite) {
    res.status(404).json({ error: 'Kode undangan tidak ditemukan' });
    return;
  }

  if (invite.used_at) {
    res.status(400).json({ error: 'Kode undangan sudah dipakai' });
    return;
  }

  if (new Date(invite.expires_at) <= new Date()) {
    res.status(400).json({ error: 'Kode undangan sudah kedaluwarsa' });
    return;
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  const email = userData.user?.email;

  if (!userId || !email) {
    res.status(401).json({ error: 'Sesi login tidak valid' });
    return;
  }

  const { error: memberError } = await supabase.from('business_members').insert({
    business_id: invite.business_id,
    user_id: userId,
    role: invite.role,
    email,
  });

  if (memberError) {
    res.status(400).json({ error: memberError.message });
    return;
  }

  const { error: markUsedError } = await supabase
    .from('business_invites')
    .update({ used_at: new Date().toISOString(), used_by: userId })
    .eq('id', invite.id);

  if (markUsedError) {
    res.status(400).json({ error: markUsedError.message });
    return;
  }

  res.json({ ok: true, businessId: invite.business_id, role: invite.role });
});

export default router;
