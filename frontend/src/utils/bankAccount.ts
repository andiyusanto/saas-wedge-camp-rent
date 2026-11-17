// Lebih dari satu rekening bank (brief 17 Nov 2026, migration 069) --
// diekstrak dari EtalaseOnlineScreen.tsx (koordinator 17 Nov 2026)
// supaya validasi per-rekening bisa diuji unit tanpa React.
export type BankAccountLike = { bank_name: string; account_number: string; account_holder: string };

// Nomor rekening cuma angka/spasi/strip, pola ramah seperti nomor WA.
export const BANK_ACCOUNT_NUMBER_RE = /^[0-9\s-]+$/;

// null = valid. Pesan error ramah kalau tidak -- dipakai langsung
// sebagai setError() di EtalaseOnlineScreen.tsx.
export function validateBankAccount(acc: BankAccountLike): string | null {
  if (!acc.bank_name.trim() || !acc.account_holder.trim()) {
    return 'Nama bank dan nama pemilik rekening wajib diisi untuk semua rekening.';
  }
  if (!acc.account_number.trim() || !BANK_ACCOUNT_NUMBER_RE.test(acc.account_number.trim())) {
    return 'Nomor rekening cuma boleh angka, spasi, dan tanda hubung.';
  }
  return null;
}

// Validasi SELURUH daftar -- transfer aktif wajib minimal 1 rekening,
// dan tiap rekening yang ada wajib lolos validateBankAccount(). null =
// valid.
export function validateBankAccounts(accounts: BankAccountLike[]): string | null {
  if (accounts.length === 0) {
    return 'Tambahkan minimal 1 rekening kalau Transfer Bank diaktifkan.';
  }
  for (const acc of accounts) {
    const err = validateBankAccount(acc);
    if (err) return err;
  }
  return null;
}
