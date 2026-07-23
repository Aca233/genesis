# 05 · API 设计

## 1. 总体约定

- Route Handler 返回的世界数据以活动 Timeline 为边界；跨现实 ID 一律拒绝。
- 普通 JSON 错误只包含安全中文信息，不下发堆栈、SQL、Key、租约 token、私有输出或内部 ID。
- chat、settlement、rewrite 共享 `TaskProgressEvent` SSE 协议。
- 客户端断开 SSE 不取消后台任务；刷新后由 state API 恢复 durable 状态。
- `Chapter` 仅是内部检查点标识。API 可以使用 `chapterId` 作为内部路由参数，但 UI 不得把它呈现为章节。

## 2. 世界状态

### `GET /api/worlds/:worldId/state`

返回活动现实的连续正文、世界标题所需字段、检查点摘要和当前任务：

```ts
type PlayState = {
  world: { id: string; name: string; mode: "pantheon" | "creator" };
  temporal: { era: string; time: string };
  checkpoint: {
    segmentId: string;
    needsSettlement: boolean;
    settling: boolean;
  };
  operation: { kind: "chat" | "settlement" | "rewrite" } | null;
  taskProgress: DurableTaskProgress | null;
  messages: MessageRow[];
};
```

前端标题固定组合为：

```text
world.name + temporal.era + temporal.time
```

正文始终可读；taskProgress 只附着状态条，不用全屏“读取中”遮挡已有内容。

## 3. 正文生成

### `POST /api/chat`

提交普通输入、续写或 Creator 统一意图。每个 generationId 只能拥有一个后台 owner。

执行语义：

1. `reserved`：保留请求与世界操作租约；
2. `context_ready`：上下文已构建；
3. `generating`：唯一一次 Narrator 正在流式生成；
4. `output_stored`：完整正文和 META 已保存为私有快照；
5. `applying`：事务写入正文、状态、动态和事件；
6. `completed`：durable completion 可重复读取。

重试同一 generationId：

- `generating` 前失败可重新生成；
- `output_stored` / `applying` 失败直接复用快照，禁止第二次 Narrator 调用；
- `completed` 重放只返回既有完成结果。

## 4. 世界动态

### `GET /api/worlds/:worldId/activities`

查询参数：

| 参数 | 规则 |
|---|---|
| `limit` | 可选，默认 30，范围 1–50 |
| `before` | 可选，ISO 时间游标；只取更早记录 |

响应：

```ts
type ActivitiesResponse = {
  focusedEvent: ProjectedWorldEvent | null;
  importantEvents: ProjectedWorldEvent[];   // 当前关注优先，其余按更新时间
  recentActivities: ProjectedWorldActivity[];
  nextCursor: string | null;
};
```

服务端先按活动 Timeline 和可见性查询，再做一次序列化投影防护：

- Pantheon / Creator limited：只返回 `public`、`player_known`；
- Creator omniscient：返回全部；hidden 附“世界内尚未知晓”标记；
- 只列出未解决的重要事件；近期动态按时间倒序分页；
- 请求本身不调用 LLM、不推进时间。

## 5. 单一事件关注

### `PUT /api/worlds/:worldId/events/:eventId/focus`

关注或替换当前事件。仅接受活动 Timeline 中未解决且 `resolvedAt=null` 的事件。

```json
{ "focusedEventId": "event-id" }
```

重复 PUT 同一事件幂等。UI 在替换已有关注时先进行本地确认，API 始终以最后一次合法 PUT 为准。

### `DELETE /api/worlds/:worldId/events/:eventId/focus`

仅当该事件正被关注时清空；否则保持当前值，重复调用幂等。

```json
{ "focusedEventId": null }
```

两种方法都只更新 `ObserverState.focusedEventId`，不调用 LLM、不生成正文、不切换场景。

## 6. 世界整理

### `POST /api/chapters/:segmentId/settle`

`segmentId` 是内部检查点 ID。接口启动或接管 durable settlement runner，并通过统一 SSE 报告：

```text
checkpoint_read → pantheon → extract → chronicle → snapshot → completed
```

整理失败保留 `settleError / settleRetryable / settleUpdatedAt`，再次 POST 从断点继续。浏览器断开后后台整理继续。

Phase 4 在此流程中加入重复动态合并、普通动态升级、事件推进/解决/派生和关注自动清理；不得暴露“结束本章”的玩家操作。

## 7. 现实改写

### `POST /api/worlds/:worldId/rewrites`

Creator 的 Narrator 返回 `retroactive_rewrite` 后建立任务。客户端不选择 scope；服务端执行白名单 plan、现实克隆、应用、结果正文、整理和切换。

### `GET /api/rewrites/:rewriteId/events`

使用统一 `TaskProgressEvent` 输出真实 rewrite 阶段。源现实不写临时正文、动态或事件；Phase 4 克隆 `WorldEvent / WorldActivity / focusedEventId` 并重映射所有引用。

## 8. 统一 SSE

```ts
type TaskProgressEvent =
  | {
      type: "progress";
      taskId: string;
      taskKind: "chat" | "settlement" | "rewrite";
      stage: string;
      status: "running" | "completed";
      detail?: string;
      occurredAt: string;
    }
  | { type: "text"; taskId: string; content: string }
  | {
      type: "failed";
      taskId: string;
      stage: string;
      message: string;
      retryable: boolean;
    }
  | {
      type: "done";
      taskId: string;
      followUp:
        | { kind: "none" }
        | { kind: "settlement"; segmentId: string }
        | { kind: "rewrite"; taskId: string };
    };
```

`DurableTaskProgress`：

```ts
type DurableTaskProgress = {
  taskKind: "chat" | "settlement" | "rewrite";
  taskId: string;
  stage: string;
  status: "running" | "failed" | "completed";
  retryable: boolean;
  safeError?: string;
  updatedAt: string;
};
```

SSE 只报告真实步骤，不伪造百分比或预计时间。失败停在具体 stage；可重试时显示“从此处重试”，不可重试时只提供“刷新世界”。

## 9. 存档 API

### `GET /api/worlds/:worldId/export`

v4 私有存档保留全部现实、hidden 内容、事件链、动态和关注引用；排除租约、私有输出快照和内部错误。

### `POST /api/worlds/import`

- v4：为现实图、消息、对象、事件和动态预生成新 ID，再重映射全部引用；
- v2/v3：缺失 `WorldEvent / WorldActivity` 时补空集合，缺失 `focusedEventId` 时补 `null`；
- 旧存档导入不重新调用 LLM，不制造历史动态；
- 非法现实图、跨现实引用或悬空关注必须拒绝并整体回滚。

v4 存档与现实事件图克隆属于 Phase 4 的既定兼容目标；在该阶段完成前不得把未实现字段标记为已往返验证。
