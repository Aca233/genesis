#!/usr/bin/env node
// 回填回滚：仅在 owner 外键迁移部署前，把房主数据退回 user_id="local"。
import "dotenv/config";
import { argv, env } from "node:process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const OWNER_TABLES = [
  "worlds",
  "genesis_tasks",
  "material_cards",
  "settings",
  "lore_index_entries",
];
const LOCAL_USER_ID = "local";

function fail(message) {
  throw new Error(message);
}

const databaseUrl = env.DATABASE_URL?.trim();
if (!databaseUrl) fail("缺少 DATABASE_URL——检查 .env。");

const email = env.OWNER_EMAIL?.trim() || argv.find((value) => value.includes("@"));
if (!email) fail("缺少房主邮箱：设置 OWNER_EMAIL 或作为参数传入。");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main() {
  const fkRows = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n
    FROM information_schema.table_constraints
    WHERE constraint_name = 'worlds_user_id_fkey'
      AND table_name = 'worlds'
      AND constraint_type = 'FOREIGN KEY'
  `);
  if (fkRows[0].n > 0) {
    fail("owner 外键已生效，local 回滚窗口已关闭；请从数据库备份恢复。");
  }

  const owner = await prisma.user.findUnique({ where: { email } });
  if (!owner) fail(`找不到房主账号 ${email}。`);

  for (const table of OWNER_TABLES) {
    const foreignRows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${table}" WHERE "user_id" NOT IN ($1, $2)`,
      LOCAL_USER_ID,
      owner.id,
    );
    if (foreignRows[0].n > 0) {
      fail(`${table} 已含其他用户数据，禁止整体回滚。`);
    }
    const localRows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${table}" WHERE "user_id" = $1`,
      LOCAL_USER_ID,
    );
    const ownerRows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${table}" WHERE "user_id" = $1`,
      owner.id,
    );
    if (localRows[0].n > 0 && ownerRows[0].n > 0) {
      fail(`${table} 同时存在 local 与房主数据，无法无损整体回滚。`);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const table of OWNER_TABLES) {
      const changed = await tx.$executeRawUnsafe(
        `UPDATE "${table}" SET "user_id" = $1 WHERE "user_id" = $2`,
        LOCAL_USER_ID,
        owner.id,
      );
      rows.push({ table, rolledBack: changed });
    }
    return rows;
  });
  console.table(result);
  console.log("回填已回滚；请在部署 owner 外键前重新执行 backfill-local-to-owner.mjs。");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
