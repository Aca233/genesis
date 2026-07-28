import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const bash = process.platform === "win32"
  ? "C:\\Program Files\\Git\\bin\\bash.exe"
  : "/bin/bash";

function bashPath(path: string): string {
  if (process.platform !== "win32") return path;
  return path.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/");
}

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(bash, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("production security scripts", () => {
  it("所有交付 shell 都能通过 bash 语法解析", () => {
    const scripts = [
      "deploy/harden-host.sh",
      "deploy/install-profile.sh",
      "deploy/preflight.sh",
      "deploy/activate-release.sh",
      "deploy/build-and-ship.sh",
      "deploy/backup.sh",
      "deploy/restore.sh",
      "deploy/security-check.sh",
    ];
    for (const script of scripts) {
      expect(existsSync(join(root, script)), `${script} 应存在`).toBe(true);
      const result = run(["-n", script]);
      expect(result.status, `${script}: ${result.stderr}`).toBe(0);
    }
  });

  it("SSH 加固模板禁用 root 与密码登录", () => {
    const config = readFileSync(join(root, "deploy/sshd-hardening.conf"), "utf8");
    expect(config).toContain("PermitRootLogin no");
    expect(config).toContain("PasswordAuthentication no");
    expect(config).toContain("AllowTcpForwarding local");
  });

  it.each([
    ["2c2g", "NODE_MEMORY_HIGH=1024M", "DATABASE_POOL_MAX=5"],
    ["4c4g", "NODE_MEMORY_HIGH=2304M", "DATABASE_POOL_MAX=10"],
  ])("%s profile 输出经过校验的资源水位", (profile, memory, pool) => {
    const result = run(["deploy/install-profile.sh", "--print", profile]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(memory);
    expect(result.stdout).toContain(pool);
    expect(result.stdout).not.toContain("GENERATION_CONNECTIONS");
  });

  it("nginx 不以连接数或生成专用速率限制正常生成", () => {
    const nginx = readFileSync(join(root, "deploy/nginx.conf"), "utf8");
    expect(nginx).not.toContain("limit_conn");
    expect(nginx).not.toContain("genesis_generation_rate");
    expect(nginx).toContain("limit_req zone=genesis_api burst=30 nodelay;");
    expect(nginx).toContain("proxy_buffering off;");
    expect(nginx).toContain("include /etc/nginx/snippets/cloudflare-realip.conf;");
    expect(nginx.split("location ^~ /.well-known/acme-challenge/")).toHaveLength(3);
    expect(nginx).toContain("www.<your-domain.example.com>");
  });

  it("SSH 加固使用首优先级 drop-in 并审计实际生效值", () => {
    const hardening = readFileSync(join(root, "deploy/harden-host.sh"), "utf8");
    expect(hardening).toContain("/00-genesis-hardening.conf");
    expect(hardening).toContain('sshd -T 2>/dev/null | grep -Fx "passwordauthentication no"');
    expect(hardening).toContain('sshd -T 2>/dev/null | grep -Fx "permitrootlogin no"');
    expect(hardening).not.toContain("cat >/etc/ssh/sshd_config.d/99-genesis-hardening.conf");
  });

  it("未知 profile 被拒绝", () => {
    const result = run(["deploy/install-profile.sh", "--print", "8c16g"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("2c2g");
    expect(result.stderr).toContain("4c4g");
  });

  it("release 验证拒绝携带 .env 的产物", () => {
    const temp = mkdtempSync(join(tmpdir(), "genesis-release-"));
    mkdirSync(join(temp, ".next"), { recursive: true });
    writeFileSync(join(temp, "server.js"), "// fixture");
    writeFileSync(join(temp, ".env"), "SECRET=leak");
    const result = run(["deploy/activate-release.sh", "--validate-only", bashPath(temp)]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(".env");
  });

  it("release 验证接受最小 standalone 产物", () => {
    const temp = mkdtempSync(join(tmpdir(), "genesis-release-"));
    mkdirSync(join(temp, ".next", "static"), { recursive: true });
    mkdirSync(join(temp, "public"), { recursive: true });
    writeFileSync(join(temp, "server.js"), "// fixture");
    const result = run(["deploy/activate-release.sh", "--validate-only", bashPath(temp)]);
    expect(result.status, result.stderr).toBe(0);
  });

  it("备份配置缺少 age recipient 或异地目标时 fail closed", () => {
    const temp = mkdtempSync(join(tmpdir(), "genesis-backup-"));
    const envFile = join(temp, "genesis.env");
    writeFileSync(envFile, "DATABASE_URL=postgresql://localhost/genesis\n");
    const result = run(["deploy/backup.sh", "--check-config"], {
      ENV_FILE: bashPath(envFile),
      CHECK_COMMANDS: "0",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("BACKUP_AGE_RECIPIENT");
  });
});
