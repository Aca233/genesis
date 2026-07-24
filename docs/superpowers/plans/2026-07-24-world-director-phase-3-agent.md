# World Director Phase 3: Agent Protocol, Provider Capabilities, and Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建缓存优先、最多四次调用的单 Agent 工具循环，并兼容原生 Tool Calling、Structured Output、纯文本 Agent Frame 和受控外部搜索。

**Architecture:** 内部只识别统一 `AgentCommand`；Provider Adapter 负责将原生工具、JSON 或文本信封转入同一协议。Prompt Compiler 固定 L0/L1，动态 L2/L3 只追加。规划模式和叙事模式使用不同解析器，任何协议内容都不能进入玩家正文。

**Tech Stack:** TypeScript 5、Zod 4、现有 LLM Gateway、Vitest 4

---

## 文件结构

```text
src/lib/llm/types.ts
src/lib/llm/adapters.ts
src/lib/llm/adapters.test.ts
src/lib/llm/gateway.ts
src/lib/llm/gateway.test.ts
src/lib/llm/agent-capabilities.ts
src/lib/llm/agent-capabilities.test.ts
src/lib/world-director/agent/commands.ts
src/lib/world-director/agent/commands.test.ts
src/lib/world-director/agent/text-frame.ts
src/lib/world-director/agent/text-frame.test.ts
src/lib/world-director/agent/conversation.ts
src/lib/world-director/agent/conversation.test.ts
src/lib/world-director/agent/prompt-compiler.ts
src/lib/world-director/agent/prompt-compiler.test.ts
src/lib/world-director/agent/loop.ts
src/lib/world-director/agent/loop.test.ts
src/lib/world-director/search/contracts.ts
src/lib/world-director/search/contracts.test.ts
src/lib/world-director/search/external.ts
src/lib/world-director/search/external.test.ts
src/app/api/settings/test/route.ts
src/app/api/settings/test/route.test.ts
src/app/api/settings/route.ts
src/app/api/settings/route.test.ts
src/app/settings/page.tsx
```

---

### Task 1: 定义统一 AgentCommand 与 Text Agent Frame

**Files:**
- Create: `src/lib/world-director/agent/commands.ts`
- Create: `src/lib/world-director/agent/commands.test.ts`
- Create: `src/lib/world-director/agent/text-frame.ts`
- Create: `src/lib/world-director/agent/text-frame.test.ts`

- [ ] **Step 1: 写严格解析测试**

```ts
import { expect, it } from "vitest";
import { AgentCommandSchema } from "./commands";
import { parseTextAgentFrame } from "./text-frame";

it("解析合法工具命令", () => {
  expect(AgentCommandSchema.parse({
    type: "tool_call",
    name: "inspect_world",
    arguments: { scope: "entities", query: "鲁迪" },
  }).type).toBe("tool_call");
});

it("拒绝信封外普通正文", () => {
  expect(() => parseTextAgentFrame(
    "鲁迪抬起枪。<<<AGENT_FRAME\n{\"type\":\"fail\",\"reason\":\"x\"}\nAGENT_FRAME>>>",
  )).toThrow("规划模式包含信封外文本");
});

it("拒绝不存在的工具", () => {
  expect(() => parseTextAgentFrame(
    "<<<AGENT_FRAME\n{\"type\":\"tool_call\",\"name\":\"raw_sql\",\"arguments\":{}}\nAGENT_FRAME>>>",
  )).toThrow();
});
```

- [ ] **Step 2: 实现命令 schema**

```ts
export const ToolNameSchema = z.enum([
  "inspect_world",
  "draft_entity_changes",
  "draft_ability_changes",
  "draft_relation_changes",
  "draft_world_progress",
  "draft_observer_changes",
  "search_external",
  "validate_draft",
]);

export const AgentCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool_call"),
    name: ToolNameSchema,
    arguments: z.unknown(),
  }).strict(),
  z.object({
    type: z.literal("finalize_draft"),
  }).strict(),
  z.object({
    type: z.literal("fail"),
    reason: z.string().trim().min(1).max(1000),
  }).strict(),
]);
```

`parseTextAgentFrame()` 必须要求整个 trim 后响应恰好为一个信封，内部 JSON 使用 `AgentCommandSchema` 解析。

- [ ] **Step 3: 运行并提交**

```powershell
pnpm test -- src/lib/world-director/agent/commands.test.ts src/lib/world-director/agent/text-frame.test.ts
git add src/lib/world-director/agent/commands.ts src/lib/world-director/agent/commands.test.ts src/lib/world-director/agent/text-frame.ts src/lib/world-director/agent/text-frame.test.ts
git commit -m "feat: define provider neutral agent commands"
```

Expected: PASS。

---

### Task 2: 扩展 LLM 类型和 Provider Adapter

**Files:**
- Modify: `src/lib/llm/types.ts`
- Modify: `src/lib/llm/adapters.ts`
- Modify: `src/lib/llm/adapters.test.ts`

- [ ] **Step 1: 写三类能力和原生工具解析测试**

在 `adapters.test.ts` 添加：

```ts
it("OpenAI 原生 tool_calls 转成统一命令 chunk", async () => {
  mockFetchSse([
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call-1",
            function: { name: "inspect_world", arguments: "{\"scope\":\"entities\"}" },
          }],
        },
      }],
    },
  ]);
  const chunks = await collect(adapters["openai-compatible"].stream(slot, request, "key"));
  expect(chunks).toContainEqual(expect.objectContaining({
    type: "tool_call",
    name: "inspect_world",
  }));
});
```

另测 Anthropic `tool_use`、Gemini `functionCall`。Provider 不支持工具字段并返回兼容错误时，Adapter 不自动伪造工具，而是向 Gateway 暴露能力降级。

- [ ] **Step 2: 扩展类型**

```ts
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AgentProtocolPreference =
  | "native_tools"
  | "structured_output"
  | "text_frame";

export type CompletionRequest = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  task: LlmTask;
  cache?: PromptCacheRequest;
  tools?: ToolDefinition[];
  protocol?: AgentProtocolPreference;
  responseSchema?: Record<string, unknown>;
};

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; callId: string; name: string; argumentsText: string }
  | { type: "search_result"; query: string; results: unknown[] }
  | { type: "usage"; /* 现有字段 */ }
  | { type: "done" };
```

`LlmTask` 增加：

```text
world-director
world-director-probe
external-search
```

- [ ] **Step 3: Adapter 实现要求**

- OpenAI：请求体按能力添加 `tools` 和 `tool_choice: "auto"`，流式合并同一 index 的 function arguments；
- Anthropic：请求体添加 `tools`，解析 `content_block_start(type=tool_use)` 和后续 delta；
- Gemini：请求体添加 `tools.functionDeclarations`，解析 `functionCall`；
- Structured Output：仅在 Provider 能力已确认时添加对应 schema；不支持时返回明确 capability error；
- 所有 Provider 的普通正文仍产生 `text` chunk；
- Provider payload 必须继续剥离内部 `cacheScope`。

- [ ] **Step 4: 运行并提交**

```powershell
pnpm test -- src/lib/llm/adapters.test.ts src/lib/llm/gateway.test.ts
git add src/lib/llm/types.ts src/lib/llm/adapters.ts src/lib/llm/adapters.test.ts
git commit -m "feat: add agent protocol transport"
```

Expected: PASS。

---

### Task 3: 实现 Agent Provider 能力探测

**Files:**
- Create: `src/lib/llm/agent-capabilities.ts`
- Create: `src/lib/llm/agent-capabilities.test.ts`
- Modify: `src/lib/llm/gateway.ts`
- Modify: `src/lib/llm/gateway.test.ts`

- [ ] **Step 1: 写探测降级测试**

```ts
it("按 native → structured → text 顺序探测并返回首个可靠协议", async () => {
  const result = await probeAgentCapabilities(fakeAdapter({
    native: "unsupported",
    structured: "unsupported",
    text: "reliable",
  }));
  expect(result).toMatchObject({
    preferredProtocol: "text_frame",
    suitableForDirector: true,
    protocolLeakage: false,
  });
});
```

另测三种均失败时 `suitableForDirector: false`；叙事模式回复含 `<<<AGENT_FRAME` 时 `protocolLeakage: true`。

- [ ] **Step 2: 实现探测结果**

```ts
export type AgentCapabilityProbe = {
  nativeTools: "supported" | "unsupported" | "unknown";
  structuredOutput: "supported" | "unsupported" | "unknown";
  textFrame: "reliable" | "unreliable" | "unknown";
  preferredProtocol: AgentProtocolPreference | null;
  protocolLeakage: boolean;
  nativeSearch: "supported_with_sources" | "unsupported" | "unknown";
  suitableForDirector: boolean;
  checkedAt: string;
};
```

探测执行：

1. 虚拟只读工具；
2. 虚拟工具结果；
3. 再次规划；
4. 切换叙事模式；
5. 检查协议泄漏；
6. 如果 Provider 宣称搜索，验证结果含来源 URL。

- [ ] **Step 3: 扩展 Gateway**

新增：

```ts
export async function testAgentSlot(
  slot: ModelSlot,
  apiKey: string,
): Promise<AgentCapabilityProbe>;
```

普通 `testSlot()` 保留给简单连通性测试；世界导演必须使用 `testAgentSlot()` 结果。

- [ ] **Step 4: 测试并提交**

```powershell
pnpm test -- src/lib/llm/agent-capabilities.test.ts src/lib/llm/gateway.test.ts
git add src/lib/llm/agent-capabilities.ts src/lib/llm/agent-capabilities.test.ts src/lib/llm/gateway.ts src/lib/llm/gateway.test.ts
git commit -m "feat: probe director model capabilities"
```

Expected: PASS。

---

### Task 4: 实现追加式 Conversation 和四层 Prompt Compiler

**Files:**
- Create: `src/lib/world-director/agent/conversation.ts`
- Create: `src/lib/world-director/agent/conversation.test.ts`
- Create: `src/lib/world-director/agent/prompt-compiler.ts`
- Create: `src/lib/world-director/agent/prompt-compiler.test.ts`

- [ ] **Step 1: 写前缀稳定测试**

```ts
it("人物变化不会改变 L0/L1 稳定前缀", () => {
  const a = compilePrompt({ ...base, runSeed: seedAtRevision1 });
  const b = compilePrompt({ ...base, runSeed: seedAtRevision2 });
  expect(hashStablePrefix(a.messages)).toBe(hashStablePrefix(b.messages));
  expect(a.messages.at(-1)?.content).not.toBe(b.messages.at(-1)?.content);
});

it("后续调用只追加帧", () => {
  const conversation = DirectorConversation.start(initialMessages);
  const first = conversation.toMessages();
  conversation.appendAssistantCommand(command);
  conversation.appendToolResult(result);
  const second = conversation.toMessages();
  expect(second.slice(0, first.length)).toEqual(first);
});
```

- [ ] **Step 2: 实现 L0/L1/L2**

```ts
export type PromptLayers = {
  policyVersion: string;
  toolManifestVersion: string;
  changeSetSchemaVersion: string;
  worldConstitution: string;
  worldConstitutionHash: string;
  styleProfile: string;
  styleProfileHash: string;
  runSeed: RunSeed;
};

export function compileDirectorPrompt(input: PromptLayers): ChatMessage[] {
  return [
    { role: "system", cacheScope: "global", content: compileL0(input) },
    { role: "system", cacheScope: "world", content: compileL1(input) },
    { role: "user", cacheScope: "dynamic", content: stableRunSeed(input.runSeed) },
  ];
}
```

禁止将当前人物卡、关系、最近正文、搜索结果或 runId 放入 L0/L1。

- [ ] **Step 3: 实现只追加 conversation**

`DirectorConversation` 只暴露 append 方法，不暴露 splice/sort/rebuild。持久化表示为有序 `ConversationFrame[]`；工具结果使用确定性序列化。

- [ ] **Step 4: 测试并提交**

```powershell
pnpm test -- src/lib/world-director/agent/conversation.test.ts src/lib/world-director/agent/prompt-compiler.test.ts
git add src/lib/world-director/agent/conversation.ts src/lib/world-director/agent/conversation.test.ts src/lib/world-director/agent/prompt-compiler.ts src/lib/world-director/agent/prompt-compiler.test.ts
git commit -m "feat: compile cache stable director prompts"
```

Expected: PASS。

---

### Task 5: 实现受控外部搜索

**Files:**
- Create: `src/lib/world-director/search/contracts.ts`
- Create: `src/lib/world-director/search/contracts.test.ts`
- Create: `src/lib/world-director/search/external.ts`
- Create: `src/lib/world-director/search/external.test.ts`

- [ ] **Step 1: 写来源和预算测试**

```ts
it("拒绝没有 URL 的原生搜索结果", () => {
  expect(() => ExternalSearchResultSchema.parse({
    query: "960穿甲弹",
    provider: "relay",
    searchedAt: "2026-07-24T00:00:00.000Z",
    results: [{ title: "结果", excerpt: "内容" }],
  })).toThrow();
});

it("第三次外部搜索被拒绝", async () => {
  await searchExternal(ctx({ searchCount: 0 }), request);
  await searchExternal(ctx({ searchCount: 1 }), request);
  await expect(searchExternal(ctx({ searchCount: 2 }), request))
    .rejects.toThrow("外部搜索预算已耗尽");
});
```

- [ ] **Step 2: 实现契约**

```ts
export const ExternalSearchResultSchema = z.object({
  query: z.string().trim().min(1).max(300),
  results: z.array(z.object({
    title: z.string().trim().min(1).max(300),
    url: z.url(),
    excerpt: z.string().trim().min(1).max(1000),
    publishedAt: z.string().optional(),
  }).strict()).max(5),
  provider: z.string().min(1),
  searchedAt: z.iso.datetime(),
}).strict();
```

`searchExternal()` 优先使用“带来源的 Provider 原生搜索”，否则调用注入的 runtime search provider；两者都不可用时返回明确 `SEARCH_UNAVAILABLE`。相同 Run 中相同规范化 query 必须复用已持久化结果。

- [ ] **Step 3: 确保搜索不能直接写草案**

搜索返回类型为：

```ts
export type ReferenceCandidate = {
  referenceId: string;
  query: string;
  results: ExternalSearchResult["results"];
};
```

它不属于 `WorldMutationSchema`。只有后续 Agent 明确调用草案工具且通过当前现实校验后才可产生 mutation。

- [ ] **Step 4: 测试并提交**

```powershell
pnpm test -- src/lib/world-director/search
git add src/lib/world-director/search
git commit -m "feat: add sourced external search"
```

Expected: PASS。

---

### Task 6: 实现最多四次调用的 Agent Loop

**Files:**
- Create: `src/lib/world-director/agent/loop.ts`
- Create: `src/lib/world-director/agent/loop.test.ts`

- [ ] **Step 1: 写两轮成功、四轮封顶和两次修正测试**

使用 fake model 和 fake tools：

```ts
it("普通轮次两次模型调用完成", async () => {
  const result = await runDirectorLoop(fixture([
    toolCall("draft_world_progress", validChanges),
    finalizeDraft(),
  ]));
  expect(result.modelCallCount).toBe(2);
  expect(result.status).toBe("draft_ready");
});

it("第五次调用前失败", async () => {
  await expect(runDirectorLoop(fixture([
    toolCall("inspect_world", query1),
    toolCall("inspect_world", query2),
    toolCall("inspect_world", query3),
    toolCall("inspect_world", query4),
  ]))).rejects.toThrow("模型调用预算已耗尽");
});

it("第三次协议修正前失败", async () => {
  await expect(runDirectorLoop(fixture([
    malformedResponse(),
    malformedResponse(),
    malformedResponse(),
  ]))).rejects.toThrow("自动修正预算已耗尽");
});
```

- [ ] **Step 2: 实现循环接口**

```ts
export async function runDirectorPlanningLoop(input: {
  runId: string;
  leaseToken: string;
  conversation: DirectorConversation;
  protocol: AgentProtocolPreference;
  model: DirectorModelClient;
  tools: DirectorToolExecutor;
  validate: (draft: DraftChangeSet) => Promise<ValidationReport>;
  persist: (checkpoint: PlanningCheckpoint) => Promise<void>;
}): Promise<PlanningResult>;
```

每次模型调用前执行 `spendModelCall()`；协议或 validation 修正前执行 `spendRepair()`；每个命令和工具结果 append 后立即 `persist()`。`finalize_draft` 只有在 validation `ok` 时成功。

- [ ] **Step 3: 运行 Phase 3 测试**

```powershell
pnpm test -- src/lib/world-director/agent src/lib/world-director/search src/lib/llm
pnpm exec tsc --noEmit
git diff --check
```

Expected: PASS。

- [ ] **Step 4: 提交**

```powershell
git add src/lib/world-director/agent/loop.ts src/lib/world-director/agent/loop.test.ts
git commit -m "feat: run bounded world director loop"
```

---

### Task 7: 在设置页保存并显示完整 Agent 能力探测

**Files:**
- Modify: `src/app/api/settings/test/route.ts`
- Create: `src/app/api/settings/test/route.test.ts`
- Modify: `src/app/api/settings/route.ts`
- Modify or create: `src/app/api/settings/route.test.ts`
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: 写 Route Handler 响应测试**

Mock `testAgentSlot()`，断言响应包含：

```json
{
  "ok": true,
  "reply": "试炼已过",
  "agentCapabilities": {
    "preferredProtocol": "text_frame",
    "suitableForDirector": true,
    "nativeSearch": "unknown"
  }
}
```

- [ ] **Step 2: 保存探测结果**

`ModelSlotSchema` 增加可选的非敏感字段：

```ts
agentCapabilities: AgentCapabilityProbeSchema.optional()
```

`PUT /api/settings` 保存槽位时保留该字段；如果 provider、baseUrl 或 model 与探测时不一致，则删除旧探测结果，防止把旧模型能力套到新模型。`GET` 的 masked slot 可以安全返回探测结果，但仍不得返回 key 或密文。

设置页点击“试炼一问”后，把响应的 `agentCapabilities` 写入对应 `SlotForm`，下一次“封存设置”随槽位保存。为 `settings/route.test.ts` 添加：更换 model 会清空旧 capability，同一 model 会保留新 probe。

- [ ] **Step 3: 修改测试 Route Handler**

连接测试成功后同时调用 `testAgentSlot()`。若普通连通成功但 Agent 不可靠，HTTP 仍为 200，`ok: true`，但 `agentCapabilities.suitableForDirector: false`，让 UI 明确显示“不适合世界导演”，而不是误报连接失败。

- [ ] **Step 4: 修改设置 UI**

`SlotEditor` 展示：

```text
原生工具：支持／不支持／未知
结构化输出：支持／不支持／未知
文本协议：可靠／不可靠／未知
原生搜索：带来源／不支持／未知
世界导演：可用／不可用
```

叙事槽不适合世界导演时，保存仍允许，但 Phase 6 正式切换门槛不能通过。

- [ ] **Step 5: 测试并提交**

```powershell
pnpm test -- src/app/api/settings/test/route.test.ts src/app/api/settings/route.test.ts
pnpm exec tsc --noEmit
git add src/app/api/settings/test/route.ts src/app/api/settings/test/route.test.ts src/app/api/settings/route.ts src/app/api/settings/route.test.ts src/app/settings/page.tsx src/lib/llm/types.ts
git commit -m "feat: show director model capabilities"
```

Expected: PASS。
