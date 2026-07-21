# 大模型厂商 Prompt Cache 优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为创世、正文、章末结算、卡片重掷及修复请求启用兼容优先的厂商 Prompt Cache，并在香炉页展示真实缓存 Token 命中统计。

**Architecture:** 业务层只标记消息的 `global/world/dynamic` 稳定性并提供低基数缓存命名空间；`src/lib/llm/cache.ts` 统一计算连续稳定前缀、断点和隐私安全哈希键，各 Provider Adapter 负责协议字段、Usage 归一化及明确字段错误下的一次去参回退。Gateway 截留统一 Usage 写入 `LlmCall`，设置 API 负责 PostgreSQL 聚合，客户端只展示统计数字，不接触 Prompt 或缓存键。

**Tech Stack:** Next.js 16 App Router、TypeScript、Prisma 7/PostgreSQL、原生 Fetch/SSE、React 19、Vitest。

---

## 文件边界

### 新建

- `src/lib/llm/cache.ts`：缓存规划、稳定哈希键、最小前缀门槛和兼容错误识别。
- `src/lib/llm/cache.test.ts`：规划器及错误分类单元测试。
- `src/lib/llm/usage.ts`：安全 Token 解析、三协议 Usage 归一化与聚合口径。
- `src/lib/llm/usage.test.ts`：Usage 归一化测试。
- `src/lib/llm/cache-capabilities.ts`：OpenAI/Anthropic 端点的进程内分级能力记忆。
- `src/lib/llm/cache-capabilities.test.ts`：端点能力降级测试。
- `prisma/migrations/20260721173000_llm_prompt_cache_stats/migration.sql`：调用日志缓存字段。
- `src/lib/llm/cache-stats.ts`：统计查询与纯聚合格式化。
- `src/lib/llm/cache-stats.test.ts`：命中率和 null 语义测试。
- `src/lib/llm/cache-stats.integration.test.ts`：真实 PostgreSQL 聚合测试。
- `src/app/api/settings/cache-stats/route.ts`：香炉只读统计 API。
- `src/app/api/settings/cache-stats/route.test.ts`：路由单元测试。
- `src/components/settings/PromptCacheStats.tsx`：缓存统计卡。
- `src/components/settings/prompt-cache-stats-state.ts`：前端格式化和状态纯逻辑。
- `src/components/settings/prompt-cache-stats-state.test.ts`：前端状态测试。

### 修改

- `src/lib/llm/types.ts`：消息稳定性、缓存计划、统一 Usage、Adapter 结果与流式 Usage chunk。
- `src/lib/llm/adapters.ts`：三协议缓存字段、流式 Usage 和兼容回退。
- `src/lib/llm/adapters.test.ts`：三协议 Payload、Usage、回退和 Abort。
- `src/lib/llm/gateway.ts`：规划缓存、截留 Usage、增强日志。
- `src/lib/llm/gateway.test.ts`：流式/非流式日志和兼容回退记录。
- `src/lib/llm/structured.ts`：稳定 System/世界上下文与动态修复后缀。
- `src/lib/llm/structured.test.ts`：结构修复仍复用稳定前缀。
- `src/lib/prompts/narrator.ts`：拆分固定规则、世界规则和回合动态规则。
- `src/lib/context/builder.ts`：按稳定性构造叙事消息。
- `src/lib/context/builder.test.ts`：稳定消息始终领先动态消息。
- `src/lib/context/sse.ts`：正文请求提供世界缓存命名空间。
- `src/app/api/chat/route.ts`、`src/app/api/messages/[id]/variants/route.ts`：传递世界级缓存命名空间。
- `src/lib/genesis/task-runner.ts`：创世和修复的缓存命名空间与消息标记。
- `src/app/api/worlds/route.ts`：旧创世入口的缓存标记。
- `src/app/api/worlds/[id]/reroll/route.ts`：任务改为 `reroll` 并启用缓存。
- `src/lib/settle/pipeline.ts`：章末固定 System 缓存与命名空间。
- `src/app/settings/page.tsx`：加载并显示缓存统计组件。
- `prisma/schema.prisma`：扩展 `LlmCall`。
- `docs/02-技术架构.md`、`docs/04-Prompt体系.md`：缓存边界、兼容回退和统计口径。

### 实施约束

- 保留当前工作区所有未提交改动，不 reset、stash 或覆盖。
- 正常成功路径不得增加模型请求；明确缓存字段不兼容时只允许一次去参回退。
- 章末仍保持一次模型调用；素材仍不产生额外调用。
- `test` 任务及稳定前缀少于 4,000 字符的请求不发送主动缓存字段。
- 动态消息一旦出现，后面的消息一律不得进入缓存前缀。
- 缓存键只能保存/传输哈希，不记录 Prompt、神谕、正文、世界书或隐藏设定。
- Next.js Route Handler 开发前核对 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`；客户端组件核对 `05-server-and-client-components.md`。
- 本环境命令使用 Windows Node：`cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd ..."`。

---

## Task 1：定义缓存与 Usage 内部契约

**Files:**
- Modify: `src/lib/llm/types.ts`
- Create: `src/lib/llm/usage.ts`
- Test: `src/lib/llm/usage.test.ts`

- [ ] **Step 1：先写失败的 Usage 契约测试**

创建 `src/lib/llm/usage.test.ts`，覆盖安全非负整数、空值和协议口径：

```ts
import { describe, expect, it } from "vitest";
import {
  normalizeAnthropicUsage,
  normalizeGeminiUsage,
  normalizeOpenAiUsage,
} from "./usage";

describe("normalized provider usage", () => {
  it("normalizes OpenAI cached prompt tokens", () => {
    expect(normalizeOpenAiUsage({
      prompt_tokens: 12000,
      completion_tokens: 900,
      prompt_tokens_details: { cached_tokens: 8000 },
    })).toEqual({
      inputTokens: 12000,
      outputTokens: 900,
      cacheReadTokens: 8000,
      cacheWriteTokens: null,
    });
  });

  it("includes Anthropic cache creation and read tokens in logical input", () => {
    expect(normalizeAnthropicUsage({
      input_tokens: 1000,
      output_tokens: 300,
      cache_read_input_tokens: 7000,
      cache_creation_input_tokens: 4000,
    })).toEqual({
      inputTokens: 12000,
      outputTokens: 300,
      cacheReadTokens: 7000,
      cacheWriteTokens: 4000,
    });
  });

  it("keeps unavailable Gemini cache write tokens null", () => {
    expect(normalizeGeminiUsage({
      promptTokenCount: 5000,
      candidatesTokenCount: 450,
      cachedContentTokenCount: 3000,
    })).toEqual({
      inputTokens: 5000,
      outputTokens: 450,
      cacheReadTokens: 3000,
      cacheWriteTokens: null,
    });
  });

  it("rejects negative, fractional and unsafe token counts", () => {
    expect(normalizeOpenAiUsage({ prompt_tokens: -1 })).toMatchObject({ inputTokens: null });
    expect(normalizeGeminiUsage({ promptTokenCount: 1.5 })).toMatchObject({ inputTokens: null });
  });
});
```

- [ ] **Step 2：运行测试并确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/usage.test.ts"
```

Expected: FAIL，`usage.ts` 不存在。

- [ ] **Step 3：扩展内部类型**

在 `src/lib/llm/types.ts` 增加：

```ts
export type PromptCacheScope = "global" | "world" | "dynamic";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  cacheScope?: PromptCacheScope;
};

export type PromptCacheRequest = {
  namespace: string;
};

export type NormalizedUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

export type AdapterCompletionResult = {
  text: string;
  usage: NormalizedUsage;
  cacheRequested: boolean;
  cacheFallback: boolean;
};

export type CompletionRequest = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  task: LlmTask;
  cache?: PromptCacheRequest;
};

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "usage"; usage: NormalizedUsage; cacheRequested: boolean; cacheFallback: boolean }
  | { type: "done" };
```

给 `LlmTask` 增加 `"reroll"`。

- [ ] **Step 4：实现 Usage 归一化**

在 `src/lib/llm/usage.ts` 实现不抛错的纯函数：

```ts
import type { NormalizedUsage } from "./types";

function token(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function emptyUsage(): NormalizedUsage {
  return { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null };
}

export function normalizeOpenAiUsage(raw: unknown): NormalizedUsage {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const details = value.prompt_tokens_details && typeof value.prompt_tokens_details === "object"
    ? value.prompt_tokens_details as Record<string, unknown> : {};
  return {
    inputTokens: token(value.prompt_tokens),
    outputTokens: token(value.completion_tokens),
    cacheReadTokens: token(details.cached_tokens),
    cacheWriteTokens: null,
  };
}

export function normalizeAnthropicUsage(raw: unknown): NormalizedUsage {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const uncached = token(value.input_tokens);
  const read = token(value.cache_read_input_tokens);
  const write = token(value.cache_creation_input_tokens);
  const components = [uncached, read, write].filter((item): item is number => item !== null);
  return {
    inputTokens: components.length ? components.reduce((sum, item) => sum + item, 0) : null,
    outputTokens: token(value.output_tokens),
    cacheReadTokens: read,
    cacheWriteTokens: write,
  };
}

export function normalizeGeminiUsage(raw: unknown): NormalizedUsage {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    inputTokens: token(value.promptTokenCount),
    outputTokens: token(value.candidatesTokenCount),
    cacheReadTokens: token(value.cachedContentTokenCount),
    cacheWriteTokens: null,
  };
}
```

- [ ] **Step 5：运行测试和类型检查**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/usage.test.ts && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec tsc --noEmit"
```

Expected: Usage 测试通过；Adapter 返回类型尚未迁移造成的类型错误留到 Task 3 前必须清零。若类型错误阻止本任务提交，则先让 Adapter 用 `AdapterCompletionResult` 包装现有文本并填 `emptyUsage()`，不得提前实现缓存行为。

- [ ] **Step 6：提交**

```bash
git add src/lib/llm/types.ts src/lib/llm/usage.ts src/lib/llm/usage.test.ts src/lib/llm/adapters.ts
git commit -m "feat: define prompt cache usage contracts"
```

---

## Task 2：实现稳定前缀规划与隐私安全缓存键

**Files:**
- Create: `src/lib/llm/cache.ts`
- Create: `src/lib/llm/cache.test.ts`
- Create: `src/lib/llm/cache-capabilities.ts`
- Create: `src/lib/llm/cache-capabilities.test.ts`

- [ ] **Step 1：写失败的缓存规划测试**

创建 `src/lib/llm/cache.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { buildPromptCachePlan, isCacheCompatibilityError } from "./cache";

const slot = {
  provider: "openai-compatible" as const,
  baseUrl: "https://models.test/v1/",
  model: "gpt-test",
};

describe("prompt cache planner", () => {
  it("uses only the contiguous stable prefix and ignores dynamic content in the key", () => {
    const stable = "S".repeat(4100);
    const first = buildPromptCachePlan(slot, {
      task: "narrative",
      cache: { namespace: "narrative:world-1:v1" },
      messages: [
        { role: "system", content: stable, cacheScope: "global" },
        { role: "system", content: "world", cacheScope: "world" },
        { role: "user", content: "player A", cacheScope: "dynamic" },
      ],
    });
    const second = buildPromptCachePlan(slot, {
      task: "narrative",
      cache: { namespace: "narrative:world-1:v1" },
      messages: [
        { role: "system", content: stable, cacheScope: "global" },
        { role: "system", content: "world", cacheScope: "world" },
        { role: "user", content: "player B", cacheScope: "dynamic" },
      ],
    });
    expect(first.enabled).toBe(true);
    expect(first.key).toBe(second.key);
    expect(first.breakpoints).toEqual([0, 1]);
    expect(first.key).not.toContain("player");
  });

  it("disables active hints for test, short and stable-after-dynamic requests", () => {
    expect(buildPromptCachePlan(slot, {
      task: "test", cache: { namespace: "test" },
      messages: [{ role: "system", content: "S".repeat(5000), cacheScope: "global" }],
    }).enabled).toBe(false);
    expect(buildPromptCachePlan(slot, {
      task: "genesis", cache: { namespace: "genesis:v1" },
      messages: [{ role: "system", content: "short", cacheScope: "global" }],
    }).enabled).toBe(false);
  });

  it("recognizes only explicit cache extension compatibility errors", () => {
    expect(isCacheCompatibilityError(400, "unknown parameter prompt_cache_key")).toBe(true);
    expect(isCacheCompatibilityError(422, "extra_forbidden stream_options")).toBe(true);
    expect(isCacheCompatibilityError(401, "invalid api key")).toBe(false);
    expect(isCacheCompatibilityError(429, "rate limited")).toBe(false);
  });
});
```

- [ ] **Step 2：写失败的能力记忆测试**

创建 `src/lib/llm/cache-capabilities.test.ts`：

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheCapabilities,
  clearCacheCapabilitiesForTests,
  downgradeCacheCapability,
} from "./cache-capabilities";

describe("endpoint cache capabilities", () => {
  beforeEach(clearCacheCapabilitiesForTests);

  it("downgrades usage independently before disabling cache keys", () => {
    const endpoint = "openai-compatible:https://models.test/v1:test-model";
    expect(cacheCapabilities(endpoint)).toEqual({ cacheKey: true, usageStream: true, cacheControl: true });
    downgradeCacheCapability(endpoint, "usageStream");
    expect(cacheCapabilities(endpoint)).toMatchObject({ cacheKey: true, usageStream: false });
    downgradeCacheCapability(endpoint, "cacheKey");
    expect(cacheCapabilities(endpoint)).toMatchObject({ cacheKey: false, usageStream: false });
  });
});
```

- [ ] **Step 3：运行测试并确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/cache.test.ts src/lib/llm/cache-capabilities.test.ts"
```

Expected: FAIL，模块不存在。

- [ ] **Step 4：实现缓存规划器**

`src/lib/llm/cache.ts` 导出：

```ts
export const MIN_ACTIVE_CACHE_CHARS = 4000;
export type PromptCachePlan = {
  enabled: boolean;
  key: string | null;
  breakpoints: number[];
  stablePrefixEnd: number;
};

export function buildPromptCachePlan(slot: ModelSlot, req: CompletionRequest): PromptCachePlan;
export function isCacheCompatibilityError(status: number, body: string): boolean;
export function normalizedEndpointKey(slot: ModelSlot): string;
```

实现规则：

1. 仅 `genesis/narrative/settlement/reroll` 且存在 `req.cache` 时启用。
2. 从第 0 条开始扫描；未标记视为 `dynamic`。遇到第一条 `dynamic` 后停止，后续全部忽略。
3. 记录最后一个 `global` 与最后一个 `world` 消息索引，去重后形成最多两个断点。
4. 稳定前缀字符总数少于 4,000 时禁用。
5. 使用 `node:crypto`：

```ts
createHash("sha256")
  .update(JSON.stringify({
    provider: slot.provider,
    baseUrl: slot.baseUrl.replace(/\/+$/, ""),
    model: slot.model,
    namespace: req.cache.namespace,
    stableMessages: req.messages.slice(0, stablePrefixEnd + 1).map(({ role, content }) => ({ role, content })),
  }))
  .digest("hex")
  .slice(0, 64);
```

返回键前缀 `genesis:`，但不包含任何明文消息。

- [ ] **Step 5：实现能力记忆**

`src/lib/llm/cache-capabilities.ts` 使用模块级 `Map`，导出：

```ts
type CacheCapability = "cacheKey" | "usageStream" | "cacheControl";
type EndpointCapabilities = Record<CacheCapability, boolean>;

export function cacheCapabilities(endpoint: string): EndpointCapabilities;
export function downgradeCacheCapability(endpoint: string, capability: CacheCapability): void;
export function clearCacheCapabilitiesForTests(): void;
```

每次读取返回副本，默认全 `true`。关闭 `cacheKey` 时不自动关闭 `usageStream`；关闭 `cacheControl` 只影响 Anthropic 标记。

- [ ] **Step 6：运行测试**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/cache.test.ts src/lib/llm/cache-capabilities.test.ts"
```

Expected: PASS。

- [ ] **Step 7：提交**

```bash
git add src/lib/llm/cache.ts src/lib/llm/cache.test.ts src/lib/llm/cache-capabilities.ts src/lib/llm/cache-capabilities.test.ts
git commit -m "feat: plan stable prompt cache prefixes"
```

---

## Task 3：为 OpenAI 兼容协议加入缓存键、Usage 和自动去参回退

**Files:**
- Modify: `src/lib/llm/adapters.ts`
- Modify: `src/lib/llm/adapters.test.ts`

- [ ] **Step 1：写失败的 OpenAI Payload 与 Usage 测试**

扩展 `src/lib/llm/adapters.test.ts`：

```ts
it("sends an OpenAI prompt cache key and emits streamed usage", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response([
    'data: {"choices":[{"delta":{"content":"正文"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":12000,"completion_tokens":300,"prompt_tokens_details":{"cached_tokens":8000}}}',
    'data: [DONE]',
    "",
  ].join("\n\n"), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const chunks = [];
  for await (const chunk of adapters["openai-compatible"].stream(slot, {
    task: "narrative",
    cache: { namespace: "narrative:world-1:v1" },
    messages: [
      { role: "system", content: "S".repeat(5000), cacheScope: "global" },
      { role: "user", content: "继续", cacheScope: "dynamic" },
    ],
  }, "key")) chunks.push(chunk);

  const payload = JSON.parse(fetchMock.mock.calls[0]![1].body);
  expect(payload.prompt_cache_key).toMatch(/^genesis:/);
  expect(payload.stream_options).toEqual({ include_usage: true });
  expect(payload.messages[0]).toEqual({ role: "system", content: "S".repeat(5000) });
  expect(chunks).toContainEqual(expect.objectContaining({
    type: "usage",
    usage: expect.objectContaining({ cacheReadTokens: 8000 }),
  }));
});
```

注意断言发往上游的 `messages` 已移除内部 `cacheScope`。

- [ ] **Step 2：写失败的分级兼容回退测试**

```ts
it("removes only rejected stream usage fields and remembers the downgrade", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('unknown parameter: stream_options', { status: 400 }))
    .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"正文"}}]}\n\ndata: [DONE]\n\n', { status: 200 }))
    .mockResolvedValueOnce(new Response('data: [DONE]\n\n', { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const req = cacheableNarrativeRequest();
  await drain(adapters["openai-compatible"].stream(slot, req, "key"));
  await drain(adapters["openai-compatible"].stream(slot, req, "key"));

  const retry = JSON.parse(fetchMock.mock.calls[1]![1].body);
  const next = JSON.parse(fetchMock.mock.calls[2]![1].body);
  expect(retry.prompt_cache_key).toBeTruthy();
  expect(retry.stream_options).toBeUndefined();
  expect(next.prompt_cache_key).toBeTruthy();
  expect(next.stream_options).toBeUndefined();
});

it("removes cache keys only for explicit cache-key errors and never retries auth or abort", async () => {
  // 400 unknown prompt_cache_key => one no-cache retry and cacheFallback=true usage chunk.
  // 401 invalid key => one request, throws.
  // AbortError / aborted signal => one request, throws/returns without fallback.
});
```

- [ ] **Step 3：运行 OpenAI Adapter 测试并确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/adapters.test.ts"
```

Expected: FAIL，Payload 无缓存字段且无 Usage chunk。

- [ ] **Step 4：重构 ProviderAdapter 的结果契约**

把 `ProviderAdapter.complete` 改为返回 `Promise<AdapterCompletionResult>`。流式 Adapter 发出 `usage` chunk。增加私有帮助函数：

```ts
function publicMessages(messages: ChatMessage[]) {
  return messages.map(({ role, content }) => ({ role, content }));
}
```

所有三协议请求都不得透传 `cacheScope` 或 `cache` 内部字段。

- [ ] **Step 5：实现 OpenAI 缓存 Payload**

在每次请求前调用 `buildPromptCachePlan(slot, req)` 与 `cacheCapabilities(endpoint)`：

```ts
const payload = {
  model: slot.model,
  messages: publicMessages(req.messages),
  temperature: req.temperature ?? slot.temperature,
  max_tokens: req.maxTokens ?? slot.maxTokens ?? DEFAULT_MAX_TOKENS,
  stream,
  ...(plan.enabled && capabilities.cacheKey ? { prompt_cache_key: `genesis:${plan.key}` } : {}),
  ...(stream && plan.enabled && capabilities.usageStream
    ? { stream_options: { include_usage: true } }
    : {}),
};
```

非流式响应解析 `json.usage`；流式解析任意带 `usage` 的事件并只发出最后一份 Usage。

- [ ] **Step 6：实现同 attempt 的分级去参回退**

新增 OpenAI 私有函数，使单次 Adapter `stream/complete` 最多发送两次：

1. 第一次按能力记忆发送。
2. 若明确报错提及 `stream_options`，关闭 `usageStream` 并去掉该字段重试。
3. 若明确报错提及 `prompt_cache_key`，关闭 `cacheKey` 并去掉该字段重试。
4. 若错误同时无法定位但明确是缓存扩展字段错误，关闭请求中全部主动扩展后重试。
5. 若 `signal.aborted`，不得重试。
6. 第二次结果的 `cacheFallback=true`；若保留了缓存键，`cacheRequested=true`，否则为 false。

适配器内部兼容回退不调用 Gateway 的 `backoff`，不改变业务重试计数。

- [ ] **Step 7：运行 Adapter 测试和类型检查**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/adapters.test.ts && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec tsc --noEmit"
```

Expected: PASS；三协议旧测试仍通过。

- [ ] **Step 8：提交**

```bash
git add src/lib/llm/adapters.ts src/lib/llm/adapters.test.ts
git commit -m "feat: enable compatible OpenAI prompt caching"
```

---

## Task 4：为 Anthropic 与 Gemini 加入原生缓存适配

**Files:**
- Modify: `src/lib/llm/adapters.ts`
- Modify: `src/lib/llm/adapters.test.ts`

- [ ] **Step 1：写失败的 Anthropic 断点测试**

```ts
it("marks at most two Anthropic stable system breakpoints", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    content: [{ type: "text", text: "完成" }],
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 7000,
      cache_creation_input_tokens: 3000,
    },
  }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const result = await adapters.anthropic.complete(anthropicSlot, cacheableMessages(), "key");
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
  expect(body.system).toEqual([
    { type: "text", text: expect.any(String), cache_control: { type: "ephemeral" } },
    { type: "text", text: expect.any(String), cache_control: { type: "ephemeral" } },
  ]);
  expect(body.messages.at(-1).content).not.toHaveProperty("cache_control");
  expect(result.usage).toMatchObject({ cacheReadTokens: 7000, cacheWriteTokens: 3000 });
});
```

测试还要覆盖多个连续同 scope System 消息先合并为一个文本块，防止超过断点限制。

- [ ] **Step 2：写失败的 Anthropic 回退测试**

```ts
it("removes Anthropic cache_control after an explicit compatibility rejection", async () => {
  // 首次 400: extra inputs are not permitted: cache_control
  // 第二次成功；body.system 仍是文本块但无 cache_control，结果 cacheFallback=true。
  // 后续同 endpoint/model 直接无 cache_control。
});
```

若中转站明确拒绝数组式 `system`，第二次将 System 合并回字符串；该能力同样记入 `cacheControl=false`。

- [ ] **Step 3：写失败的 Gemini 隐式缓存 Usage 测试**

```ts
it("emits Gemini implicit cache usage without creating cachedContent", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response([
    'data: {"candidates":[{"content":{"parts":[{"text":"完成"}]}}]}',
    'data: {"usageMetadata":{"promptTokenCount":9000,"candidatesTokenCount":500,"cachedContentTokenCount":6000}}',
    "",
  ].join("\n\n"), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const chunks = await drain(adapters.gemini.stream(geminiSlot, cacheableMessages(), "key"));
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
  expect(body.cachedContent).toBeUndefined();
  expect(chunks).toContainEqual(expect.objectContaining({
    type: "usage",
    usage: { inputTokens: 9000, outputTokens: 500, cacheReadTokens: 6000, cacheWriteTokens: null },
  }));
});
```

- [ ] **Step 4：运行测试并确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/adapters.test.ts"
```

Expected: FAIL。

- [ ] **Step 5：实现 Anthropic System 块与 Usage**

新增 `toAnthropicSystem`：

- 只处理 `role=system`。
- 将相邻且同 scope 的 System 消息合并。
- 根据 `plan.breakpoints` 给最后 global 块、最后 world 块添加 `cache_control`。
- 最多两个标记。
- 动态 System 可以是无标记块，但必须位于稳定块之后。
- 非流式取顶层 `usage`。
- 流式把 `message_start.message.usage` 与 `message_delta.usage` 合并，最后发一个统一 Usage。

实现明确 `cache_control/system array` 字段错误的一次去参回退及能力记忆。

- [ ] **Step 6：实现 Gemini Usage**

- `toGeminiBody` 继续保持稳定 System 在 `systemInstruction`、动态内容在后。
- 非流式解析顶层 `usageMetadata`。
- 流式保存最后出现的 `usageMetadata`，结束前发出 Usage。
- `cacheRequested` 表示请求拥有有效缓存计划；Gemini 虽无显式字段，也设为 true，便于统计“已按缓存友好顺序发送”。
- `cacheFallback` 永远 false。

- [ ] **Step 7：运行三协议测试与类型检查**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/adapters.test.ts src/lib/llm/usage.test.ts src/lib/llm/cache-capabilities.test.ts && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec tsc --noEmit"
```

Expected: PASS。

- [ ] **Step 8：提交**

```bash
git add src/lib/llm/adapters.ts src/lib/llm/adapters.test.ts
git commit -m "feat: cache Anthropic and Gemini prompt prefixes"
```

---

## Task 5：扩展调用日志并让 Gateway 持久化缓存 Usage

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260721173000_llm_prompt_cache_stats/migration.sql`
- Modify: `src/lib/llm/gateway.ts`
- Modify: `src/lib/llm/gateway.test.ts`

- [ ] **Step 1：写失败的 Schema 完整性断言**

在 `src/lib/llm/gateway.test.ts` 或新建 `src/lib/llm/cache-schema-integrity.test.ts` 读取 Prisma Schema，断言：

```ts
expect(schema).toContain("inputTokens      Int?");
expect(schema).toContain("cacheReadTokens  Int?");
expect(schema).toContain("cacheWriteTokens Int?");
expect(schema).toContain("cacheRequested   Boolean");
expect(schema).toContain("cacheFallback    Boolean");
```

- [ ] **Step 2：写失败的 Gateway 日志测试**

扩展 `src/lib/llm/gateway.test.ts`：

```ts
it("persists normalized usage and cache transport metadata", async () => {
  mocks.stream.mockImplementation(async function* () {
    yield { type: "text", text: "answer" };
    yield {
      type: "usage",
      usage: { inputTokens: 12000, outputTokens: 500, cacheReadTokens: 8000, cacheWriteTokens: null },
      cacheRequested: true,
      cacheFallback: false,
    };
    yield { type: "done" };
  });

  await expect(complete("narrative", cacheableRequest(), {
    maxAttempts: 1, allowFallback: false,
  })).resolves.toBe("answer");

  expect(mocks.llmCallCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
    provider: "openai-compatible",
    model: "test-model",
    inputTokens: 12000,
    outputTokens: 500,
    cacheReadTokens: 8000,
    cacheWriteTokens: null,
    cacheRequested: true,
    cacheFallback: false,
  }) });
});
```

另测直接 `stream()` 会截留 Usage、不把 `usage` chunk 泄漏给调用者；无 Usage 时写 `null` 而不是 0。

- [ ] **Step 3：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/gateway.test.ts src/lib/llm/cache-schema-integrity.test.ts"
```

Expected: FAIL。

- [ ] **Step 4：扩展 Prisma 模型与迁移**

在 `LlmCall` 增加：

```prisma
provider         String?
model            String?
inputTokens      Int?    @map("input_tokens")
outputTokens     Int?    @map("output_tokens")
cacheReadTokens  Int?    @map("cache_read_tokens")
cacheWriteTokens Int?    @map("cache_write_tokens")
cacheRequested   Boolean @default(false) @map("cache_requested")
cacheFallback    Boolean @default(false) @map("cache_fallback")
```

迁移只做 `ALTER TABLE`，旧行得到 false/NULL：

```sql
ALTER TABLE "llm_calls"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "input_tokens" INTEGER,
  ADD COLUMN "output_tokens" INTEGER,
  ADD COLUMN "cache_read_tokens" INTEGER,
  ADD COLUMN "cache_write_tokens" INTEGER,
  ADD COLUMN "cache_requested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cache_fallback" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "llm_calls_task_created_at_idx" ON "llm_calls"("task", "created_at");
```

并在 Prisma 模型增加对应 `@@index([task, createdAt])`。

- [ ] **Step 5：重构 Gateway 日志与流式聚合**

`logCall` 接收：

```ts
type CallLog = {
  task: string;
  slot: SlotName;
  provider: string;
  model: string;
  startedAt: number;
  ok: boolean;
  error?: string;
  usage?: NormalizedUsage;
  cacheRequested?: boolean;
  cacheFallback?: boolean;
};
```

`collectStream` 返回 `{ text, usage, cacheRequested, cacheFallback }`；若收到多份 Usage 使用最后一份。公开 `stream()` 只 yield `text/done`，拦截 `usage`。Adapter `complete()` 结果直接解包文本并记 Usage。

重试规则：最终成功日志记录成功 attempt 的 Usage；失败日志不伪造 Usage。缓存兼容回退由 Adapter 的 `cacheFallback` 传出，不算 Gateway retry。

- [ ] **Step 6：生成 Client、应用测试迁移并运行测试**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec prisma generate"
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec prisma migrate deploy"
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/gateway.test.ts src/lib/llm/cache-schema-integrity.test.ts && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec tsc --noEmit"
```

Expected: PASS。

- [ ] **Step 7：提交**

```bash
git add prisma/schema.prisma prisma/migrations/20260721173000_llm_prompt_cache_stats src/lib/llm/gateway.ts src/lib/llm/gateway.test.ts src/lib/llm/cache-schema-integrity.test.ts
git commit -m "feat: persist provider prompt cache usage"
```

---

## Task 6：重排高价值请求的稳定前缀与动态后缀

**Files:**
- Modify: `src/lib/llm/structured.ts`
- Modify: `src/lib/llm/structured.test.ts`
- Modify: `src/lib/prompts/narrator.ts`
- Modify: `src/lib/context/builder.ts`
- Modify: `src/lib/context/builder.test.ts`
- Modify: `src/lib/context/sse.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/app/api/messages/[id]/variants/route.ts`
- Modify: `src/lib/genesis/task-runner.ts`
- Modify: `src/app/api/worlds/route.ts`
- Modify: `src/app/api/worlds/[id]/reroll/route.ts`
- Modify: `src/lib/settle/pipeline.ts`
- Modify: corresponding tests

- [ ] **Step 1：写失败的结构化请求缓存测试**

在 `src/lib/llm/structured.test.ts` mock `complete`，断言：

```ts
expect(complete).toHaveBeenCalledWith("narrative", expect.objectContaining({
  cache: { namespace: "genesis:v1" },
  messages: [
    expect.objectContaining({ role: "system", cacheScope: "global" }),
    expect.objectContaining({ role: "system", cacheScope: "world" }),
    expect.objectContaining({ role: "user", cacheScope: "dynamic" }),
  ],
}), expect.anything());
```

第二次结构校验修复时，System 与 world 消息完全相同，只改变末尾 user retry note。

为 `completeStructured` 增加选项：

```ts
cache?: { namespace: string };
stableContext?: string[];
```

- [ ] **Step 2：写失败的叙事消息顺序测试**

在 `src/lib/context/builder.test.ts` 断言：

```ts
const messages = await buildNarratorContext(...);
expect(messages[0]).toMatchObject({ role: "system", cacheScope: "global" });
expect(messages[1]).toMatchObject({ role: "system", cacheScope: "world" });
const firstDynamic = messages.findIndex((message) => message.cacheScope === "dynamic");
expect(firstDynamic).toBeGreaterThan(1);
expect(messages.slice(firstDynamic).every((message) => message.cacheScope === "dynamic")).toBe(true);
```

另测 scale、omens、查探结果随回合变化时只影响动态块，不改变 global/world 文本。

- [ ] **Step 3：写失败的任务分类与调用次数测试**

覆盖：

- 创世流式请求：`cache.namespace === "genesis:v1"`，有效首轮仍 `stream` 一次。
- 创世修复：同 namespace 与 System 前缀。
- 重掷与引用修复：`task === "reroll"`、`cache.namespace === "reroll:v1"`。
- 章末：`task === "settlement"`、`cache.namespace === "settlement:v1"`，仍恰好调用模型一次。
- 正文和异文：namespace 为 `narrative:${worldId}:v1`。

- [ ] **Step 4：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/structured.test.ts src/lib/context/builder.test.ts src/lib/genesis/task-runner.test.ts src/lib/settle/pipeline.integration.test.ts src/app/api/chat/route.test.ts"
```

Expected: FAIL，消息没有 scope/cache。

- [ ] **Step 5：拆分 Narrator 固定、世界与动态块**

把 `narratorSystem()` 拆为：

```ts
export function narratorGlobalSystem(): string;
export function narratorWorldSystem(opts: {
  worldName: string;
  styleCard: unknown;
  themeCard: unknown;
  cosmology: unknown;
  fusionAxiom?: unknown;
  playerGod: ...;
  gods: ...;
}): string;
export function narratorTurnSystem(opts: {
  scale: Scale;
  omens?: string[];
  hiddenEntries?: ...;
}): string;
```

- `global` 只含与世界无关的核心规则和输出契约。
- `world` 含世界名、风格、主题、宇宙论、融合公理、玩家神和主神卡；按数据库稳定顺序序列化。
- `dynamic` 含当前 scale、omens、查探结果、实体卡、能力、世界书命中、编年史和正文窗口。

不得把征兆、hiddenEntries 或 CURRENT SCALE 留在 world 块。

- [ ] **Step 6：更新 Context Builder 与正文缓存命名空间**

`buildNarratorContext` 返回：

```ts
[
  { role: "system", content: narratorGlobalSystem(), cacheScope: "global" },
  { role: "system", content: narratorWorldSystem(...), cacheScope: "world" },
  { role: "system", content: narratorTurnSystem(...), cacheScope: "dynamic" },
  ...allOtherDynamicSystemMessages,
  { role: "user", content: ..., cacheScope: "dynamic" },
]
```

给 `narratorSSE` 增加 `cacheNamespace: string` 参数，调用 Gateway：

```ts
{ task: "narrative", messages: opts.messages, cache: { namespace: opts.cacheNamespace } }
```

Chat 与异文路由都传 `narrative:${worldId}:v1`。

- [ ] **Step 7：更新结构化、创世、章末和重掷调用**

`completeStructured` 组装：

```ts
messages: [
  { role: "system", content: opts.system, cacheScope: "global" },
  ...(opts.stableContext ?? []).map((content) => ({ role: "system" as const, content, cacheScope: "world" as const })),
  { role: "user", content: opts.user + retryNote, cacheScope: "dynamic" },
],
cache: opts.cache,
```

调用点：

- Genesis System `global`；lorebook excerpts 可作为 `stableContext`；神谕与素材仍 dynamic。
- 旧 `/api/worlds` 创世入口同样启用 `genesis:v1`。
- Settlement System `global`，完整 context dynamic，`settlement:v1`。
- Reroll System `global`，当前卡组 dynamic，任务/namespace 均为 `reroll`/`reroll:v1`。

- [ ] **Step 8：运行目标回归**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/structured.test.ts src/lib/context/builder.test.ts src/lib/genesis/task-runner.test.ts src/lib/genesis/generate.test.ts src/app/api/chat/route.test.ts src/lib/context/sse.test.ts"
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec vitest run --config vitest.integration.config.ts src/lib/settle/pipeline.integration.test.ts"
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec tsc --noEmit"
```

Expected: PASS；同章结算模型请求仍一次。

- [ ] **Step 9：提交**

```bash
git add src/lib/llm/structured.ts src/lib/llm/structured.test.ts src/lib/prompts/narrator.ts src/lib/context src/app/api/chat src/app/api/messages/[id]/variants/route.ts src/lib/genesis/task-runner.ts src/app/api/worlds src/lib/settle/pipeline.ts src/lib/settle/pipeline.integration.test.ts
git commit -m "feat: arrange stable cache prefixes for model tasks"
```

---

## Task 7：实现缓存统计聚合与只读 API

**Files:**
- Create: `src/lib/llm/cache-stats.ts`
- Create: `src/lib/llm/cache-stats.test.ts`
- Create: `src/lib/llm/cache-stats.integration.test.ts`
- Create: `src/app/api/settings/cache-stats/route.ts`
- Create: `src/app/api/settings/cache-stats/route.test.ts`

- [ ] **Step 1：先核对 Next.js Route Handler 文档**

```bash
sed -n '1,220p' node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
```

确认 GET 默认动态读取数据库，不添加静态缓存配置。

- [ ] **Step 2：写失败的聚合纯函数测试**

```ts
import { describe, expect, it } from "vitest";
import { aggregateCacheCalls } from "./cache-stats";

describe("cache stats", () => {
  it("excludes unavailable usage from hit-rate denominator", () => {
    const aggregate = aggregateCacheCalls([
      { inputTokens: 10000, outputTokens: 500, cacheReadTokens: 7000, cacheWriteTokens: null, cacheFallback: false },
      { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, cacheFallback: true },
    ]);
    expect(aggregate).toMatchObject({
      calls: 2,
      callsWithUsage: 1,
      inputTokens: 10000,
      cacheReadTokens: 7000,
      cacheWriteTokens: null,
      hitRate: 0.7,
      fallbackCalls: 1,
    });
  });

  it("returns null hit rate instead of zero when usage is unavailable", () => {
    expect(aggregateCacheCalls([{ inputTokens: null, cacheReadTokens: null } as never]).hitRate).toBeNull();
  });
});
```

- [ ] **Step 3：写失败的真实 PostgreSQL 聚合测试**

`src/lib/llm/cache-stats.integration.test.ts` 插入跨 24 小时边界、不同 task/provider/model、null Usage 与回退日志，调用 `loadPromptCacheStats(prisma)`，断言：

- `last24Hours` 排除旧记录。
- `allTime` 包含全部。
- `byTask` 将 `genesis/narrative/settlement/reroll` 分开。
- `recent` 不含 error 或 Prompt。
- 测试清理自己以 UUID 前缀创建的行。

- [ ] **Step 4：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/cache-stats.test.ts"
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec vitest run --config vitest.integration.config.ts src/lib/llm/cache-stats.integration.test.ts"
```

Expected: FAIL。

- [ ] **Step 5：实现聚合模块**

导出：

```ts
export type CacheAggregate = {
  calls: number;
  callsWithUsage: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  hitRate: number | null;
  fallbackCalls: number;
};

export function aggregateCacheCalls(rows: CacheUsageRow[]): CacheAggregate;
export async function loadPromptCacheStats(db = prisma): Promise<CacheStatsResponse>;
```

`sumNullable` 只有至少一条非 null 时才返回数字；`hitRate = sum(cacheRead) / sum(input)`，只纳入同一行两个值都非 null 且 input > 0 的数据。最近调用限制 20 条，选择字段白名单。

- [ ] **Step 6：实现统计 Route Handler 与路由测试**

`GET /api/settings/cache-stats`：

```ts
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(await loadPromptCacheStats());
}
```

路由测试 mock `loadPromptCacheStats`，断言 200 和 DTO 原样返回；数据库错误时返回 500 `{ error: "缓存统计读取失败" }`，不泄漏 SQL/连接串。

- [ ] **Step 7：运行测试**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/lib/llm/cache-stats.test.ts src/app/api/settings/cache-stats/route.test.ts"
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec vitest run --config vitest.integration.config.ts src/lib/llm/cache-stats.integration.test.ts"
```

Expected: PASS。

- [ ] **Step 8：提交**

```bash
git add src/lib/llm/cache-stats.ts src/lib/llm/cache-stats.test.ts src/lib/llm/cache-stats.integration.test.ts src/app/api/settings/cache-stats
git commit -m "feat: expose prompt cache usage statistics"
```

---

## Task 8：在香炉页展示缓存命中情况

**Files:**
- Create: `src/components/settings/PromptCacheStats.tsx`
- Create: `src/components/settings/prompt-cache-stats-state.ts`
- Create: `src/components/settings/prompt-cache-stats-state.test.ts`
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1：核对 Server/Client Component 文档**

```bash
sed -n '1,220p' node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
```

确认交互统计卡作为独立 Client Component，数据库只通过 API 读取。

- [ ] **Step 2：写失败的格式化状态测试**

```ts
import { describe, expect, it } from "vitest";
import { formatCacheRate, summarizeCacheAvailability } from "./prompt-cache-stats-state";

describe("prompt cache stats presentation", () => {
  it("distinguishes unavailable usage from a real zero hit", () => {
    expect(formatCacheRate(null)).toBe("端点未返回用量");
    expect(formatCacheRate(0)).toBe("0.0%");
    expect(formatCacheRate(0.725)).toBe("72.5%");
  });

  it("surfaces compatibility fallback without claiming cache failure", () => {
    expect(summarizeCacheAvailability({ fallbackCalls: 3, callsWithUsage: 0, calls: 5 }))
      .toContain("自动兼容回退 3 次");
  });
});
```

- [ ] **Step 3：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/components/settings/prompt-cache-stats-state.test.ts"
```

Expected: FAIL。

- [ ] **Step 4：实现纯格式化逻辑**

`prompt-cache-stats-state.ts` 导出：

```ts
export function formatTokens(value: number | null): string;
export function formatCacheRate(rate: number | null): string;
export function taskLabel(task: string): string;
export function summarizeCacheAvailability(aggregate: Pick<CacheAggregate, "calls" | "callsWithUsage" | "fallbackCalls">): string;
```

Token 使用 `Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 })`；null 显示 `—`。

- [ ] **Step 5：实现 PromptCacheStats 组件**

组件 mount 后请求 `/api/settings/cache-stats`，渲染：

1. 标题与说明：“缓存的是输入前缀，不是模型答案”。
2. 最近 24 小时与累计两张摘要卡：读取/输入、命中率、写入、调用数。
3. 按任务表：创世、正文、章末、重掷。
4. 最近 20 次：时间、provider/model、task、`cacheRead/input`、回退标记。
5. null Usage 显示“端点未返回用量”。
6. 加载失败显示局部错误和“重试”按钮，不影响设置表单。

避免 `useEffect` 同步 setState lint：通过 effect 内异步 fetch 回调更新，或用 `setTimeout(() => void load(), 0)` 启动。

- [ ] **Step 6：接入香炉页面**

在模型槽位区和保存按钮之间插入：

```tsx
<PromptCacheStats />
```

不把 stats 合并进 `/api/settings`，避免每次编辑槽位都查询日志大表。

- [ ] **Step 7：运行测试、Lint 和 Build**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test src/components/settings/prompt-cache-stats-state.test.ts src/app/api/settings/cache-stats/route.test.ts"
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd lint"
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd build"
```

Expected: PASS，`/settings` 生产构建成功。

- [ ] **Step 8：提交**

```bash
git add src/components/settings src/app/settings/page.tsx
git commit -m "feat: show prompt cache hits in settings"
```

---

## Task 9：更新文档并做完整缓存回归

**Files:**
- Modify: `docs/02-技术架构.md`
- Modify: `docs/04-Prompt体系.md`
- Test: all unit/integration suites

- [ ] **Step 1：补端到端回归测试**

在 Gateway/Adapter/调用点测试中串联下列验收：

1. 同一世界两次正文请求的 dynamic user 不同，但 `prompt_cache_key` 相同。
2. 修改世界级稳定卡片后缓存键改变。
3. OpenAI 缓存参数支持时只请求一次。
4. 中转站明确拒绝 `stream_options` 时只额外请求一次，后续不再探测。
5. Anthropic global/world 有两个断点，dynamic 无断点。
6. Gemini 不创建显式缓存资源但记录 `cachedContentTokenCount`。
7. 创世有效首轮仍只有一条生产 `stream("narrative", ...)`。
8. 素材模块无模型调用。
9. 同章结算并发测试仍全局一次请求。
10. Cache Stats 不返回 Prompt、错误全文或缓存键。

- [ ] **Step 2：更新架构与 Prompt 文档**

`docs/02-技术架构.md` 记录：

- 缓存规划器、协议 Adapter、Gateway 日志和统计 API 的数据流。
- OpenAI/Anthropic 明确字段错误去参回退。
- Gemini 仅隐式缓存。
- 缓存不是答案复用。

`docs/04-Prompt体系.md` 记录：

- global → world → dynamic 的严格顺序。
- 叙事固定/世界/回合三块。
- 创世 Schema、章末 Schema 和重掷 System 的缓存边界。
- 4,000 字符主动提示门槛与哈希键隐私。

- [ ] **Step 3：应用开发数据库迁移**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec prisma migrate deploy"
```

Expected: `20260721173000_llm_prompt_cache_stats` 成功应用。

- [ ] **Step 4：运行完整单元测试**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test"
```

Expected: 0 failed。

- [ ] **Step 5：运行完整集成测试**

```bash
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd test:integration"
```

Expected: 0 failed。

- [ ] **Step 6：运行类型、Lint、Build 与差异检查**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd exec tsc --noEmit"
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd lint"
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd build"
git diff --check
```

Expected: 全部 exit 0，`git diff --check` 无输出。

- [ ] **Step 7：静态核对调用约束**

```bash
grep -R 'stream("narrative"' -n src/lib/genesis src/app/api/genesis
grep -R -E 'completeStructured|completeText|stream\(' -n src/lib/materials src/components/materials src/app/api/materials
```

Expected:

- 创世生产流调用仍只有 `src/lib/genesis/task-runner.ts` 的一条。
- 素材目录没有模型调用。

- [ ] **Step 8：启动服务并做 HTTP 冒烟**

```bash
cmd.exe /c "cd /d C:\创世 && C:\Users\Aca\AppData\Roaming\npm\pnpm.cmd dev"
cmd.exe /c "curl.exe -I http://localhost:3000/settings && curl.exe -I http://localhost:3000/api/settings/cache-stats"
```

Expected: 两者均 `HTTP/1.1 200 OK`。手测香炉：无 Usage、真实 0%、有命中、兼容回退四种状态措辞不同。

- [ ] **Step 9：提交**

```bash
git add docs/02-技术架构.md docs/04-Prompt体系.md prisma/schema.prisma prisma/migrations/20260721173000_llm_prompt_cache_stats
git add src/lib/llm src/lib/context src/lib/prompts src/lib/genesis src/lib/settle src/app/api src/app/settings src/components/settings
git commit -m "feat: complete provider prompt cache optimization"
```

---

## 风险与控制

1. **中转站宣称 OpenAI 兼容但拒绝扩展字段**：只对明确字段错误去参，按 endpoint+model 记忆；认证、限流、服务错误绝不误判。
2. **兼容回退放大请求数**：每个 Adapter attempt 最多一次回退；能力记忆使同进程后续不再探测。
3. **动态内容污染缓存键**：规划器只取第一个 dynamic 之前的连续前缀；测试用不同玩家输入断言键不变。
4. **世界更新后错误复用缓存**：world 内容参与稳定前缀哈希；任何稳定卡变更都会产生新键。
5. **Anthropic 超过缓存断点限制**：相邻同 scope System 合并，最多 global/world 两个断点。
6. **Usage 口径虚高或虚低**：协议归一化独立测试；null 不当 0，命中率只使用完整行。
7. **叙事提示词拆分改变行为**：保持各块内部文本和最终顺序；运行现有 Context Builder、叙事 SSE 和完整回归。
8. **章末/创世调用次数回归**：保留现有并发与单请求测试并增加静态 grep。
9. **统计页泄密**：API select 白名单，禁止返回 Prompt、缓存键、错误全文与 API Key。

## 规格覆盖自检

- OpenAI 缓存键、流 Usage、分级回退：Task 3。
- Anthropic 两级断点及回退：Task 4。
- Gemini 隐式缓存与 Usage：Task 4。
- 全高价值请求稳定前缀：Task 6。
- 日志模型与统一口径：Task 1、5。
- 24 小时/累计/任务/最近统计：Task 7、8。
- 正常路径不增调用、无答案缓存、隐私：Task 2、3、9。
- 完整验证与开发库迁移：Task 9。
