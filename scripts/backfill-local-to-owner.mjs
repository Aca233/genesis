#!/usr/bin/env node
// 多租户 Phase A 数据回填：把单机期 user_id="local" 的数据转给房主。
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

const dryRun = argv.includes("--dry-run");
const email = env.OWNER_EMAIL?.trim() || argv.find((value) => value.includes("@"));
if (!email) fail("缺少房主邮箱：设置 OWNER_EMAIL 或作为参数传入。");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function countRows(client, table, userId) {
  const rows = await client.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "${table}" WHERE "user_id" = $1`,
    userId,
  );
  return rows[0].n;
}

async function main() {
  const owner = await prisma.user.findUnique({ where: { email } });
  if (!owner) fail(`找不到房主账号 ${email}——请先运行 auth-admin.mjs seed-owner。`);
  if (owner.id === LOCAL_USER_ID) fail("房主 id 不允许为 local。");

  const before = [];
  for (const table of OWNER_TABLES) {
    before.push({
      table,
      local: await countRows(prisma, table, LOCAL_USER_ID),
      owner: await countRows(prisma, table, owner.id),
    });
  }

  const clashes = before.filter((row) => row.local > 0 && row.owner > 0);
  if (clashes.length > 0) {
    fail(`房主名下已有数据，无法无损整体回填：${clashes.map((row) => row.table).join("、")}`);
  }

  console.table(before);
  if (dryRun) {
    console.log(`dry-run：将把以上 local 数据转给 ${email} (${owner.id})，未写库。`);
    return;
  }

  const migrated = await prisma.$transaction(async (tx) => {
    const result = [];
    for (const row of before) {
      const changed = await tx.$executeRawUnsafe(
        `UPDATE "${row.table}" SET "user_id" = $1 WHERE "user_id" = $2`,
        owner.id,
        LOCAL_USER_ID,
      );
      const remaining = await countRows(tx, row.table, LOCAL_USER_ID);
      const owned = await countRows(tx, row.table, owner.id);
      if (changed !== row.local || remaining !== 0 || owned !== row.owner + row.local) {
        fail(`${row.table} 回填计数不一致，事务已回滚。`);
      }
      result.push({ table: row.table, migrated: changed, remainingLocal: remaining });
    }
    return result;
  });

  console.table(migrated);
  console.log(`回填完成：存量数据现归 ${email} (${owner.id})。`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
