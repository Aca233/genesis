# 世界自适应图标系统设计

**日期：** 2026-07-24

**状态：** 实施中；当前基于 settlement／reality 事务落地兼容垂直切片

**目标项目：** 创世
**架构名称：** World-Adaptive Icon System（世界自适应图标系统）

---

## 1. 摘要

《创世》可以容纳仙侠、太空歌剧、赛博朋克、现代都市、原始部落、恐怖和多 IP 融合等任意世界观。固定使用羊皮卷、魔法书或中世纪纹章会把产品外壳误当成世界设定，无法覆盖这种开放性。

本设计把图标分成两个稳定边界：

1. **产品操作层**：关闭、返回、发送、编辑、删除、设置、导入和导出等操作永久使用固定 Phosphor 图标，不随世界改变。
2. **世界叙事层**：导航、实体、神明、能力、事件、素材、创世卡、纪元和现实分支等视觉母题由世界主题决定。

系统以内置的约 500 枚精选图标组成版本化语义目录。LLM 不生成 SVG，也不直接选择任意 Iconify ID，而是在创世结构化输出中选择图标家族、视觉特征和稳定语义令牌。服务端把令牌确定性解析为本地图标，并将结果随世界和现实持久化。

核心原则是：

> 操作语义跨世界保持稳定，叙事母题随世界变化；LLM 只做受控选择，程序负责验证、解析、回退、授权和渲染。

---

## 2. 已确认的产品决策

以下决策已经确认，实施阶段不再重新选择：

1. 第一期完整覆盖叙事层，包括导航、实体纹章、神明、能力、事件、素材库、创世卡和叙事状态。
2. 关闭、返回、删除、发送、编辑、重试、设置等通用操作图标不随世界变化。
3. 不保留旧世界和 v1–v3 存档兼容；导入端只接受 v4，旧版本在任何写事务开始前明确拒绝。
4. 新世界的初次图标主题并入现有创世卡组生成响应，不增加独立模型调用。
5. 每个世界只允许一个主图标家族和一个纹章图标家族。
6. 玩家修改创世卡后不自动重算主题；提供手动“重铸图标主题”。
7. 允许使用 CC BY 图标集，并统一生成实际使用图标的署名清单。
8. 后续新增人物、神明、能力、事件和动态在既有结构化 LLM 输出中携带 `iconConcept`，不增加独立调用。
9. 玩家可以手动覆盖单个图标；玩家选择会锁定，主题重铸不得覆盖。
10. 图标选择器只搜索当前世界的主图标集和纹章图标集。
11. `WorldIconTheme` 为世界级共享配置；单项覆盖属于时间线，现实分叉时复制并重写对象 ID。
12. 第一期目录约 500 枚人工精选图标，不直接开放完整的数万枚图标集。
13. 采用版本化语义令牌目录为主体，实体纹章使用“程序外框 + 目录 motif”的组合方案。

---

## 3. 与 World Director Runtime 的边界

### 3.1 当前接入基线

仓库当前没有可接入的 World Director Runtime Phase 6、`DraftChangeSet` 或 `ProjectionPlan` 实现，因此它不再作为图标系统的实施前置条件。当前版本接入现有的 settlement、能力抽取、世界动态结算和 reality 事务，并保持未来迁移所需的边界清晰。

当前共用改动面包括：

```text
prisma/schema.prisma
prisma/migrations/*
src/lib/settle/pipeline.ts
src/lib/abilities/extraction.ts
src/lib/world-activity/settlement.ts
src/lib/reality/clone.ts
src/app/play/[worldId]/page.tsx
src/components/play/types.ts
src/components/play/RuneRail.tsx
src/components/play/PlayDrawer.tsx
src/components/play/CodexPanel.tsx
src/components/play/ChroniclePanel.tsx
src/components/play/WorldActivityPanel.tsx
```

图标分配必须作为非事实附属数据与对象创建处于同一事务；分配失败不得改变世界事实提交语义。未来若 World Director Runtime 落地，应迁移同一契约，而不是保留两套分配路径。

### 3.2 当前接入点与未来迁移契约

当前结构化抽取结果携带 `iconConcept`，由服务端验证、确定性解析并在相同事务写入：

```text
Extractor / Settlement structured output
→ entity / god / ability / event create
→ iconConcept
→ schema 拒绝 Iconify ID、SVG 和 path payload
→ IconResolver 确定性解析
→ 与本轮世界变化在同一事务写入 IconAssignment
```

当前字段至少覆盖：

```text
newEntities[].iconConcept
newGods[].iconConcept
abilityChanges[].iconConcept
world activity create／derive event iconConcept
```

### 3.3 与世界事实的边界

- 图标属于非事实视觉投影，不改变 `CanonicalChangeSet` 的世界事实含义。
- 图标主题和玩家换图属于纯 UI／配置操作，不创建 `WorldDirectorRun`。
- 图标不进入因果校验和正文双向证据审计。
- `iconConcept` 不要求正文逐字证明；其所属对象本身仍必须通过创建或变化证据校验。
- 图标解析不计入每轮最多四次 LLM 调用。
- 自动解析失败时使用确定性兜底，不得导致原子世界提交失败。
- 玩家锁定覆盖必须进入现实修订和分叉语义；自动视觉推导不需要成为独立世界事实。

---

## 4. 图标来源和目录范围

### 4.1 基础设施

使用 Iconify 的统一数据格式和按图标集拆分的本地包，但不依赖 Iconify 公共运行时 API。

候选图标集：

| 图标集 | 主要用途 | 许可证 |
|---|---|---|
| Phosphor | 固定产品操作层、通用叙事主题 | MIT |
| Tabler Icons | 科技、工业、现代和结构性概念 | MIT |
| IconPark Outline | 东方物件、生活物件和抽象母题 | Apache 2.0 |
| Game Icons | 能力、神明、生物、武器、法则和纹章 | CC BY 3.0 |

Material Symbols 可以作为目录制作阶段的覆盖兜底，但第一期不默认选为世界主家族。

### 4.2 本地化要求

- 图标数据随应用构建和部署。
- 运行时不访问第三方 Iconify API。
- 不把完整图标集或约 500 枚目录全部发送到客户端。
- 客户端只接收当前页面实际需要的 SVG 数据。
- 不把几万个独立 SVG 文件无选择地复制到 `public`。
- 不把完整 SVG 字符串作为存档真源。

### 4.3 精选目录

目录约 500 枚图标，覆盖：

- 导航与世界结构；
- 文明、科技、自然、宗教、魔法和社会；
- 神明、人物、势力、种族、地点、遗物和教团；
- 能力、法则、状态和代价；
- 世界事件、活动和编年史；
- 创世卡和素材库类别；
- 现实、时间、纪元、分支和观察；
- 仙侠、科幻、赛博、现代、原始、恐怖和混合世界的常用母题。

每个目录条目使用稳定语义令牌，不以第三方图标 ID 作为业务接口。

---

## 5. 核心数据结构

### 5.1 图标家族

```ts
type IconFamily =
  | "phosphor"
  | "tabler"
  | "iconPark"
  | "gameIcons";
```

主图标家族允许：

```text
phosphor
tabler
iconPark
```

纹章图标家族允许：

```text
gameIcons
phosphor
iconPark
```

### 5.2 目录条目

```ts
type IconCatalogEntry = {
  token: string;
  role: "interface" | "narrative" | "emblem";
  concepts: string[];
  families: Partial<Record<IconFamily, string>>;
  genres: string[];
  tones: string[];
  attribution?: AttributionRecord;
};
```

示例：

```ts
{
  token: "reality.branch",
  role: "narrative",
  concepts: ["现实", "分支", "时间线", "岔路"],
  families: {
    phosphor: "ph:git-fork",
    tabler: "tabler:binary-tree-2",
    iconPark: "icon-park-outline:tree-diagram",
  },
  genres: ["universal"],
  tones: ["structural", "mystical"],
}
```

目录必须有显式 `catalogVersion`。存档保存令牌和版本，目录可以在不批量迁移世界记录的情况下替换真实图标映射。

### 5.3 世界主题

```ts
type WorldIconTheme = {
  version: 1;
  catalogVersion: 1;
  source: "generated" | "default";
  primaryFamily: "phosphor" | "tabler" | "iconPark";
  emblemFamily: "gameIcons" | "phosphor" | "iconPark";
  visualTone: string[];
  motifTags: string[];
  assignments: {
    navigation: Record<NavigationRole, string>;
    entityTypes: Record<EntityType, string>;
    abilityKinds: Record<string, string>;
    eventKinds: Record<string, string>;
    materialTypes: Record<string, string>;
    genesisCards: Record<string, string>;
    narrativeStates: Record<string, string>;
  };
  lockedAssignments: Record<string, string>;
};
```

规则：

- `WorldIconTheme` 属于 `World`，所有现实共享。
- 新世界保存生成主题。
- 旧世界不属于第一版支持边界，不要求读取兼容、后台回填或模型迁移。
- 世界级玩家覆盖进入 `lockedAssignments`。
- 主题重铸保留全部世界级和时间线级玩家锁定项。

### 5.4 时间线单项分配

```ts
type IconAssignment = {
  subjectType: "entity" | "god" | "ability" | "event";
  subjectId: string;
  token: string;
  source: "generated" | "derived" | "player";
  playerLocked: boolean;
};
```

时间线级分配用于对象级图标和玩家覆盖。它不承担世界级导航、创世卡或素材分类配置。

---

## 6. 持久化模型

### 6.1 World

在 `World` 增加：

```prisma
iconTheme Json? @map("icon_theme")
```

真实 Iconify ID 和 SVG 不是数据库真源。必要时可以作为可重建缓存保存，但导入导出以主题、令牌和目录版本为准。

### 6.2 IconAssignment

```prisma
model IconAssignment {
  id           String   @id @default(cuid())
  timelineId   String   @map("timeline_id")
  timeline     Timeline @relation(fields: [timelineId], references: [id], onDelete: Cascade)

  subjectType  String   @map("subject_type")
  subjectId    String   @map("subject_id")
  token        String
  source       String
  playerLocked Boolean  @default(false) @map("player_locked")

  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([timelineId, subjectType, subjectId])
  @@index([timelineId])
  @@map("icon_assignments")
}
```

`subjectId` 不设置跨多张目标表的外键。服务层写入前必须验证对象属于当前时间线；删除对象的服务必须同步清理分配。时间线删除由级联清理。

### 6.3 现实分叉

现实分叉复制 `IconAssignment`，并通过既有克隆映射重写 `subjectId`：

```text
entity → entityIds
god → godIds
ability → abilityIds
event → eventIds
```

无法映射的分配不得原样复制。它应被跳过并记录完整性问题，避免新现实引用源现实对象。

`WorldIconTheme` 不复制，因为所有现实共享同一个世界主题。

---

## 7. 图标解析器

核心解析接口：

```ts
resolveIcon({
  theme,
  token,
  subjectType,
  subjectId,
  override,
}): ResolvedIcon
```

返回：

```ts
type ResolvedIcon = {
  id: string;
  token: string;
  family: IconFamily;
  license: string;
  attribution?: AttributionRecord;
};
```

解析顺序：

1. 当前现实中的玩家锁定覆盖；
2. 当前现实中的自动单项分配；
3. 世界级玩家锁定分配；
4. 世界主题的类别分配；
5. 语义令牌在当前指定家族中的映射；
6. 当前类别的固定默认令牌；
7. 固定 Phosphor 未知图标。

约束：

- 业务组件不能直接传任意 Iconify ID。
- 主图标家族不得使用纹章专用映射。
- 纹章 motif 不得跨到未选择的图标家族。
- 相同输入必须产生相同结果。
- 任何错误都必须局部回退。

---

## 8. 初次生成和重铸

### 8.1 初次主题

初次主题并入新世界的创世卡组结构化输出：

```json
{
  "iconTheme": {
    "primaryFamily": "iconPark",
    "emblemFamily": "gameIcons",
    "visualTone": ["organic", "ritual", "delicate"],
    "motifTags": ["星轨", "骨瓷", "潮汐"],
    "assignments": {
      "navigation": {
        "activity": "world.activity",
        "starmap": "cosmos.constellation",
        "chronicle": "chronicle.archive",
        "god": "divinity.pantheon",
        "creator": "observer.transcendent",
        "realities": "reality.branch",
        "lore": "knowledge.codex",
        "codex": "people.collective"
      }
    }
  }
}
```

Prompt 只包含：

- 允许的家族枚举；
- 按类别压缩的语义令牌；
- 令牌简短中文含义；
- 一个主家族和一个纹章家族的约束；
- 避免把所有世界固定解释成古籍或中世纪奇幻的要求。

服务端处理：

1. Zod 验证结构；
2. 删除不存在或类别不符的令牌；
3. 检查令牌在所选家族是否有映射；
4. 缺失项按世界标签和默认规则补齐；
5. 永远产出完整可用主题；
6. 图标主题失败不得让创世任务失败。

### 8.2 创世卡编辑

创世卡编辑页展示紧凑主题预览：

- 主图标家族；
- 纹章家族；
- 视觉关键词；
- 右缘导航实际排列；
- 一个实体纹章、能力图标和事件图标样例；
- “重铸图标主题”次级操作。

玩家修改宇宙论、主题或风格卡后：

- 不自动重算；
- 显示“世界设定已修改，可重新铸造图标主题”；
- 玩家可以忽略提示继续创世。

### 8.3 重铸

重铸读取当前最终卡组，单独调用主题生成：

```text
读取当前卡组
→ 生成候选主题
→ Zod 和目录校验
→ 成功后原子替换
```

要求：

- 重铸期间继续显示旧主题；
- 使用幂等键并防止重复提交；
- 只有完整校验通过才替换；
- 失败时保留旧主题；
- 保留所有玩家锁定项；
- 已开始游玩的世界重铸时明确提示会改变所有未锁定叙事图标；
- 重铸是配置操作，不创建 World Director Run。

---

## 9. 新对象和 Agent 运行时

### 9.1 iconConcept

World Director 的创建和投影草案可以携带：

```ts
iconConcept?: string;
```

推荐输出目录令牌：

```json
{
  "name": "逆熵祷告",
  "abilityKind": "ritual",
  "iconConcept": "time.reverse"
}
```

为了兼容自然语言，解析器支持：

1. 精确令牌匹配；
2. 令牌别名和 `concepts` 匹配；
3. 对象类型默认令牌；
4. 使用 `worldId + subjectType + subjectId` 确定性选择候选；
5. 保存最终自动分配，避免后续漂移。

### 9.2 原子投影

Agent 的规划输出冻结后，图标解析进入 ProjectionPlan：

```text
已验证 DraftChangeSet
→ CanonicalChangeSet
→ ProjectionPlan
→ 预解析所有 iconConcept
→ 世界事务中写实体、能力、事件和 IconAssignment
```

事务开始前必须把所有可能失败的目录查找和授权验证完成。进入事务后只执行确定性写入和固定兜底。

如果自动图标无法解析：

- 世界事实照常提交；
- 对象使用类别默认图标；
- 不启动第二个模型；
- 不重试整轮 Agent Run。

---

## 10. 渲染组件

### 10.1 OperationIcon

```tsx
<OperationIcon name="close" />
```

职责：

- 固定使用 Phosphor；
- 覆盖返回、关闭、确认、取消、添加、编辑、删除、发送、停止、重试、搜索、筛选、导入、导出、复制、下载、设置和状态反馈；
- 不读取 `WorldIconTheme`；
- 不参与 LLM 选择。

### 10.2 WorldIcon

```tsx
<WorldIcon token="chronicle.archive" />
```

职责：

- 只接受语义令牌；
- 读取当前世界主题和时间线覆盖；
- 解析为本地 SVG；
- 使用 `currentColor`；
- 图标失败时原位显示固定兜底；
- 不因后加载发生布局位移。

### 10.3 Emblem

现有 `Emblem.tsx` 保留确定性的外框、名字哈希和上传图优先级，内部 motif 改为目录图标：

```tsx
<Emblem
  seed={entity.emblemSeed}
  motifToken={resolvedToken}
  family={theme.emblemFamily}
/>
```

要求：

- 上传图片拥有最高显示优先级；
- 30px 以下使用简化 motif；
- 40px 以上显示完整程序外环；
- 高复杂度图标使用目录中的简化映射；
- 全部单色化，不直接显示彩色图标。

---

## 11. 界面行为

### 11.1 右缘符文

替换现有 Emoji 和 Unicode 混排：

```text
◌ ✦ 📜 ◈ ◉ ⌘ 📖 👥 ⚱
```

新的导航统一使用 SVG：

```tsx
<WorldIcon token={tab.iconToken} />
```

状态规范：

- 默认使用 `var(--ink-soft)`；
- 当前页签使用 `var(--gilt)`；
- 未读使用已有烫金微焕，不更换图形；
- 手机底部栏使用同一图标和标签；
- 设置属于固定操作层；可以使用固定 Phosphor 图标或项目自定义单色香炉 SVG，但不随世界变化。

### 11.2 单项选择器

选择器使用右侧抽屉或详情区，不新增阻断式模态框：

1. 当前图标与来源；
2. 12–24 枚语义推荐；
3. 搜索框；
4. 主库／纹章库切换；
5. 类别和母题筛选；
6. 分页结果；
7. “恢复随世界主题”。

交互：

- 单击预览；
- 再次确认或双击应用；
- 方向键移动；
- `Enter` 选择；
- `Escape` 关闭；
- 选中状态同时使用边框、勾选和文字；
- 不一次渲染约 500 枚图标。

玩家选择写入：

```text
source = player
playerLocked = true
```

恢复自动主题会解除该覆盖并重新执行确定性解析。

---

## 12. 可访问性和视觉一致性

### 12.1 尺寸和重量

- 正文内操作：16px；
- 普通按钮：18px；
- 右缘导航：20px；
- 最小点击区域约 40×40px；
- 固定操作默认 Phosphor `regular`；
- 次级操作可以使用 `light`；
- 选中状态通过颜色、背景和文字表达，不依赖换图。

### 12.2 辅助语义

- 有邻近文本的装饰图标使用 `aria-hidden="true"`。
- 纯图标按钮必须有稳定的 `aria-label`。
- 辅助名称描述功能，不描述世界皮肤：始终是“打开现实树”，不是“打开命运枝杈”。
- 选择器图标必须有中文概念名。
- 成功、危险、选中和未读不能只靠颜色或图形表达。
- 尊重 `prefers-reduced-motion`，关闭烫金微焕。

### 12.3 一致性约束

每个世界必须满足：

- 一个主图标家族；
- 一个纹章图标家族；
- 同一尺寸档位使用统一视觉重量；
- 所有动态图标单色化并继承产品主题色；
- 导航不混用 Emoji；
- 不给每个图标增加独立发光底座；
- 世界差异来自母题，不任意改变字号、按钮结构和交互方式。

---

## 13. 错误处理

### 13.1 初次生成

- `iconTheme` 缺失：生成完整默认主题；
- 主家族非法：回退 Phosphor；
- 纹章家族非法：回退程序纹章默认 motif；
- 部分令牌非法：只替换错误项；
- 全部图标字段非法：世界仍正常创建；
- 不向玩家显示模型原始错误输出。

### 13.2 重铸

- 保留旧主题直到新主题完整通过；
- 失败时不产生半更新；
- 显示简洁可重试错误；
- 旧响应不得覆盖更新的主题版本。

### 13.3 解析和渲染

- 当前家族缺少映射：使用同令牌默认家族；
- 令牌不存在：使用对象类别默认令牌；
- SVG 数据损坏：使用固定 Phosphor 未知图标；
- 单个图标失败不影响同页其他内容；
- 选择器保存失败时恢复旧图标。

---

## 14. 导入、导出和授权

### 14.1 存档 v4

```json
{
  "version": 4,
  "world": {
    "iconTheme": {}
  },
  "timelines": [
    {
      "iconAssignments": []
    }
  ]
}
```

导入规则：

- 只接受 v4；v1–v3 和未知版本在任何数据库写事务前返回 400；
- v4 校验世界图、家族、目录版本和令牌；
- 未知家族回退到固定默认值；
- 未知令牌逐项回退；
- 非法单项覆盖被丢弃并进入导入摘要；
- 图标错误不得阻断正文、世界状态或现实树导入。

### 14.2 授权记录

```ts
type AttributionRecord = {
  collection: string;
  icon: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
};
```

系统按实际使用的真实图标去重生成清单：

- 设置页“图标与开源许可”；
- 世界导出包 `ICON-CREDITS.md`；
- EPUB 版权／来源页；
- 纯文本 Markdown 不包含图标时不强制附加图标署名；
- CC BY 图标保留具体作者；
- 玩家上传图片不进入开源图标署名清单。

---

## 15. 测试策略

### 15.1 目录和解析器

- 所有语义令牌唯一；
- 所有真实图标映射有许可证；
- CC BY 映射包含作者和来源 URL；
- 每个允许的主家族覆盖全部必需导航令牌；
- 所有对象类别都有默认令牌；
- 解析器覆盖优先级正确；
- 相同输入产生相同输出；
- 主库和纹章库不会跨用；
- 非法令牌逐级回退；
- 自然语言 `iconConcept` 能匹配或确定性兜底。

### 15.2 Agent 和事务

- `iconConcept` 被严格 schema 接受，任意 Iconify ID 或 SVG 被拒绝；
- 图标字段异常不导致 Agent 世界事实失败；
- 自动分配随本轮投影原子写入；
- 图标失败不消耗额外 LLM 调用；
- 图标不进入因果或证据审计；
- 重铸保留玩家锁定项。

### 15.3 现实和存档

- 现实分叉复制分配并按对象映射重写 ID；
- 源现实和子现实的单项覆盖互不污染；
- 删除现实级联删除分配；
- v1–v3 导入明确拒绝且不启动写事务；
- v4 未知令牌不阻断导入；
- 导出只汇总实际使用的 CC BY 图标。

### 15.4 组件和交互

- `OperationIcon` 不读取世界主题；
- `WorldIcon` 随主题正确解析；
- `RuneRail` 不再渲染 Emoji；
- 当前、未读和禁用状态不只依赖图标；
- 选择器只搜索当前世界两个家族；
- 键盘可以完成搜索、预览、选择和恢复；
- 上传图片优先于程序纹章；
- 小尺寸纹章使用简化 motif；
- 辅助名称保持功能语义。

---

## 16. 性能目标

- 不调用 Iconify 公共 API；
- 首屏不下载完整图标集；
- 图标目录不进入客户端主包；
- 首屏只携带当前页面实际使用的 SVG；
- 右缘导航不出现明显后加载闪变；
- 选择器按搜索词和分页返回；
- 当前世界解析结果按主题版本、时间线和令牌缓存；
- 重铸和单项覆盖精确失效缓存；
- 新内容图标不增加独立 LLM 调用。

---

## 17. 人工视觉验收

至少使用以下世界进行验收：

1. 东方仙侠；
2. 太空歌剧；
3. 赛博朋克；
4. 现代都市；
5. 原始部落；
6. 宇宙恐怖；
7. 混合世界，例如“修仙宗门驾驶生物星舰”。

每个世界检查：

- 主图标家族内部一致；
- 纹章家族内部一致；
- 导航语义仍可识别；
- 没有被强行套成中世纪奇幻；
- 操作图标完全一致；
- 人物、能力和事件母题符合世界；
- 重铸前后玩家锁定项不变；
- 切换现实不会更换整个世界的视觉语言。

---

## 18. 完成标准

第一版完成必须同时满足：

- 约 500 枚精选目录落地并通过完整性测试；
- 新世界生成完整 `WorldIconTheme`；
- 导入只接受 v4，v1–v3 不进入写事务；
- 已确认的全部叙事入口支持动态图标；
- 操作层统一固定为 Phosphor；
- 当前结构化创建／结算入口支持严格 `iconConcept`；
- 图标分配与对象创建、世界动态和现实变化正确集成；
- 世界主题重铸可用；
- 单项选择、锁定和恢复可用；
- 现实分叉正确继承时间线覆盖；
- v4 存档和署名清单可导入导出；
- 自动测试通过；
- 七类代表世界完成视觉验收。

---

## 19. 推荐实施顺序

按以下顺序实施并验证：

1. 目录契约、精选数据和完整性测试；
2. `WorldIconTheme`、`IconAssignment` 和迁移；
3. `IconResolver`、本地 SVG 加载和缓存；
4. 固定 `OperationIcon` 和动态 `WorldIcon`；
5. 创世主题生成、校验、预览和重铸；
6. 扩展当前结构化抽取和结算 schema 的 `iconConcept`；
7. 接入 settlement／reality 原子提交和现实克隆；
8. 改造实体纹章、导航、能力、事件、素材和创世卡界面；
9. 单项选择器、锁定和恢复；
10. v4 导入导出、许可清单和视觉验收。

未来引入 World Director Runtime 时，必须以相同 `iconConcept`、`IconAssignment` 和原子提交契约迁移当前接入点，并删除旧路径，不能并存两套真源。
