#!/usr/bin/env bash
# 《创世》恢复脚本:恢复演练(--drill)与真恢复(--into)
# 安放:/srv/genesis/bin/restore.sh(chmod 750, chown genesis:genesis)
#
# 用法:
#   restore.sh --drill <dump 文件>          恢复到一次性演练库并核对行数,不碰生产库
#   restore.sh --into <目标库名> <dump 文件>  覆盖式恢复(危险;先 systemctl stop genesis)
#
# 上线前必须完整走一次 --drill;此后建议每月抽查一次。
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/genesis/genesis.env}"
DRILL_DB="${DRILL_DB:-genesis_restore_drill}"

usage() { grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,8p'; exit 1; }

MODE="${1:-}"; shift || true

# 管理连接:剥掉 query 参数、指向 postgres 库(createdb/dropdb 需要)
DATABASE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
DB_URL_NO_QUERY="${DATABASE_URL%%\?*}"
ADMIN_URL="${DB_URL_NO_QUERY%/*}/postgres"

sanity_counts() {
  local db_url="$1"
  echo "── 行数核对(与预期世界数量对照)──"
  psql "$db_url" --no-psqlrc --tuples-only --command "
    SELECT 'worlds:    ' || count(*) FROM worlds
    UNION ALL SELECT 'timelines: ' || count(*) FROM timelines
    UNION ALL SELECT 'chapters:  ' || count(*) FROM chapters
    UNION ALL SELECT 'messages:  ' || count(*) FROM messages;"
}

case "$MODE" in
  --drill)
    DUMP="${1:?用法: restore.sh --drill <dump 文件>}"
    test -r "$DUMP"
    echo "[drill] 恢复 $DUMP -> 临时库 $DRILL_DB"
    psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS $DRILL_DB;"
    psql "$ADMIN_URL" -c "CREATE DATABASE $DRILL_DB;"
    pg_restore --no-owner --dbname="${DB_URL_NO_QUERY%/*}/$DRILL_DB" "$DUMP"
    sanity_counts "${DB_URL_NO_QUERY%/*}/$DRILL_DB"
    psql "$ADMIN_URL" -c "DROP DATABASE $DRILL_DB;"
    echo "[drill] 通过:dump 可恢复,临时库已清理"
    ;;
  --into)
    TARGET_DB="${1:?用法: restore.sh --into <目标库名> <dump 文件>}"
    DUMP="${2:?用法: restore.sh --into <目标库名> <dump 文件>}"
    test -r "$DUMP"
    echo "!! 即将用 $DUMP 覆盖数据库 [$TARGET_DB] 的现有内容"
    echo "!! 确认应用已停止(systemctl stop genesis),输入库名以继续:"
    read -r CONFIRM
    [ "$CONFIRM" = "$TARGET_DB" ] || { echo "已取消"; exit 1; }
    # --clean --if-exists:先删既有对象再重建,得到与 dump 一致的状态
    pg_restore --clean --if-exists --no-owner \
      --dbname="${DB_URL_NO_QUERY%/*}/$TARGET_DB" "$DUMP"
    sanity_counts "${DB_URL_NO_QUERY%/*}/$TARGET_DB"
    echo "[restore] 完成。启动应用前先人工核对上方行数。"
    ;;
  *) usage ;;
esac
