#!/usr/bin/env bash
# 生产上线安全验收：汇总网络、服务、HTTP、安全头、发布物与备份证据。
set -euo pipefail

DOMAIN="${DOMAIN:-}"
SSH_PORT="${SSH_PORT:-22}"
ENV_FILE="${ENV_FILE:-/etc/genesis/genesis.env}"
CURRENT_LINK="${CURRENT_LINK:-/srv/genesis/current}"
BACKUP_DIR="${BACKUP_DIR:-/srv/genesis/backups}"
BASE_URL="${BASE_URL:-https://$DOMAIN}"

[[ -n "$DOMAIN" ]] || { echo "用法: DOMAIN=example.com $0" >&2; exit 2; }
[[ "$DOMAIN" != *://* && "$DOMAIN" != */* ]] || { echo "DOMAIN 只填写主机名，不含协议或路径" >&2; exit 2; }
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] || { echo "SSH_PORT 必须是端口号" >&2; exit 2; }

for command_name in curl find grep readlink ss stat systemctl ufw; do
  command -v "$command_name" >/dev/null || { echo "缺少命令: $command_name" >&2; exit 2; }
done

pass_count=0
fail_count=0
pass() { echo "PASS $*"; pass_count=$((pass_count + 1)); }
fail() { echo "FAIL $*" >&2; fail_count=$((fail_count + 1)); }

check_public_listeners() {
  local bad_listener=0 local_address peer_address rest host port
  while read -r local_address peer_address rest; do
    [[ -n "$local_address" ]] || continue
    host="${local_address%:*}"
    port="${local_address##*:}"
    case "$host" in
      0.0.0.0|"[::]"|::|"*")
        case "$port" in
          "$SSH_PORT"|80|443) ;;
          *) fail "发现非预期公网监听 $local_address"; bad_listener=1 ;;
        esac
        ;;
    esac
  done < <(ss -H -lnt | awk "{print \$4, \$5}")
  [[ "$bad_listener" -eq 0 ]] && pass "公网监听仅限 SSH/80/443"
}

check_http_header() {
  local file="$1" name="$2" pattern="$3"
  if grep -Eiq "^${name}:[[:space:]]*${pattern}" "$file"; then
    pass "HTTP header $name"
  else
    fail "缺少或错误的 HTTP header $name"
  fi
}

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/genesis-security.XXXXXX")"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT INT TERM

check_public_listeners
if ss -H -lnt | grep -Eq "(0\.0\.0\.0|\[::\]|:::):5432([[:space:]]|$)"; then
  fail "PostgreSQL 5432 暴露到公网"
else
  pass "PostgreSQL 仅 loopback"
fi

https_headers="$tmp_dir/https.headers"
if curl --silent --show-error --max-time 15 --head "$BASE_URL/" >"$https_headers"; then
  pass "HTTPS 可访问"
  check_http_header "$https_headers" Strict-Transport-Security "max-age="
  check_http_header "$https_headers" Content-Security-Policy ".+"
  check_http_header "$https_headers" X-Content-Type-Options "nosniff"
  check_http_header "$https_headers" X-Frame-Options "DENY"
  check_http_header "$https_headers" Referrer-Policy ".+"
  check_http_header "$https_headers" Permissions-Policy ".+"
else
  fail "HTTPS 访问失败: $BASE_URL"
fi

http_headers="$tmp_dir/http.headers"
if curl --silent --show-error --max-time 15 --head "http://$DOMAIN/" >"$http_headers"; then
  grep -Eq "^HTTP/[^ ]+ 308([[:space:]]|$)" "$http_headers" && pass "HTTP 使用 308 跳转" || fail "HTTP 未使用 308 跳转"
  grep -Eiq "^Location:[[:space:]]*https://$DOMAIN/" "$http_headers" && pass "HTTP 跳转到正确 HTTPS 域名" || fail "HTTP Location 不正确"
else
  fail "HTTP 重定向检查失败"
fi

worlds_status="$(curl --silent --show-error --max-time 15 --output /dev/null --write-out "%{http_code}" "$BASE_URL/api/worlds" || true)"
[[ "$worlds_status" == "401" ]] && pass "未登录业务 API 返回 401" || fail "未登录 /api/worlds 返回 $worlds_status，预期 401"

oauth_headers="$tmp_dir/oauth.headers"
oauth_body="$(printf "%s" "{\"provider\":\"discord\",\"callbackURL\":\"/\",\"errorCallbackURL\":\"/login\"}")"
if curl --silent --show-error --max-time 15 --dump-header "$oauth_headers" --output /dev/null \
  --header "Content-Type: application/json" --data "$oauth_body" "$BASE_URL/api/auth/sign-in/social"; then
  grep -Eiq "^Set-Cookie:.*(oauth|state)" "$oauth_headers" && pass "Discord OAuth 下发 state cookie" || fail "Discord OAuth 未下发 state cookie"
else
  fail "Discord OAuth 发起请求失败"
fi

systemctl is-active --quiet genesis && pass "genesis service active" || fail "genesis service inactive"
systemctl is-active --quiet fail2ban && pass "fail2ban active" || fail "fail2ban inactive"
systemctl is-enabled --quiet unattended-upgrades && pass "unattended-upgrades enabled" || fail "unattended-upgrades disabled"
ufw status | grep -q "Status: active" && pass "UFW active" || fail "UFW inactive"

if [[ -r "$ENV_FILE" ]]; then
  env_mode="$(stat -c "%a" "$ENV_FILE")"
  [[ "$env_mode" == "600" || "$env_mode" == "640" ]] && pass "环境文件权限 $env_mode" || fail "环境文件权限为 $env_mode，预期 600/640"
else
  fail "环境文件不可读: $ENV_FILE"
fi

if [[ -L "$CURRENT_LINK" ]]; then
  current_release="$(readlink -f "$CURRENT_LINK")"
  pass "current 是 release 软链接"
  if find "$current_release" -maxdepth 3 -type f \( -name ".env" -o -name ".env.*" -o -name "*.pem" -o -name "*.key" \) -print -quit | grep -q .; then
    fail "当前 release 含环境文件或私钥"
  else
    pass "当前 release 无秘密文件"
  fi
else
  fail "$CURRENT_LINK 不是软链接"
fi

if find "$BACKUP_DIR" -maxdepth 1 -type f -name "genesis-*.dump.age" -mmin -2160 -print -quit 2>/dev/null | grep -q .; then
  pass "最近 36 小时内存在加密备份"
else
  fail "最近 36 小时内无加密备份"
fi

echo "SUMMARY pass=$pass_count fail=$fail_count"
[[ "$fail_count" -eq 0 ]]
