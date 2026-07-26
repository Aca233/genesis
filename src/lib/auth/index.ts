import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { prisma } from "../db"; // 相对导入:供 @better-auth/cli generate 加载

function adminUserIds(): string[] {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const auth = betterAuth({
  appName: "创世",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // 朋友阶段:房主建号,无自助注册(设计文档 §2.3)
    minPasswordLength: 8,
  },
  plugins: [admin({ adminUserIds: adminUserIds() })],
});
