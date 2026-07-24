# 通用星图古卷双主题背景实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成、加工并接入一组构图一致的日卷/烛光星图古卷背景，在增强主游玩页氛围的同时维持长文本可读性。

**Architecture:** 先用 `gpt-image-2` 生成 3840×2160 日卷 PNG 母版，再以母版作为参考图编辑出同构烛光 PNG。验收后用 FFmpeg 导出网页 WebP，由主游玩页专用的 `PlayBackground` 展示；CSS 根据现有 `html[data-theme="candle"]` 自动切换图片，其他路由不加载该视觉层。

**Tech Stack:** `gpt-image-2`、PNG、FFmpeg 7、WebP、Next.js 16 App Router、React 19、Tailwind CSS v4、Vitest。

## Global Constraints

- 原始图与最终图均为 `3840 × 2160`、16:9。
- 中央横向约 58%、纵向约 86% 必须是低细节、低对比的正文阅读安全区。
- 不得出现文字、字母、数字、伪文字、人物、动物、建筑、武器、具体世界地貌、徽标或水印。
- 主要装饰只放在左右各约 21% 的侧翼和四角；构图平衡但不精确镜像。
- 日卷和烛光版的星图、轨道、符印、边饰必须位置一致；烛光版只改颜色、明度、材质气氛和金墨亮度。
- 背景四周自然延伸到画布边缘，并能承受 CSS `cover` 的少量裁切。
- 不加入动态粒子、视差或常驻发光动画。
- 只接入主游玩页；首页、创世仪式和抽屉内部不新增独立插画。
- 按项目规则，修改代码前以 `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` 为 Next.js 16 CSS 行为依据。

---

## 文件结构

- Create: `art/backgrounds/play-celestial-day-source.png` — 日卷原始母版，保留用于后续返工。
- Create: `art/backgrounds/play-celestial-candle-source.png` — 参考编辑得到的烛光原始母版。
- Create: `public/images/backgrounds/play-celestial-day.webp` — 日卷网页资源。
- Create: `public/images/backgrounds/play-celestial-candle.webp` — 烛光网页资源。
- Create: `src/components/play/PlayBackground.tsx` — 主游玩页的无语义背景层。
- Create: `src/components/play/PlayBackground.test.tsx` — 背景层的结构与可访问性测试。
- Modify: `src/app/play/[worldId]/page.tsx` — 只在主游玩页挂载背景层。
- Modify: `src/app/globals.css` — 定义双主题背景资源、覆盖方式、透明度和窄屏降噪。
- Modify: `.gitignore` — 忽略本地视觉讨论工具产生的 `/.superpowers/`。

### Task 1: 生成并验收日卷母版

**Files:**
- Create: `art/backgrounds/play-celestial-day-source.png`

**Interfaces:**
- Consumes: 已确认的视觉规格 `docs/superpowers/specs/2026-07-24-universal-celestial-parchment-background-design.md`。
- Produces: 一张通过验收的 `3840×2160` RGB/RGBA PNG，供 Task 2 作为唯一参考图。

- [ ] **Step 1: 用 gpt-image-2 生成日卷母版**

参数：

```text
Model: gpt-image-2
Size: 3840x2160
Quality: high
Output format: PNG
```

复制下面整段作为提示词：

```text
Use case: stylized-concept
Asset type: full-screen background for the main reading view of a text-heavy Chinese fantasy worldbuilding web game

Create a universal celestial parchment background, viewed perfectly straight-on as a flat 2D artwork. It should feel like an ancient atlas of creation laid across the entire screen: refined, quiet, mysterious, scholarly, and suitable behind long passages of Chinese text.

Canvas and composition:
- Exact landscape canvas, 3840 × 2160, 16:9.
- Reserve the central 58% of the canvas width and central 86% of the canvas height as a calm reading-safe zone.
- Inside that central safe zone, show only very subtle, low-frequency, low-contrast parchment fibers and gentle tonal variation.
- Do not place stars, bright dots, orbital intersections, sigils, map outlines, borders, stains, or focal details inside the reading-safe zone.
- Concentrate decoration in the left and right outer 21% side wings and in the four corners.
- Keep the two sides visually balanced but not perfectly mirrored.
- Let all textures and decorations continue naturally to the canvas edges so the image can be cropped slightly with CSS background-size: cover.

Visual content:
- Warm ivory and pale beige aged parchment, clean and elegant rather than dirty.
- Fine faded sepia and smoky-gray celestial-chart linework.
- Sparse desaturated antique-gold star points, never bright white.
- Delicate constellation arcs, partial concentric orbital diagrams, faint antique contour-map lines, and a few purely geometric creation sigils.
- The geometric sigils must be isolated decorative shapes, not a writing system and not arranged like sentences.
- Subtle hand-inked irregularity, restrained cartographic filigree near the outer edges, museum-quality fantasy illustration.
- Matte paper texture, soft diffuse illumination, no dramatic shadows.

Palette:
- Base parchment close to warm ivory #F3EAD8.
- Raised highlights near #F8F1E3.
- Ink lines in muted dark brown and smoky taupe.
- Sparse accents in low-saturation antique gold close to #A87F2E.
- Keep contrast low enough to remain a secondary visual layer behind dark brown body text.

Hard constraints:
- No text of any language.
- No letters, numbers, labels, captions, compass words, calligraphy, pseudo-writing, fake runes, or watermark.
- No people, faces, hands, animals, gods, buildings, temples, weapons, ships, planets rendered as realistic globes, or recognizable real-world geography.
- No book, scroll object, desk, tabletop, page edge, frame, border, vignette frame, perspective view, mockup, UI, buttons, or text boxes.
- No torn holes, heavy mold, blood, soot, burned edges, black corners, strong stains, high-contrast focal point, neon glow, or dense star field.
- Do not make the center blank white; it should remain natural parchment, just quiet and low-detail.

The final result must read as one continuous premium background texture: richly authored at the sides, exceptionally calm in the center, and immediately usable beneath a long-form reading interface.
```

- [ ] **Step 2: 校验文件属性**

将下载的原图保存为 `art/backgrounds/play-celestial-day-source.png`，运行：

```powershell
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt -of default=noprint_wrappers=1 "art/backgrounds/play-celestial-day-source.png"
```

Expected:

```text
width=3840
height=2160
```

- [ ] **Step 3: 进行视觉验收**

用图片查看工具检查以下各项：

```text
[ ] 中央阅读安全区没有星点、圆环交点、符印或强污渍
[ ] 左右侧翼都有装饰，但没有完全镜像
[ ] 没有任何文字、伪文字、水印或具体世界元素
[ ] 没有书本、桌面、画框或透视场景
[ ] 日卷纸张温润干净，不脏黄、不焦黑
[ ] 四边可以少量裁切而不破坏构图
```

若仅有一个局部问题，用一次定向编辑修复，不要重新扩写创意。例如：

```text
Edit only the central reading-safe zone: remove the bright orbital intersection and restore it as quiet low-contrast parchment fibers. Preserve every other element, color, position, and canvas dimension exactly. Add no text and no new decoration.
```

- [ ] **Step 4: 提交日卷母版**

```powershell
git add -- "art/backgrounds/play-celestial-day-source.png"
git commit -m "art: add celestial parchment day master"
```

### Task 2: 参考编辑烛光版并验证构图一致性

**Files:**
- Create: `art/backgrounds/play-celestial-candle-source.png`

**Interfaces:**
- Consumes: `art/backgrounds/play-celestial-day-source.png`，角色为“唯一编辑目标和构图参考图”。
- Produces: 与日卷母版同尺寸、同构图的烛光 PNG，供 Task 3 转码。

- [ ] **Step 1: 将日卷母版作为输入图编辑**

参数：

```text
Model: gpt-image-2
Input image: art/backgrounds/play-celestial-day-source.png
Input image role: edit target and exact composition reference
Size: 3840x2160
Quality: high
Output format: PNG
```

复制下面整段作为编辑提示词：

```text
Use case: lighting-weather
Asset type: candle-dark-theme counterpart of an existing full-screen game background
Input image: Image 1 is the edit target and the exact composition reference.

Convert Image 1 into a candlelit dark-parchment theme.

Absolute preservation requirements:
- Preserve the exact 3840 × 2160 canvas, crop, geometry, composition, and spatial alignment.
- Preserve every celestial line, constellation arc, star point, contour line, geometric creation sigil, corner ornament, paper mark, and empty area in exactly the same location, at the same scale and with the same silhouette.
- Do not add, remove, move, rotate, redraw, simplify, or reinterpret any decorative element.
- Preserve the central 58%-wide and 86%-high reading-safe zone as the same calm, low-detail area.
- This is a palette, material, and illumination conversion only.

Theme conversion:
- Change the parchment base from warm ivory to deep warm umber close to #2B241C.
- Use slightly raised dark-brown paper variation close to #332B21 and recessed tones close to #241E16.
- Convert the ink lines into restrained warm taupe and near-black brown layers that remain visible but subtle.
- Convert the sparse antique-gold points and selected fine accents to muted candle gold close to #C9A356.
- Give the gold only a very soft, diffuse candlelit presence; no neon bloom, no halos, no bright white stars.
- Keep the paper tactile and matte, with faint fibers visible in the dark tones.
- Maintain enough tonal separation to support warm off-white body text, while keeping the background secondary.

Hard constraints:
- Change only palette, luminance, paper material mood, and restrained gold intensity.
- No text of any language, letters, numbers, labels, captions, pseudo-writing, runes, logos, or watermark.
- No new objects, figures, buildings, scenery, borders, frames, shadows, smoke, flames, candles, burned edges, or vignettes.
- Do not crush the image into pure black.
- Do not brighten or decorate the central reading-safe zone.
- Do not crop, resize, shift, or change aspect ratio.

The result must look like the exact same ancient celestial atlas viewed in candle mode, so switching between the two images produces no visible layout jump.
```

- [ ] **Step 2: 保存并校验文件属性**

保存为 `art/backgrounds/play-celestial-candle-source.png`，运行：

```powershell
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt -of default=noprint_wrappers=1 "art/backgrounds/play-celestial-candle-source.png"
```

Expected:

```text
width=3840
height=2160
```

- [ ] **Step 3: 叠图检查位置漂移**

生成 50% 透明叠图，仅用于检查，不提交：

```powershell
ffmpeg -y -i "art/backgrounds/play-celestial-day-source.png" -i "art/backgrounds/play-celestial-candle-source.png" -filter_complex "[0:v][1:v]blend=all_mode=average" "art/backgrounds/play-celestial-alignment-check.png"
```

查看叠图并确认：

```text
[ ] 主要轨道与地图线没有双影
[ ] 星点没有成对错位
[ ] 边角符印轮廓没有漂移
[ ] 中央安全区边界没有变化
```

检查结束后删除 `art/backgrounds/play-celestial-alignment-check.png`。若出现明显双影，用日卷母版重新执行一次烛光编辑，并进一步强调“palette-only edit”。

- [ ] **Step 4: 提交烛光母版**

```powershell
git add -- "art/backgrounds/play-celestial-candle-source.png"
git commit -m "art: add celestial parchment candle master"
```

### Task 3: 转码网页资源并验证画质

**Files:**
- Create: `public/images/backgrounds/play-celestial-day.webp`
- Create: `public/images/backgrounds/play-celestial-candle.webp`

**Interfaces:**
- Consumes: 两张通过验收的 3840×2160 PNG 母版。
- Produces: 两张同尺寸 WebP，供 CSS URL 直接引用。

- [ ] **Step 1: 导出 WebP**

```powershell
New-Item -ItemType Directory -Force "public/images/backgrounds" | Out-Null
ffmpeg -y -i "art/backgrounds/play-celestial-day-source.png" -c:v libwebp -quality 82 -compression_level 6 -preset picture "public/images/backgrounds/play-celestial-day.webp"
ffmpeg -y -i "art/backgrounds/play-celestial-candle-source.png" -c:v libwebp -quality 82 -compression_level 6 -preset picture "public/images/backgrounds/play-celestial-candle.webp"
```

- [ ] **Step 2: 校验尺寸和文件体积**

```powershell
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt -of default=noprint_wrappers=1 "public/images/backgrounds/play-celestial-day.webp"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt -of default=noprint_wrappers=1 "public/images/backgrounds/play-celestial-candle.webp"
Get-Item "public/images/backgrounds/*.webp" | Select-Object Name,Length
```

Expected:

```text
两张均为 width=3840、height=2160
单张目标体积不超过 2.5 MB
```

如果任意一张超过 2.5 MB，将该图 `-quality 82` 改为 `-quality 76` 重导一次；不要降尺寸。

- [ ] **Step 3: 对比原图和 WebP**

放大检查星图细线、纸张纤维和渐变区域，确认没有明显块状色带、细线断裂或金点糊边。

- [ ] **Step 4: 提交网页资源**

```powershell
git add -- "public/images/backgrounds/play-celestial-day.webp" "public/images/backgrounds/play-celestial-candle.webp"
git commit -m "art: add optimized play background assets"
```

### Task 4: 建立主游玩页专用背景层

**Files:**
- Create: `src/components/play/PlayBackground.test.tsx`
- Create: `src/components/play/PlayBackground.tsx`
- Modify: `src/app/play/[worldId]/page.tsx:21-24,585-589`

**Interfaces:**
- Consumes: CSS class `play-background`。
- Produces: `PlayBackground(): React.JSX.Element`，只渲染一个 `aria-hidden` 的装饰层。

- [ ] **Step 1: 写失败测试**

创建 `src/components/play/PlayBackground.test.tsx`：

```tsx
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayBackground } from "./PlayBackground";

describe("PlayBackground", () => {
  it("渲染无语义且不可交互的主游玩页背景层", () => {
    const html = renderToStaticMarkup(createElement(PlayBackground));

    expect(html).toContain('class="play-background"');
    expect(html).toContain('aria-hidden="true"');
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
pnpm test -- "src/components/play/PlayBackground.test.tsx"
```

Expected: FAIL，错误包含无法解析 `./PlayBackground`。

- [ ] **Step 3: 实现最小组件**

创建 `src/components/play/PlayBackground.tsx`：

```tsx
export function PlayBackground() {
  return <div className="play-background" aria-hidden="true" />;
}
```

- [ ] **Step 4: 在主游玩页挂载**

在 `src/app/play/[worldId]/page.tsx` 的其他 play 组件 import 附近加入：

```tsx
import { PlayBackground } from "@/components/play/PlayBackground";
```

将主界面根节点：

```tsx
<main className="relative flex min-h-screen flex-col">
```

改为：

```tsx
<main className="play-shell relative flex min-h-screen flex-col">
  <PlayBackground />
```

`PlayBackground` 必须是 `main` 的第一个子节点，且不挂载到 loading/error 分支和其他路由。

- [ ] **Step 5: 运行测试**

```powershell
pnpm test -- "src/components/play/PlayBackground.test.tsx"
```

Expected: PASS。

- [ ] **Step 6: 提交组件接入**

```powershell
git add -- "src/components/play/PlayBackground.tsx" "src/components/play/PlayBackground.test.tsx" "src/app/play/[worldId]/page.tsx"
git commit -m "feat: mount themed play background layer"
```

### Task 5: 定义双主题背景样式

**Files:**
- Modify: `src/app/globals.css:10-40,66-80,125`

**Interfaces:**
- Consumes: `html[data-theme="candle"]` 和两张 `/images/backgrounds/*.webp`。
- Produces: `--play-background-image`、`--play-background-opacity` 主题变量，以及 `.play-shell` / `.play-background` 样式。

- [ ] **Step 1: 在主题变量中注册图片**

在 `:root` 末尾加入：

```css
  --play-background-image: url("/images/backgrounds/play-celestial-day.webp");
  --play-background-opacity: 0.58;
```

在 `[data-theme="candle"]` 末尾加入：

```css
  --play-background-image: url("/images/backgrounds/play-celestial-candle.webp");
  --play-background-opacity: 0.66;
```

- [ ] **Step 2: 添加主游玩页背景层样式**

在 `body > *` 规则之后加入：

```css
.play-shell {
  isolation: isolate;
  background: transparent;
}

.play-background {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-color: var(--paper);
  background-image:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--paper) 12%, transparent),
      transparent 22% 78%,
      color-mix(in srgb, var(--paper) 12%, transparent)
    ),
    var(--play-background-image);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  opacity: var(--play-background-opacity);
  transition: opacity 0.6s ease;
}

@media (max-width: 640px) {
  .play-background {
    background-position: center;
    opacity: calc(var(--play-background-opacity) * 0.72);
  }
}

@media (prefers-reduced-motion: reduce) {
  .play-background {
    transition: none;
  }
}
```

- [ ] **Step 3: 运行静态检查和构建**

```powershell
pnpm lint
pnpm build
```

Expected: 两条命令均退出码 0。

- [ ] **Step 4: 提交样式**

```powershell
git add -- "src/app/globals.css"
git commit -m "feat: style dual-theme celestial play backgrounds"
```

### Task 6: 视觉验收与针对性加工

**Files:**
- Modify if needed: `art/backgrounds/play-celestial-day-source.png`
- Modify if needed: `art/backgrounds/play-celestial-candle-source.png`
- Modify if needed: `public/images/backgrounds/play-celestial-day.webp`
- Modify if needed: `public/images/backgrounds/play-celestial-candle.webp`
- Modify if needed: `src/app/globals.css`

**Interfaces:**
- Consumes: 已运行的主游玩页、日卷/烛光主题切换。
- Produces: 在常见桌面与手机宽度下通过可读性和构图验收的最终背景。

- [ ] **Step 1: 启动项目并打开真实存档**

```powershell
pnpm dev
```

在浏览器打开一个已有的 `/play/<worldId>`，优先选取包含多段长正文和底部输入区的存档。

- [ ] **Step 2: 验收桌面日卷**

在 `1440×900` 与 `1920×1080` 下检查：

```text
[ ] 正文是第一视觉层级
[ ] 左右侧翼有可见星图装饰
[ ] 中央没有穿过文字的亮线、星点或符印
[ ] 顶部标题、右缘符文列、底部输入区边界清晰
[ ] 页面滚动时背景固定且没有接缝
```

- [ ] **Step 3: 验收桌面烛光并检查切换**

切换到烛光模式，检查同样两种尺寸：

```text
[ ] 暖白正文保持清晰
[ ] 深褐背景仍保留纸纹和侧翼线条，没有糊成纯黑
[ ] 日卷/烛光切换时星图位置没有视觉跳动
[ ] 金色点缀不比 UI 的主烫金按钮更亮
```

- [ ] **Step 4: 验收窄屏**

在 `390×844` 下检查：

```text
[ ] 背景被裁切后中央仍安静
[ ] 底部符文栏和输入区不受影响
[ ] 侧翼残留装饰不形成突兀竖线
```

- [ ] **Step 5: 只做单变量修正**

按问题类型一次只调整一项：

```text
背景整体太抢眼 → 每次降低 --play-background-opacity 0.05
背景几乎不可见 → 每次提高 --play-background-opacity 0.04
中央仍太花 → 优先编辑源图清理中央，不用大面积 CSS 模糊
窄屏边缘过乱 → 仅降低移动端 opacity，最低不低于桌面值的 0.55 倍
两主题构图错位 → 重新执行烛光参考编辑，不用 CSS 位移补偿
```

每次修改后重新导出受影响的 WebP，并复查日卷、烛光和窄屏三种状态。

- [ ] **Step 6: 运行完整验证**

```powershell
pnpm test
pnpm lint
pnpm build
git diff --check
```

Expected: 所有命令退出码 0。

- [ ] **Step 7: 提交视觉定稿**

```powershell
git add -- "art/backgrounds" "public/images/backgrounds" "src/app/globals.css"
git commit -m "polish: finalize celestial play backgrounds"
```

### Task 7: 清理本地视觉讨论产物

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 本地 `.superpowers/brainstorm/` 视觉讨论文件。
- Produces: Git 不再把本地视觉辅助会话显示为未跟踪项目。

- [ ] **Step 1: 写入忽略规则**

在 `.gitignore` 的 `# local agent/runtime state` 小节加入：

```gitignore
/.superpowers/
```

- [ ] **Step 2: 确认忽略生效**

```powershell
git status --short
```

Expected: 输出中不再出现 `?? .superpowers/`。

- [ ] **Step 3: 提交**

```powershell
git add -- ".gitignore"
git commit -m "chore: ignore visual companion state"
```

