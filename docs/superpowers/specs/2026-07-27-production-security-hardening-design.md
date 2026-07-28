# 生产服务器安全加固设计

## 目标与边界

为 Debian/Ubuntu 单机部署提供可重复、可审计、可回滚的生产安全套件，支持 `2c2g` 与 `4c4g` 两种资源规格。当前只交付仓库内配置与脚本，不连接或修改尚未购买的服务器。

资源 profile 只改变 Node、PostgreSQL 与数据库连接池水位；TLS、账户、网络、服务沙箱、备份和发布安全策略保持一致。正常生成不设置连接数、次数或专用速率上限。

## 资源 profile

| 项目 | 2c2g | 4c4g |
|---|---:|---:|
| Node `MemoryHigh` | 1024M | 2304M |
| Node `MemoryMax` | 1280M | 2867M |
| V8 old-space | 896MB | 2048MB |
| 应用数据库池 | 5 | 10 |
| PostgreSQL `shared_buffers` | 256MB | 512MB |
| PostgreSQL `max_connections` | 20 | 40 |
| Swap | 2GB | 2GB |

profile 由 `deploy/install-profile.sh` 安装为 systemd drop-in、应用 profile 环境文件、PostgreSQL conf.d 与 nginx snippet。切换 profile 后重启 PostgreSQL、nginx 与 genesis 即可，不重装系统。

## 防线

### 主机

- SSH 仅公钥、禁 root/密码登录，保留本地端口转发供数据库迁移隧道使用。
- UFW 默认拒绝入站，只开放 SSH、80、443；PostgreSQL 仅监听 loopback。
- Fail2ban 保护 SSH，unattended-upgrades 安装安全更新。
- 内核网络与信息泄露 sysctl 加固；2GB swap 缓冲短时内存峰值。
- `harden-host.sh --check` 只审计，`--apply` 才修改；没有可用 SSH 公钥时拒绝禁用密码登录。

### 边缘与应用

- nginx 只接受指定 Host，未知 HTTP Host 返回 444，未知 TLS SNI 拒绝握手。
- TLS 1.2/1.3、HSTS、CSP、frame deny、nosniff、严格 referrer 与 permissions policy。
- auth、生成与普通 API 分级限流；生成型长请求共享 profile 级全局连接上限。
- SSE 保持不缓冲；OAuth 回调与会话查询不被登录爆破限流误伤。
- systemd 以无特权 `genesis` 用户运行，清空 capabilities，限制地址族、命名空间、设备、内核与文件系统写权限。

### 发布

- 发布到 `/srv/genesis/releases/<release-id>`，`/srv/genesis/current` 原子软链接切换。
- release 内禁止 `.env`、私钥和可写源码；运行时缓存独立放在 `/srv/genesis/shared/cache`。
- 激活前执行 preflight；重启后访问本机健康端点；失败自动切回上一版本。
- 保留最近三个版本，部署脚本不再直接 `rsync --delete` 覆盖正在运行的目录。

### 备份

- `pg_dump -Fc` 先做目录可读性验证，再使用 age 公钥加密。
- 只保存 `.dump.age`，明文临时文件由 trap 清理。
- `BACKUP_AGE_RECIPIENT` 与 `BACKUP_RCLONE_REMOTE` 缺失即失败；不允许把“无异地备份”降级为警告。
- systemd timer 每日运行，安全验收检查最近备份不超过 36 小时。
- 恢复要求显式 age 私钥，支持隔离演练库与人工确认后的目标库恢复。

## 验收

`deploy/security-check.sh` 在服务器上检查公网监听、PostgreSQL 绑定、TLS/安全头、未登录 401、OAuth state Cookie、UFW、Fail2ban、自动更新、systemd 沙箱、环境文件权限、release 秘密泄漏和备份新鲜度。任何硬要求失败都返回非零。
