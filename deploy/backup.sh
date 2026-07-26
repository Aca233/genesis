#!/usr/bin/env bash
# 《创世》nightly 备份:pg_dump -Fc + 7 日本地轮换 + 异地一份
# 安放:/srv/genesis/bin/backup.sh(chmod 750, chown genesis:genesis)
# cron(genesis 用户):30 3 * * * /srv/genesis/bin/backup.sh >> /srv/genesis/backups/backup.log 2>&1
#
# 世界数据是用户不可再生的创作资产 —— 异地占位段必须配置,
# 同机备份挡不住整机丢失。
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/genesis/genesis.env}"
BACKUP_DIR="${BACKUP_DIR:-/srv/genesis/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"

# 从环境文件取 DATABASE_URL,并剥掉 query 参数
# (connection_limit 等是 Prisma 约定,libpq 不识别会直接报错)
DATABASE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
DB_URL_NO_QUERY="${DATABASE_URL%%\?*}"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/genesis-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] pg_dump -> $OUT"
pg_dump --format=custom --no-owner --dbname="$DB_URL_NO_QUERY" --file="$OUT"

# 基本健全性:非空 + pg_restore 能读目录
test -s "$OUT"
pg_restore --list "$OUT" >/dev/null

# 7 日轮换(只删本脚本命名规则的文件)
find "$BACKUP_DIR" -maxdepth 1 -name 'genesis-*.dump' -mtime +"$KEEP_DAYS" -delete

# ── 异地一份(占位:二选一取消注释并配置)────────────────────────
# rclone(推荐,支持各类对象存储;先 rclone config 配好 remote):
# rclone copy "$OUT" <remote>:<bucket>/genesis-backups/ --no-traverse
#
# 或 rsync 到另一台机器:
# rsync -az "$OUT" <backup-user>@<backup-host>:<path>/genesis-backups/
echo "[$(date -Is)] WARN: offsite copy not configured (edit backup.sh)" >&2

echo "[$(date -Is)] done: $(du -h "$OUT" | cut -f1)"
