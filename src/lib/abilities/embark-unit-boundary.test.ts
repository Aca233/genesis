import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const currentUnitSuite = new URL("./embark.test.ts", import.meta.url);

function forbidden(...parts: string[]) {
  return parts.join("/");
}

describe("embark unit-test boundary", () => {
  it("默认单元套件不加载 dotenv、数据库客户端或 API route", async () => {
    const source = await readFile(currentUnitSuite, "utf8");

    expect(source).not.toContain(forbidden("dotenv", "config"));
    expect(source).not.toContain(forbidden("@", "lib", "db"));
    expect(source).not.toContain(forbidden("@", "app", "api", "worlds", "[id]", "embark", "route"));
  });
});
