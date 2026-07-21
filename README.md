# 创世

一句话创世的神格 AIRP 网页游戏：说出你的第一句神谕，AI 生成完整世界观（可容纳/融合/魔改任意现有 IP），你将扮演其中一位神，与一整个「活着的」神谱共处一个自行运转的世界。

完整方案见 [docs/](docs/00-总览.md)。

## 当前核心能力

- **结构化能力谱**：种族拥有 2–5 项先天能力或族群技艺；玩家神与每位主神拥有 3–6 项神权；创世同时生成 6–12 位主要人物及其个人技能、主种族和势力关系。
- **继承而非复制**：人物默认继承主种族的先天能力；族群技艺不会自动掌握，必须在创世卡中明确引用，或在后续正文中有确切的学习依据。先天能力的强化、受损、封印或失去以人物覆写记录表达。
- **迷雾与沿革**：玩家神可查看自己的全部神权；其他神明、人物与种族能力按已知、传闻、隐藏三层投影。隐藏项由服务端过滤，剧情中的发动、调查或确认可令其渐进揭示。觉醒、习得、精进、变异、受损、封印、恢复、失去和揭示均保留章节、消息、时之仪尺度及正文证据。
- **叙事化裁决**：能力的效果、触发、代价、限制、掌握与状态进入叙事上下文，但不是必胜按钮。游戏没有技能快捷按钮，也没有伤害、法力、冷却或成功率等数值战斗系统。
- **兼容旧世界与存档**：旧世界不会自动补齐能力或主要人物，只在后续剧情明确展现时渐进建档；新版私有存档完整保留能力来源、人物关系与沿革，同时仍可导入旧版存档。
- **章节节奏不变**：同一章可继续多轮对话，只有玩家点击「结束本章」才启动集中结算；AI 只会建议，不会自动翻章。

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
