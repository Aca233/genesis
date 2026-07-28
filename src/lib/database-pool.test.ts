import { describe, expect, it } from "vitest";
import { databasePoolMax } from "./database-pool";

describe("databasePoolMax", () => {
  it.each([
    [undefined, 5],
    ["", 5],
    ["5", 5],
    ["10", 10],
    [" 10 ", 10],
  ])("把 %s 解析为 %d", (raw, expected) => {
    expect(databasePoolMax(raw)).toBe(expected);
  });

  it.each(["0", "51", "2.5", "abc"])("拒绝非法连接池上限 %s", (raw) => {
    expect(() => databasePoolMax(raw)).toThrow("DATABASE_POOL_MAX");
  });
});
