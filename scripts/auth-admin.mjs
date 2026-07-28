#!/usr/bin/env node
// 房主账号管理（朋友阶段，无邮件基础设施）。
import "dotenv/config";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function makeAuth({ allowSignUp }) {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: { enabled: true, disableSignUp: !allowSignUp, minPasswordLength: 8 },
    plugins: [admin({
      adminUserIds: (process.env.ADMIN_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    })],
  });
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "seed-owner" || command === "create-user") {
    const [email, password, name = email?.split("@")[0]] = args;
    if (!email || !password) throw new Error(`用法: node scripts/auth-admin.mjs ${command} <email> <password> [name]`);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log("用户已存在，跳过创建。userId=", existing.id);
    } else {
      const auth = makeAuth({ allowSignUp: true });
      const result = await auth.api.signUpEmail({ body: { email, password, name } });
      console.log("已创建用户:", result.user.id, result.user.email);
    }
    if (command === "seed-owner") console.log("请把该 id 填入 ADMIN_USER_IDS 并重启服务。");
  } else if (command === "set-password") {
    const [ownerEmail, ownerPassword, userId, newPassword] = args;
    if (!newPassword) throw new Error("用法: node scripts/auth-admin.mjs set-password <ownerEmail> <ownerPassword> <targetUserId> <newPassword>");
    const auth = makeAuth({ allowSignUp: false });
    const { headers } = await auth.api.signInEmail({
      body: { email: ownerEmail, password: ownerPassword },
      returnHeaders: true,
    });
    const cookie = (headers.get("set-cookie") ?? "").split(";")[0];
    if (!cookie) throw new Error("房主登录失败：未取得会话 cookie");
    await auth.api.setUserPassword({ body: { userId, newPassword }, headers: new Headers({ cookie }) });
    console.log("已重置密码:", userId);
  } else {
    throw new Error(`未知子命令: ${command ?? "(空)"}；可用: seed-owner | create-user | set-password`);
  }
} finally {
  await prisma.$disconnect();
}
