import { describe, expect, it } from "vitest";
import { getDiscordAuthConfig } from "./discord";

describe("getDiscordAuthConfig", () => {
  it("两个凭据都缺失时关闭 Discord 登录", () => {
    expect(getDiscordAuthConfig({})).toEqual({ enabled: false });
  });

  it("两个凭据齐全时启用 Discord 登录并裁掉首尾空白", () => {
    expect(
      getDiscordAuthConfig({
        DISCORD_CLIENT_ID: "  client-id  ",
        DISCORD_CLIENT_SECRET: "  client-secret  ",
      }),
    ).toEqual({
      enabled: true,
      provider: {
        clientId: "client-id",
        clientSecret: "client-secret",
      },
    });
  });

  it.each([
    [{ DISCORD_CLIENT_ID: "client-id" }, "DISCORD_CLIENT_SECRET"],
    [{ DISCORD_CLIENT_SECRET: "client-secret" }, "DISCORD_CLIENT_ID"],
  ])("只配置一半凭据时拒绝启动", (env, missing) => {
    expect(() => getDiscordAuthConfig(env)).toThrow(missing);
  });
});
