# 创世模式联动背景实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use $team (coordinated parallel execution) or $ralph (persistent single-owner completion) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成两张抽象世界模式氛围图，并把它们作为首页专用叠层接入现有日／烛星图背景，使“诸神共世”和“创世主”切换时产生稳定、可读、可降级的视觉反馈。

**Architecture:** 保留 `PlayBackground` 作为通用日／烛底图，新建只服务首页的 `GenesisModeBackground`，同时挂载并预加载两张模式图片，以现有 `worldMode` 驱动 `opacity` 交叉淡入。主题差异完全由 `html[data-theme="candle"]` 下的 CSS 变量控制；图片失败时组件移除失败图层并自然退回现有星图背景。

**Tech Stack:** 内置 `image_gen`（`gpt-image-2`）、PNG、FFmpeg 7、WebP、Next.js 16.2 App Router、`next/image`、React 19、Tailwind CSS v4、Vitest 4。

## Global Constraints

- 在当前脏主工作区之外创建隔离 worktree 和 `codex/genesis-mode-backgrounds` 分支执行；不得覆盖、暂存或提交主工作区现有未提交改动。
- 两张模式母版均为 `2048 × 1152`、16:9，并使用相同视角、主体中心和空间尺度。
- 模式资产是低透明度氛围叠层，不替换现有 `play-celestial-day.webp` 与 `play-celestial-candle.webp`。
- “诸神共世”由 5–7 枚星核构成不完全环阵，中央留空；“创世主”只保留一枚主星核和一道巨型世界环轮。
- 主要视觉结构放在中央偏上；表单所在中下区域保持低频、低对比；中央主体必须能承受 `390px` 手机的 `cover` 裁切。
- 不出现人物、面孔、手、动物、建筑、武器、文字、字母、数字、伪文字、现实宗教符号、徽标、水印或 UI。
- 不新增粒子、视差、WebGL、音效、常驻计时器或持续滤镜动画。
- 模式切换只动画 `opacity`，时长 `600ms`；`prefers-reduced-motion: reduce` 下直接切换。
- 两张 WebP 在首页同时预加载；Next.js 16 使用 `preload`，不得使用已弃用的 `priority`。
- 图片加载失败不得影响表单、主题切换或创世请求；现有日／烛背景始终作为后备。
- 不修改世界模式业务逻辑、创世 API 负载、数据库或其他页面。
- 修改前以 `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` 和 `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md` 为 Next.js 16 行为依据。
- 源码修改遵守仓库编辑策略：语义修改使用原生 `apply_patch`；Shell 只用于测试、构建、Git、二进制资产复制和 FFmpeg 转码。

---

## 文件结构

- Create: `art/backgrounds/genesis-mode-pantheon-source.png` — “诸神共世”无损母版。
- Create: `art/backgrounds/genesis-mode-creator-source.png` — “创世主”无损母版。
- Create: `public/images/backgrounds/genesis-mode-pantheon.webp` — 首页使用的“诸神共世”网页资产。
- Create: `public/images/backgrounds/genesis-mode-creator.webp` — 首页使用的“创世主”网页资产。
- Create: `src/components/genesis/GenesisModeBackground.tsx` — 两张模式叠层、预加载和失败降级。
- Create: `src/components/genesis/GenesisModeBackground.test.tsx` — 组件结构、状态类、预加载与可访问性测试。
- Create: `src/lib/genesis/home-background-contract.test.ts` — 首页挂载与全局样式契约测试。
- Modify: `src/app/page.tsx` — 将现有 `worldMode` 传给首页模式背景。
- Modify: `src/app/globals.css` — 四种主题／模式组合、交叉淡入、保护遮罩、移动端与减少动态效果样式。

### Task 1: 生成并验收“诸神共世”母版

**Files:**
- Create: `art/backgrounds/genesis-mode-pantheon-source.png`

**Interfaces:**
- Consumes: `docs/omx/specs/2026-07-25-genesis-mode-linked-background-design.md`；现有两张星图背景只作为风格与色温参考，不作为编辑目标。
- Produces: 一张通过构图、安全区和内容检查的 `2048×1152` PNG，供 Task 2 作为构图编辑目标。

- [ ] **Step 1: 在隔离 worktree 中准备生成参考**

先用 `view_image` 查看：

```text
public/images/backgrounds/play-celestial-day.webp
public/images/backgrounds/play-celestial-candle.webp
```

它们的角色均为“风格、纸张质感和克制程度参考”。不得把已有底图直接烘焙进新图，也不得覆盖已有资产。

- [ ] **Step 2: 使用内置 `image_gen` 生成母版**

分类为 `stylized-concept`，以两张已有背景作为参考图，使用以下完整提示词：

```text
Use case: stylized-concept
Asset type: low-opacity full-screen atmosphere layer for the world-mode selector of a text-heavy Chinese worldbuilding game
Input images:
- Image 1 is a style reference for the existing daylight celestial-parchment background.
- Image 2 is a style reference for the existing candle-dark celestial-parchment background.
- Do not reproduce either reference as a complete background. Create a separate mode-symbolism atmosphere plate that can be overlaid on both at low opacity.

Primary request:
Create the “Pantheon / Many Gods Coexisting” mode atmosphere plate. Show five to seven abstract celestial cores of different sizes and restrained brightness arranged as an incomplete council-like orbital ring around a calm empty central seat. Interweave several fine orbital paths to imply independent powers, relationships, balance, and shared world-making.

Canvas and composition:
- Exact landscape canvas, 2048 × 1152, 16:9, perfectly straight-on flat 2D artwork.
- Keep the same visual camera and spatial scale that a matching single-creator variant can reuse.
- Place the primary ring structure in the central upper 44% of the canvas.
- Preserve the central lower 56% as a calm, low-frequency, low-contrast form-safe zone.
- Keep the central 45% of the canvas width meaningful after mobile cover-cropping.
- Let secondary arcs and extremely faint throne-like or star-gate silhouettes extend toward the left and right edges.
- Edges must continue naturally with no frame, page edge, vignette frame, or isolated poster boundary.

Visual language:
- Abstract ancient celestial cartography, quiet creation ritual, refined ink-wash nebulae, thin antique-gold orbital linework, deep neutral umber and smoky taupe field.
- The empty central seat is implied only by negative space inside the incomplete ring; do not draw a literal chair or throne.
- The five to seven cores should feel related but not identical and should not form a perfect mechanical mandala.
- Matte, subdued, scholarly, mysterious, premium game background artwork.
- Designed to be composited over both ivory parchment and dark candle parchment at roughly 25–35% opacity.
- Keep all highlights soft and muted; no bright white and no neon.

Hard constraints:
- No text of any language, letters, numbers, labels, captions, calligraphy, pseudo-writing, fake runes, logo, signature, or watermark.
- No people, gods, faces, eyes, hands, bodies, animals, creatures, buildings, temples, literal thrones, weapons, ships, or realistic planets.
- No recognizable real-world religion symbol.
- No UI, cards, buttons, input boxes, panels, borders, book, desk, scroll object, page edge, frame, perspective mockup, or screenshot.
- No dense star field, high-contrast explosion, hard spotlight, lens flare, cyberpunk neon, pure black void, or exact mirror symmetry.
- Do not place a bright core, orbital intersection, or dense texture in the lower form-safe zone.

The result must read as a restrained symbolic atmosphere layer for “many gods in balance,” remain secondary behind interface text, and provide a compositionally stable reference for a matching “single creator” edit.
```

若执行环境没有提供内置 `image_gen`，在此停止资产生成并向用户说明：可改用技能内置的 CLI `gpt-image-2` 流程，但该流程需要 `OPENAI_API_KEY`，只有用户明确同意后才能切换。不得用 CSS、SVG、占位渐变或其他模型静默替代已批准的生图资产。

生成结果保存于内置工具默认目录后，使用文件复制操作将选定结果复制为：

```text
art/backgrounds/genesis-mode-pantheon-source.png
```

不得覆盖同名文件；若执行时文件已经存在，先确认它是否属于本任务的已验收产物，否则保存为带版本号的候选文件并比较后再决定。

- [ ] **Step 3: 校验文件属性**

运行：

```powershell
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt -of default=noprint_wrappers=1 "art/backgrounds/genesis-mode-pantheon-source.png"
```

Expected:

```text
width=2048
height=1152
```

若内置生成器返回不同尺寸，只允许等比例居中缩放／裁切到 `2048×1152`；不得拉伸：

```powershell
ffmpeg -y -i "<generated-source.png>" -vf "scale=2048:1152:force_original_aspect_ratio=increase,crop=2048:1152" "art/backgrounds/genesis-mode-pantheon-source.png"
```

- [ ] **Step 4: 进行视觉验收**

用 `view_image` 检查：

```text
[ ] 有且仅有 5–7 枚主要星核
[ ] 星核形成不完全环阵，中央通过负空间留出空位
[ ] 主结构位于中央偏上，下半部足够平静
[ ] 中央 45% 宽度在手机裁切后仍能表达“多核制衡”
[ ] 两侧有克制延展，但没有精确镜像
[ ] 没有人物、建筑、字形、伪文字、宗教符号、UI 或水印
[ ] 低透明度叠加后仍可辨认，不依赖刺眼高光
[ ] 四边能被 `cover` 少量裁切
```

若只有一个局部问题，使用一次定向编辑修复，保留其余构图。例如：

```text
Edit only the lower form-safe region: remove the bright orbital crossing and restore calm low-frequency smoky-umber texture. Preserve every core, ring, side ornament, color relationship, camera, crop, and canvas size exactly. Add no text and no new object.
```

- [ ] **Step 5: 提交“诸神共世”母版**

```powershell
git add -- "art/backgrounds/genesis-mode-pantheon-source.png"
git commit -m "art: add pantheon mode atmosphere master"
```

### Task 2: 参考编辑“创世主”母版并验证构图连续性

**Files:**
- Create: `art/backgrounds/genesis-mode-creator-source.png`

**Interfaces:**
- Consumes: Task 1 的 `genesis-mode-pantheon-source.png`，角色为唯一编辑目标和精确构图参考。
- Produces: 同尺寸、同视角、同主体中心的单核心版本，供 Task 3 转码。

- [ ] **Step 1: 将“诸神共世”母版载入编辑上下文**

用 `view_image` 查看 `art/backgrounds/genesis-mode-pantheon-source.png`，并明确其角色为：

```text
Image 1: edit target and exact composition/camera reference
```

- [ ] **Step 2: 使用内置 `image_gen` 编辑为“创世主”**

使用以下完整提示词：

```text
Use case: precise-object-edit
Asset type: matching “Single Creator” world-mode atmosphere layer
Input image: Image 1 is the edit target and the exact composition, camera, crop, palette, texture, and spatial-scale reference.

Primary edit:
Transform the many-gods orbital council into a single-creator cosmic structure. Remove all secondary celestial cores and replace the council arrangement with exactly one principal creation core in the same central-upper visual anchor. Reconfigure the existing orbital paths into one immense incomplete world-ring or cosmic loom surrounding that core. Let restrained nebular and terrain-generating ripples expand outward from it.

Absolute preservation requirements:
- Preserve the exact 2048 × 1152 canvas, camera, crop, horizonless flat 2D viewpoint, central visual anchor, edge continuation, texture character, palette family, and overall contrast.
- Preserve the calm central-lower 56% form-safe zone.
- Preserve enough meaningful structure inside the central 45% width for mobile cover-cropping.
- Keep the same overall visual mass as Image 1 so crossfading feels like one cosmic mechanism changing state.

Creator-mode expression:
- Exactly one principal celestial core; no smaller companion core that could be read as another god.
- One immense incomplete world-ring or cosmic loom around the core.
- More surrounding negative space than the pantheon version, expressing solitary observation and singular authorship.
- Faint outward-generating ripples may suggest nebulae, continents, or the birth of laws, but must remain abstract and non-specific.
- Deep neutral umber, smoky taupe, restrained antique gold, matte and low contrast.
- Designed to overlay both daylight and candle parchment at roughly 25–35% opacity.

Hard constraints:
- No text, letters, numbers, labels, calligraphy, pseudo-writing, fake runes, logos, signature, or watermark.
- No people, creator figure, face, eye, hand, body, animal, creature, building, temple, weapon, ship, or realistic globe.
- No recognizable real-world religion symbol.
- No UI, cards, buttons, input boxes, panels, border, page edge, book, desk, frame, or screenshot.
- No bright white star, explosion, lens flare, neon, pure black void, dense particle field, or high-contrast focal glare.
- Do not crop, resize, tilt, change the camera, or brighten the lower form-safe zone.

The finished image must feel like the same ancient cosmic apparatus as Image 1 transformed from “many powers in balance” into “one solitary source of creation,” with no visible camera jump during a 600ms crossfade.
```

将选定结果复制为：

```text
art/backgrounds/genesis-mode-creator-source.png
```

- [ ] **Step 3: 校验尺寸**

```powershell
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt -of default=noprint_wrappers=1 "art/backgrounds/genesis-mode-creator-source.png"
```

Expected:

```text
width=2048
height=1152
```

- [ ] **Step 4: 生成临时叠图检查构图漂移**

```powershell
ffmpeg -y -i "art/backgrounds/genesis-mode-pantheon-source.png" -i "art/backgrounds/genesis-mode-creator-source.png" -filter_complex "[0:v][1:v]blend=all_mode=average" "art/backgrounds/genesis-mode-alignment-check.png"
```

用 `view_image` 检查临时叠图：

```text
[ ] 两张图的主体中心和观察视角一致
[ ] 主要环轮没有因整体平移形成明显双影
[ ] 纹理尺度和边缘延展一致
[ ] 下方安全区边界没有跳动
[ ] 创世主图只有一枚可读作主体的星核
[ ] 切换差异来自“多核 → 单核／单环”，而不是整幅换景
```

检查完后删除 `art/backgrounds/genesis-mode-alignment-check.png`，不要提交临时图。若主体整体漂移，重新以 Task 1 母版编辑一次，不用独立生成替代。

- [ ] **Step 5: 提交“创世主”母版**

```powershell
git add -- "art/backgrounds/genesis-mode-creator-source.png"
git commit -m "art: add creator mode atmosphere master"
```

### Task 3: 转码并验收网页资产

**Files:**
- Create: `public/images/backgrounds/genesis-mode-pantheon.webp`
- Create: `public/images/backgrounds/genesis-mode-creator.webp`

**Interfaces:**
- Consumes: Tasks 1–2 的两张 `2048×1152` PNG 母版。
- Produces: 两张稳定静态路径的 WebP，供 `GenesisModeBackground` 使用。

- [ ] **Step 1: 使用 FFmpeg 导出 WebP**

目录已经存在，不需要重建。运行：

```powershell
ffmpeg -y -i "art/backgrounds/genesis-mode-pantheon-source.png" -c:v libwebp -quality 82 -compression_level 6 -preset picture "public/images/backgrounds/genesis-mode-pantheon.webp"
ffmpeg -y -i "art/backgrounds/genesis-mode-creator-source.png" -c:v libwebp -quality 82 -compression_level 6 -preset picture "public/images/backgrounds/genesis-mode-creator.webp"
```

- [ ] **Step 2: 校验尺寸和体积**

```powershell
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt -of default=noprint_wrappers=1 "public/images/backgrounds/genesis-mode-pantheon.webp"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt -of default=noprint_wrappers=1 "public/images/backgrounds/genesis-mode-creator.webp"
Get-Item "public/images/backgrounds/genesis-mode-pantheon.webp","public/images/backgrounds/genesis-mode-creator.webp" | Select-Object Name,Length
```

Expected:

```text
两张均为 width=2048、height=1152
单张不超过 1.5 MB
```

若任一文件超过 `1.5 MB`，只把该图的 `-quality 82` 调整为 `-quality 76` 重导一次，不降尺寸。

- [ ] **Step 3: 对比 PNG 与 WebP**

用 `view_image` 分别查看两张 WebP，确认：

```text
[ ] 星轨细线没有明显断裂
[ ] 烟雾与低频渐变没有块状色带
[ ] 星核边缘没有严重糊边
[ ] WebP 没有引入伪文字般的压缩纹理
[ ] 构图和裁切与对应 PNG 一致
```

- [ ] **Step 4: 提交网页资产**

```powershell
git add -- "public/images/backgrounds/genesis-mode-pantheon.webp" "public/images/backgrounds/genesis-mode-creator.webp"
git commit -m "art: add optimized genesis mode backgrounds"
```

### Task 4: TDD 建立首页专用模式背景组件

**Files:**
- Create: `src/components/genesis/GenesisModeBackground.test.tsx`
- Create: `src/components/genesis/GenesisModeBackground.tsx`

**Interfaces:**
- Consumes: `WorldMode`、Task 3 的两个静态图片路径和后续 Task 5 的 CSS 类。
- Produces: `GenesisModeBackground({ mode }: { mode: WorldMode }): React.JSX.Element`。

- [ ] **Step 1: 写失败测试**

新建 `src/components/genesis/GenesisModeBackground.test.tsx`：

```tsx
import type { ImgHTMLAttributes } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GenesisModeBackground } from "./GenesisModeBackground";

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    preload,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    preload?: boolean;
  }) => (
    <img
      {...props}
      data-preload={preload ? "true" : "false"}
    />
  ),
}));

describe("GenesisModeBackground", () => {
  it.each([
    ["pantheon", "genesis-mode-background__image--pantheon"],
    ["creator", "genesis-mode-background__image--creator"],
  ] as const)("将 %s 图层设为激活态", (mode, activeClass) => {
    const html = renderToStaticMarkup(
      createElement(GenesisModeBackground, { mode }),
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(
      `/images/backgrounds/genesis-mode-pantheon.webp`,
    );
    expect(html).toContain(
      `/images/backgrounds/genesis-mode-creator.webp`,
    );
    expect(html).toContain(`${activeClass} is-active`);
    expect(html.match(/data-preload="true"/g)).toHaveLength(2);
    expect(html).not.toContain("role=");
    expect(html).not.toContain("tabindex=");
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
pnpm exec vitest run src/components/genesis/GenesisModeBackground.test.tsx
```

Expected: FAIL，因为 `GenesisModeBackground.tsx` 尚不存在。

- [ ] **Step 3: 编写最小组件实现**

新建 `src/components/genesis/GenesisModeBackground.tsx`：

```tsx
"use client";

import Image from "next/image";
import { useState } from "react";
import type { WorldMode } from "@/lib/world-mode";

const MODE_LAYERS: ReadonlyArray<{
  mode: WorldMode;
  src: string;
}> = [
  {
    mode: "pantheon",
    src: "/images/backgrounds/genesis-mode-pantheon.webp",
  },
  {
    mode: "creator",
    src: "/images/backgrounds/genesis-mode-creator.webp",
  },
];

export function GenesisModeBackground({ mode }: { mode: WorldMode }) {
  const [failed, setFailed] = useState<Record<WorldMode, boolean>>({
    pantheon: false,
    creator: false,
  });

  return (
    <div
      className={`genesis-mode-background genesis-mode-background--${mode}`}
      aria-hidden="true"
    >
      {MODE_LAYERS.map((layer) => (
        !failed[layer.mode] && (
          <Image
            key={layer.mode}
            src={layer.src}
            alt=""
            fill
            sizes="100vw"
            preload
            className={[
              "genesis-mode-background__image",
              `genesis-mode-background__image--${layer.mode}`,
              mode === layer.mode && "is-active",
            ].filter(Boolean).join(" ")}
            onError={() => {
              setFailed((current) => (
                current[layer.mode]
                  ? current
                  : { ...current, [layer.mode]: true }
              ));
            }}
          />
        )
      ))}
    </div>
  );
}
```

实现边界：

- 不读取主题状态；
- 不处理世界模式业务逻辑；
- 不渲染文案或交互节点；
- `onError` 只移除失败的图片，不切换 `mode`；
- 两张未失败图片始终挂载并设置 `preload`。

- [ ] **Step 4: 运行测试并确认通过**

```powershell
pnpm exec vitest run src/components/genesis/GenesisModeBackground.test.tsx
```

Expected: PASS，两个参数化用例均通过。

- [ ] **Step 5: 运行组件源码检查**

```powershell
pnpm exec eslint src/components/genesis/GenesisModeBackground.tsx src/components/genesis/GenesisModeBackground.test.tsx
```

Expected: PASS，无警告或错误。

- [ ] **Step 6: 提交组件**

```powershell
git add -- "src/components/genesis/GenesisModeBackground.tsx" "src/components/genesis/GenesisModeBackground.test.tsx"
git commit -m "feat: add genesis mode background layers"
```

### Task 5: TDD 接入首页并完成四态样式

**Files:**
- Create: `src/lib/genesis/home-background-contract.test.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: Task 4 的 `GenesisModeBackground` 和首页现有 `worldMode`。
- Produces: 首页四种主题／模式组合、`600ms` 交叉淡入、中央保护遮罩、移动端降噪与减少动态效果降级。

- [ ] **Step 1: 写失败的首页与样式契约测试**

新建 `src/lib/genesis/home-background-contract.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve(process.cwd(), "src/app/page.tsx"),
  "utf8",
);
const globalCss = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

describe("genesis mode background homepage contract", () => {
  it("passes the existing worldMode state into the visual layer", () => {
    expect(pageSource).toContain(
      'import { GenesisModeBackground } from "@/components/genesis/GenesisModeBackground";',
    );
    expect(pageSource).toContain(
      "<GenesisModeBackground mode={worldMode} />",
    );
  });

  it("defines crossfade, mobile attenuation, and reduced-motion fallback", () => {
    expect(globalCss).toContain(".genesis-mode-background__image");
    expect(globalCss).toContain(
      ".genesis-mode-background__image.is-active",
    );
    expect(globalCss).toContain("transition: opacity 600ms ease;");
    expect(globalCss).toContain("@media (max-width: 640px)");
    expect(globalCss).toContain(
      "@media (prefers-reduced-motion: reduce)",
    );
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
pnpm exec vitest run src/lib/genesis/home-background-contract.test.ts
```

Expected: FAIL，因为首页尚未导入／挂载组件，CSS 尚无模式图层选择器。

- [ ] **Step 3: 把模式图层挂载到首页**

在 `src/app/page.tsx` 的 import 区新增：

```tsx
import { GenesisModeBackground } from "@/components/genesis/GenesisModeBackground";
```

紧跟现有底图之后挂载：

```tsx
<PlayBackground variant="home" />
<GenesisModeBackground mode={worldMode} />
```

不要新增模式 state；不要改动 `setWorldMode(mode)`、`buildGenesisTaskPayload` 或创建按钮逻辑。

- [ ] **Step 4: 增加主题变量**

在 `src/app/globals.css` 的 `:root` 中、现有 `--play-background-opacity` 后加入：

```css
--genesis-mode-opacity: 0.28;
--genesis-mode-filter: saturate(0.72) sepia(0.2) brightness(0.96);
--genesis-mode-blend: multiply;
```

在 `[data-theme="candle"]` 中、现有 `--play-background-opacity` 后加入：

```css
--genesis-mode-opacity: 0.34;
--genesis-mode-filter: saturate(0.86) sepia(0.16) brightness(0.86) contrast(1.04);
--genesis-mode-blend: screen;
```

这些变量只控制模式叠层；不得改变通用 `PlayBackground` 的资源路径。

- [ ] **Step 5: 增加模式图层、保护遮罩与交叉淡入样式**

在 `.play-background--home` 之后加入：

```css
.genesis-mode-background {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}

.genesis-mode-background__image {
  object-fit: cover;
  object-position: center 38%;
  opacity: 0;
  filter: var(--genesis-mode-filter);
  mix-blend-mode: var(--genesis-mode-blend);
  transition: opacity 600ms ease;
}

.genesis-mode-background__image.is-active {
  opacity: var(--genesis-mode-opacity);
}

.genesis-mode-background::after {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse at 50% 64%,
      color-mix(in srgb, var(--paper) 58%, transparent) 0 24%,
      color-mix(in srgb, var(--paper) 24%, transparent) 46%,
      transparent 76%
    );
}
```

说明：

- `object-position` 把模式核心保留在中央偏上；
- 两张图片固定叠放，只有激活图层改变 `opacity`；
- `::after` 使用当前主题纸色保护表单区域；
- `mix-blend-mode` 在日卷中压入墨色，在烛光中提取金色；
- 不动画 `filter`、`transform` 或 `background-position`。

- [ ] **Step 6: 调整首页面板透光程度**

将 `.home-genesis-panel` 的背景从：

```css
background: color-mix(in srgb, var(--paper) 88%, transparent);
```

调整为：

```css
background: color-mix(in srgb, var(--paper) 84%, transparent);
```

不要降低模式卡片和 `textarea` 自身的实体纸张表面；它们继续承担文字可读性。

- [ ] **Step 7: 增加移动端和减少动态效果规则**

在现有 `@media (max-width: 640px)` 内加入：

```css
.genesis-mode-background__image {
  object-position: center 34%;
}

.genesis-mode-background__image.is-active {
  opacity: calc(var(--genesis-mode-opacity) * 0.72);
}

.genesis-mode-background::after {
  background:
    radial-gradient(
      ellipse at 50% 66%,
      color-mix(in srgb, var(--paper) 70%, transparent) 0 32%,
      color-mix(in srgb, var(--paper) 30%, transparent) 54%,
      transparent 82%
    );
}
```

在现有 `@media (prefers-reduced-motion: reduce)` 内加入：

```css
.genesis-mode-background__image {
  transition: none;
}
```

- [ ] **Step 8: 运行契约与相关业务测试**

```powershell
pnpm exec vitest run src/lib/genesis/home-background-contract.test.ts src/components/genesis/GenesisModeBackground.test.tsx src/lib/genesis/create-request.test.ts
```

Expected: PASS。`create-request.test.ts` 必须继续证明默认 `pantheon` 与切换后的 `creator` 请求负载不变。

- [ ] **Step 9: 运行源码检查**

```powershell
pnpm exec eslint src/app/page.tsx src/app/globals.css src/components/genesis/GenesisModeBackground.tsx src/components/genesis/GenesisModeBackground.test.tsx src/lib/genesis/home-background-contract.test.ts
```

若 ESLint 因 CSS 不在支持范围而报告“ignored file”警告，改为：

```powershell
pnpm exec eslint src/app/page.tsx src/components/genesis/GenesisModeBackground.tsx src/components/genesis/GenesisModeBackground.test.tsx src/lib/genesis/home-background-contract.test.ts
```

Expected: PASS。

- [ ] **Step 10: 提交首页接入**

```powershell
git add -- "src/app/page.tsx" "src/app/globals.css" "src/lib/genesis/home-background-contract.test.ts"
git commit -m "feat: link genesis modes to celestial backgrounds"
```

### Task 6: 四态视觉验收与完整回归

**Files:**
- Verify only: 本计划列出的全部资产与源码。

**Interfaces:**
- Consumes: Tasks 1–5 的完整实现。
- Produces: 可合入的、经过桌面／移动端、主题／模式、失败降级和完整构建验证的分支。

- [ ] **Step 1: 启动隔离 worktree 的开发服务器**

使用不会与主工作区冲突的端口，例如：

```powershell
pnpm dev -- --hostname 127.0.0.1 --port 3100
```

若通过 `Start-Process` 启动，必须使用 `-WindowStyle Hidden`。服务器准备好后打开 `http://127.0.0.1:3100/`。

- [ ] **Step 2: 验收桌面四种组合**

在约 `1440×1000` 视口依次检查：

```text
[ ] 日卷 × 诸神共世：可看出多核制衡，表单文字仍是第一视觉层级
[ ] 日卷 × 创世主：可看出单核与巨环，切换过程无闪白
[ ] 烛光 × 诸神共世：金核可辨但不发霓虹光
[ ] 烛光 × 创世主：单核突出但不压过标题和输入框
[ ] 两种模式切换时视角、主体中心和页面布局不跳动
[ ] 日／烛切换后模式语义保持不变
[ ] 输入框、错误文案、禁用按钮、典籍和素材入口都保持清晰
```

分别保存四态截图到临时 `output/` 目录用于比较，不提交这些截图。

- [ ] **Step 3: 验收 `390px` 移动端**

在 `390×844` 视口检查两种模式和两种主题：

```text
[ ] 页面没有横向滚动
[ ] 中央裁切仍能区分“多核”与“单核”
[ ] 模式背景强度低于桌面
[ ] 模式卡、神谕输入和底部按钮不被高对比纹理干扰
[ ] 页面滚动和点击区域不受装饰图层影响
```

在浏览器控制台验证：

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

Expected: `true`。

- [ ] **Step 4: 验收减少动态效果**

模拟 `prefers-reduced-motion: reduce` 后切换两种模式，确认图片直接切换，没有 `600ms` 淡入，同时页面其他功能正常。

- [ ] **Step 5: 验收图片失败降级**

在浏览器测试上下文中阻断：

```text
**/images/backgrounds/genesis-mode-creator.webp
```

切换到“创世主”并确认：

```text
[ ] 不显示破图图标或替代文字
[ ] 现有日／烛星图背景仍可见
[ ] 模式卡、输入框、主题切换和创世按钮仍可操作
[ ] 控制台没有 React 状态循环或未捕获异常
```

- [ ] **Step 6: 运行完整验证**

根目录 `pnpm lint` 会递归扫描本地 worktree 的 `.next`，因此只检查源码：

```powershell
pnpm test
pnpm exec eslint src
pnpm build
git diff --check HEAD~5..HEAD
git status --short
```

Expected:

```text
全部 Vitest 通过
ESLint 通过
生产构建通过
git diff --check 无输出
只存在本功能预期的已提交变更，无临时叠图或截图被跟踪
```

- [ ] **Step 7: 检查提交边界**

```powershell
git log --oneline --decorate -6
git diff --stat master...HEAD
git diff --name-status master...HEAD
```

Expected: 分支只包含两张 PNG 母版、两张 WebP、组件及测试、首页接入、全局样式和契约测试；不得包含主工作区原有 API、编年史、百科、活动、现实树或迁移改动。
