# 创世

一句话创世的神格 AIRP 网页游戏：说出你的第一句神谕，AI 生成完整世界观（可容纳/融合/魔改任意现有 IP），你将扮演其中一位神，与一整个「活着的」神谱共处一个自行运转的世界。

完整方案见 [docs/](docs/00-总览.md)。

## 本机运行

前置：Node 20+ / pnpm / Docker Desktop。

```bash
# 1. 依赖
pnpm install

# 2. 环境变量
cp .env.example .env
# 编辑 .env：SECRET_KEY 生成方式
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. 数据库（Postgres 16，宿主端口 5433）
docker compose up -d
pnpm prisma migrate dev

# 4. 启动
pnpm dev
```

打开 http://localhost:3000 → 先去「香炉」（/settings）配置你的模型 Key（BYOK，支持 OpenAI 兼容中转站 / Anthropic / Gemini）→ 回到首页说出神谕。

> 国内网络拉取 postgres 镜像失败时，可用镜像源后重打标签：
> `docker pull docker.1ms.run/library/postgres:16-alpine && docker tag docker.1ms.run/library/postgres:16-alpine postgres:16-alpine`

## 技术栈

Next.js 16（App Router）· TypeScript · Tailwind v4 · Prisma 7 + PostgreSQL · Zod · Motion

## 里程碑

- **M1 能玩**：世界生成 + 卡片编辑 + RP 对话 + 状态面板 + BYOK ← 当前
- **M2 有深度**：章节结算 + 诸神回合 + 三层记忆 + 百科 + 迷雾
- **M3 完整**：陨落/余烬 + 时间线分叉 + 模板广场 + ST 导出 + 成书导出
