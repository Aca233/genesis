#!/usr/bin/env bash
# 恢复 age 加密的 PostgreSQL custom dump。
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/genesis/genesis.env}"
AGE_IDENTITY_FILE="${AGE_IDENTITY_FILE:-/etc/genesis/backup-age-key.txt}"
DRILL_DB="${DRILL_DB:-genesis_restore_drill}"

usage() { echo "用法: $0 --drill <dump.age> | --into <目标库名> <dump.age>" >&2; exit 2; }
fail() { echo "RESTORE ERROR: $*" >&2; exit 1; }
env_value() { local line; line="$(grep -m1 "^$1=" "$ENV_FILE" || true)"; printf "%s" "${line#*=}" | sed "s/^\"//;s/\"$//"; }

[[ -r "$ENV_FILE" ]] || fail "$ENV_FILE 不可读"
[[ -r "$AGE_IDENTITY_FILE" ]] || fail "$AGE_IDENTITY_FILE 不可读"
for command in age pg_restore psql; do command -v "$command" >/dev/null || fail "缺少命令: $command"; done

DATABASE_URL="$(env_value DATABASE_URL)"
[[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL 未配置"
DB_URL_NO_QUERY="${DATABASE_URL%%\?*}"
ADMIN_URL="${DB_URL_NO_QUERY%/*}/postgres"

PLAIN="$(mktemp "${TMPDIR:-/tmp}/genesis-restore.XXXXXX.dump")"
cleanup() { rm -f "$PLAIN"; }
trap cleanup EXIT INT TERM
umask 077

sanity_counts() {
  psql "$1" --no-psqlrc --tuples-only --command "SELECT count(*) FROM worlds;"
}

MODE="${1:-}"; shift || true
case "$MODE" in
  --drill)
    DUMP="${1:-}"; [[ -r "$DUMP" ]] || fail "加密 dump 不可读"
    age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$PLAIN" "$DUMP"
    pg_restore --list "$PLAIN" >/dev/null
    psql "$ADMIN_URL" --command "DROP DATABASE IF EXISTS $DRILL_DB;"
    psql "$ADMIN_URL" --command "CREATE DATABASE $DRILL_DB;"
    pg_restore --no-owner --dbname="${DB_URL_NO_QUERY%/*}/$DRILL_DB" "$PLAIN"
    sanity_counts "${DB_URL_NO_QUERY%/*}/$DRILL_DB"
    psql "$ADMIN_URL" --command "DROP DATABASE $DRILL_DB;"
    echo "RESTORE DRILL OK"
    ;;
  --into)
    TARGET_DB="${1:-}"; DUMP="${2:-}"
    [[ "$TARGET_DB" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || fail "目标库名非法"
    [[ -r "$DUMP" ]] || fail "加密 dump 不可读"
    age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$PLAIN" "$DUMP"
    pg_restore --list "$PLAIN" >/dev/null
    echo "输入目标库名 [$TARGET_DB] 以确认覆盖："
    read -r CONFIRM
    [[ "$CONFIRM" == "$TARGET_DB" ]] || fail "已取消"
    pg_restore --clean --if-exists --no-owner --dbname="${DB_URL_NO_QUERY%/*}/$TARGET_DB" "$PLAIN"
    sanity_counts "${DB_URL_NO_QUERY%/*}/$TARGET_DB"
    echo "RESTORE OK"
    ;;
  *) usage ;;
esac
