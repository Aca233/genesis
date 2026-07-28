#!/usr/bin/env bash
# systemd ExecStartPre：在 Node 启动前验证运行目录、环境和权限。
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/genesis/current}"
ENV_FILE="${ENV_FILE:-/etc/genesis/genesis.env}"
PROFILE_FILE="${PROFILE_FILE:-/etc/genesis/profile.env}"

fail() { echo "PRECHECK ERROR: $*" >&2; exit 1; }

[[ -L "$APP_DIR" || -d "$APP_DIR" ]] || fail "$APP_DIR 不存在"
[[ -r "$APP_DIR/server.js" ]] || fail "server.js 不可读"
[[ -d "$APP_DIR/.next/static" ]] || fail ".next/static 缺失"
[[ -d "$APP_DIR/public" ]] || fail "public 缺失"

if find -L "$APP_DIR" -maxdepth 2 -type f \( -name ".env" -o -name ".env.*" -o -name "*.pem" -o -name "*.key" \) -print -quit | grep -q .; then
  fail "release 中发现环境文件或私钥"
fi

[[ -r "$ENV_FILE" ]] || fail "$ENV_FILE 不可读"
[[ -r "$PROFILE_FILE" ]] || fail "$PROFILE_FILE 不可读"

for key in DATABASE_URL SECRET_KEY BETTER_AUTH_SECRET BETTER_AUTH_URL; do
  grep -q "^${key}=" "$ENV_FILE" || fail "$ENV_FILE 缺少 $key"
done
grep -Eq "^DATABASE_POOL_MAX=(5|10)$" "$PROFILE_FILE" || fail "DATABASE_POOL_MAX 必须来自受支持 profile"

mode="$(stat -c "%a" "$ENV_FILE")"
owner="$(stat -c "%U:%G" "$ENV_FILE")"
[[ "$mode" == "640" || "$mode" == "600" ]] || fail "$ENV_FILE 权限必须为 640 或 600（当前 $mode）"
[[ "$owner" == "root:genesis" || "$owner" == "root:root" ]] || fail "$ENV_FILE 属主异常（当前 $owner）"

echo "PRECHECK OK: $APP_DIR"
