# 部署手册 · 2C2G / 4C4G 安全单机

> 更新日期：2026-07-27
>
> 目标环境：Debian/Ubuntu，nginx + Next.js standalone 单进程 + PostgreSQL 同机。
> 仓库内脚本不会自动连接服务器；买好机器后按本文显式执行。

## 0. 架构与硬约束

```text
浏览器 ──HTTPS──▶ nginx :443
                    ├─ 静态文件 → /srv/genesis/current
                    └─ API / 页面 / SSE → 127.0.0.1:3000 Node 单进程
                                                 └─ 127.0.0.1:5432 PostgreSQL

/srv/genesis/releases/<release-id>  # 不可变只读版本
/srv/genesis/current -> releases/... # 原子切换软链接
/srv/genesis/shared/cache            # 唯一运行期可写应用目录
```

硬约束：

1. 不在生产小机上运行 `next build`；在本机/CI 构建 standalone 后上传。
2. Node 只能单进程。当前 SSE 与任务去重依赖进程内状态，禁止 pm2 cluster、多实例 systemd 或多副本。
3. PostgreSQL 与 Node 只监听 loopback；公网仅 SSH、80、443。
4. release 中禁止 `.env`、PEM、key；生产秘密只在 `/etc/genesis/genesis.env`。
5. SSE 路由必须保持 `proxy_buffering off` 和长读超时。
6. 正常生成不设置连接数、次数或专用速率上限；仅登录与普通 API 保留防刷保护。
7. 备份必须先 age 加密，再上传 rclone 异地目标；缺任一配置即失败。

## 1. 文件清单

| 文件 | 用途 | 服务器位置 |
|---|---|---|
| `harden-host.sh` | 主机审计/加固，默认只检查 | `/srv/genesis/bin/harden-host.sh` |
| `sshd-hardening.conf` | SSH 实际生效的禁 root/密码登录配置 | `/srv/genesis/bin/sshd-hardening.conf` |
| `install-profile.sh` | 安装 2C2G/4C4G 资源水位 | `/srv/genesis/bin/install-profile.sh` |
| `preflight.sh` | systemd 启动前校验 | `/srv/genesis/bin/preflight.sh` |
| `activate-release.sh` | 原子激活、健康检查、失败回滚 | `/srv/genesis/bin/activate-release.sh` |
| `security-check.sh` | 上线安全验收汇总 | `/srv/genesis/bin/security-check.sh` |
| `backup.sh` / `restore.sh` | age 加密备份与恢复演练 | `/srv/genesis/bin/` |
| `genesis.service` | Node 单进程 systemd 单元 | `/etc/systemd/system/genesis.service` |
| `genesis-backup.service/.timer` | 夜间备份调度 | `/etc/systemd/system/` |
| `nginx.conf` | TLS、Host 门、安全头、限流、SSE | `/etc/nginx/sites-available/genesis.conf` |
| `build-and-ship.sh` | 构建机生成并上传 release | 仅构建机 |

服务器没有完整仓库。先把所需 `deploy/*` 文件上传到临时目录，再以 root 安装到上述位置。

## 2. 选择资源 profile

两种 profile 共用同一套脚本，买机器后只需选择一次：

| 项目 | `2c2g` | `4c4g` |
|---|---:|---:|
| Node `MemoryHigh` | 1024M | 2304M |
| Node `MemoryMax` | 1280M | 2867M |
| V8 old-space | 896MB | 2048MB |
| 应用数据库池 | 5 | 10 |
| PostgreSQL `shared_buffers` | 256MB | 512MB |
| PostgreSQL `max_connections` | 20 | 40 |
| swap | 2GB | 2GB |

在本机只读预览：

```bash
bash deploy/install-profile.sh --print 2c2g
bash deploy/install-profile.sh --print 4c4g
```

服务器安装：

```bash
sudo /srv/genesis/bin/install-profile.sh --install 2c2g
# 或
sudo /srv/genesis/bin/install-profile.sh --install 4c4g
```

脚本会安装 `/etc/genesis/profile.env`、systemd memory drop-in 及 PostgreSQL profile，并清理旧版生成连接限制片段。之后执行：

```bash
sudo systemctl restart postgresql
sudo systemctl daemon-reload
sudo nginx -t && sudo systemctl reload nginx
```

`4c4g` 更适合多人同时生成；仍然保持 Node 单进程，但不会通过 nginx 限制正常生成并发。

## 3. 首次服务器初始化

### 3.1 软件、用户与目录

```bash
# Node 22 LTS；确保最终位于 /usr/bin/node
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs nginx postgresql postgresql-client rsync curl

sudo useradd --system --create-home --home-dir /srv/genesis --shell /usr/sbin/nologin genesis
sudo mkdir -p /srv/genesis/{bin,releases,shared/cache,backups}
sudo usermod -aG genesis deploy
sudo chown root:genesis /srv/genesis/bin /srv/genesis/releases
sudo chmod 750 /srv/genesis/bin
sudo chmod 2775 /srv/genesis/releases
sudo chown genesis:genesis /srv/genesis/shared/cache /srv/genesis/backups
sudo chmod 750 /srv/genesis/shared/cache /srv/genesis/backups
```

### 3.2 上传并安装运维脚本

```bash
sudo cp deploy/{harden-host,install-profile,preflight,activate-release,backup,restore,security-check}.sh /srv/genesis/bin/
sudo cp deploy/sshd-hardening.conf /srv/genesis/bin/
sudo cp deploy/cleanup-llmcalls.sql /srv/genesis/bin/
sudo chown root:genesis /srv/genesis/bin/*
sudo chmod 750 /srv/genesis/bin/*.sh
sudo chmod 640 /srv/genesis/bin/cleanup-llmcalls.sql /srv/genesis/bin/sshd-hardening.conf

# 允许构建机只调用受路径约束的激活器；用 visudo 创建 /etc/sudoers.d/genesis-deploy
# deploy ALL=(root) NOPASSWD: /srv/genesis/bin/activate-release.sh /srv/genesis/releases/*
```

把 `deploy` 加入 `genesis` 组后需重新登录 SSH，组权限才会生效。`releases` 使用 setgid 目录，上传中的新 release 可写；激活后脚本会改为 `root:genesis` 且去掉组写权限。

### 3.3 主机加固

先给 `deploy` 用户安装并验证 SSH 公钥；脚本检测不到 `authorized_keys` 时会拒绝关闭密码登录。

```bash
# 默认只审计，不修改
sudo DEPLOY_USER=deploy /srv/genesis/bin/harden-host.sh --check

# 明确应用；按机器选 profile
sudo DEPLOY_USER=deploy GENESIS_PROFILE=2c2g /srv/genesis/bin/harden-host.sh --apply
# 或 GENESIS_PROFILE=4c4g
```

`--apply` 安装 UFW、Fail2ban、unattended-upgrades、age、rclone，禁 root/密码 SSH，保留 local forwarding，开放 SSH/80/443，应用 sysctl，并在无 swap 时创建 2GB `/swapfile`。不要在未验证新 SSH 公钥会话前关闭当前管理会话。

### 3.4 PostgreSQL

```bash
sudo -u postgres createuser --createdb genesis
sudo -u postgres createdb -O genesis genesis
sudo -u postgres psql -c "ALTER USER genesis WITH PASSWORD '<强密码>';"
sudo systemctl restart postgresql
```

profile 会把 PostgreSQL 绑定至 `127.0.0.1,::1`。确认：

```bash
sudo -u postgres psql -c "show listen_addresses; show shared_buffers; show max_connections;"
sudo ss -lntp | grep 5432
```

## 4. 环境变量与 Discord

```bash
sudo install -d -m 750 -o root -g genesis /etc/genesis
sudo editor /etc/genesis/genesis.env
sudo chown root:genesis /etc/genesis/genesis.env
sudo chmod 640 /etc/genesis/genesis.env
```

环境文件模板：

```env
NODE_ENV=production
HOSTNAME=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://genesis:<强密码>@localhost:5432/genesis
SECRET_KEY=<64位hex>
BETTER_AUTH_SECRET=<64位hex>
BETTER_AUTH_URL=https://example.com
ADMIN_USER_IDS=
DISCORD_CLIENT_ID=<Discord Application ID>
DISCORD_CLIENT_SECRET=<Discord Client Secret>
BACKUP_AGE_RECIPIENT=<age1...公钥>
BACKUP_RCLONE_REMOTE=<remote:path>
```

`DATABASE_POOL_MAX` 不放在这里，由 `/etc/genesis/profile.env` 管理。生成 64 位 hex：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Discord Developer Portal 的生产回调必须精确为：

```text
https://example.com/api/auth/callback/discord
```

服务器必须允许到 `discord.com`、Discord API/CDN 的 HTTPS 出站。任何 Discord 用户首次授权都可注册；与既有邮箱账号同邮箱时不会隐式合并。

## 5. TLS 与 nginx

先用 certbot 或其他 ACME 客户端签发证书，再把 `deploy/nginx.conf` 中全部 `<your-domain.example.com>` 替换为真实域名：

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/genesis.conf
sudo ln -s /etc/nginx/sites-available/genesis.conf /etc/nginx/sites-enabled/genesis.conf
sudo nginx -t
sudo systemctl reload nginx
```

模板已包含：TLS 1.2/1.3、HSTS、CSP、Host 门、`nosniff`、frame deny、referrer/permissions policy、登录/普通 API 防刷和 SSE 不缓冲。生成路由不设连接数、次数或专用速率上限；稳定性依靠数据库池、提示词缓存、systemd 内存水位与服务自动恢复，而不是拒绝正常生成。CSP 当前兼容 Next 的内联脚本/样式；后续若改为 nonce，需应用与 nginx 同步调整。

## 6. systemd 与首次 release

```bash
sudo cp deploy/genesis.service /etc/systemd/system/genesis.service
sudo cp deploy/genesis-backup.service deploy/genesis-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

在构建机：

```bash
cd <仓库根目录>
SERVER=deploy@example.com bash deploy/build-and-ship.sh
```

脚本执行 `pnpm install --frozen-lockfile`、Prisma generate、图标子集构建、Next standalone 构建，剥离 `.env`，上传到 `/srv/genesis/releases/<release-id>`，再调用激活器。激活器会：

1. 验证 standalone 结构和秘密文件；
2. 把 `.next/cache` 链接到共享缓存；
3. 将 release 设为 root 持有、只读；
4. 原子切换 `/srv/genesis/current`；
5. 重启并健康检查 `/api/auth/get-session`；
6. 失败时恢复旧链接并重启；
7. 保留最近 3 个 release。

手工回滚到仍保留的版本，也走同一激活器：

```bash
sudo /srv/genesis/bin/activate-release.sh /srv/genesis/releases/<旧release-id>
```

## 7. 数据库迁移与首次建号

服务器不安装 Prisma CLI。迁移从构建机经 SSH loopback 隧道执行：

```bash
ssh -f -o ExitOnForwardFailure=yes -L 15432:localhost:5432 deploy@example.com sleep 120
DATABASE_URL="postgresql://genesis:<强密码>@localhost:15432/genesis" pnpm exec prisma migrate deploy
```

顺序：先迁移，再发布新代码。首次房主建号：

```text
migrate deploy
  → DATABASE_URL=<隧道连接串> node scripts/auth-admin.mjs seed-owner <邮箱> <密码>
  → 把打印的 userId 写入 ADMIN_USER_IDS
  → sudo systemctl restart genesis
```

Discord 开放注册不要求预建账号。

## 8. age + rclone 加密异地备份

### 8.1 密钥与异地目标

```bash
sudo age-keygen -o /etc/genesis/backup-age-key.txt
sudo chown root:genesis /etc/genesis/backup-age-key.txt
sudo chmod 640 /etc/genesis/backup-age-key.txt
```

把命令输出的 `age1...` 公钥写入 `BACKUP_AGE_RECIPIENT`。把 age 私钥另存到离线密码库；服务器和数据库同时损坏时，没有它就无法恢复。

使用固定的 systemd 可读配置路径配置 rclone，并验证远端：

```bash
sudo rclone config --config /etc/genesis/rclone.conf
sudo chown root:genesis /etc/genesis/rclone.conf
sudo chmod 640 /etc/genesis/rclone.conf
sudo -u genesis rclone --config /etc/genesis/rclone.conf lsd <remote:path>
```

### 8.2 启用 timer

```bash
sudo -u genesis /srv/genesis/bin/backup.sh --check-config
sudo systemctl enable --now genesis-backup.timer
sudo systemctl start genesis-backup.service
systemctl status genesis-backup.service --no-pager
systemctl list-timers genesis-backup.timer
```

每次备份执行 `pg_dump -Fc` → `pg_restore --list` 校验 → age 加密 → rclone `--immutable` 上传；本地只保留 `.dump.age`，默认轮换 7 天。这里不使用 cron。

### 8.3 恢复演练

```bash
# 恢复到一次性演练库，不触碰生产库
sudo -u genesis /srv/genesis/bin/restore.sh --drill /srv/genesis/backups/genesis-<时间>.dump.age

# 真恢复前先停服务；脚本要求再次输入目标库名
sudo systemctl stop genesis
sudo -u genesis /srv/genesis/bin/restore.sh --into genesis /srv/genesis/backups/genesis-<时间>.dump.age
sudo systemctl start genesis
```

上线前至少完成一次演练，之后建议每月抽查。

## 9. 上线安全验收

```bash
sudo DOMAIN=example.com /srv/genesis/bin/security-check.sh
```

验收项包括：公网监听仅 SSH/80/443、5432 不公网、HTTPS 安全头、HTTP 308、未登录 API 401、Discord OAuth state cookie、genesis/Fail2ban/unattended-upgrades/UFW 状态、环境权限、current 软链接、release 无秘密、36 小时内有加密备份。任一失败都非零退出。

另做两项人工验收：

- 实际开一局，确认 SSE 逐条到达而不是最后整块吐出；
- 上传接近 10MB 的世界存档，确认仅 `/api/worlds/import` 放宽 body 上限。

## 10. 买服务器后的首次执行顺序

1. 选 `2c2g` 或 `4c4g`，创建服务器并只允许 SSH 公钥；
2. 绑定域名，先确认 DNS 指向正确 IP；
3. 安装软件、用户与目录，上传 `/srv/genesis/bin` 脚本；
4. 运行 `harden-host.sh --check`，确认 deploy 公钥后再 `--apply`；
5. 创建 PostgreSQL 用户/库，安装 profile；
6. 配 `/etc/genesis/genesis.env`、Discord 回调、age/rclone；
7. 申请 TLS，安装 nginx 与 systemd，运行 `nginx -t`；
8. 从构建机跑迁移、首次建号与 `build-and-ship.sh`；
9. 启用备份 timer，产出首份异地加密备份并完成恢复演练；
10. 运行 `security-check.sh` 和人工 SSE/导入验收。

Windows 本地只能验证脚本语法和无副作用模式；UFW、systemd、ss、nginx、PostgreSQL reload、真实 TLS/OAuth 与恢复演练必须在买到的 Linux 服务器上完成。
