// Lebih dari satu rekening bank (brief 17 Nov 2026, migration 069) --
// diekstrak dari routes/etalase.ts (koordinator 17 Nov 2026) supaya
// jalur kompatibilitas mundur paling rawan di fitur ini -- menormalkan
// payment_snapshot (bentuk BARU: bank_accounts array, atau bentuk LAMA
// dari sebelum migration 069: 3 field flat) jadi satu daftar rekening
// seragam -- bisa diuji unit tanpa menarik masuk Express/Supabase.
export type BankAccountDisplay = { bank_name: string; account_number: string; account_holder: string };

export type PaymentSnapshotBankFields = {
  bank_accounts?: BankAccountDisplay[];
  bank_name?: string;
  bank_account_number?: string;
  bank_account_holder?: string;
};

// Prioritas: bank_accounts (bentuk baru) kalau ADA dan TIDAK KOSONG.
// Fallback ke array 1-elemen dari 3 field flat (snapshot lama, dari
// SEBELUM migration 069) kalau bank_accounts tidak ada/kosong TAPI
// bank_name terisi. Snapshot yang Transfer Bank-nya tidak pernah
// aktif sama sekali (pesanan tunai/QRIS) -> array kosong.
export function resolveBankAccountsForDisplay(snapshot: PaymentSnapshotBankFields | null | undefined): BankAccountDisplay[] {
  if (!snapshot) return [];
  if (snapshot.bank_accounts && snapshot.bank_accounts.length > 0) {
    return snapshot.bank_accounts;
  }
  if (snapshot.bank_name) {
    return [
      {
        bank_name: snapshot.bank_name,
        account_number: snapshot.bank_account_number ?? '',
        account_holder: snapshot.bank_account_holder ?? '',
      },
    ];
  }
  return [];
}
