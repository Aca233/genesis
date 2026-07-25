# Task 4 报告

## 实施内容

- 新增 `GenesisModeBackground` 客户端组件，渲染 Pantheon 与 Creator 两个静态背景图层。
- 根据 `mode` 为对应图层添加 `is-active`，并保留后续 CSS 所需的类名。
- 两个图层均使用 `preload`；图片加载失败时仅移除对应图层，不改变模式。
- 新增参数化静态渲染测试，覆盖两个模式、路径、激活类、预加载及无交互语义节点要求。

## TDD 记录

1. 组件尚不存在时运行指定 Vitest：失败，Vitest 报告 `No test files found`。
2. 添加失败测试。
3. 实现最小组件。
4. 运行指定 Vitest：通过，1 个测试文件、2 个测试通过。

## 校验

- `pnpm exec vitest run src/components/genesis/GenesisModeBackground.test.tsx`：PASS（2/2）。
- `pnpm exec eslint src/components/genesis/GenesisModeBackground.tsx src/components/genesis/GenesisModeBackground.test.tsx`：PASS（无错误、无警告）。
- 未修改首页、CSS 或资产。

## Commit

- `eff35c5 feat: add genesis mode background layers`

## Fix round 1

- 未新增测试依赖；项目未安装 `react-test-renderer`、`jsdom` 或 `@testing-library/react`。
- 增强参数化测试，严格断言恰好渲染两张指定图片，且仅当前模式图层具有 `is-active`。
- 通过捕获 `Image` props 精确断言两图均为装饰图、启用 `preload`，且不存在 `priority`、`role` 或 `tabIndex`。
- 增加失败路径测试，触发 Pantheon 图层的 `onError` 后断言只移除失败图层、保留 Creator 图层，并保持 `pantheon` 模式容器不变。
- `pnpm exec vitest run src/components/genesis/GenesisModeBackground.test.tsx`：PASS（3/3）。
- `pnpm exec eslint src/components/genesis/GenesisModeBackground.tsx src/components/genesis/GenesisModeBackground.test.tsx`：PASS（无错误、无警告）。
