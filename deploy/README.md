# 部署手册 · 2C2G 单机(nginx + Node standalone + PostgreSQL 同机)

> 更新日期:2026-07-27
> 依据:`docs/superpowers/specs/2026-07-26-multi-tenant-conversion-design.md` §7「部署与运维(2C2G)」的运维裁决。
> 目标环境:2 vCPU / 2GB 内存的单台 Linux 服务器(Debian/Ubuntu 语境,其他发行版按需换包管理器)。

## 0. 架构总览与硬约束

```
浏览器 ──HTTPS──▶ nginx(443)
                    ├─ /_next/static、/images  → 磁盘直出(alias)
                    └─ 其余(含 SSE)          → 127.0.0.1:3000 Node standalone 单进程
                                                  └─ localhost:5432 PostgreSQL 16(同机)
```

三条硬约束,违反任何一条都会产生难排查的故障:

1. **禁止在 2GB 服务器上执行 `next build`**。构建峰值内存 1–2GB,与 Postgres 同机的 2GB 盒子会 OOM。必须在本机/CI 构建后 rsync 产物上服务器(见 §2);若确实要在服务器上构建,至少临时挂 2GB swap 且仅供构建期使用。
2. **禁止多副本/集群模式(pm2 cluster、多个 systemd 实例、nginx 负载均衡到多进程)**。SSE 事件总线与任务去重依赖模块级内存 Map(`src/lib/chat/task-runner.ts:10-11` 的 `activeTasks`/`listeners`,settle/rewrite 的任务 runner 同理),多实例会导致订阅者收不到事件、任务重复执行。多实例演进(Redis pub/sub)是公开期之后的独立课题。
3. **SSE 路由必须关闭代理缓冲并放宽读超时**(见 §5),否则流式叙事表现为"卡住不动直到一次性全部吐出"或中途断流。

### 0.1 本目录文件清单

| 文件 | 用途 | 安放位置(服务器) |
|---|---|---|
| `build-and-ship.sh` | 本机/CI:standalone 构建 + rsync 上船 + 重启 | 不上服务器,在构建机运行 |
| `genesis.service` | systemd 单进程单元 | `/etc/systemd/system/genesis.service` |
| `nginx.conf` | nginx server 块(SSE/body 上限已配) | `/etc/nginx/sites-available/genesis.conf` |
| `backup.sh` | nightly `pg_dump -Fc` + 7 日轮换 + 异地占位 | `/srv/genesis/bin/backup.sh` |
| `restore.sh` | 恢复/恢复演练脚本 | `/srv/genesis/bin/restore.sh` |
| `cleanup-llmcalls.sql` | 月度清理 90 天前 `llm_calls` | `/srv/genesis/bin/cleanup-llmcalls.sql` |

> 服务器上没有仓库。下文出现的 `deploy/xxx` 文件先从构建机 `scp` 到服务器再 `cp` 到目标位置。

### 0.2 上线前置事项

- **iconify 预编译(设计 §7 阻塞项,已落地)**:`svg.server.ts` 正常路径只读构建期抽取的子集 `src/lib/icons/icon-subset.generated.json`(由 `pnpm build:icons` 生成);四个全量图标集 JSON(合计约 14MB)经 `next.config.ts` 的 `serverExternalPackages` 外置,不进服务端包(实测 standalone 产物 43M→30M)。注意:**全量集合的 `createRequire` 兜底是开发期专用**——standalone 产物里没有 `@iconify-json/*`,子集过期在生产会直接抛 MODULE_NOT_FOUND。因此 `build-and-ship.sh` 在每次 build 前强制重跑 `pnpm build:icons`,保证子集与目录同步。
- **多人化 Phase A 尚未落地**:当前代码单用户(`user_id` 恒为 `"local"`),无登录。本手册的 nginx/systemd/备份配置与 Phase A 无耦合,可先行部署;但**在无鉴权状态下切勿把站点暴露到公网**——至少加 nginx basic auth 或 IP 白名单(nginx.conf 中已留注释位)。

## 1. 服务器初始化(一次性)

```bash
# 1) Node 22 LTS(package.json engines: ^20.19.0 || >=22.12.0)
#    以 NodeSource 为例;任何方式装到 /usr/bin/node 均可
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs nginx postgresql-16 postgresql-client-16

# 2) 专用用户与目录
sudo useradd --system --create-home --home-dir /srv/genesis --shell /usr/sbin/nologin genesis
sudo mkdir -p /srv/genesis/app /srv/genesis/bin /srv/genesis/backups
sudo chown -R genesis:genesis /srv/genesis

# 3) 数据库与账号(本机访问,不监听公网)
#    --createdb 供 restore.sh --drill 建/删一次性演练库使用
sudo -u postgres createuser --createdb genesis
sudo -u postgres createdb -O genesis genesis
sudo -u postgres psql -c "ALTER USER genesis WITH PASSWORD '<强密码>';"

# 4) 环境变量文件(权限 640,属主 root:genesis)
sudo mkdir -p /etc/genesis
sudo tee /etc/genesis/genesis.env >/dev/null <<'EOF'
NODE_ENV=production
HOSTNAME=127.0.0.1
PORT=3000
# connection_limit=5 为设计裁决口径(见 §3 说明)
DATABASE_URL=postgresql://genesis:<强密码>@localhost:5432/genesis?connection_limit=5
# 32 字节 hex(64 个 hex 字符),生成:node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 丢失即全部已存 API Key 不可解密,请与备份一起异地保存一份
SECRET_KEY=<64位hex>
EOF
sudo chown root:genesis /etc/genesis/genesis.env
sudo chmod 640 /etc/genesis/genesis.env
```

环境变量就这两项是硬需求:`DATABASE_URL`(`src/lib/db.ts`)与 `SECRET_KEY`(`src/lib/crypto.ts`,缺失或为 `replace-me` 时保存 API Key 直接抛错)。`HOSTNAME=127.0.0.1` 让 Node 只监听本机,由 nginx 对外。

## 2. 构建与上船(在构建机,不在服务器)

`next.config.ts` 已启用 `output: "standalone"`:`next build` 会产出 `.next/standalone` 自包含目录(内含裁剪过的 `node_modules` 与 `server.js`),服务器上**无需** pnpm/依赖安装,`node server.js` 即起。注意 standalone 默认不含 `public/` 与 `.next/static`,必须手工拷入——`build-and-ship.sh` 已处理。

```bash
# 在构建机(本机 WSL/Git Bash 或 CI;Windows 原生 shell 不适用本脚本)
cd <仓库根目录>
SERVER=deploy@your-server.example.com bash deploy/build-and-ship.sh
```

脚本流程:`pnpm install --frozen-lockfile` + `prisma generate` + `build:icons` → `pnpm build` → 组装产物目录(standalone + public + static,并**剥离随构建复制进产物的本地 `.env`**——生产环境变量只来自 `/etc/genesis/genesis.env`,dev 库连接串与密钥绝不上船)→ `rsync --delete` 到 `/srv/genesis/app` 并重启 systemd 单元。首次部署前先完成 §1、§4、§5,且先跑一次数据库迁移(§6)。

## 3. Postgres 同机调优

2GB 内存里 Postgres 只能分到小头。编辑 `postgresql.conf`(Debian 系在 `/etc/postgresql/16/main/`):

```conf
max_connections = 20
shared_buffers = 256MB
```

改完 `sudo systemctl restart postgresql`。

口径解释(设计 §7 裁决):

- 应用侧连接池上限 5(`DATABASE_URL` 带 `connection_limit=5`,并由 PrismaPg 显式 `max: 5`)。**现状差距**:`src/lib/db.ts` 目前只把 `connectionString` 传给 `PrismaPg`,未显式传 `max: 5`——node-postgres 连接池默认上限 10,且不识别 `connection_limit` 查询参数(该参数是 Prisma 原生连接串约定,在 pg 驱动下仅作文档性标注)。补 `max: 5` 属代码改动,归多人化 A3 泳道;在补齐前,实际池上限为 10,`max_connections=20` 仍然覆盖(10 应用 + pg_dump/psql/运维余量)。
- `max_connections=20` 刻意压低:每连接有内存开销,且能在应用连接泄漏时尽早暴露问题而不是拖垮整机。

## 4. systemd 单进程

```bash
sudo cp deploy/genesis.service /etc/systemd/system/genesis.service
sudo systemctl daemon-reload
sudo systemctl enable --now genesis
systemctl status genesis --no-pager
journalctl -u genesis -f        # 跟日志
```

要点(详见 `genesis.service` 内注释):

- `ExecStart=/usr/bin/node server.js`,工作目录 `/srv/genesis/app`,环境来自 `/etc/genesis/genesis.env`;
- **单实例约束落在这里**:一个 unit、`Type=simple`、不开模板实例;
- `MemoryHigh=1024M` / `MemoryMax=1280M`:2GB 盒子上给 Node 的安全水位(其余留给 Postgres 与系统)。触顶被杀会由 `Restart=always` 拉起;若 journal 频繁出现 oom-kill,先查是否有路由意外加载了全量图标集(目录漂移走了 `createRequire` 兜底,见 §0.2),再考虑调上限;
- 基础加固:`NoNewPrivileges`、`ProtectSystem=strict`(仅放行需要写的路径)、`PrivateTmp`。

## 5. nginx:SSE、body 上限、静态直出

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/genesis.conf
# 按文件头注释替换 server_name 与证书路径占位符
sudo ln -s /etc/nginx/sites-available/genesis.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

配置里三块与本项目强相关,改动前先理解:

1. **SSE 路由**(5 个,与代码一一对应,新增流式端点时必须同步这份正则):

   | 端点 | 方法 | 代码位置 |
   |---|---|---|
   | `/api/chat` | POST | `src/app/api/chat/route.ts`(narratorSSE) |
   | `/api/messages/{id}/variants` | POST | `src/app/api/messages/[id]/variants/route.ts` |
   | `/api/chapters/{id}/settle` | POST | `src/app/api/chapters/[id]/settle/route.ts` |
   | `/api/genesis/tasks/{id}/events` | GET | `src/app/api/genesis/tasks/[id]/events/route.ts` |
   | `/api/rewrites/{id}/events` | GET | `src/app/api/rewrites/[id]/events/route.ts` |

   对它们:`proxy_buffering off` + `proxy_read_timeout 900s`(设计要求 ≥600s;应用侧叙事流有约 100s 间隔的心跳,900s 足够宽裕)。应用已自带 `X-Accel-Buffering: no` 响应头,nginx 会尊重它,但显式关缓冲是双保险——不要依赖单边。

2. **请求体上限**:全局 `client_max_body_size 1m`;仅 `/api/worlds/import` 放宽到 `10m`(应用层在 `src/app/api/worlds/import/route.ts` 自带 10MB 硬限,nginx 与其对齐,双层防线)。

3. **静态直出**:`/_next/static`(内容寻址,一年 immutable 缓存)与 `/images`(public 目录)由 nginx 从 `/srv/genesis/app` 磁盘直出,不过 Node,省 CPU 省内存。

## 6. 数据库迁移

迁移在**构建机**执行(服务器上没有 prisma CLI——standalone 产物不含它,也不该为跑迁移在 2GB 盒子上装全套 node_modules):

```bash
# SSH 隧道把服务器上仅监听本机的 Postgres 映射到本地 15432
ssh -f -o ExitOnForwardFailure=yes -L 15432:localhost:5432 deploy@your-server sleep 120
DATABASE_URL="postgresql://genesis:<强密码>@localhost:15432/genesis" pnpm exec prisma migrate deploy
```

顺序纪律:**先迁移,后上新产物**(`prisma migrate deploy` 只追加执行 `prisma/migrations/` 中未应用的迁移,可重复执行)。`build-and-ship.sh` 中留有对应的注释段落。

## 7. 备份、恢复与数据清理

世界数据是用户不可再生的创作资产,是全清单唯一不可逆的损失面。备份纪律不可省。

### 7.1 nightly 备份 + 7 日轮换 + 异地

```bash
sudo cp deploy/backup.sh deploy/restore.sh deploy/cleanup-llmcalls.sql /srv/genesis/bin/
sudo chown genesis:genesis /srv/genesis/bin/*
sudo chmod 750 /srv/genesis/bin/*.sh

# genesis 用户的 crontab(sudo crontab -u genesis -e)
30 3 * * * /srv/genesis/bin/backup.sh >> /srv/genesis/backups/backup.log 2>&1
20 4 1 * * psql "$(grep '^DATABASE_URL=' /etc/genesis/genesis.env | cut -d= -f2- | cut -d'?' -f1)" -f /srv/genesis/bin/cleanup-llmcalls.sql >> /srv/genesis/backups/cleanup.log 2>&1
```

- `backup.sh`:`pg_dump -Fc`(自定义压缩格式,支持 `pg_restore` 选择性恢复)到 `/srv/genesis/backups/`,自动删除 7 天前的本地备份,**并把最新一份推到异地**(脚本内 rclone/rsync 占位,必须配置——同机备份挡不住整机丢失);
- `cleanup-llmcalls.sql`:月度删除 90 天前的 `llm_calls` 行(观测数据,可再生;`created_at` 有索引,删除后 `VACUUM ANALYZE`)。**除 `llm_calls` 外任何表都不做定期清理**。

### 7.2 恢复与上线前恢复演练(必做)

```bash
# 演练:恢复到临时库并做基本核对,不触碰生产库
/srv/genesis/bin/restore.sh --drill /srv/genesis/backups/genesis-<最新>.dump

# 真恢复(危险,覆盖生产库;脚本内有二次确认)
sudo systemctl stop genesis
/srv/genesis/bin/restore.sh --into genesis /srv/genesis/backups/genesis-<时间点>.dump
sudo systemctl start genesis
```

演练脚本会把 dump 恢复进一次性的 `genesis_restore_drill` 库,输出 `worlds/timelines/messages` 行数供人工核对,结束后删库。**上线前至少完整走一次演练**;此后建议每月随备份抽查一次。

## 8. 上线检查清单

- [ ] `next build` 在构建机完成,服务器上从未跑过 build;
- [ ] `systemctl status genesis` Active,`journalctl -u genesis` 无 SECRET_KEY/DATABASE_URL 报错;
- [ ] `curl -N` 一次 `/api/genesis/tasks/<id>/events`(或实际开一局)确认 SSE 逐条到达而非整块吐出;
- [ ] 导入一个 >1MB 的世界存档确认 nginx 未拦(`/api/worlds/import` 10m 生效);
- [ ] `psql -c 'show max_connections; show shared_buffers;'` 返回 20 / 256MB;
- [ ] 备份 cron 已产出至少一份 dump,异地推送可见,恢复演练已走通;
- [ ] 站点未裸奔公网(basic auth / IP 白名单,直至多人化 Phase A 落地);
- [ ] 本次构建前跑过 `pnpm build:icons`(`build-and-ship.sh` 已内置),journal 无异常内存水位。
