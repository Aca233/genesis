# 多人化改造设计（设计评估）

日期：2026-07-26
状态：设计评估完成，等待用户复核；本文只批准设计，不代表已授权生产代码改造
范围：账号与会话、数据所有权与隔离、API 边界加固、API Key 与费用策略、滥用配额、2C2G 部署运维
兼容策略：纯增量改造（加表、加列、加外键、加包裹层），零数据丢失，可单事务回滚

## 0. 摘要与建议

四路实证研究（身份假设面 / 数据模型 / 鉴权选型 / 产品运维策略）的一致结论：

- **改造形态是"schema 浅、路由宽"的环绕层工程**：数据层只需加一张 User 表和四个外键;真正的工作量在 API 层——**44 个路由文件今日全部无鉴权**,其中约 2/3(62 处)是仅凭 cuid 不可猜性的裸 id 查询,`GET /api/worlds` 甚至无条件列出全库世界。
- **鉴权选型:better-auth(v1.6 稳定线)**。Auth.js/next-auth v5 至今停留 beta 且已由 Better Auth 团队接管进入维保模式;Clerk 类 SaaS 对大陆用户可用性不可控且无法覆盖本项目的每用户 Key 逻辑;手写 jose 方案是兜底而非首选。
- **费用策略:BYOK-first(玩家自带 Key)**。Settings 表本就按 userId 为主键、AES-256-GCM 信封加密可直接复用;BYOK 把主导运营成本(LLM)天然外部化,Phase A 无需任何配额系统。
- **分两阶段**:Phase A 朋友内测(账号+隔离+BYOK,房主建号,无邮件依赖)≈ 一个专注实施波次(M–L 级);Phase B 公开(频控、配额、上限、可选房主赞助档)延后,且 A 阶段的设计不为 B 预埋一行废代码。
- **与在途工作零冲突**:鉴权全部落在路由入口与新增 `src/lib/auth/**` 模块;wave-2 游戏性改造、时间一致性设计、世界导演设计触碰的 `src/lib/chat/** / settle/** / context/builder.ts` 库层经查全部以 worldId/chapterId 为参、用户无关。唯一交叠点(chat 路由入口一行属主门)建议在 wave-2 落地后合入。

## 1. 现状盘点（实证数字）

### 1.1 数据层：浅

22 个 Prisma 模型中（`prisma/schema.prisma`）：

- **4 个直接持有 userId**（均 `@default("local")`，无 User 表、无外键）：World(:16)、GenesisTask(:50)、MaterialCard(:492)、Settings(:541，userId 即主键）。schema 第 2 行注释已预留多用户意图。
- **17 个经外键链继承所有权**：Timeline→World，Chapter→Timeline，Message/God/Entity/Ability/ChronicleEntry/WorldEvent/RealityRewrite… 一律不加列，查询用关系遍历 `where: { timeline: { world: { userId } } }`。
- **1 个全局模型 LlmCall**（:551-571）：**没有 userId 列**——成本记账无用户维度，是费用治理的硬缺口。

### 1.2 路由层：宽

44 个 `route.ts` 全部无鉴权，呈两套并行范式：

- **A 模式**（约 1/3，已按 userId 过滤,写死 `"local"`）：settings、materials、genesis tasks、rewrites、export、materials/archive——共约 40 处字面量分布在 20 个文件（另有 4 处 create 依赖 schema 默认值隐式写入）。
- **B 模式**（约 2/3，62 处裸 id 查询、无任何用户条件）：worlds 全家、chat、settle、messages、abilities、codex、chronicle、icons、observer、realities 等。最严重：`GET /api/worlds`(worlds/route.ts:117) 无条件 findMany。

### 1.3 四个必须专项修复的真实漏洞

1. **chat 路由不校验章节属主**（chat/route.ts:65-77）——任何登录用户可向他人世界注入回合并消耗其 Key；
2. **worlds 列表完全无过滤**（worlds/route.ts:117）；
3. **settings/test 可动用已存 Key 试连**（settings/test/route.ts:23-30）——花别人钱的代理端点；
4. **两个后台 task-runner 写死身份**（genesis/task-runner.ts:22、reality/task-runner.ts:29 的 `const USER_ID = "local"`）——断点恢复的任务会以错误身份解析他人 Key。

### 1.4 客户端：零侵入

全部裸相对路径 `fetch("/api/...")`，无全局用户态、无 zustand 全局 store；SSE 消费用 EventSource（无法自定义 header）与 fetch 读流。**cookie 会话对现有全部调用零改动生效**。

## 2. 账号与会话

### 2.1 选型：better-auth（裁决）

| 候选 | 裁决 | 依据 |
|---|---|---|
| **better-auth 1.6.x** | ✅ 采用 | 活跃维护、Auth.js 官方继任者、Next 16 捆绑文档推荐并附 proxy.ts 示例；`@better-auth/prisma-adapter` 支持 Prisma 7；cookie+DB 会话（可吊销、SSE 天然兼容）；scrypt 密码哈希（node:crypto，零额外服务）；内建限流；`disableSignUp` + admin 插件恰好覆盖无邮件的朋友阶段 |
| Auth.js / next-auth v5 | ❌ | 至今 beta；2025-09 起由 Better Auth 团队接管、进入 security-patch 模式，官方指引新项目使用 Better Auth |
| iron-session / jose 手写 | 保留为兜底 | 依赖最轻但会话吊销、限流、账号管理全要自写安全代码；better-auth 的 cookie+DB session 模型可被其原位替换，迁移面只有 DAL 一个模块 |
| Clerk / SaaS | ❌ | 大陆可用性不可控（无接入点/ICP，结构性风险确凿）；按 MAU 计费；无法覆盖 per-user Key 逻辑，引入后 data-scoping 一样要做 |

### 2.2 接线（三层）

```ts
// 1) src/lib/auth/index.ts —— 实例
export const auth = betterAuth({
  database: prismaAdapter(prisma),
  emailAndPassword: { enabled: true, disableSignUp: true }, // 朋友阶段关闭自助注册
  plugins: [admin()],                                        // 房主建号/重置密码/封禁
});
// 2) src/app/api/auth/[...all]/route.ts —— 一行挂载
export const { GET, POST } = toNextJsHandler(auth);
// 3) src/lib/auth/session.ts —— DAL（真正的防线）
export const requireUserId = cache(async (): Promise<string> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError(); // 统一映射 401 JSON
  return session.user.id;
});
```

**关键约束（Next 16.2 实证）**：中间件文件是 `src/proxy.ts` 而非 middleware.ts（v16 起改名，Node runtime）；官方立场是 proxy 只做"乐观检查"（仅解 cookie、禁查库），**真正的安全检查放路由内 DAL**。`unauthorized()/forbidden()` 属 canary 实验特性，不用。

- `src/proxy.ts`：仅做未登录页面导航重定向到 /login，matcher 排除 `/api`；
- 44 条业务路由**不写 44 份检查**：每个 handler 本来就需要 userId 做租户过滤，把 `where: { userId: "local" }` 换成 `const userId = await requireUserId()` 的**同一行编辑同时完成鉴权与隔离**；
- SSE 四类端点（chat POST 流 / settle POST 流 / genesis events GET / rewrites events GET）：连接建立时验证一次会话+属主即可，长连接期间会话过期可接受（写入侧受下次请求校验）；cookie 随 fetch/EventSource 同源自动携带，零改动。

### 2.3 朋友阶段注册与找回（无邮件基础设施）

- 注册：`disableSignUp: true` + admin 插件 `createUser`——**房主建号**（邮箱+初始密码带外分发），首登后自改密码；
- 找回：房主 `setUserPassword` 直接重置；`requestPasswordReset` 不配置邮件回调即自动不可用，无悬空攻击面；
- 未来自助邀请码：`hooks.before` 拦截 sign-up 校验自建 InviteCode 表——增量配置，无需换库。

### 2.4 测试兼容

现有路由测试全部 `vi.mock('@/lib/db')` 后直接调 handler。DAL 单模块设计下，每个测试只需追加一行 `vi.mock('@/lib/auth/session', ...mockResolvedValue('test-user'))`，约 40 组既有测试机械替换 `"local"` → `"test-user"`，不重写测试架构。

## 3. 数据模型与隔离

### 3.1 迁移（单事务，零丢失，可回滚）

```text
1. better-auth CLI 生成 4 张新表（user/session/account/verification）
2. 插入房主 User
3. 单事务:UPDATE World/GenesisTask/MaterialCard/Settings SET user_id = <房主id> WHERE user_id = 'local'
4. 四列加外键约束、删除 @default("local")   ← 让漏传 userId 的写入报错而非静默归入幽灵租户
5. LlmCall 增加可空 user_id 列 + @@index([userId, createdAt])（worldId 顺手可加）
```

### 3.2 查询隔离策略（三选一的裁决）

**采用 (a) 路由边界显式所有权门**：一组约 8 个共享助手——`requireWorld(userId,id)`、`requireChapter`（chapter→timeline→world.userId）、`requireMessage`、`requireAbility`、`requireEntity`…（Prisma 关系过滤一行表达）。工作量精确为 62 处裸查询 + 约 10 处列表/创建点。

否决 (b) `$extends` 自动注入——会被代码库广泛使用的结构化事务类型（abilities/mutations.ts:94-104 等）静默绕过；否决 (c) Postgres RLS——要求每查询事务化 SET LOCAL，反而触碰全部 130 个生产调用点且不适合 2C2G。辅助防线：仅 dev/test 启用的 `$extends` 断言守卫（对四个属主模型的查询缺 userId 即抛错），生产无隐式魔法。

### 3.3 唯一约束修复（仅 3 处）

1. `RealityRewrite.idempotencyKey` 全局 @unique(:338) → `@@unique([worldId, idempotencyKey])`——堵跨租户占坑/存在性探测；
2. `AbilityEvent.dedupeKey` 全局 @unique(:401) → `@@unique([abilityId, dedupeKey])`；
3. `GenerationRequest.id`（客户端自选主键 :127）：chat 路由先过章节属主门，行查找收窄为 `{ id, chapterId }`，跨用户撞键统一表现为 409。
其余 @@unique（含 MaterialCard.sourceRef，已按用户作用域）经查天然安全。

### 3.4 后台任务的身份来源

genesis/settle/rewrite runner 在浏览器断开、崩溃恢复后**没有请求上下文**——身份必须来自任务行：GenesisTask.userId 列已存在；RealityRewrite 经 world.userId；chat/settle 经 chapter→timeline→world.userId。两个 `const USER_ID = "local"` 常量改为从任务行读取。

## 4. API 边界加固

- 覆盖面 = **全部 44 个路由**（读 15 / 写 22 / 服务端代理 2 / auth 挂载新增），不只是带 "local" 的那批；
- `settings/test` 与 `settings/models` 是花 Key 的代理端点，与 settings 同级鉴权；
- 世界导入导出：import(:1528) 改为显式归属当前登录用户——这同时是好友间分享存档的天然通道（A 导出 → B 导入即复制到 B 名下）；
- 请求体积防线不逐路由铺开：nginx `client_max_body_size` 全局 1MB、`/api/worlds/import` 单独放宽 10MB。

## 5. API Key 与费用策略

**BYOK-first**：每用户一行 Settings、槽位密文（AES-256-GCM）、掩码读取全部复用；LLM 成本天然按用户隔离，房主不再为访客买单。

**命门改动（唯一的结构性变更）**：`gateway.resolveSlot`(gateway.ts:35) 是全部 LLM 调用解析 Key 的单一咽喉，但签名不含用户——扩一个显式 `userId` 参数，10 个入口点随之传参（请求路径从会话取，后台 runner 从任务行取）。**建议此变更作为先行小 PR 在 wave-2 大量改动 chat/settle 之前合入**，把 merge 冲突面压到最小。

安全声明：单一服务器级 SECRET_KEY 仍是信封密钥——泄露即全体用户密钥泄露，属已知单点，Phase A 可接受，Phase B 前评估 HKDF(SECRET_KEY, userId) 派生或轮换。

共享 Key + 配额（房主赞助档）**整体推迟到 Phase B**：需要单价表、预算检查、聚合展示一整套子系统。Phase A 唯一要做的是给 LlmCall 加 userId 列，让归属数据从第一天就开始积累。`/api/settings/cache-stats` 改为按当前用户过滤（现在向任何访问者展示全库统计）。

## 6. 滥用与配额（Phase B 专属）

朋友互信 + BYOK 成本自担 + 世界租约天然串行化（每世界至多 1 个进行中操作，operation-lock.ts:67-100），使 Phase A 没有真实威胁模型。Phase B 公开时追加：

- turns/hour 内存滑动窗口频控（单进程足够，无需 Redis；better-auth 内建限流覆盖 auth 端点）；
- 每用户世界数上限（3–10）——借世界租约间接封顶并发，最省力的抓手；
- 全局生成并发信号量（进程内计数器，2C2G 建议同时 4–8 路上游流）;
- `POST /api/worlds` 专项频控——创世本身是一次 16k maxTokens 的同步 LLM 调用且不在世界租约保护内，是首要滥用对象；
- ToS 与封禁开关（admin 插件 banUser 已内建）。

## 7. 部署与运维（2C2G）

- **构建**：启用 `output: "standalone"`；**`next build` 峰值内存 1–2GB，与 Postgres 同机的 2GB 盒子会 OOM——必须本机/CI 构建后 rsync 产物上服务器**（或至少 2GB swap 仅供构建期）；
- **进程**：systemd 单进程管理；**禁止 pm2 cluster/多副本**——SSE 事件总线与任务去重依赖模块级内存 Map（chat/task-runner.ts:10-11 等），多实例演进（Redis pub/sub）列为公开期之后的独立课题;
- **nginx**：SSE 路由 `proxy_buffering off` + 读超时 ≥600s;统一 body 上限（§4）;
- **Postgres 同机**：`DATABASE_URL` 加 `connection_limit=5`（PrismaPg 显式 max: 5），Postgres `max_connections≈20`、`shared_buffers≈256MB`;
- **备份**：nightly `pg_dump -Fc` + 7 日轮换 + 异地一份（世界数据是用户不可再生的创作资产,全清单唯一不可逆损失面）,上线前做一次恢复演练;月度清理 90 天前 LlmCall;
- **部署前阻塞项:iconify 急切解析**——实测 14.2MB JSON（game-icons 6.46 + ph 4.57 + tabler 2.12 + icon-park 1.01）全量进堆,而目录只需 ~500 枚图标:构建期抽取生成 <1MB 预编译 JSON,运行时只加载它。resolveIcon/目录版本化语义不变,可独立于 auth 改造并行做。

## 8. 与既有路线的关系

- **wave-2 游戏性**（chat/settle/builder）:库层以 worldId/chapterId 为参、用户无关,鉴权外圈分层成立;唯一交叠是 chat/route.ts 入口一次属主门插入,**在 wave-2 落地后合入**;gateway userId 签名变更作为先行小 PR;
- **时间一致性设计**（同日修订版）与**世界导演设计**:均在 timeline/world 作用域内运作,继承所有权模型后无需感知 userId,零冲突;
- 隐私模型:世界默认私有、仅属主可见,是 scoping 做对之后的自然结果,零额外建模。分享链接/旁观模式明确列为范围外,不预埋字段。

## 9. 分阶段实施建议

| 阶段 | 内容 | 规模 |
|---|---|---|
| **A0 先行小 PR** | gateway.resolveSlot 加 userId 参数(10 入口点)+ LlmCall.userId 列 | S |
| **A1 账号基座** | better-auth 接入(4 张表、[...all] 路由、proxy.ts、requireUserId DAL、登录页、401 统一处理) | M |
| **A2 隔离改造** | 40 处 "local" 替换 + 62 处裸查询加所有权门(8 个 helper)+ 3 处唯一约束修复 + 2 个 task-runner 身份来源 + 4 漏洞专项 + 存量数据迁移 + ~40 组测试更新 | L |
| **A3 部署** | iconify 预编译、standalone 构建流程、systemd/nginx/Postgres 调优、备份 cron + 恢复演练 | M |
| **B 公开加固** | 频控、世界数上限、并发信号量、创世频控、可选赞助档、封禁 | M-L(另行批准) |

A0→A1→A2 依序,A3 与 A1/A2 可并行。Phase A 总量约等于一次 wave-1 规模的专注实施波次。

## 10. 风险与开放问题

1. better-auth 1.x→2.x 未来大版本(1.7 已 RC):API 面被 DAL 单点封装,升级冲击隔离在 src/lib/auth/** 内;
2. SECRET_KEY 单点(§5)——Phase B 前评估;
3. localStorage 设备偏好(主题、AI 建议开关)跨账号残留:美观级问题,建议后续把 chuangshi:ai-suggestions 收敛为仅 Settings.prefs;
4. Clerk 大陆封锁状态为唯一未决证据项(低置信度,不影响裁决);
5. 多实例水平扩展被内存事件总线锁死——显式声明单实例约束,公开期后另行立项。
