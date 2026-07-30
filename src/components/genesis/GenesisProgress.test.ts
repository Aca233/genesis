import { describe, expect, it } from "vitest";
import { genesisConnectionLabel } from "./GenesisProgress";

describe("genesisConnectionLabel", () => {
  it("distinguishes provider recovery from a broken progress connection", () => {
    expect(genesisConnectionLabel("waiting_for_provider", "live"))
      .toBe("模型服务暂不可用，后台自动重试");
    expect(genesisConnectionLabel("running", "reconnecting"))
      .toBe("连接中断，正在恢复");
  });
});
