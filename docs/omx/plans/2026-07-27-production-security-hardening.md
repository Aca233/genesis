# Production Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $ralph to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付支持 2C2G/4C4G 的 Debian/Ubuntu 单机生产安全部署套件。

**Architecture:** nginx 负责 TLS、Host 门、响应头和流量水位；systemd 与主机脚本负责最小权限和网络边界；release 激活器负责原子发布与回滚；age+rclone 负责加密异地备份；security-check 汇总上线证据。

**Tech Stack:** Bash、nginx、systemd、UFW、Fail2ban、PostgreSQL 16、age、rclone、Next.js standalone。

## Global Constraints

- 不连接或修改真实服务器。
- `harden-host.sh` 默认只审计，只有显式 `--apply` 才修改。
- 关闭 SSH 密码前必须证明 deploy 用户已有公钥。
- release 与备份失败必须 fail closed。
- 资源 profile 只能是 `2c2g` 或 `4c4g`。

---

### Task 1: 可执行契约测试与 profiles

- [x] 写入会执行真实 shell 模式的失败测试。
- [x] 实现 profile 打印、安装和输入校验。
- [x] 接入数据库连接池 profile。

### Task 2: nginx 与 systemd

- [x] 加入 TLS、Host、安全头、限流和 SSE 规则。
- [x] 加强 systemd 沙箱并接入 preflight/profile drop-in。
- [x] 验证配置可解析且 profile 数值符合契约。

### Task 3: 主机加固与原子发布

- [x] 实现 host audit/apply 双模式与 SSH 防锁死守卫。
- [x] 实现 release validate、原子切换、健康检查、失败回滚与版本清理。
- [x] 把 build-and-ship 改为上传新 release 后调用激活器。

### Task 4: 加密备份与验收

- [x] 把备份改为 age 加密、rclone 必需、systemd timer 调度。
- [x] 更新恢复脚本支持加密 dump。
- [x] 实现 security-check 并更新部署手册。

### Task 5: 全量验证

- [x] 运行 deploy 可执行契约测试、所有 shell 语法检查、TypeScript、lint 与全量单测。
- [x] 记录 Linux 专属验证边界和买服务器后的首次执行顺序。
