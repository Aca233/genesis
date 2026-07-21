# 大模型厂商 Prompt Cache 优化设计

**日期：** 2026-07-21  
**状态：** 待用户书面规格复核  
**范围：** OpenAI 兼容协议、Anthropic、Gemini；创世、正文、章末结算、卡片重掷与修复；香炉缓存统计

## 1. 目标

提高厂商侧 Prompt Cache 的实际命中率，降低重复输入 Token 的计费与首 Token 延迟，同时保持模型每次重新推理，不复用历史答案。

验收目标：

1. 创世、正文、章末结算、卡片重掷及其既有修复请求均使用稳定前缀和动态后缀。
2. OpenAI 兼容协议主动发送缓存路由参数；不支持扩展字段的中转站自动去参重试，并在当前进程记住端点能力。
3. Anthropic 使用原生 `cache_control` 缓存断点。
4. Gemini 使用稳定前缀促进隐式缓存，并读取缓存命中用量；本期不创建显式 CachedContent 对象。
5. 正常成功路径不增加模型调用；只有端点明确拒绝缓存扩展字段时发生一次兼容回退请求。
6. 香炉页能看到最近 24 小时、累计、按任务分类的缓存读取、写入及输入 Token 命中率。
7. 连接测试与短请求不启用 Prompt Cache。
8. 不实现本地答案缓存，不因缓存返回旧创世或旧剧情。

## 2. 非目标

- 不缓存模型输出结果。
- 不改变模型选择、温度、最大输出 Token 或重试次数。
- 不为 Gemini 创建、续期或删除显式 `cachedContents`。
- 不根据厂商价格表计算人民币或美元节省金额；不同模型和中转站折扣不一致。
- 不记录提示词正文、缓存键原文或 API Key 到统计表。

## 3. 总体架构

新增三个边界清晰的内部能力：

1. **缓存规划器**：根据任务、消息稳定性与长度生成协议无关的 `PromptCachePlan`。
2. **协议适配与用量归一化**：各 Adapter 把计划转换为厂商字段，并把响应中的 Usage 转为统一结构。
3. **统计聚合**：Gateway 将统一 Usage 与兼容回退结果写入 `LlmCall`；设置页通过只读 API 聚合展示。

调用链：

```text
业务调用
  -> CompletionRequest(messages + cache plan)
  -> LLM Gateway
  -> Provider Adapter
       OpenAI: prompt_cache_key + stream usage
       Anthropic: system/content cache_control blocks
       Gemini: stable prefix + implicit cache usage
  -> normalized usage
  -> LlmCall
  -> /api/settings/cache-stats
  -> 香炉缓存统计
```

业务层只声明哪些消息属于稳定前缀，不直接拼厂商字段。厂商兼容细节集中在 `src/lib/llm`，防止散落到创世、正文和结算代码中。

## 4. 协议无关缓存契约

### 4.1 消息稳定性

扩展内部消息类型，允许标记：

```ts
type PromptCacheScope = "global" | "world" | "dynamic";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  cacheScope?: PromptCacheScope;
};
```

语义：

- `global`：跨世界稳定，例如叙事者总规则、创世 JSON Schema、章末输出 Schema。
- `world`：同一世界内较稳定，例如宇宙论、主题卡、固定世界书、稳定角色设定。
- `dynamic`：本章正文、当前状态、玩家输入、素材选择、无效输出及修复错误。

不允许把 `dynamic` 消息放在 `global/world` 前面后再期待后续稳定内容命中。缓存规划器会把第一个动态消息之后的全部内容视为动态后缀。

### 4.2 缓存计划

`CompletionRequest` 增加内部可选字段：

```ts
type PromptCachePlan = {
  enabled: boolean;
  namespace: string;
  breakpoints: number[];
};
```

- `namespace` 是低基数业务命名，如 `genesis:v1`、`narrative:<worldId>:v1`、`settlement:v1`、`reroll:v1`。
- Gateway 对 `provider + normalizedBaseUrl + model + namespace + stable-prefix fingerprint` 做 SHA-256，生成不含用户正文的缓存路由键。
- `breakpoints` 指消息结束位置；用于 Anthropic 的显式断点，也用于测试稳定前缀是否排列正确。
- 缓存键不包含随机 UUID、时间戳、章节 ID、玩家本回合输入或完整动态正文。

### 4.3 启用条件

仅以下任务启用：

- `genesis`
- `narrative`
- `settlement`
- `reroll`
- 这些流程内部既有的结构/引用/素材修复请求

`test` 永不启用。规划器在稳定前缀不足 4,000 个 UTF-16 字符时不发送主动缓存参数，避免对明显低于多数厂商最低缓存门槛的请求制造噪声。该阈值只控制主动提示；厂商若自动缓存整个请求，系统不阻止。

## 5. 提示词排列与缓存边界

### 5.1 创世

排列：

1. `GENESIS_SYSTEM` 与自动生成的 WorldDeck JSON Schema：`global`
2. 权威世界书摘录：`world`（仅该次创世稳定）
3. 原初神谕、冻结素材块：`dynamic`
4. 生成指令：`dynamic`

修复请求保持同一个 System 前缀和缓存命名空间；验证错误、无效输出放在最后。网络重试复用同一缓存键。

### 5.2 正文叙事

排列：

1. 叙事者固定规则：`global`
2. 世界主题、宇宙论、长期固定设定：`world`
3. 当前相关实体、能力、编年史、正文窗口：`dynamic`
4. 玩家输入或导演续写指令：`dynamic`

只对真实稳定前缀设置断点。会随章变化的实体卡或能力状态不标记为 `world`，避免低命中缓存写入。

### 5.3 章末结算

排列：

1. 章末结算固定规则与结构化 Schema：`global`
2. 世界固定规则：`world`（若当前调用已单独提供）
3. 当前章节正文、现有实体状态与待结算数据：`dynamic`

现有“一次章末模型调用”约束不变；缓存不拆分结算调用。

### 5.4 卡片重掷与修复

排列：

1. 创世固定 System/Schema：`global`
2. 当前完整卡组、锁定路径、玩家重掷备注：`dynamic`

重掷使用独立任务值 `reroll`，便于统计，不与首次创世混为一类。修复沿用重掷缓存命名空间和稳定 System 前缀。

## 6. 各厂商适配

### 6.1 OpenAI 兼容协议

启用缓存时请求增加：

- `prompt_cache_key`：由 Gateway 生成的稳定哈希键。
- 流式请求增加 `stream_options: { include_usage: true }`，用于读取最终 Usage。

若端点支持缓存保留时长参数，本期不主动发送，避免中转站兼容面扩大。

#### 自动兼容回退

端点首次按“支持缓存扩展”处理。若响应为 400/404/422，且响应体明确包含未知字段、额外字段、`prompt_cache_key`、`stream_options`、`extra_forbidden`、`unknown parameter` 等兼容错误：

1. 立即以完全相同的模型、消息、温度和输出上限重试一次；仅移除缓存扩展字段。
2. 将 `normalizedBaseUrl + model` 标记为当前进程“不支持该扩展组合”。
3. 后续请求直接使用无扩展字段形式，不再支付探测失败。
4. 进程重启后重新探测，使端点升级后可自动恢复缓存能力。

非兼容错误（认证失败、限流、服务错误、内容错误）不得触发去参回退。回退请求属于同一次 Gateway attempt，不得叠加现有三次网络重试为指数级请求。

若端点只拒绝 `stream_options`，能力记忆应支持降级层级：保留 `prompt_cache_key`、移除 Usage 扩展；只有缓存键本身被拒绝时才完全关闭主动缓存参数。

### 6.2 Anthropic

将 System 内容从单一拼接字符串改为文本块数组，在稳定边界末尾添加：

```json
{ "cache_control": { "type": "ephemeral" } }
```

最多设置两个主要断点：

1. 全局规则末尾。
2. 世界级稳定上下文末尾。

动态正文、玩家输入、无效输出与验证错误不加缓存控制。若某中转站的 Anthropic 兼容实现拒绝块式 System 或 `cache_control`，使用与 OpenAI 相同原则的明确字段错误去参回退与进程内能力记忆。

### 6.3 Gemini

- 维持 System Instruction 和 Contents 中的稳定前缀顺序。
- 不创建显式缓存资源，不增加缓存管理 API 调用。
- 从 `usageMetadata.cachedContentTokenCount` 读取隐式缓存命中。
- Gemini 没有返回缓存写入 Token 时，统一统计中的写入值为 `null`，而不是伪造为 0。

## 7. Adapter 与 Gateway 返回契约

Adapter 的非流式结果从裸字符串改为内部结果对象：

```ts
type NormalizedUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

type AdapterCompletionResult = {
  text: string;
  usage: NormalizedUsage;
  cacheRequested: boolean;
  cacheFallback: boolean;
};
```

流式 `StreamChunk` 增加内部 `usage` 类型；Gateway 只向业务调用者转发 `text` 和既有 `done`，同时截留 Usage 写日志。现有业务层 API 不需要理解厂商 Usage。

统一口径：

- `inputTokens`：完整逻辑 Prompt Token。
- OpenAI：`prompt_tokens`；读取缓存为 `prompt_tokens_details.cached_tokens`。
- Anthropic：`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`；读取与写入分别取对应字段。
- Gemini：`promptTokenCount`；读取取 `cachedContentTokenCount`。
- 厂商未提供的字段为 `null`。

缓存输入命中率：

```text
cacheReadTokens / inputTokens
```

聚合时只统计两者都非空且 `inputTokens > 0` 的调用。不能把 `null` 当成 0 后声称“未命中”。

## 8. 数据模型与统计 API

扩展 `LlmCall`：

```prisma
provider          String?
model             String?
inputTokens       Int?     @map("input_tokens")
outputTokens      Int?     @map("output_tokens")
cacheReadTokens   Int?     @map("cache_read_tokens")
cacheWriteTokens  Int?     @map("cache_write_tokens")
cacheRequested    Boolean  @default(false) @map("cache_requested")
cacheFallback     Boolean  @default(false) @map("cache_fallback")
```

不修改旧日志；旧行字段保持空值/默认值。

新增 `GET /api/settings/cache-stats`，返回：

```ts
type CacheStatsResponse = {
  last24Hours: CacheAggregate;
  allTime: CacheAggregate;
  byTask: Array<{ task: string } & CacheAggregate>;
  recent: CacheCallSummary[];
};
```

聚合字段：调用数、带可用 Usage 的调用数、输入、输出、缓存读取、缓存写入、命中率、兼容回退次数。查询只返回数字、任务、协议、模型、时间和成功状态，不返回错误全文或 Prompt。

## 9. 香炉页面

在两个模型槽位下方增加“Prompt Cache”统计卡：

- 明确说明“缓存的是输入前缀，不是答案”。
- 最近 24 小时：命中 Token、总输入 Token、命中率、写入 Token。
- 累计数据：同上。
- 按任务：创世、正文、章末、重掷。
- 兼容回退提示：例如“OpenAI 中转端点已自动关闭不支持的缓存参数”。
- 最近调用列表显示协议、模型、任务、缓存读取/输入 Token、是否回退。
- Usage 不可用时显示“端点未返回用量”，不显示 0% 命中。

统计加载失败不影响槽位编辑、保存或连接测试。

## 10. 错误处理与安全

- 缓存参数不兼容只允许一次去参回退；回退失败走既有错误与重试规则。
- AbortSignal 必须传给探测请求与回退请求；玩家中止后不再回退。
- 缓存键只含哈希，不含原始神谕、正文、世界书、隐藏能力或素材内容。
- `LlmCall.error` 继续截断；统计 API 不返回该字段。
- 日志写入失败仍不阻塞模型响应。
- Usage 字段使用安全非负整数解析；异常或超范围值记为 `null`。

## 11. 测试策略

### 单元测试

1. 缓存规划器：稳定前缀、首个动态边界、短前缀禁用、键稳定性、动态内容不进入键。
2. OpenAI Payload：缓存键、流式 Usage、Usage 归一化。
3. OpenAI 回退：只对明确字段错误去参；能力分级记忆；认证/限流不误回退；Abort 不回退。
4. Anthropic Payload：两个断点、动态块无标记、Usage 归一化、兼容回退。
5. Gemini Usage：缓存读取与不可用字段的 `null` 语义。
6. Gateway：流式与非流式均记录 Usage、provider/model、cacheRequested/cacheFallback。
7. 统计聚合：24 小时、累计、按任务、`null` 不计入命中率。
8. 设置页纯状态/格式化测试：不可用 Usage、0 Token、回退提示。

### 集成与回归

1. Prisma 迁移真实应用，旧 `LlmCall` 仍可查询。
2. 缓存统计 API 对真实 PostgreSQL 聚合正确。
3. 创世有效首轮仍只有一次正常模型请求；缓存功能不拆分素材调用。
4. 章末仍只有一次模型调用。
5. 完整单元、集成、TypeScript、ESLint、Next build 通过。

## 12. 实施边界

预计修改：

- `src/lib/llm/types.ts`
- `src/lib/llm/cache.ts`（新）
- `src/lib/llm/adapters.ts`
- `src/lib/llm/gateway.ts`
- `src/lib/context/builder.ts`
- `src/lib/prompts/*` 及高价值调用点
- `prisma/schema.prisma` 与新迁移
- `src/app/api/settings/cache-stats/route.ts`（新）
- `src/app/settings/page.tsx`
- 对应单元与集成测试

不得引入厂商 SDK；继续使用当前轻量 Fetch 适配层。
