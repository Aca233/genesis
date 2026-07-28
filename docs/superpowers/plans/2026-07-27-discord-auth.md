# Discord Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有 better-auth 登录系统增加面向所有 Discord 用户的 OAuth 注册与登录。

**Architecture:** 服务端纯函数负责校验 Discord 环境变量并生成 provider 配置，auth 实例启用 Discord 且禁止隐式同邮箱合并。登录页由服务端按凭据状态决定是否渲染入口，客户端复用 safeNext 发起 OAuth 并处理错误回流。

**Tech Stack:** Next.js 16.2.10、React 19、better-auth 1.6.25、Vitest。

## Global Constraints

- 保留邮箱密码登录与 `disableSignUp: true`。
- Discord 首次授权允许自动注册。
- 禁止 OAuth 登录时隐式合并同邮箱账号。
- 不新增数据库迁移或依赖。

---

### Task 1: Discord 服务端配置

**Files:**
- Create: `src/lib/auth/discord.ts`
- Create: `src/lib/auth/discord.test.ts`
- Modify: `src/lib/auth/index.ts`

**Interfaces:**
- Produces: `getDiscordAuthConfig(env): { enabled: boolean; provider?: { clientId; clientSecret } }`

- [x] 先写凭据完整、均缺失、半配置三组失败测试。
- [x] 运行测试确认因接口不存在而失败。
- [x] 实现纯配置函数并接入 `socialProviders.discord`。
- [x] 设置 `account.accountLinking.disableImplicitLinking=true`。
- [x] 运行认证测试确认通过。

### Task 2: 登录页 OAuth 入口与错误回流

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/components/auth/LoginForm.tsx`
- Modify: `src/components/auth/LoginForm.test.ts`

**Interfaces:**
- Consumes: `getDiscordAuthConfig(process.env).enabled`
- Produces: `discordCallbackURL(next)`、`discordErrorCallbackURL(next)`、`discordErrorMessage(code)`

- [x] 先写 Discord 回跳、安全 next、错误映射与按开关渲染的失败测试。
- [x] 运行测试确认缺少行为。
- [x] 加入 Discord 按钮，调用 `authClient.signIn.social`。
- [x] 保留邮箱登录行为与原文案。
- [x] 运行登录页测试确认通过。

### Task 3: 配置与验证

**Files:**
- Modify: `.env.example`
- Modify: `deploy/README.md`

- [x] 记录 `DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET` 和回调 URI。
- [x] 运行认证专项测试与 `npx tsc --noEmit`。
- [x] 用假凭据调用 social sign-in 端点，断言 Discord authorize URL 与 callback URI。
- [x] 运行全量单测并记录真实 Discord 凭据这一外部验证边界。
