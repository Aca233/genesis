#!/usr/bin/env bash
# 原子激活 standalone release；健康检查失败时自动回滚。
set -euo pipefail

BASE_DIR="${BASE_DIR:-/srv/genesis}"
RELEASES_DIR="${RELEASES_DIR:-$BASE_DIR/releases}"
CURRENT_LINK="${CURRENT_LINK:-$BASE_DIR/current}"
SHARED_CACHE="${SHARED_CACHE:-$BASE_DIR/shared/cache}"
SERVICE="${SERVICE:-genesis}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/auth/get-session}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"

fail() { echo "RELEASE ERROR: $*" >&2; exit 1; }

validate_release() {
  local release="$1"
  [[ -d "$release" ]] || fail "release 目录不存在: $release"
  if find "$release" -maxdepth 3 -type f \( -name ".env" -o -name ".env.*" -o -name "*.pem" -o -name "*.key" \) -print -quit | grep -q .; then
    fail "release 中禁止包含 .env、PEM 或私钥"
  fi
  [[ -f "$release/server.js" ]] || fail "release 缺少 server.js"
  [[ -d "$release/.next/static" ]] || fail "release 缺少 .next/static"
  [[ -d "$release/public" ]] || fail "release 缺少 public"
}

if [[ "${1:-}" == "--validate-only" ]]; then
  [[ $# -eq 2 ]] || fail "用法: $0 --validate-only <release-dir>"
  validate_release "$2"
  echo "RELEASE OK: $2"
  exit 0
fi

[[ $# -eq 1 ]] || fail "用法: $0 <release-dir>"
[[ "$(uname -s)" == "Linux" ]] || fail "激活只支持 Linux"
[[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "激活必须以 root 运行"

release="$(readlink -f "$1")"
releases_root="$(readlink -f "$RELEASES_DIR")"
[[ -n "$releases_root" && -d "$releases_root" ]] || fail "releases 根目录不存在: $RELEASES_DIR"
case "$release/" in "$releases_root/"*) ;; *) fail "release 必须位于 $RELEASES_DIR" ;; esac
validate_release "$release"

install -d -m 2775 -o root -g genesis "$RELEASES_DIR"
install -d -m 0755 -o root -g genesis "$BASE_DIR/shared"
install -d -m 0750 -o genesis -g genesis "$SHARED_CACHE"
rm -rf "$release/.next/cache"
ln -s "$SHARED_CACHE" "$release/.next/cache"
chown -R root:genesis "$release"
find "$release" -type d -exec chmod 0755 {} +
find "$release" -type f -exec chmod 0644 {} +

previous=""
if [[ -L "$CURRENT_LINK" ]]; then previous="$(readlink -f "$CURRENT_LINK")"; fi
next_link="$BASE_DIR/.current.$$.tmp"
ln -s "$release" "$next_link"
mv -Tf "$next_link" "$CURRENT_LINK"

systemctl restart "$SERVICE"
healthy=0
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 3 "$HEALTH_URL" >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "$healthy" -ne 1 ]]; then
  echo "RELEASE ERROR: 健康检查失败，开始回滚" >&2
  if [[ -n "$previous" && -d "$previous" ]]; then
    rollback_link="$BASE_DIR/.current.rollback.$$.tmp"
    ln -s "$previous" "$rollback_link"
    mv -Tf "$rollback_link" "$CURRENT_LINK"
    systemctl restart "$SERVICE"
  fi
  exit 1
fi

mapfile -t old_releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf "%T@ %p\n" | sort -nr | tail -n +$((KEEP_RELEASES + 1)) | cut -d" " -f2-)
for old in "${old_releases[@]}"; do
  [[ "$old" == "$release" || "$old" == "$previous" ]] && continue
  rm -rf --one-file-system "$old"
done

echo "RELEASE ACTIVE: $release"
