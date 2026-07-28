#!/usr/bin/env bash
# Debian/Ubuntu 主机加固。默认 --check；--apply 才修改。
set -euo pipefail

MODE="${1:---check}"
PROFILE="${GENESIS_PROFILE:-2c2g}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
SSH_PORT="${SSH_PORT:-22}"
case "$MODE" in --check|--apply) ;; *) echo "用法: $0 --check|--apply" >&2; exit 2 ;; esac
case "$PROFILE" in 2c2g|4c4g) ;; *) echo "GENESIS_PROFILE 只能是 2c2g 或 4c4g" >&2; exit 2 ;; esac

pass=0; fail_count=0
ok() { echo "PASS $*"; pass=$((pass + 1)); }
bad() { echo "FAIL $*" >&2; fail_count=$((fail_count + 1)); }
check_cmd() { command -v "$1" >/dev/null && ok "command $1" || bad "missing command $1"; }

audit() {
  check_cmd ufw; check_cmd fail2ban-client; check_cmd systemctl; check_cmd ss
  id genesis >/dev/null 2>&1 && ok "user genesis" || bad "user genesis missing"
  id "$DEPLOY_USER" >/dev/null 2>&1 && ok "user $DEPLOY_USER" || bad "user $DEPLOY_USER missing"
  [[ -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]] && ok "deploy authorized_keys" || bad "deploy authorized_keys missing"
  ufw status 2>/dev/null | grep -q "Status: active" && ok "ufw active" || bad "ufw inactive"
  systemctl is-active --quiet fail2ban && ok "fail2ban active" || bad "fail2ban inactive"
  systemctl is-enabled --quiet unattended-upgrades && ok "unattended upgrades enabled" || bad "unattended upgrades disabled"
  ss -lnt | grep -Eq "0\\.0\\.0\\.0:5432|\\[::\\]:5432" && bad "PostgreSQL exposed" || ok "PostgreSQL loopback only"
  sshd -T 2>/dev/null | grep -Fx "passwordauthentication no" >/dev/null && ok "SSH password disabled" || bad "SSH password not disabled"
  sshd -T 2>/dev/null | grep -Fx "permitrootlogin no" >/dev/null && ok "SSH root disabled" || bad "SSH root not disabled"
  echo "SUMMARY pass=$pass fail=$fail_count"
  [[ "$fail_count" -eq 0 ]]
}

if [[ "$MODE" == "--check" ]]; then audit; exit $?; fi
[[ "$(uname -s)" == "Linux" ]] || { echo "--apply 仅支持 Linux" >&2; exit 1; }
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "--apply 必须以 root 运行" >&2; exit 1; }

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ufw fail2ban unattended-upgrades age rclone curl postgresql-client
id genesis >/dev/null 2>&1 || useradd --system --home /srv/genesis --shell /usr/sbin/nologin genesis
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG genesis "$DEPLOY_USER"
[[ -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]] || { echo "拒绝关闭密码：$DEPLOY_USER 尚无 authorized_keys" >&2; exit 1; }

install -d -m 0755 /etc/ssh/sshd_config.d
install -m 0644 "$(dirname "$0")/sshd-hardening.conf" /etc/ssh/sshd_config.d/00-genesis-hardening.conf
rm -f /etc/ssh/sshd_config.d/99-genesis-hardening.conf
sshd -t

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT/tcp" comment SSH
ufw allow 80/tcp comment HTTP
ufw allow 443/tcp comment HTTPS
ufw --force enable

cat >/etc/fail2ban/jail.d/genesis.local <<EOF
[sshd]
enabled = true
port = $SSH_PORT
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban unattended-upgrades

cat >/etc/sysctl.d/99-genesis-hardening.conf <<EOF
kernel.kptr_restrict=2
kernel.dmesg_restrict=1
kernel.yama.ptrace_scope=1
fs.protected_fifos=2
fs.protected_regular=2
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.default.accept_redirects=0
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.default.send_redirects=0
net.ipv4.conf.all.accept_source_route=0
net.ipv4.conf.default.accept_source_route=0
net.ipv4.tcp_syncookies=1
net.ipv6.conf.all.accept_redirects=0
net.ipv6.conf.default.accept_redirects=0
EOF
sysctl --system >/dev/null

if ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q "^/swapfile " /etc/fstab || echo "/swapfile none swap sw 0 0" >>/etc/fstab
fi

"$(dirname "$0")/install-profile.sh" --install "$PROFILE"
systemctl restart ssh fail2ban
audit
