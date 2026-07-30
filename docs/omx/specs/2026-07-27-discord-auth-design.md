# Discord 开放注册与登录设计

## 目标

任何拥有 Discord 账号的人都可以通过 OAuth 首次注册并在之后直接登录《创世》，同时保留现有邮箱密码登录。

## 认证与账号规则

- 使用 better-auth 1.6.25 原生 `socialProviders.discord`，请求 Discord 的默认 `identify` 与 `email` scope。
- 首次成功授权自动创建 `User` 与 `Account(providerId=discord)`；现有账号表已满足需求，不新增迁移。
- 明确设置 `account.accountLinking.disableImplicitLinking=true`：Discord 邮箱若已被一个未绑定的本地账号占用，不自动合并，OAuth 返回登录页并提示先使用原方式登录。
- 邮箱密码自助注册继续关闭；房主分发的邮箱账号仍可正常登录。
- Discord 凭据只有在 `DISCORD_CLIENT_ID` 与 `DISCORD_CLIENT_SECRET` 同时存在时才启用。只配置一个变量视为部署错误并在服务启动时抛出明确错误。

## 页面与回跳

- `/login` 在 Discord 已配置时显示“使用 Discord 注册 / 登录”。未配置时只显示原邮箱登录，不提供失效按钮。
- OAuth 成功后回到经过 `safeNext` 收敛的站内路径。
- OAuth 失败回到 `/login`，以中文呈现取消授权、账号未绑定、邮箱缺失及通用错误；保留原始 `next` 目的地供重试。
- Discord Developer Portal 回调地址固定为 `<BETTER_AUTH_URL>/api/auth/callback/discord`。

## 验证

- 单元测试覆盖凭据开关、半配置拒绝、OAuth URL 构造、错误文案、安全回跳和原邮箱表单。
- 类型检查、认证专项测试和全量单测必须通过。
- 无真实 Discord Client Secret 时，通过本地假凭据验证 `/api/auth/sign-in/social` 生成正确 Discord authorize URL 与 callback URI；真实端到端授权需部署者填写 Discord Developer Portal 凭据。
