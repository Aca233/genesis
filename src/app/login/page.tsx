import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { CelestialPageShell } from "@/components/layout/CelestialPageShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { getDiscordAuthConfig } from "@/lib/auth/discord";

export const metadata: Metadata = { title: "登入 · 创世" };

export default async function LoginPage() {
  // standalone 产物部署后才注入生产环境变量，必须在请求时读取。
  await connection();
  const discordEnabled = getDiscordAuthConfig(process.env).enabled;

  return (
    <CelestialPageShell contentClassName="login-page-content flex min-h-[calc(100vh-3rem)] items-center justify-center sm:min-h-[calc(100vh-5rem)]">
      <Suspense fallback={null}>
        <LoginForm discordEnabled={discordEnabled} />
      </Suspense>
    </CelestialPageShell>
  );
}
