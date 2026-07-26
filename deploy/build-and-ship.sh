#!/usr/bin/env bash
# 《创世》构建 + 上船脚本 —— 在构建机运行(本机 WSL/Git Bash 或 CI),
# 绝不在 2C2G 服务器上运行:next build 峰值内存 1–2GB,与 Postgres
# 同机的 2GB 盒子会 OOM(设计 §7 裁决:构建产物 rsync 上船)。
#
# 用法:
#   SERVER=deploy@your-server.example.com bash deploy/build-and-ship.sh
# 可覆盖变量见下方「配置」段。
#
# 前置(一次性):服务器已按 deploy/README.md §1/§4/§5 初始化;
# deploy 用户可 sudo systemctl restart genesis(sudoers 加一行:
#   deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart genesis
# )。
set -euo pipefail

# ── 配置(占位符,按环境覆盖)─────────────────────────────────────
SERVER="${SERVER:?用法: SERVER=deploy@your-server bash deploy/build-and-ship.sh}"
APP_DIR="${APP_DIR:-/srv/genesis/app}"
SERVICE="${SERVICE:-genesis}"
OUT_DIR="${OUT_DIR:-.deploy-out}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── 1. 依赖与构建 ───────────────────────────────────────────────
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm build:icons   # 重新抽取图标子集(src/lib/icons/icon-subset.generated.json)
pnpm build         # next.config.ts 已设 output:"standalone"

test -f .next/standalone/server.js || {
  echo "ERROR: .next/standalone/server.js 不存在(output:standalone 未生效?)" >&2
  exit 1
}

# ── 2. 组装产物目录 ─────────────────────────────────────────────
# standalone 默认不含 public/ 与 .next/static,需手工拷入(官方口径)。
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -r .next/standalone/. "$OUT_DIR"/
mkdir -p "$OUT_DIR/.next"
cp -r .next/static "$OUT_DIR/.next/static"
cp -r public "$OUT_DIR/public"

# 安全:next build 会把本地 .env(dev 数据库串/密钥)复制进 standalone,
# 生产环境变量只来自 /etc/genesis/genesis.env(systemd EnvironmentFile),
# 本地 .env 绝不上船。
rm -f "$OUT_DIR/.env" "$OUT_DIR"/.env.*

# ── 3. 数据库迁移(先迁移,后上新产物)──────────────────────────
# 服务器上没有 prisma CLI,迁移从构建机经 SSH 隧道执行。
# 首次部署或有新迁移时取消注释(migrate deploy 幂等,可重复执行):
#
# ssh -f -o ExitOnForwardFailure=yes -L 15432:localhost:5432 "$SERVER" sleep 120
# DATABASE_URL="postgresql://genesis:<强密码>@localhost:15432/genesis" \
#   pnpm exec prisma migrate deploy

# ── 4. rsync 上船 + 重启 ────────────────────────────────────────
# --delete 保证产物目录与本次构建一致;排除运行期缓存避免每次清空。
rsync -az --delete --exclude='.next/cache' "$OUT_DIR"/ "$SERVER:$APP_DIR"/

ssh "$SERVER" "sudo systemctl restart $SERVICE && systemctl is-active $SERVICE"

echo "OK: shipped $(git rev-parse --short HEAD 2>/dev/null || echo '?') -> $SERVER:$APP_DIR"
