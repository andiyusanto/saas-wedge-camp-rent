#!/usr/bin/env bash
# ============================================================
# backup-db.sh — Backup manual database Supabase (Free plan, tidak ada
# backup otomatis). Dijalankan manual oleh Andi, tidak dipanggil oleh
# backend/app. Lihat scripts/BACKUP.md untuk setup lengkap & cara
# restore yang sudah diuji.
#
# Menghasilkan DUA file terpisah:
#   1. <prefix>-public-<timestamp>.dump — schema `public` LENGKAP
#      (struktur + data: businesses, items, bookings, dst). Restore-nya
#      diuji rutin ke Postgres lokal/Docker biasa, lihat BACKUP.md.
#   2. <prefix>-auth-<timestamp>.dump — DATA-ONLY dari auth.users dan
#      auth.identities SAJA (akun login vendor, termasuk hash
#      password). TIDAK direstore-test rutin (butuh project Supabase
#      lain yang schema auth-nya cocok), disimpan semata-mata supaya
#      akun login tidak hilang total kalau project Supabase rusak.
#
# TIDAK mem-backup: foto/gambar di Cloudflare R2 (item, customer,
# pickup, logo usaha) — itu object storage terpisah, di luar database
# Postgres ini sama sekali.
# ============================================================
set -euo pipefail

: "${SEWALOG_DB_URL:?Set SEWALOG_DB_URL ke connection string Supabase. Pakai SESSION POOLER (host aws-...pooler.supabase.com, port 5432, user postgres.<ref>) — BUKAN Direct connection (paket Free cuma IPv6, kemungkinan besar gagal dari ISP rumahan) dan BUKAN Transaction pooler (port 6543, dilarang untuk pg_dump). Lihat BACKUP.md.}"
: "${SEWALOG_BACKUP_DIR:?Set SEWALOG_BACKUP_DIR ke folder backup DI LUAR repo ini, mis. ~/sewalog-backups}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir_abs="$(mkdir -p "$SEWALOG_BACKUP_DIR" && cd "$SEWALOG_BACKUP_DIR" && pwd)"

case "$backup_dir_abs" in
  "$repo_root"|"$repo_root"/*)
    echo "SEWALOG_BACKUP_DIR ($backup_dir_abs) ada DI DALAM repo ini ($repo_root) — tolak, dump tidak boleh pernah ikut di-commit." >&2
    exit 1
    ;;
esac

timestamp=$(date +%Y%m%d-%H%M%S)
public_file="$backup_dir_abs/sewalog-public-$timestamp.dump"
auth_file="$backup_dir_abs/sewalog-auth-$timestamp.dump"

echo "-- Backup schema public (struktur + data) --"
pg_dump "$SEWALOG_DB_URL" --schema=public --format=custom --file="$public_file"
chmod 600 "$public_file"
echo "OK: $public_file"

echo "-- Backup auth.users + auth.identities (data-only, SENSITIF — hash password) --"
pg_dump "$SEWALOG_DB_URL" \
  --data-only --format=custom \
  --table=auth.users --table=auth.identities \
  --file="$auth_file"
chmod 600 "$auth_file"
echo "OK: $auth_file"

echo
echo "Selesai. Dua file di $backup_dir_abs:"
echo "  $public_file  (restore-test rutin, lihat BACKUP.md)"
echo "  $auth_file    (SENSITIF, simpan aman, jangan kirim/unggah ke tempat terbuka)"
