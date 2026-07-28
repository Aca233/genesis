type DiscordEnv = Readonly<Record<string, string | undefined>>;

export type DiscordAuthConfig =
  | { enabled: false }
  | {
      enabled: true;
      provider: {
        clientId: string;
        clientSecret: string;
      };
    };

/** Discord OAuth 只有在两项凭据同时存在时启用，避免部署出一个必然失败的登录入口。 */
export function getDiscordAuthConfig(env: DiscordEnv): DiscordAuthConfig {
  const clientId = env.DISCORD_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim() ?? "";

  if (!clientId && !clientSecret) return { enabled: false };
  if (!clientId) {
    throw new Error("已配置 DISCORD_CLIENT_SECRET，但缺少 DISCORD_CLIENT_ID");
  }
  if (!clientSecret) {
    throw new Error("已配置 DISCORD_CLIENT_ID，但缺少 DISCORD_CLIENT_SECRET");
  }

  return {
    enabled: true,
    provider: { clientId, clientSecret },
  };
}
