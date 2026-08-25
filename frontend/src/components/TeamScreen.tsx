import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Users, UserPlus, Copy, Trash2, Check } from 'lucide-react';
import { useTeam } from '../hooks/useTeam';
import type { TeamInvite, TeamMember } from '../hooks/useTeam';
import type { Business, BusinessUpdateInput } from '../hooks/useBusiness';
import { ConfirmModal } from './ConfirmModal';
import { BusinessInfoSection } from './BusinessInfoSection';
import { formatDateIndo } from '../utils/formatters';

function inviteUrl(code: string) {
  return `${window.location.origin}${window.location.pathname}?invite=${code}`;
}

export function TeamScreen({
  session,
  businessId,
  business,
  onSaveBusiness,
}: {
  session: Session;
  businessId: string;
  business: Business;
  onSaveBusiness: (input: BusinessUpdateInput) => Promise<{ error: string | null }>;
}) {
  const { members, invites, loading, error, createInvite, revokeInvite, removeMember } = useTeam(session, businessId);
  const [role, setRole] = useState<'owner' | 'karyawan'>('karyawan');
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<TeamInvite | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);

  async function handleCreateInvite() {
    setCreating(true);
    setActionError(null);
    const { error: err } = await createInvite(role);
    setCreating(false);
    if (err) setActionError(err);
  }

  async function handleCopy(code: string, id: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setActionError('Gagal menyalin link. Salin manual dari kode di atas.');
    }
  }

  if (loading) return <p className="text-sm text-[#6E6853]">Memuat...</p>;
  if (error) return <p className="text-sm text-[#A8412E]">Gagal memuat: {error}</p>;

  return (
    <div className="space-y-6">
      <BusinessInfoSection business={business} onSave={onSaveBusiness} />

      <div className="bg-[#FBFAF4] p-4 sm:p-5 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-3">
        <h2 className="text-lg font-bold text-[#26302B] flex items-center gap-2">
          <Users className="w-5 h-5 text-[#2B4739]" />
          <span>Kelola Karyawan</span>
        </h2>
        <p className="text-xs text-[#6E6853]">
          Karyawan yang bergabung dapat akses penuh ke data operasional usaha ini (kalender, transaksi, jaminan &amp;
          denda, katalog) — kecuali menu Kelola Karyawan ini sendiri, yang cuma bisa diakses pemilik.
        </p>

        <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-[#E6E1D2]">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'owner' | 'karyawan')}
            className="px-3 py-2 rounded-lg bg-white border border-[#DBD5C1] text-[#26302B] text-sm"
          >
            <option value="karyawan">Karyawan</option>
            <option value="owner">Pemilik (co-owner)</option>
          </select>
          <button
            onClick={handleCreateInvite}
            disabled={creating}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#2B4739] hover:bg-[#1E3429] text-white font-semibold text-sm shadow-sm transition disabled:opacity-60"
          >
            <UserPlus className="w-4 h-4" />
            {creating ? 'Membuat...' : 'Buat Link Undangan'}
          </button>
        </div>

        {actionError && <p className="text-xs text-[#A8412E]">{actionError}</p>}
      </div>

      {invites.length > 0 && (
        <div className="bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-2">
          <h3 className="text-sm font-bold text-[#26302B]">Undangan Belum Dipakai</h3>
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-xs">
              <div className="min-w-0">
                <p className="font-semibold text-[#26302B]">
                  {inv.role === 'owner' ? 'Pemilik (co-owner)' : 'Karyawan'}
                </p>
                <p className="text-[#6E6853]">Kedaluwarsa {formatDateIndo(inv.expires_at.slice(0, 10))}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleCopy(inv.code, inv.id)}
                  className="p-2 rounded-lg bg-white border border-[#DBD5C1] text-[#2B4739] hover:bg-[#E8EFEA] transition"
                  title="Salin link undangan"
                >
                  {copiedId === inv.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => setRevokeTarget(inv)}
                  className="p-2 rounded-lg bg-white border border-[#DBD5C1] text-[#A8412E] hover:bg-[#FAF0EE] transition"
                  title="Batalkan undangan"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-[#FBFAF4] p-4 rounded-2xl border border-[#DBD5C1] shadow-xs space-y-2">
        <h3 className="text-sm font-bold text-[#26302B]">Anggota ({members.length})</h3>
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#F1EEE2] border border-[#DBD5C1] text-xs">
            <div className="min-w-0">
              <p className="font-semibold text-[#26302B] truncate">{m.email}</p>
              <p className="text-[#6E6853]">{m.role === 'owner' ? 'Pemilik' : 'Karyawan'} · sejak {formatDateIndo(m.created_at.slice(0, 10))}</p>
            </div>
            {m.user_id !== session.user.id && (
              <button
                onClick={() => setRemoveTarget(m)}
                className="p-2 rounded-lg bg-white border border-[#DBD5C1] text-[#A8412E] hover:bg-[#FAF0EE] transition shrink-0"
                title="Keluarkan dari tim"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <ConfirmModal
        isOpen={revokeTarget !== null}
        title="Batalkan Undangan?"
        description="Link undangan ini tidak akan bisa dipakai lagi untuk bergabung."
        confirmLabel="Batalkan"
        onConfirm={async () => {
          const { error: err } = await revokeInvite(revokeTarget!.id);
          if (err) throw new Error(err);
        }}
        onClose={() => setRevokeTarget(null)}
      />

      <ConfirmModal
        isOpen={removeTarget !== null}
        title="Keluarkan dari Tim?"
        description={`${removeTarget?.email ?? 'Anggota ini'} akan kehilangan akses ke data usaha ini. Dia bisa diundang lagi kapan saja lewat link undangan baru.`}
        confirmLabel="Keluarkan"
        onConfirm={async () => {
          const { error: err } = await removeMember(removeTarget!.id);
          if (err) throw new Error(err);
        }}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}
