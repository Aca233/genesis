import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminRoots = ["src/app/admin", "src/components/admin", "src/lib/admin"];

function adminSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return adminSourceFiles(path);
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [path];
  });
}

describe("admin browser dialog boundary", () => {
  it("contains no prompt or alert calls in admin pages, components, or libraries", () => {
    const forbiddenBrowserDialog = new RegExp(`window\\.(?:${["prompt", "alert"].join("|")})\\s*\\(`);
    const findings = adminRoots.flatMap(adminSourceFiles).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbiddenBrowserDialog.test(source) ? [path] : [];
    });

    expect(findings).toEqual([]);
  });
});
