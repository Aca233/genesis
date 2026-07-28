#!/usr/bin/env bash
# 加密夜间备份：pg_dump -Fc -> age -> rclone；缺任一安全配置即失败。
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/genesis/genesis.env}"
BACKUP_DIR="${BACKUP_DIR:-/srv/genesis/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
CHECK_COMMANDS="${CHECK_COMMANDS:-1}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/genesis/rclone.conf}"
export RCLONE_CONFIG

fail() { echo "BACKUP ERROR: $*" >&2; exit 1; }

env_value() {
  local key="$1" line value
  line="$(grep -m1 "^${key}=" "$ENV_FILE" 2>/dev/null || true)"
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  printf "%s" "$value"
}

[[ -r "$ENV_FILE" ]] || fail "$ENV_FILE 不可读"
DATABASE_URL="$(env_value DATABASE_URL)"
BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-$(env_value BACKUP_AGE_RECIPIENT)}"
BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-$(env_value BACKUP_RCLONE_REMOTE)}"

[[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL 未配置"
[[ -n "$BACKUP_AGE_RECIPIENT" ]] || fail "BACKUP_AGE_RECIPIENT 未配置"
[[ "$BACKUP_AGE_RECIPIENT" == age1* ]] || fail "BACKUP_AGE_RECIPIENT 不是 age 公钥"
[[ -n "$BACKUP_RCLONE_REMOTE" ]] || fail "BACKUP_RCLONE_REMOTE 未配置"
[[ "$CHECK_COMMANDS" != "1" || -r "$RCLONE_CONFIG" ]] || fail "$RCLONE_CONFIG 不可读"

if [[ "$CHECK_COMMANDS" == "1" ]]; then
  for command in pg_dump pg_restore age rclone; do
    command -v "$command" >/dev/null || fail "缺少命令: $command"
  done
fi

if [[ "${1:-}" == "--check-config" ]]; then
  echo "BACKUP CONFIG OK"
  exit 0
fi
[[ $# -eq 0 ]] || fail "用法: $0 [--check-config]"

DB_URL_NO_QUERY="${DATABASE_URL%%\?*}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/genesis-$STAMP.dump.age"
PLAIN="$(mktemp "${TMPDIR:-/tmp}/genesis-$STAMP.XXXXXX.dump")"
cleanup() { rm -f "$PLAIN"; }
trap cleanup EXIT INT TERM
umask 077
install -d -m 0750 "$BACKUP_DIR"

echo "[$(date -Is)] pg_dump -> encrypted backup"
pg_dump --format=custom --no-owner --dbname="$DB_URL_NO_QUERY" --file="$PLAIN"
test -s "$PLAIN" || fail "pg_dump 为空"
pg_restore --list "$PLAIN" >/dev/null
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$OUT" "$PLAIN"
test -s "$OUT" || fail "加密输出为空"
rm -f "$PLAIN"

rclone copyto "$OUT" "${BACKUP_RCLONE_REMOTE%/}/$(basename "$OUT")" --immutable
find "$BACKUP_DIR" -maxdepth 1 -name "genesis-*.dump.age" -mtime +"$KEEP_DAYS" -delete
echo "[$(date -Is)] done: $(du -h "$OUT" | cut -f1) encrypted + offsite"
