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
# deploy 用户属于 genesis 组，可写 releases；并可无密码调用激活器(sudoers):
#   deploy ALL=(root) NOPASSWD: /srv/genesis/bin/activate-release.sh /srv/genesis/releases/*
set -euo pipefail

# ── 配置(占位符,按环境覆盖)─────────────────────────────────────
SERVER="${SERVER:?用法: SERVER=deploy@your-server bash deploy/build-and-ship.sh}"
RELEASES_DIR="${RELEASES_DIR:-/srv/genesis/releases}"
SERVICE="${SERVICE:-genesis}"
OUT_DIR="${OUT_DIR:-.deploy-out}"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD 2>/dev/null || echo build)}"

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

# ── 4. 上传新 release + 原子激活 ────────────────────────────────
REMOTE_RELEASE="$RELEASES_DIR/$RELEASE_ID"
ssh "$SERVER" "mkdir -p \"$REMOTE_RELEASE\""
rsync -az --delete "$OUT_DIR"/ "$SERVER:$REMOTE_RELEASE"/

# 激活器会校验秘密泄漏、原子切换 current、健康检查并在失败时回滚。
ssh "$SERVER" "sudo /srv/genesis/bin/activate-release.sh \"$REMOTE_RELEASE\" && systemctl is-active \"$SERVICE\""

echo "OK: shipped $(git rev-parse --short HEAD 2>/dev/null || echo '?') -> $SERVER:$REMOTE_RELEASE"
